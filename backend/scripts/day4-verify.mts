/**
 * Day 4 verification — run: npx tsx scripts/day4-verify.mts
 *
 * Tests the Telegram module end to end WITHOUT any real Telegram traffic:
 * the bot is constructed with a dummy token + preset botInfo, and a
 * recording transformer on bot.api.config intercepts every API call
 * (grammY copies transformers into the per-update Api instances, so
 * stubbing bot.api methods directly would NOT intercept ctx.reply —
 * the transformer is the only mock that sees handler sends). Updates are
 * driven through bot.handleUpdate with synthetic message/callback_query
 * objects. The feed is a fake (controllable mids); the ledger is a temp
 * DB, reset at the start of every run (Day 3 lesson: a stale temp DB
 * produces false PASSes).
 *
 * The live HTTP layer (POST /intent storing alerts, POST /order with a
 * pendingOrderId, /health 0.4.0) is covered separately by the curl smoke
 * test against the local server — see hidden_files/day4/day4-build-log.md.
 */
import { rmSync } from 'node:fs';
import { PaperLedger, LedgerError } from '../src/ledger.js';
import { PendingOrderStore } from '../src/pendingOrders.js';
import { createTelegramBot, formatFillMessage, type TelegramHandle, type ExecutePendingResult } from '../src/telegram.js';
import { parseIntent } from '../src/intent.js';
import { buildPreview } from '../src/preview.js';
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- Fixtures ---------------------------------------------------------------
rmSync('/tmp/paper-day4-verify.db', { force: true });
rmSync('/tmp/paper-day4-verify-unpaired.db', { force: true });

const DUMMY_TOKEN = '123456789:AAEtestTestTestTestTestTestTestTestTe';
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
  private changes: Record<string, number | null> = { BTC: 1.5, ETH: -0.5, SOL: null };
  setMid(coin: string, mid: number | null): void {
    this.mids[coin] = mid;
  }
  snapshot(): { coin: 'BTC' | 'ETH' | 'SOL'; mid: number | null; change24h: number | null }[] {
    return (['BTC', 'ETH', 'SOL'] as const).map(coin => ({
      coin,
      mid: this.mids[coin],
      change24h: this.changes[coin],
    }));
  }
  get connected(): boolean {
    return true;
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
        result: {
          message_id: ++nextMessageId,
          date: 1,
          chat: { id: p.chat_id, type: 'private' },
          text: p.text,
        },
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
function callbackUpdate(chatId: number, data: string, messageId: number): Record<string, unknown> {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: chatId, is_bot: false, first_name: 'Test' },
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        text: 'Confirm order?',
      },
      chat_instance: 'test-instance',
      data,
    },
  };
}

const TEST_CHAT = 7322242672;

// --- Shared execute path (mirrors server.ts executePendingOrderOnce) ---------
const ledger = new PaperLedger('/tmp/paper-day4-verify.db');
const pending = new PendingOrderStore();
const feed = new FakeFeed();
const marks = (): Record<string, number | null> => {
  const m: Record<string, number | null> = {};
  for (const p of feed.snapshot()) m[p.coin] = p.mid;
  return m;
};
let handle: TelegramHandle | null = null;
const executePending = async (id: string): Promise<ExecutePendingResult> => {
  const order = pending.claimForExecution(id);
  if (!order) {
    return { ok: false, status: 409, error: 'order already decided or expired — no fill', pending: pending.get(id) ?? null };
  }
  const m = marks();
  try {
    const fill = ledger.executeOrder(order.coin, order.side, order.size, m[order.coin] ?? null);
    const portfolio = ledger.getPortfolio(m);
    if (handle) {
      const verb = order.side === 'close' ? 'CLOSE' : undefined;
      await handle.notifyFill(fill, portfolio, verb);
      if (order.telegramChatId !== undefined && order.telegramMessageId !== undefined) {
        await handle.editConfirmMessage(
          order.telegramChatId,
          order.telegramMessageId,
          formatFillMessage(fill, portfolio, verb),
        );
      }
    }
    return { ok: true, fill, portfolio, pending: order };
  } catch (err) {
    pending.markCancelled(id);
    if (err instanceof LedgerError) return { ok: false, status: err.status, error: err.message, pending: order };
    throw err;
  }
};

