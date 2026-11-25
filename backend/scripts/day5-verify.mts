/**
 * Day 5 verification — run: npx tsx scripts/day5-verify.mts
 *
 * Covers the Day 5 edge cases at the module level (the glasses screens
 * themselves are verified in the simulator — see the Day 5 build log):
 *
 *   #2 STT failure surface: transcribePcm rejects BEFORE any network call
 *      (missing key 500 / empty audio 400 / oversized audio 400), so the
 *      glasses can map every STT failure to its named error screen.
 *   #3 Unparseable phrase: parseIntent → unknown/needs_size, buildPreview
 *      returns the named refusal text, never a preview.
 *   #4 Empty positions: a fresh ledger reports an explicit empty state
 *      (positions [], equity = cash = $10,000, 0 fills).
 *   #5 Alert fire-once: checkAlerts fires a crossed alert exactly once
 *      (one send, ledger marked fired — the state the glasses poll reads),
 *      and a second tick fires nothing.
 *   #6 Telegram /price honesty: with the feed disconnected, /price and
 *      /price BTC answer "unavailable — reconnecting" with NO price;
 *      connected, they answer the live mid.
 *   #7 20 s auto-cancel, cross-channel: the shared pending store still
 *      enforces one-decision semantics after Day 5 — a cancel from either
 *      surface blocks the other surface's claim, and vice versa.
 *   #8 Close with no position / oversell: named LedgerError refusals from
 *      executeOrder AND named errors from buildPreview; refused orders
 *      write no fill and move no cash.
 *
 * Temp DBs only, deleted at the start of every run (Day 3 lesson: a stale
 * temp DB produces false PASSes). Telegram is driven through a recording
 * transformer with a dummy token, exactly like day4-verify — no real
 * Telegram traffic, and the Railway paper account is never touched.
 */
