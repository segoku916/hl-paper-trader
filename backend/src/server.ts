/**
 * Hyperliquid Paper Trader — backend (Day 1 + Day 2 + Day 3 + Day 4).
 *
 * Owns ALL secrets and API keys. The glasses app never sees a key — it talks
 * only to this server. Paper trading only; no wallet, no signing, no real funds.
 *
 * Endpoints:
 *   GET /health     liveness probe (version 0.4.0, Telegram status)
 *   GET /prices     live BTC/ETH/SOL mids + 24h change (Hyperliquid allMids)
 *   GET /positions  paper portfolio: cash, equity, positions, fills (Day 2)
 *   POST /order     execute a confirmed paper order at the live mid (Day 2);
 *                   accepts {pendingOrderId} for the shared confirm path (Day 4)
 *   POST /order/cancel  cancel a pending order (Day 4): a glasses scroll-No
 *                   or 20 s timeout cancels the shared order so a Telegram
 *                   Yes can no longer execute it either
 *   POST /stt       transcribe glasses mic PCM via Groq Whisper (Day 3)
 *   POST /intent    parse a transcript + preview the order, no execution (Day 3);
 *                   alert intents are stored for real (Day 4)
 *   POST /alerts    create a price alert {coin, direction, price} (Day 4)
 *   GET /alerts     list price alerts, newest first (Day 4)
 *   WS  /stream     live mids + fill notifications pushed to glasses clients
 *
 * Day 4: a grammY Telegram bot (src/telegram.ts, polling) runs next to the
 * HTTP/WS server and shares the ledger + mids. Pending orders live in ONE
 * store (src/pendingOrders.ts) both confirm paths use: a glasses tap YES
 * and a Telegram inline Yes claim the same order, so one order executes
 * at most once. A 5 s timer evaluates stored price alerts against live
 * mids and fires each once to the paired Telegram chat.
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { HyperliquidFeed } from './hl.js';
import { PaperLedger, LedgerError } from './ledger.js';
import { parseIntent } from './intent.js';
import { buildPreview } from './preview.js';
import { transcribePcm, SttError, STT_BODY_CAP_BYTES, STT_MAX_BYTES } from './stt.js';
import { PendingOrderStore } from './pendingOrders.js';
import { createTelegramBot, formatFillMessage, formatOrderConfirm, type TelegramHandle, type ExecutePendingResult } from './telegram.js';

const PORT = Number(process.env.PORT ?? 3000);
// Test runs point LEDGER_DB at a temp file so the real paper account (starting
// equity $10,000) is never polluted by verification trades.
const ledger = new PaperLedger(process.env.LEDGER_DB ?? 'data/paper-ledger.db');

const feed = new HyperliquidFeed();
feed.start();

const pendingOrders = new PendingOrderStore();

/** Current live mids keyed by coin (null until the feed has a value). */
function currentMarks(): Record<string, number | null> {
  const marks: Record<string, number | null> = {};
  for (const p of feed.snapshot()) marks[p.coin] = p.mid;
  return marks;
}

// Telegram handle — null when TELEGRAM_BOT_TOKEN is missing (log + keep the
// HTTP server up; /health reports telegram: unavailable). Assigned below,
// after executePendingOrderOnce is defined (the bot's Yes handler calls it).
let telegram: TelegramHandle | null = null;

/**
 * THE shared claim-and-execute path (Day 4): both the glasses POST /order
 * (with pendingOrderId) and the Telegram inline Yes run this exact code.
 * Claim is atomic in the pending store; execution is synchronous in the
 * ledger, so exactly one confirm path can ever fill a given order.
 * On success: notify Telegram + broadcast the fill + edit the Telegram
 * confirm message to FILLED (the Telegram sends are fire-and-forget —
 * they must never block or fail the order response).
 */