handle = createTelegramBot({
  token: DUMMY_TOKEN,
  ledger,
  feed: feed as unknown as HyperliquidFeed,
  pending,
  executePending,
});
if (!handle) throw new Error('bot should be created with a dummy token');
handle.bot.botInfo = TEST_BOT_INFO;
const apiCalls = installRecorder(handle.bot);
const sends = (from = 0): ApiCall[] => apiCalls.slice(from).filter(c => c.method === 'sendMessage');
const edits = (from = 0): ApiCall[] => apiCalls.slice(from).filter(c => c.method === 'editMessageText');
const answers = (from = 0): ApiCall[] => apiCalls.slice(from).filter(c => c.method === 'answerCallbackQuery');
const lastSendText = (): string => {
  const s = sends();
  return s.length ? String(s[s.length - 1].payload.text ?? '') : '';
};
const fillsCount = (): number => ledger.getPortfolio(marks()).fills.length;

// --- A. Alert storage -------------------------------------------------------
console.log('alerts: storage');
const a1 = ledger.createAlert('BTC', 'above', 65000, null);
check('createAlert returns id 1, unfired', a1.id === 1 && a1.fired === false && a1.coin === 'BTC', a1);
check('listAlerts shows it', ledger.listAlerts().length === 1, ledger.listAlerts());
check('listUnfiredAlerts length 1', ledger.listUnfiredAlerts().length === 1);
let threw = '';
try {
  ledger.createAlert('DOGE', 'above', 1, null);
} catch (err) {
  threw = (err as Error).message;
}
check('bad coin rejected', threw.includes('unknown coin'), threw);
threw = '';
try {
  ledger.createAlert('BTC', 'sideways', 1, null);
} catch (err) {
  threw = (err as Error).message;
}
check('bad direction rejected', threw.includes('unknown direction'), threw);
threw = '';
try {
  ledger.createAlert('BTC', 'above', 0, null);
} catch (err) {
  threw = (err as Error).message;
}
check('price 0 rejected', threw.includes('positive number'), threw);
check('markAlertFired flips once', ledger.markAlertFired(a1.id) === true);
check('markAlertFired second call false (atomic dedup)', ledger.markAlertFired(a1.id) === false);
check('listUnfiredAlerts now 0', ledger.listUnfiredAlerts().length === 0);

// --- B. Pairing via /start --------------------------------------------------
console.log('pairing:');
check('getPairing null before /start', ledger.getPairing() === null);
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/start', 6) as never);
const pairing = ledger.getPairing();
check('pairing stored after /start', pairing?.chatId === TEST_CHAT, pairing);
check('/start reply contains the pairing code', lastSendText().includes(`Pairing code: ${pairing?.code ?? '?'}`), lastSendText());
check('handle.isPaired() true', handle.isPaired() === true);

// --- C. Commands (fresh $10,000 account) ------------------------------------
console.log('commands:');
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/positions', 10) as never);
check('/positions shows equity + no positions', lastSendText().includes('Equity $10,000.00') && lastSendText().includes('No open positions'), lastSendText());
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/pnl', 4) as never);
check('/pnl shows realized + unrealized', lastSendText().includes('Realized +$0.00') && lastSendText().includes('Unrealized +$0.00'), lastSendText());
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price BTC', 6) as never);
check('/price BTC shows mid + change', lastSendText() === 'BTC $60,000.00 (+1.50%)', lastSendText());
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price', 6) as never);
check(
  '/price (no arg) shows all three',
  lastSendText().includes('BTC $60,000.00') && lastSendText().includes('ETH $1,700.00') && lastSendText().includes('SOL $71.00'),
  lastSendText(),
);
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price DOGE', 6) as never);
check('/price DOGE errors', lastSendText().includes('Unknown coin: DOGE'), lastSendText());
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/help', 5) as never);
check('/help lists commands', lastSendText().includes('/positions') && lastSendText().includes('/price'), lastSendText());
feed.setMid('ETH', null);
await handle.bot.handleUpdate(messageUpdate(TEST_CHAT, '/price ETH', 6) as never);
check('/price ETH with no mid reports unavailable', lastSendText().includes('live price unavailable'), lastSendText());
feed.setMid('ETH', 1700);

// --- D. notifyFill payload --------------------------------------------------
console.log('notifyFill:');
const mark0 = apiCalls.length;
const fill1 = ledger.executeOrder('BTC', 'buy', 0.01, 60000);
const sentFill = await handle.notifyFill(fill1, ledger.getPortfolio(marks()));
check('notifyFill returns true when paired', sentFill === true);
check('notifyFill sends exactly 1 message', sends(mark0).length === 1, sends(mark0).length);
check(
  'notifyFill text matches glasses format',
  lastSendText().includes('FILLED: BUY 0.01 BTC @ $60,000.00') && lastSendText().includes('Paper equity $10,000.00'),
  lastSendText(),
);
const mark1 = apiCalls.length;
const closeFill = ledger.executeOrder('BTC', 'close', undefined, 60000);
await handle.notifyFill(closeFill, ledger.getPortfolio(marks()), 'CLOSE');
check('notifyFill verb override CLOSE', lastSendText().includes('FILLED: CLOSE 0.01 BTC @ $60,000.00'), lastSendText());
check('close notify is 1 more send', sends(mark1).length === 1);

