/**
 * Hyperliquid Paper Trader — backend (Day 1).
 *
 * Owns ALL secrets and API keys. The glasses app never sees a key — it talks
 * only to this server. Paper trading only; no wallet, no signing, no real funds.
 *
 * Endpoints:
 *   GET /health     liveness probe
 *   GET /prices     live BTC/ETH/SOL mids + 24h change (Hyperliquid allMids)
 *   GET /positions  paper portfolio: cash, equity, positions, fills (Day 2)
 *   POST /order     execute a confirmed paper order at the live mid (Day 2)
 *   WS  /stream     live mids + fill notifications pushed to glasses clients
 *
 * Day 3+: POST /stt, POST /alerts (see README.md).
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { HyperliquidFeed } from './hl.js';
import { PaperLedger, LedgerError } from './ledger.js';

const PORT = Number(process.env.PORT ?? 3000);
// Test runs point LEDGER_DB at a temp file so the real paper account (starting
// equity $10,000) is never polluted by verification trades.
const ledger = new PaperLedger(process.env.LEDGER_DB ?? 'data/paper-ledger.db');

const feed = new HyperliquidFeed();
feed.start();

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
      version: '0.2.0',
      hlConnected: feed.connected,
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
        const body = (await readJsonBody(req)) as { coin?: unknown; side?: unknown; size?: unknown };
        if (typeof body.coin !== 'string' || typeof body.side !== 'string') {
          throw new LedgerError(400, 'order needs {coin, side, size} — e.g. {"coin":"BTC","side":"buy","size":0.001}');
        }
        const marks: Record<string, number | null> = {};
        for (const p of feed.snapshot()) marks[p.coin] = p.mid;
        const fill = ledger.executeOrder(body.coin, body.side, body.size, marks[body.coin] ?? null);
        const portfolio = ledger.getPortfolio(marks);
        sendJson(200, { ok: true, fill, portfolio });
        broadcast({ type: 'fill', fill, portfolio });
      } catch (err) {
        sendError(err);
      }
    })();
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
  console.log(`hl-paper-trader-backend listening on :${PORT} (/health, /prices, /positions, POST /order, /stream)`);
});