async function executePendingOrderOnce(id: string): Promise<ExecutePendingResult> {
  const pending = pendingOrders.claimForExecution(id);
  if (!pending) {
    return { ok: false, status: 409, error: 'order already decided or expired — no fill', pending: pendingOrders.get(id) ?? null };
  }
  const marks = currentMarks();
  const mid = marks[pending.coin] ?? null;
  try {
    const fill = ledger.executeOrder(pending.coin, pending.side, pending.size, mid);
    const portfolio = ledger.getPortfolio(marks);
    // Telegram notify + confirm-message edit: fire-and-forget, never fatal.
    if (telegram) {
      const verb = pending.side === 'close' ? 'CLOSE' : undefined;
      void telegram.notifyFill(fill, portfolio, verb).catch(err => {
        console.error('[server] notifyFill failed:', (err as Error)?.message ?? err);
      });
      if (pending.telegramChatId !== undefined && pending.telegramMessageId !== undefined) {
        void telegram
          .editConfirmMessage(
            pending.telegramChatId,
            pending.telegramMessageId,
            formatFillMessage(fill, portfolio, verb),
          )
          .catch(err => {
            console.error('[server] editConfirmMessage failed:', (err as Error)?.message ?? err);
          });
      }
    }
    broadcast({ type: 'fill', fill, portfolio });
    return { ok: true, fill, portfolio, pending };
  } catch (err) {
    // Execution failed (stale preview: cash/position moved since /intent) —
    // the order is dead, not retryable; release the claim as cancelled.
    pendingOrders.markCancelled(id);
    if (err instanceof LedgerError) {
      return { ok: false, status: err.status, error: err.message, pending };
    }
    console.error('[server] executePendingOrderOnce unexpected error:', err);
    return { ok: false, status: 500, error: 'internal error', pending };
  }
}

telegram = createTelegramBot({
  token: process.env.TELEGRAM_BOT_TOKEN,
  ledger,
  feed,
  pending: pendingOrders,
  executePending: id => executePendingOrderOnce(id),
});
if (telegram) {
  void telegram.start();
  // Price-alert checker: every 5 s, evaluate unfired alerts against live
  // mids. A timer (not feed ticks) so checks also run while the feed is
  // on fixed test mids with no live ticks.
  const alertTimer = setInterval(() => {
    if (!telegram) return;
    void telegram.checkAlerts(currentMarks()).then(fired => {
      for (const alert of fired) broadcast({ type: 'alert', alert });
    }).catch(err => {
      console.error('[server] alert check failed:', (err as Error)?.message ?? err);
    });
  }, 5_000);
  alertTimer.unref();
}
// Expire stale pending orders so a 5-minute-old preview can never execute.
const sweepTimer = setInterval(() => pendingOrders.sweepExpired(), 60_000);
sweepTimer.unref();

/** Read a small JSON body (POST /order). Rejects >10KB or bad JSON. */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 10 * 1024) {
        reject(new LedgerError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'));
      } catch {
        reject(new LedgerError(400, 'request body must be valid JSON'));
      }
    });
    req.on('error', () => reject(new LedgerError(400, 'failed to read request body')));
  });
}

/** Read a raw audio body (POST /stt). Rejects >2 MB. */
function readRawBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > STT_BODY_CAP_BYTES) {
        reject(new LedgerError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new LedgerError(400, 'failed to read request body')));
  });
}