// --- E. Alert firing (fire once, no double on re-tick) ----------------------
console.log('alerts: firing');
const above = ledger.createAlert('BTC', 'above', 65000, null);
const sendsBeforeAlert = sends().length;
let fired = await handle.checkAlerts(marks());
check('no fire below threshold (60000 < 65000)', fired.length === 0 && sends().length === sendsBeforeAlert);
const sendsBefore = sends().length;
feed.setMid('BTC', 64999);
fired = await handle.checkAlerts(marks());
check('no fire at 64999', fired.length === 0);
feed.setMid('BTC', 65000);
fired = await handle.checkAlerts(marks());
check('fires at exactly 65000', fired.length === 1 && fired[0].id === above.id, fired);
check('fire sends exactly 1 ping', sends().length - sendsBefore === 1, sends().length - sendsBefore);
check(
  'ping text names coin + threshold + live mid',
  lastSendText().includes('ALERT: BTC above $65,000.00') && lastSendText().includes('Now $65,000.00'),
  lastSendText(),
);
feed.setMid('BTC', 66000);
fired = await handle.checkAlerts(marks());
check('no double-fire on re-tick at 66000', fired.length === 0 && sends().length - sendsBefore === 1, fired.length);
check('alert row is fired', ledger.listAlerts().find(a => a.id === above.id)?.fired === true);

const below = ledger.createAlert('ETH', 'below', 1500, null);
fired = await handle.checkAlerts(marks());
check('below-alert silent at 1700', fired.length === 0);
feed.setMid('ETH', 1500);
fired = await handle.checkAlerts(marks());
check('below-alert fires at 1500', fired.length === 1 && fired[0].id === below.id, fired);
feed.setMid('ETH', 1400);
fired = await handle.checkAlerts(marks());
check('below-alert no double-fire at 1400', fired.length === 0);
feed.setMid('BTC', 60000);
feed.setMid('ETH', 1700);

// --- F. Two-way confirm: one order, one execution ---------------------------
console.log('two-way confirm:');
const order1 = pending.create({ coin: 'BTC', side: 'buy', size: 0.01, price: 60000, notional: 600, cashAfter: 9400 });
const mark2 = apiCalls.length;
const msgId1 = await handle.sendOrderConfirm(order1);
check('sendOrderConfirm returns a message id', typeof msgId1 === 'number' && msgId1 > 0, msgId1);
check('confirm message id stored on the pending order', order1.telegramMessageId === msgId1, order1.telegramMessageId);
const confirmSend = sends(mark2)[0];
const keyboard = confirmSend?.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
check(
  'confirm buttons carry order:yes/no:<id>',
  keyboard?.inline_keyboard?.[0]?.[0]?.callback_data === `order:yes:${order1.id}` &&
    keyboard?.inline_keyboard?.[0]?.[1]?.callback_data === `order:no:${order1.id}`,
  keyboard,
);
check('confirm text shows the preview', String(confirmSend?.payload.text ?? '').includes('BUY 0.01 BTC @ $60,000.00'), confirmSend?.payload.text);

const fillsBeforeYes = fillsCount();
const mark3 = apiCalls.length;
await handle.bot.handleUpdate(callbackUpdate(TEST_CHAT, `order:yes:${order1.id}`, msgId1!) as never);
check('Telegram Yes executes exactly 1 fill', fillsCount() - fillsBeforeYes === 1, fillsCount() - fillsBeforeYes);
check('Yes answers the callback', answers(mark3).length === 1 && String(answers(mark3)[0].payload.text ?? '').includes('filled'), answers(mark3));
check(
  'Yes edits the confirm message to FILLED',
  edits(mark3).length === 1 && String(edits(mark3)[0].payload.text ?? '').startsWith('FILLED: BUY 0.01 BTC @ $60,000.00'),
  edits(mark3),
);
const mark4 = apiCalls.length;
await handle.bot.handleUpdate(callbackUpdate(TEST_CHAT, `order:yes:${order1.id}`, msgId1!) as never);
check('second Yes = 0 extra fills', fillsCount() - fillsBeforeYes === 1, fillsCount() - fillsBeforeYes);
check('second Yes answers Already decided', String(answers(mark4)[0]?.payload.text ?? '').includes('Already decided'), answers(mark4));
check('second Yes edits nothing', edits(mark4).length === 0, edits(mark4).length);
const glassesAfter = await executePending(order1.id);
check('glasses execute after Telegram Yes = 409 no-op', glassesAfter.ok === false && glassesAfter.status === 409, glassesAfter);
check('still exactly 1 fill after both paths', fillsCount() - fillsBeforeYes === 1);