import { rmSync } from 'node:fs';
import { PaperLedger, LedgerError } from '../src/ledger.js';
import { PendingOrderStore } from '../src/pendingOrders.js';
import { createTelegramBot, type TelegramHandle, type ExecutePendingResult } from '../src/telegram.js';
import { parseIntent } from '../src/intent.js';
import { buildPreview } from '../src/preview.js';
import { transcribePcm, SttError, STT_MAX_BYTES } from '../src/stt.js';
import type { HyperliquidFeed } from '../src/hl.js';

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  total++;
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(` FAIL ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
  }
}

// --- Fixtures ---------------------------------------------------------------
rmSync('/tmp/paper-day5-verify.db', { force: true });
rmSync('/tmp/paper-day5-verify-tg.db', { force: true });

const DUMMY_TOKEN = '123456:day5-verify-dummy-token-not-real';
const TEST_BOT_INFO = {
  id: 9269090463,
  is_bot: true,
  first_name: 'Lethal ape trader',
  username: 'Lethal_ape_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as never;

class FakeFeed {
  private mids: Record<string, number | null> = { BTC: 60000, ETH: 1700, SOL: 71 };
  connectedValue = true;
  snapshot(): { coin: 'BTC' | 'ETH' | 'SOL'; mid: number | null; change24h: number | null }[] {
    return (['BTC', 'ETH', 'SOL'] as const).map(coin => ({
      coin,
      mid: this.mids[coin],
      change24h: null,
    }));
  }
  get connected(): boolean {
    return this.connectedValue;
  }
  get lastMidAtMs(): number {
    return Date.now();
  }
}

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function installRecorder(bot: TelegramHandle['bot']): ApiCall[] {
  const calls: ApiCall[] = [];
  let nextMessageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method: method as string, payload: payload as Record<string, unknown> });
    const p = payload as Record<string, unknown>;
    if (method === 'sendMessage') {
      return {
        ok: true,
        result: { message_id: ++nextMessageId, date: 1, chat: { id: p.chat_id, type: 'private' }, text: p.text },
      } as never;
    }
    if (method === 'editMessageText') {
      return {
        ok: true,
        result: { message_id: p.message_id, date: 1, chat: { id: p.chat_id, type: 'private' }, text: p.text },
      } as never;
    }
    if (method === 'getMe') return { ok: true, result: TEST_BOT_INFO } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

let updateId = 1;
function messageUpdate(chatId: number, text: string, commandLength?: number): Record<string, unknown> {
  const message: Record<string, unknown> = {
    message_id: updateId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: 'private' },
    from: { id: chatId, is_bot: false, first_name: 'Test' },
    text,
  };
  if (commandLength !== undefined) {
    message.entities = [{ type: 'bot_command', offset: 0, length: commandLength }];
  }
  return { update_id: updateId++, message };
}

const TEST_CHAT = 7322242672;
const MARKS: Record<string, number | null> = { BTC: 60000, ETH: 1700, SOL: 71 };

// --- #8 + #4: ledger guards and the empty state -----------------------------
console.log('#8/#4 ledger: named refusals, no writes, explicit empty state');
const ledger = new PaperLedger('/tmp/paper-day5-verify.db');
const empty = ledger.getPortfolio(MARKS);
check('empty portfolio: positions []', empty.positions.length === 0, empty.positions);
check('empty portfolio: cash = equity = 10000', empty.cash === 10000 && empty.equity === 10000, empty);
check('empty portfolio: realized 0, fills []', empty.realizedPnl === 0 && empty.fills.length === 0, empty);

let threw = '';
try {
  ledger.executeOrder('BTC', 'close', undefined, 60000);
} catch (err) {
  threw = err instanceof LedgerError ? err.message : String(err);
}
check('close with no position → named refusal', threw.includes('nothing to close'), threw);
threw = '';
try {
  ledger.executeOrder('ETH', 'sell', 0.5, 1700);
} catch (err) {
  threw = err instanceof LedgerError ? err.message : String(err);
}
check('sell with no position → named refusal', threw.includes('insufficient position'), threw);
const afterRefusals = ledger.getPortfolio(MARKS);
check('refusals wrote no fill, moved no cash', afterRefusals.fills.length === 0 && afterRefusals.cash === 10000, afterRefusals);

ledger.executeOrder('BTC', 'buy', 0.01, 60000);
threw = '';
try {
  ledger.executeOrder('BTC', 'sell', 0.02, 60000);
} catch (err) {
  threw = err instanceof LedgerError ? err.message : String(err);
}
check('oversell (0.02 vs held 0.01) → named refusal', threw.includes('insufficient position'), threw);
const afterOversell = ledger.getPortfolio(MARKS);
check('oversell wrote no fill; position intact', afterOversell.fills.length === 1 && afterOversell.positions.length === 1 && afterOversell.positions[0].size === 0.01, afterOversell);
ledger.executeOrder('BTC', 'close', undefined, 60000);
check('close of the real position fills', ledger.getPortfolio(MARKS).positions.length === 0);

// --- #8 + #3: preview guards and unparseable phrases ------------------------
console.log('#8/#3 preview: named errors, never a phantom preview');
const fresh = new PaperLedger('/tmp/paper-day5-verify-tg.db'); // reused below for Telegram
const freshPortfolio = fresh.getPortfolio(MARKS);
const closePreview = buildPreview(parseIntent('close BTC'), MARKS, freshPortfolio);
check('preview close with no position → error, no preview', closePreview.preview === null && (closePreview.error ?? '').includes('nothing to close'), closePreview);
const oversellPreview = buildPreview(parseIntent('sell 0.02 BTC'), MARKS, {
  ...freshPortfolio,
  positions: [{ coin: 'BTC', size: 0.01, avgEntry: 60000, mark: 60000, value: 600, unrealizedPnl: 0, unrealizedPnlPct: 0 }],
});
check('preview oversell → error, no preview', oversellPreview.preview === null && (oversellPreview.error ?? '').includes('insufficient position'), oversellPreview);
const garbage = parseIntent('flibberty gibbet snarp');
check('unparseable phrase → intent unknown', garbage.kind === 'unknown', garbage);
const garbagePreview = buildPreview(garbage, MARKS, freshPortfolio);
check('unparseable phrase → "Didn\'t catch that", no preview', garbagePreview.preview === null && (garbagePreview.error ?? '').includes("Didn't catch that"), garbagePreview);
const noSize = buildPreview(parseIntent('buy BTC'), MARKS, freshPortfolio);
check('missing size → "How much BTC?", no preview', noSize.preview === null && (noSize.error ?? '').includes('How much BTC'), noSize);

// --- #2: STT failure surface (all rejections happen before any fetch) -------
console.log('#2 stt: named failures before the network');
let sttStatus = 0;
try {
  await transcribePcm(Buffer.alloc(32000), undefined);
} catch (err) {
  sttStatus = err instanceof SttError ? err.status : -1;
}
check('missing GROQ key → SttError 500', sttStatus === 500, sttStatus);
sttStatus = 0;
try {
  await transcribePcm(Buffer.alloc(0), 'dummy-key-for-validation-only');
} catch (err) {
  sttStatus = err instanceof SttError ? err.status : -1;
}
check('empty audio → SttError 400', sttStatus === 400, sttStatus);
sttStatus = 0;
try {
  await transcribePcm(Buffer.alloc(STT_MAX_BYTES + 2), 'dummy-key-for-validation-only');
} catch (err) {
  sttStatus = err instanceof SttError ? err.status : -1;
}
check('oversized audio → SttError 400', sttStatus === 400, sttStatus);

// --- #7: shared pending store — one decision across both surfaces -----------
console.log('#7 pending store: cancel from one surface blocks the other');
const store = new PendingOrderStore();
const mk = () => store.create({ coin: 'BTC', side: 'buy', size: 0.01, price: 60000, notional: 600, cashAfter: 9400 });
const o1 = mk();
check('glasses cancel (20 s timeout path) succeeds', store.cancel(o1.id) === true);
check('Telegram Yes after glasses cancel → claim null', store.claimForExecution(o1.id) === null);
check('cancelled order status is final', store.get(o1.id)?.status === 'cancelled', store.get(o1.id));
const o2 = mk();
check('Telegram Yes claims the order', store.claimForExecution(o2.id)?.id === o2.id);
check('glasses tap after Telegram Yes → second claim null', store.claimForExecution(o2.id) === null);
check('glasses cancel after Telegram Yes → false (already decided)', store.cancel(o2.id) === false);
const o3 = mk();
check('Telegram No cancels', store.cancel(o3.id) === true);
check('glasses /order after Telegram No → claim null', store.claimForExecution(o3.id) === null);

// --- Telegram fixtures for #5 + #6 ------------------------------------------
const tgLedger = fresh;
const feed = new FakeFeed();
const pending = new PendingOrderStore();
const executePending = async (id: string): Promise<ExecutePendingResult> => {
  const order = pending.claimForExecution(id);
  if (!order) return { ok: false, status: 409, error: 'order already decided or expired — no fill', pending: pending.get(id) ?? null };
  const fill = tgLedger.executeOrder(order.coin, order.side, order.size, MARKS[order.coin] ?? null);
  return { ok: true, fill, portfolio: tgLedger.getPortfolio(MARKS), pending: order };
};
const handle = createTelegramBot({
  token: DUMMY_TOKEN,
  ledger: tgLedger,
  feed: feed as unknown as HyperliquidFeed,
  pending,
  executePending,
});
if (!handle) throw new Error('bot should be created with a dummy token');
handle.bot.botInfo = TEST_BOT_INFO;
const apiCalls = installRecorder(handle.bot);
const sends = (from = 0): ApiCall[] => apiCalls.slice(from).filter(c => c.method === 'sendMessage');
const lastSendText = (): string => {
  const s = sends();
  return s.length ? String(s[s.length - 1].payload.text ?? '') : '';
};

// Pair the test chat so alerts have somewhere to land.
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/start', 6) as never);
check('test chat paired', handle.isPaired() && handle.getPairedChatId() === TEST_CHAT);

// --- #5: alert fire-once -----------------------------------------------------
console.log('#5 alerts: fires once to Telegram, ledger state is glasses-readable');
const alert = tgLedger.createAlert('BTC', 'above', 59000, TEST_CHAT);
const sendsBefore = sends().length;
const fired1 = await handle.checkAlerts({ BTC: 60000, ETH: 1700, SOL: 71 });
check('crossed alert fires on first tick', fired1.length === 1 && fired1[0].id === alert.id, fired1);
check('exactly one ALERT send', sends(sendsBefore).length === 1 && lastSendText().includes('ALERT: BTC above'), sends(sendsBefore));
check('ledger marks it fired (what GET /alerts shows the glasses)', tgLedger.listAlerts().find(a => a.id === alert.id)?.fired === true);
const fired2 = await handle.checkAlerts({ BTC: 60000, ETH: 1700, SOL: 71 });
check('second tick fires nothing (fire-once)', fired2.length === 0 && sends(sendsBefore).length === 1, fired2);
const below = tgLedger.createAlert('ETH', 'below', 1600, TEST_CHAT); // mid 1700 is NOT below 1600 → uncrossed
const fired3 = await handle.checkAlerts({ BTC: 60000, ETH: 1700, SOL: 71 });
check('uncrossed alert stays unfired', fired3.length === 0 && tgLedger.listAlerts().find(a => a.id === below.id)?.fired === false, fired3);

// --- #6: /price honesty -------------------------------------------------------
console.log('#6 telegram /price: disconnected feed never quotes a dead number');
feed.connectedValue = false;
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price', 6) as never);
const discAll = lastSendText();
check('/price (all) while disconnected → unavailable + reconnecting', discAll.includes('unavailable') && discAll.includes('reconnecting'), discAll);
check('/price (all) while disconnected → no price quoted', !discAll.includes('$60,000') && !discAll.includes('BTC $'), discAll);
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price BTC', 6) as never);
const discOne = lastSendText();
check('/price BTC while disconnected → unavailable, no number', discOne.includes('unavailable') && !discOne.includes('60,000'), discOne);
feed.connectedValue = true;
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price BTC', 6) as never);
const liveOne = lastSendText();
check('/price BTC while connected → live mid quoted', liveOne.includes('BTC') && liveOne.includes('$60,000.00'), liveOne);

console.log(`\nDay 5 verify: ${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
