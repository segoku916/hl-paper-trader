/**
 * Day 3 backend verification — run: npx tsx scripts/day3-verify.mts
 *
 * Tests parseIntent (phrase table), buildPreview (pricing against a temp
 * paper ledger — the real $10,000 account is never touched) and the
 * pcmToWav header. Live Groq transcription is NOT tested here: the key
 * lives only in Railway Variables, so /stt is verified after deploy
 * (see DAY3-VOICE-PLAN.md test plan step 5).
 */
import { parseIntent } from '../src/intent.js';
import { buildPreview } from '../src/preview.js';
import { pcmToWav, STT_SAMPLE_RATE } from '../src/stt.js';
import { PaperLedger } from '../src/ledger.js';
import { rmSync } from 'node:fs';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(` FAIL ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
  }
}
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- 1. Intent parsing -----------------------------------------------------
console.log('intent:');
const intentCases: Array<[string, unknown]> = [
  ['buy 0.01 bitcoin', { kind: 'order', coin: 'BTC', side: 'buy', size: 0.01 }],
  ['buy 0.01 BTC', { kind: 'order', coin: 'BTC', side: 'buy', size: 0.01 }],
  ['buy $500 bitcoin', { kind: 'order', coin: 'BTC', side: 'buy', usdAmount: 500 }],
  ['buy 500 dollars of bitcoin', { kind: 'order', coin: 'BTC', side: 'buy', usdAmount: 500 }],
  ['sell half my ETH', { kind: 'order', coin: 'ETH', side: 'sell', fraction: 0.5 }],
  ['sell a quarter of my BTC', { kind: 'order', coin: 'BTC', side: 'sell', fraction: 0.25 }],
  ['sell all my SOL', { kind: 'close', coin: 'SOL' }],
  ['close my SOL position', { kind: 'close', coin: 'SOL' }],
  ['alert me if BTC goes above 65k', { kind: 'alert', coin: 'BTC', direction: 'above', price: 65000 }],
  ['alert me when ETH drops below 1500', { kind: 'alert', coin: 'ETH', direction: 'below', price: 1500 }],
  ['buy bitcoin', { kind: 'needs_size', coin: 'BTC', side: 'buy' }],
  ['blah blah blah', { kind: 'unknown', transcript: 'blah blah blah' }],
];
for (const [phrase, expected] of intentCases) {
  check(JSON.stringify(phrase), eq(parseIntent(phrase), expected), parseIntent(phrase));
}

// --- 2. Preview pricing ----------------------------------------------------
// Temp ledger: buy 0.02 BTC @ 60,000 -> cash $8,800, position 0.02 @ 60,000.
console.log('preview:');
// Fresh temp db every run — reusing it re-executes the seed buy and fails
// 7 preview checks (caught 24 Nov ~16:40 WIB: 1st run ALL PASS, 2nd run 7 FAIL).
rmSync('/tmp/paper-day3-verify.db', { force: true });
const ledger = new PaperLedger('/tmp/paper-day3-verify.db');
ledger.executeOrder('BTC', 'buy', 0.02, 60_000);
const marks = { BTC: 61_000, ETH: 1_700, SOL: 71 };
const portfolio = ledger.getPortfolio(marks);
check('ledger cash 8800', portfolio.cash === 8800, portfolio.cash);
check('ledger holds 0.02 BTC', portfolio.positions[0]?.size === 0.02, portfolio.positions);

const p = (phrase: string) => buildPreview(parseIntent(phrase), marks, portfolio);
check(
  'buy 0.01 BTC -> notional 610, cashAfter 8190',
  eq(p('buy 0.01 BTC').preview, { coin: 'BTC', side: 'buy', size: 0.01, price: 61000, notional: 610, cashAfter: 8190 }),
  p('buy 0.01 BTC').preview,
);
check(
  'buy $500 BTC -> size 0.00819672, cashAfter 8300',
  eq(p('buy $500 bitcoin').preview, { coin: 'BTC', side: 'buy', size: 0.00819672, price: 61000, notional: 500, cashAfter: 8300 }),
  p('buy $500 bitcoin').preview,
);
check(
  'sell half BTC -> size 0.01, realized +10, cashAfter 9410',
  eq(p('sell half my BTC').preview, { coin: 'BTC', side: 'sell', size: 0.01, price: 61000, notional: 610, cashAfter: 9410, realizedPnl: 10 }),
  p('sell half my BTC').preview,
);
check(
  'close BTC -> size 0.02, realized +20, cashAfter 10020',
  eq(p('close my BTC position').preview, { coin: 'BTC', side: 'close', size: 0.02, price: 61000, notional: 1220, cashAfter: 10020, realizedPnl: 20 }),
  p('close my BTC position').preview,
);
check('sell half ETH, no position -> error', (p('sell half my ETH').error ?? '').includes('nothing to sell'), p('sell half my ETH'));
check('close SOL, no position -> error', (p('close my SOL position').error ?? '').includes('nothing to close'), p('close my SOL position'));
check('buy 999 BTC -> insufficient cash', (p('buy 999 BTC').error ?? '').includes('insufficient paper cash'), p('buy 999 BTC'));
check('buy 2 ETH -> notional 3400, cashAfter 5400', p('buy 2 ETH').preview?.cashAfter === 5400, p('buy 2 ETH').preview);
check('alert -> Day 4 note', p('alert me if BTC goes above 65k').alert?.price === 65000, p('alert me if BTC goes above 65k'));
check(
  'no mid -> feed error',
  buildPreview(parseIntent('buy 0.01 BTC'), { BTC: null, ETH: null, SOL: null }, portfolio).error?.includes('feed not connected') ?? false,
);
check('unknown -> retry hint', (p('blah blah blah').error ?? '').includes("Didn't catch that"), p('blah blah blah'));
check('buy bitcoin, no size -> ask', (p('buy bitcoin').error ?? '').includes('How much BTC?'), p('buy bitcoin'));

// --- 3. WAV wrapping --------------------------------------------------------
console.log('stt:');
const pcm = Buffer.alloc(32_000); // 1 s of 16 kHz s16le mono
const wav = pcmToWav(pcm);
check('wav length 32044', wav.length === 32_044, wav.length);
check('RIFF/WAVE markers', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE');
check('fmt/data markers', wav.toString('ascii', 12, 16) === 'fmt ' && wav.toString('ascii', 36, 40) === 'data');
check('sample rate 16000', wav.readUInt32LE(24) === STT_SAMPLE_RATE, wav.readUInt32LE(24));
check('data chunk size', wav.readUInt32LE(40) === 32_000, wav.readUInt32LE(40));

console.log(failures === 0 ? '\nDAY3 VERIFY: ALL PASS' : `\nDAY3 VERIFY: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
