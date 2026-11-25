/**
 * Telegram bot — Day 4.
 *
 * grammY bot (long polling, no webhook/public URL needed for the demo).
 * The bot is the notification + confirmation channel for the paper trader:
 *
 *   /start            pair this chat (stores the chat id + a pairing code)
 *   /positions        paper equity/cash/positions, same ledger as the glasses
 *   /pnl              realized + unrealized PnL
 *   /price [coin]     live Hyperliquid mids (BTC/ETH/SOL, all three by default)
 *   /help             command list
 *   inline Yes/No     confirm a pending voice order — the SAME pending-order
 *                     store the glasses use, so a Telegram Yes and a glasses
 *                     tap can never both execute one order.
 *
 * Senders: notifyFill (after any fill) and notifyAlert (when a stored price
 * alert crosses). Both are plain text, numbers formatted like the glasses
 * screens. Sends go only to the paired chat; with no pairing they log and
 * no-op — alerts stay unfired until a chat is paired, never lost silently.
 *
 * Secrets: the token comes from TELEGRAM_BOT_TOKEN (Railway Variables in
 * production). When it is missing, createTelegramBot returns null — the
 * HTTP server keeps running and /health reports telegram: unavailable
 * (same fail-loud pattern as the Groq key in /stt). No token, key, or chat
 * id ever reaches the glasses app bundle.
 *
 * grammY's Node defaults fight Node 24's native fetch in two ways, both
 * found while verifying Day 4 (25 Nov): (1) the default client fetch is
 * the legacy `node-fetch` shim, which fails outright in this sandbox;
 * (2) grammY's timeout/abort signals come from the `abort-controller`
 * polyfill, which native fetch rejects ("Expected signal to be an instance
 * of AbortSignal"). The bot is therefore constructed with a native-fetch
 * wrapper that bridges grammY's polyfill signal onto a native
 * AbortController, so timeouts/aborts still cancel requests. Without this,
 * a bad token hangs bot.start() forever (grammY retries HttpErrors
 * indefinitely) instead of failing loud.
 *
 * Testing: all sends are mockable without network. The verify script
 * (scripts/day4-verify.mts) installs a recording transformer on
 * bot.api.config — grammY copies transformers into the per-update Api
 * instances, so stubbing bot.api methods directly would NOT intercept
 * ctx.reply/ctx.editMessageText. Never send to a real chat from tests.
 */

import { Bot, InlineKeyboard } from 'grammy';
import type { PaperLedger, Fill, PortfolioView, Alert } from './ledger.js';
import type { HyperliquidFeed, WatchCoin } from './hl.js';
import { WATCH_COINS } from './hl.js';
import type { PendingOrder, PendingOrderStore } from './pendingOrders.js';

/** Result of the shared claim-and-execute path (owned by server.ts). */
export type ExecutePendingResult =
  | { ok: true; fill: Fill; portfolio: PortfolioView; pending: PendingOrder }
  | { ok: false; status: number; error: string; pending: PendingOrder | null };

export interface TelegramDeps {
  token: string | undefined;
  ledger: PaperLedger;
  feed: HyperliquidFeed;
  pending: PendingOrderStore;
  /** Shared execution path: claim the pending order, execute it on the
   * ledger at the live mid, notify + broadcast. Owned by server.ts so the
   * glasses POST /order path and this callback path run identical code. */
  executePending: (id: string) => Promise<ExecutePendingResult>;
}