const order2 = pending.create({ coin: 'ETH', side: 'buy', size: 1, price: 1700, notional: 1700, cashAfter: 7700 });
const msgId2 = await handle.sendOrderConfirm(order2);
const fillsBeforeNo = fillsCount();
const mark5 = apiCalls.length;
await handle.bot.handleUpdate(callbackUpdate(TEST_CHAT, `order:no:${order2.id}`, msgId2!) as never);
check('Telegram No = 0 fills', fillsCount() - fillsBeforeNo === 0, fillsCount() - fillsBeforeNo);
check('No cancels the pending order', pending.get(order2.id)?.status === 'cancelled', pending.get(order2.id)?.status);
check(
  'No edits the message to CANCELLED',
  edits(mark5).length === 1 && String(edits(mark5)[0].payload.text ?? '').includes('CANCELLED — no fill'),
  edits(mark5),
);
const mark6 = apiCalls.length;
await handle.bot.handleUpdate(callbackUpdate(TEST_CHAT, `order:yes:${order2.id}`, msgId2!) as never);
check('Yes after No = 0 fills', fillsCount() - fillsBeforeNo === 0, fillsCount() - fillsBeforeNo);
check('Yes after No answers Already decided', String(answers(mark6)[0]?.payload.text ?? '').includes('Already decided'), answers(mark6));

// Expired pending orders can never execute.
const shortStore = new PendingOrderStore(1);
const expiring = shortStore.create({ coin: 'BTC', side: 'buy', size: 0.01, price: 60000, notional: 600, cashAfter: 9400 });
await sleep(5);
check('expired pending claim returns null', shortStore.claimForExecution(expiring.id) === null);
check('expired pending marked expired', shortStore.get(expiring.id)?.status === 'expired');

// --- G. Unpaired behaviour (separate ledger, no /start) --------------------
console.log('unpaired:');
const ledger2 = new PaperLedger('/tmp/paper-day4-verify-unpaired.db');
const pending2 = new PendingOrderStore();
let handle2: TelegramHandle | null = createTelegramBot({
  token: DUMMY_TOKEN,
  ledger: ledger2,
  feed: feed as unknown as HyperliquidFeed,
  pending: pending2,
  executePending: async () => ({ ok: false, status: 409, error: 'not used', pending: null }),
});
if (!handle2) throw new Error('second bot should be created');
handle2.bot.botInfo = TEST_BOT_INFO;
const apiCalls2 = installRecorder(handle2.bot);
check('handle2 unpaired', handle2.isPaired() === false);
const unpairedAlert = ledger2.createAlert('BTC', 'above', 65000, null);
feed.setMid('BTC', 66000);
const fired2 = await handle2.checkAlerts(marks());
check('crossed alert with no chat does NOT fire', fired2.length === 0, fired2);
check('crossed alert sends nothing when unpaired', apiCalls2.filter(c => c.method === 'sendMessage').length === 0);
check('unfired alert stays unfired (not lost)', ledger2.listUnfiredAlerts().some(a => a.id === unpairedAlert.id));
const order3 = pending2.create({ coin: 'BTC', side: 'buy', size: 0.01, price: 66000, notional: 660, cashAfter: 9340 });
check('sendOrderConfirm unpaired returns null', (await handle2.sendOrderConfirm(order3)) === null);
feed.setMid('BTC', 60000);

// --- H. Missing token --------------------------------------------------------
console.log('token:');
check(
  'no token -> null handle (HTTP unaffected)',
  createTelegramBot({ token: undefined, ledger, feed: feed as unknown as HyperliquidFeed, pending, executePending }) === null,
);

// --- I. Preview regression ---------------------------------------------------
console.log('preview:');
const alertPreview = buildPreview(parseIntent('alert me if BTC goes above 65k'), marks(), ledger.getPortfolio(marks()));
check('alert intent still parses', alertPreview.alert?.price === 65000, alertPreview);
check('Day 3 "alerts land on Day 4" text is gone', alertPreview.error === undefined, alertPreview.error);
const unknownPreview = buildPreview(parseIntent('blah blah blah'), marks(), ledger.getPortfolio(marks()));
check('unknown still returns the retry hint', (unknownPreview.error ?? '').includes("Didn't catch that"), unknownPreview.error);

console.log(failures === 0 ? `\nDAY4 VERIFY: ALL PASS (${total} checks)` : `\nDAY4 VERIFY: ${failures} FAILURES of ${total} checks`);
process.exit(failures === 0 ? 0 : 1);