const server = createServer((req, res) => {
  // The glasses app runs on a different origin (Vite :5173 in the simulator,
  // the packaged app origin on real G2 hardware) and fetches from here.
  // Price/portfolio data is public paper-trading state, no credentials are
  // involved, so allow any origin. Without this the WebView blocks responses.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const sendError = (err: unknown): void => {
    if (err instanceof LedgerError) {
      sendJson(err.status, { ok: false, error: err.message });
    } else {
      console.error('[server] unexpected error:', err);
      sendJson(500, { ok: false, error: 'internal error' });
    }
  };

  if (req.url === '/health') {
    sendJson(200, {
      ok: true,
      service: 'hl-paper-trader-backend',
      version: '0.4.0',
      hlConnected: feed.connected,
      telegram: telegram === null ? 'unavailable' : telegram.isPaired() ? 'paired' : 'unpaired',
    });
    return;
  }

  if (req.url === '/prices') {
    sendJson(200, {
      ok: true,
      source: 'hyperliquid-allMids',
      hlConnected: feed.connected,
      updatedAt: new Date(feed.lastMidAtMs || Date.now()).toISOString(),
      prices: feed.snapshot(),
    });
    return;
  }

  if (req.url === '/positions') {
    if (req.method !== 'GET') {
      sendJson(405, { ok: false, error: 'method not allowed' });
      return;
    }
    try {
      const marks: Record<string, number | null> = {};
      for (const p of feed.snapshot()) marks[p.coin] = p.mid;
      sendJson(200, { ok: true, ...ledger.getPortfolio(marks) });
    } catch (err) {
      sendError(err);
    }
    return;
  }

  if (req.url === '/order') {
    if (req.method !== 'POST') {
      sendJson(405, { ok: false, error: 'method not allowed' });
      return;
    }
    void (async () => {
      try {
        const body = (await readJsonBody(req)) as {
          coin?: unknown;
          side?: unknown;
          size?: unknown;
          pendingOrderId?: unknown;
        };
        // Day 4 shared confirm path: the glasses confirm screen (and the
        // Telegram Yes button) claim the SAME pending order, so one order
        // executes at most once no matter which surface confirms first.
        if (typeof body.pendingOrderId === 'string' && body.pendingOrderId) {
          const result = await executePendingOrderOnce(body.pendingOrderId);
          if (!result.ok) {
            sendJson(result.status, { ok: false, error: result.error });
            return;
          }
          sendJson(200, { ok: true, fill: result.fill, portfolio: result.portfolio });
          return;
        }
        if (typeof body.coin !== 'string' || typeof body.side !== 'string') {
          throw new LedgerError(400, 'order needs {coin, side, size} — e.g. {"coin":"BTC","side":"buy","size":0.001}');
        }
        const marks: Record<string, number | null> = {};
        for (const p of feed.snapshot()) marks[p.coin] = p.mid;
        const fill = ledger.executeOrder(body.coin, body.side, body.size, marks[body.coin] ?? null);
        const portfolio = ledger.getPortfolio(marks);
        sendJson(200, { ok: true, fill, portfolio });
        broadcast({ type: 'fill', fill, portfolio });
        // Day 4: every glasses-confirmed fill also posts to Telegram.
        if (telegram) {
          const verb = body.side === 'close' ? 'CLOSE' : undefined;
          void telegram.notifyFill(fill, portfolio, verb).catch(err => {
            console.error('[server] notifyFill failed:', (err as Error)?.message ?? err);
          });
        }
      } catch (err) {
        sendError(err);
      }
    })();
    return;
  }

  if (req.url === '/order/cancel') {
    if (req.method !== 'POST') {
      sendJson(405, { ok: false, error: 'method not allowed' });
      return;
    }
    void (async () => {
      try {
        const body = (await readJsonBody(req)) as { pendingOrderId?: unknown };
        if (typeof body.pendingOrderId !== 'string' || !body.pendingOrderId) {
          throw new LedgerError(400, 'cancel needs {pendingOrderId}');
        }
        const order = pendingOrders.get(body.pendingOrderId);
        if (!order) {
          sendJson(404, { ok: false, error: 'unknown pending order' });
          return;
        }
        if (pendingOrders.cancel(body.pendingOrderId)) {
          console.log(`[server] pending order ${body.pendingOrderId} cancelled`);
          if (telegram && order.telegramChatId !== undefined && order.telegramMessageId !== undefined) {
            void telegram
              .editConfirmMessage(
                order.telegramChatId,
                order.telegramMessageId,
                `${formatOrderConfirm(order)}\n\nCANCELLED — no fill`,
              )
              .catch(err => {
                console.error('[server] editConfirmMessage failed:', (err as Error)?.message ?? err);
              });
          }
          sendJson(200, { ok: true, cancelled: true });
          return;
        }
        // Already decided (executed/cancelled/expired) — not an error, the
        // outcome is already final on both surfaces.
        sendJson(200, { ok: true, cancelled: false, status: order.status });
      } catch (err) {
        sendError(err);
      }
    })();
    return;
  }

  if (req.url === '/stt') {
    if (req.method !== 'POST') {
      sendJson(405, { ok: false, error: 'method not allowed' });
      return;
    }
    void (async () => {
      try {
        const pcm = await readRawBody(req);
        if (pcm.length === 0) throw new LedgerError(400, 'empty audio — nothing to transcribe');
        if (pcm.length > STT_MAX_BYTES) {
          throw new LedgerError(400, 'audio too long — max 30 seconds per voice command');
        }
        const startedAt = Date.now();
        const transcript = await transcribePcm(pcm, process.env.GROQ_API_KEY);
        sendJson(200, { ok: true, transcript, durationMs: Date.now() - startedAt, model: 'whisper-large-v3-turbo' });
      } catch (err) {
        if (err instanceof SttError) sendJson(err.status, { ok: false, error: err.message });
        else sendError(err);
      }
    })();
    return;
  }

  if (req.url === '/intent') {
    if (req.method !== 'POST') {
      sendJson(405, { ok: false, error: 'method not allowed' });
      return;
    }
    void (async () => {
      try {
        const body = (await readJsonBody(req)) as { transcript?: unknown };
        if (typeof body.transcript !== 'string' || !body.transcript.trim()) {
          throw new LedgerError(400, 'intent needs {transcript} — e.g. {"transcript":"buy 0.01 BTC"}');
        }
        const intent = parseIntent(body.transcript);
        const marks: Record<string, number | null> = {};
        for (const p of feed.snapshot()) marks[p.coin] = p.mid;
        const { preview, alert, error } = buildPreview(intent, marks, ledger.getPortfolio(marks));

        // Day 4: a voice alert is stored for real now (no longer info-only).
        // It fires to the paired Telegram chat when the live mid crosses it.
        if (alert) {
          try {
            const stored = ledger.createAlert(
              alert.coin,
              alert.direction,
              alert.price,
              telegram?.getPairedChatId() ?? null,
            );
            const paired = telegram !== null && telegram.isPaired();
            sendJson(200, {
              ok: true,
              transcript: body.transcript.trim(),
              intent,
              preview: null,
              alert,
              alertId: stored.id,
              message: `Alert set: ${alert.coin} ${alert.direction} $${alert.price.toLocaleString('en-US')}${paired ? '' : ' · pair Telegram to get the ping'}`,
              error: null,
            });
          } catch (err) {
            // Bad alert input (e.g. price 0) surfaces as a glasses info
            // screen, not a failed request — same pattern as other intents.
            sendJson(200, {
              ok: true,
              transcript: body.transcript.trim(),
              intent,
              preview: null,
              alert,
              error: err instanceof LedgerError ? err.message : 'could not set that alert',
            });
          }
          return;
        }

        // Day 4: an order preview becomes a pending order in the ONE store
        // both confirm paths use. The glasses send its id back with the
        // confirm tap; Telegram gets the same id on its inline buttons.
        let pendingOrderId: string | null = null;
        if (preview) {
          const order = pendingOrders.create({
            coin: preview.coin,
            side: preview.side,
            size: preview.size,
            price: preview.price,
            notional: preview.notional,
            cashAfter: preview.cashAfter,
          });
          pendingOrderId = order.id;
          // Fire-and-forget: a slow/failed Telegram send must never block
          // or fail the glasses confirm screen.
          if (telegram) {
            void telegram.sendOrderConfirm(order).catch(err => {
              console.error('[server] sendOrderConfirm failed:', (err as Error)?.message ?? err);
            });
          }
        }
        sendJson(200, { ok: true, transcript: body.transcript.trim(), intent, preview, alert: alert ?? null, error: error ?? null, pendingOrderId });
      } catch (err) {
        sendError(err);
      }
    })();
    return;
  }

  if (req.url === '/alerts') {
    if (req.method === 'GET') {
      try {
        sendJson(200, { ok: true, alerts: ledger.listAlerts() });
      } catch (err) {
        sendError(err);
      }
      return;
    }
    if (req.method === 'POST') {
      void (async () => {
        try {
          const body = (await readJsonBody(req)) as { coin?: unknown; direction?: unknown; price?: unknown };
          const alert = ledger.createAlert(
            typeof body.coin === 'string' ? body.coin : '',
            typeof body.direction === 'string' ? body.direction : '',
            body.price,
            telegram?.getPairedChatId() ?? null,
          );
          sendJson(200, { ok: true, alert });
        } catch (err) {
          sendError(err);
        }
      })();
      return;
    }
    sendJson(405, { ok: false, error: 'method not allowed' });
    return;
  }

  sendJson(404, { ok: false, error: 'not found' });
});

const wss = new WebSocketServer({ server, path: '/stream' });

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

function pushPrices(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: 'prices',
      source: 'hyperliquid-allMids',
      hlConnected: feed.connected,
      updatedAt: new Date(feed.lastMidAtMs || Date.now()).toISOString(),
      prices: feed.snapshot(),
    }),
  );
}

wss.on('connection', socket => {
  pushPrices(socket);
  const unsubscribe = feed.onUpdate(() => pushPrices(socket));
  socket.on('close', unsubscribe);
  socket.on('error', () => unsubscribe());
});

server.listen(PORT, () => {
  console.log(`hl-paper-trader-backend listening on :${PORT} (/health, /prices, /positions, POST /order, POST /stt, POST /intent, /alerts, /stream; telegram ${telegram === null ? 'unavailable' : telegram.isPaired() ? 'paired' : 'unpaired'})`);
});