export interface TelegramHandle {
  /** The grammY bot — exposed so tests can drive handleUpdate + install a
   * recording transformer. Production code uses the methods below. */
  readonly bot: Bot;
  isPaired(): boolean;
  getPairedChatId(): number | null;
  /** Post a fill to the paired chat. False when unpaired or the send fails. */
  notifyFill(fill: Fill, portfolio: PortfolioView, verb?: string): Promise<boolean>;
  /** Post a fired alert to its chat (or the paired chat). False when no
   * chat is reachable or the send fails — the caller must NOT mark fired. */
  notifyAlert(alert: Alert, mid: number): Promise<boolean>;
  /** Send the inline Yes/No confirm for a pending order. Returns the
   * message id (stored on the pending order for the later edit), or null
   * when unpaired or the send fails. */
  sendOrderConfirm(pending: PendingOrder): Promise<number | null>;
  /** Edit a confirm message in place (FILLED / CANCELLED / failed). */
  editConfirmMessage(chatId: number, messageId: number, text: string): Promise<void>;
  /** Evaluate unfired alerts against current mids; send + mark fired, once
   * each. Returns the alerts that fired on this tick. */
  checkAlerts(marks: Record<string, number | null>): Promise<Alert[]>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const formatPrice = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatSigned = (n: number): string =>
  `${n >= 0 ? '+' : '−'}$${formatPrice(Math.abs(n))}`;
const trimSize = (size: number): string => String(Number(size.toFixed(6)));

/** Pairing code alphabet — no 0/O/1/I/L so a code read aloud is unambiguous. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Native fetch with a signal bridge for grammY (see header note).
 * grammY's Node shim passes an `abort-controller` polyfill signal on every
 * API call; Node's native fetch rejects it outright. Bridge the polyfill
 * signal onto a native AbortController so grammY timeouts/aborts still
 * cancel the request instead of throwing before any network happens.
 */
function grammyFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const [url, init] = args;
  const foreignSignal = init?.signal as AbortSignal | undefined;
  if (!foreignSignal) return fetch(url, init);
  const controller = new AbortController();
  if (foreignSignal.aborted) {
    controller.abort(foreignSignal.reason);
  } else {
    foreignSignal.addEventListener('abort', () => controller.abort(foreignSignal.reason), { once: true });
  }
  return fetch(url, { ...init, signal: controller.signal });
}
function makePairingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function formatPositions(portfolio: PortfolioView): string {
  const lines = [
    `Equity $${formatPrice(portfolio.equity)}`,
    `Cash $${formatPrice(portfolio.cash)} · Realized ${formatSigned(portfolio.realizedPnl)}`,
  ];
  if (portfolio.positions.length === 0) {
    lines.push('No open positions');
    return lines.join('\n');
  }
  for (const pos of portfolio.positions) {
    lines.push(`${pos.coin} ${trimSize(pos.size)} @ $${formatPrice(pos.avgEntry)}`);
    const val = pos.value === null ? '—' : `$${formatPrice(pos.value)}`;
    const pnl =
      pos.unrealizedPnl === null
        ? ''
        : ` · ${formatSigned(pos.unrealizedPnl)}${pos.unrealizedPnlPct === null ? '' : ` (${pos.unrealizedPnlPct >= 0 ? '+' : ''}${pos.unrealizedPnlPct.toFixed(2)}%)`}`;
    lines.push(`Val ${val}${pnl}`);
  }
  return lines.join('\n');
}

/** Fill text shared by the Telegram notify + the confirm-message edit. */
export function formatFillMessage(fill: Fill, portfolio: PortfolioView, verb?: string): string {
  const v = verb ?? (fill.side === 'buy' ? 'BUY' : 'SELL');
  const lines = [
    `FILLED: ${v} ${trimSize(fill.size)} ${fill.coin} @ $${formatPrice(fill.price)}`,
    `≈ $${formatPrice(fill.notional)} · Paper equity $${formatPrice(portfolio.equity)}`,
  ];
  if (fill.side === 'sell' && fill.realizedPnl !== 0) {
    lines.push(`Realized ${formatSigned(fill.realizedPnl)}`);
  }
  return lines.join('\n');
}

/** Order-confirm text shared by the inline message and the CANCELLED edit. */
export function formatOrderConfirm(pending: PendingOrder): string {
  const verb = pending.side === 'buy' ? 'BUY' : pending.side === 'sell' ? 'SELL' : 'CLOSE';
  return [
    'Confirm order?',
    `${verb} ${trimSize(pending.size)} ${pending.coin} @ $${formatPrice(pending.price)}`,
    `≈ $${formatPrice(pending.notional)} · Cash after $${formatPrice(pending.cashAfter)}`,
    'Tap a button — or confirm on the glasses.',
  ].join('\n');
}

export function createTelegramBot(deps: TelegramDeps): TelegramHandle | null {
  const { token, ledger, feed, pending, executePending } = deps;
  if (!token) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set — Telegram features unavailable (HTTP server unaffected)');
    return null;
  }
  const bot = new Bot(token, {
    // Native fetch + polyfill-signal bridge (see header note) — without
    // this, every API call fails before touching the network.
    client: { fetch: grammyFetch },
  });
  bot.catch(err => console.error('[telegram] handler error:', err));

  const getPairedChatId = (): number | null => ledger.getPairing()?.chatId ?? null;
  const currentMarks = (): Record<string, number | null> => {
    const marks: Record<string, number | null> = {};
    for (const p of feed.snapshot()) marks[p.coin] = p.mid;
    return marks;
  };

  const handle: TelegramHandle = {
    bot,

    isPaired: () => getPairedChatId() !== null,
    getPairedChatId,

    async notifyFill(fill, portfolio, verb): Promise<boolean> {
      const chatId = getPairedChatId();
      if (chatId === null) {
        console.log('[telegram] notifyFill skipped — no paired chat');
        return false;
      }
      try {
        await bot.api.sendMessage(chatId, formatFillMessage(fill, portfolio, verb));
        return true;
      } catch (err) {
        console.error('[telegram] notifyFill failed:', (err as Error)?.message ?? err);
        return false;
      }
    },

    async notifyAlert(alert, mid): Promise<boolean> {
      const chatId = alert.chatId ?? getPairedChatId();
      if (chatId === null) {
        console.log(`[telegram] notifyAlert skipped (alert #${alert.id}) — no paired chat`);
        return false;
      }
      try {
        await bot.api.sendMessage(
          chatId,
          `ALERT: ${alert.coin} ${alert.direction} $${formatPrice(alert.price)}\nNow $${formatPrice(mid)}`,
        );
        return true;
      } catch (err) {
        console.error(`[telegram] notifyAlert failed (alert #${alert.id}):`, (err as Error)?.message ?? err);
        return false;
      }
    },

    async sendOrderConfirm(pendingOrder): Promise<number | null> {
      const chatId = getPairedChatId();
      if (chatId === null) {
        console.log('[telegram] sendOrderConfirm skipped — no paired chat');
        return null;
      }
      try {
        const msg = await bot.api.sendMessage(chatId, formatOrderConfirm(pendingOrder), {
          reply_markup: new InlineKeyboard()
            .text('Yes ✓', `order:yes:${pendingOrder.id}`)
            .text('No ✕', `order:no:${pendingOrder.id}`),
        });
        pendingOrder.telegramChatId = chatId;
        pendingOrder.telegramMessageId = msg.message_id;
        return msg.message_id;
      } catch (err) {
        console.error('[telegram] sendOrderConfirm failed:', (err as Error)?.message ?? err);
        return null;
      }
    },

    async editConfirmMessage(chatId, messageId, text): Promise<void> {
      try {
        await bot.api.editMessageText(chatId, messageId, text);
      } catch (err) {
        // Editing can fail if the message was deleted or the text is
        // unchanged ("message is not modified") — never fatal.
        console.warn('[telegram] editConfirmMessage failed:', (err as Error)?.message ?? err);
      }
    },

    async checkAlerts(marks): Promise<Alert[]> {
      const fired: Alert[] = [];
      for (const alert of ledger.listUnfiredAlerts()) {
        const mid = marks[alert.coin] ?? null;
        if (mid === null || !Number.isFinite(mid)) continue;
        const crossed = alert.direction === 'above' ? mid >= alert.price : mid <= alert.price;
        if (!crossed) continue;
        // Send FIRST, mark fired only on delivery success — a failed send
        // leaves the alert unfired so the next tick retries instead of
        // silently losing it. The mark itself is atomic (WHERE fired = 0),
        // so a hovering price can never double-send.
        const sent = await handle.notifyAlert(alert, mid);
        if (sent && ledger.markAlertFired(alert.id)) {
          console.log(`[telegram] alert #${alert.id} fired: ${alert.coin} ${alert.direction} $${alert.price} (mid $${mid})`);
          fired.push({ ...alert, fired: true, firedAt: new Date().toISOString() });
        }
      }
      return fired;
    },

    async start(): Promise<void> {
      try {
        await bot.start();
      } catch (err) {
        // init() failure (bad token, no network) must not take the HTTP
        // server down — log loudly and keep serving.
        console.error('[telegram] bot failed to start (HTTP server unaffected):', (err as Error)?.message ?? err);
      }
    },

    async stop(): Promise<void> {
      await bot.stop();
    },
  };

  // ── Commands ─────────────────────────────────────────────────────────

  bot.command('start', async ctx => {
    const code = makePairingCode();
    ledger.pairChat(ctx.chat.id, code);
    await ctx.reply(
      [
        'Paired ✓ — HL Paper Trader linked to this chat.',
        `Pairing code: ${code}`,
        'Fills + price alerts will land here.',
        '',
        'Commands: /positions /pnl /price BTC /help',
      ].join('\n'),
    );
  });

  bot.command('help', async ctx => {
    await ctx.reply(
      [
        'HL Paper Trader — paper trading on Hyperliquid mids.',
        '/positions — equity, cash, open positions',
        '/pnl — realized + unrealized PnL',
        '/price [BTC|ETH|SOL] — live mid (all three by default)',
        'Voice orders on the glasses can also be confirmed here with Yes/No.',
      ].join('\n'),
    );
  });

  bot.command('positions', async ctx => {
    await ctx.reply(formatPositions(ledger.getPortfolio(currentMarks())));
  });

  bot.command('pnl', async ctx => {
    const portfolio = ledger.getPortfolio(currentMarks());
    const unrealized = portfolio.positions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
    await ctx.reply(
      [
        `Realized ${formatSigned(portfolio.realizedPnl)}`,
        `Unrealized ${formatSigned(unrealized)}`,
        `Equity $${formatPrice(portfolio.equity)}`,
      ].join('\n'),
    );
  });

  bot.command('price', async ctx => {
    const arg = ctx.match?.toString().trim().toUpperCase() ?? '';
    // Day 5 honesty: while the feed is disconnected the snapshot holds
    // last-known mids, not live ones — say so instead of answering with a
    // dead number presented as live.
    if (!feed.connected) {
      await ctx.reply('Live prices unavailable — Hyperliquid feed reconnecting, retry in a moment');
      return;
    }
    const snapshot = feed.snapshot();
    if (!arg) {
      const lines = snapshot.map(p => {
        const mid = p.mid === null ? '—' : `$${formatPrice(p.mid)}`;
        const chg = p.change24h === null ? '' : ` (${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(2)}%)`;
        return `${p.coin} ${mid}${chg}`;
      });
      await ctx.reply(lines.join('\n'));
      return;
    }
    if (!(WATCH_COINS as readonly string[]).includes(arg)) {
      await ctx.reply(`Unknown coin: ${arg} (BTC, ETH, SOL)`);
      return;
    }
    const row = snapshot.find(p => p.coin === (arg as WatchCoin));
    if (!row || row.mid === null) {
      await ctx.reply(`${arg}: live price unavailable — feed not connected yet, retry in a moment`);
      return;
    }
    const chg = row.change24h === null ? '' : ` (${row.change24h >= 0 ? '+' : ''}${row.change24h.toFixed(2)}%)`;
    await ctx.reply(`${arg} $${formatPrice(row.mid)}${chg}`);
  });

  // ── Inline Yes/No confirm ────────────────────────────────────────────

  bot.callbackQuery(/^order:(yes|no):([0-9a-f-]{36})$/, async ctx => {
    const decision = ctx.match[1] as 'yes' | 'no';
    const id = ctx.match[2];
    const order = pending.get(id);

    if (decision === 'yes') {
      const result = await executePending(id);
      if (result.ok) {
        // The shared path already edited the confirm message to FILLED.
        await ctx.answerCallbackQuery({ text: 'Order filled' });
      } else if (result.status === 409) {
        await ctx.answerCallbackQuery({ text: 'Already decided — see the message above' });
      } else {
        await ctx.answerCallbackQuery({ text: `Order failed: ${result.error}` });
        const p = result.pending ?? order;
        if (p?.telegramChatId !== undefined && p.telegramMessageId !== undefined) {
          await handle.editConfirmMessage(
            p.telegramChatId,
            p.telegramMessageId,
            `${formatOrderConfirm(p)}\n\nOrder failed: ${result.error}`,
          );
        }
      }
      return;
    }

    // No: cancel the pending order so the glasses tap can no longer execute it.
    if (pending.cancel(id)) {
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      if (order) {
        await ctx.editMessageText(`${formatOrderConfirm(order)}\n\nCANCELLED — no fill`).catch(err => {
          console.warn('[telegram] cancel edit failed:', (err as Error)?.message ?? err);
        });
      }
    } else {
      await ctx.answerCallbackQuery({ text: 'Already decided — see the message above' });
    }
  });

  return handle;
}
