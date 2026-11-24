/**
 * Voice intent parser — Day 3.
 *
 * Deterministic regex first (narrow command set, no LLM needed for v1).
 * Input: a Whisper transcript string. Output: a structured intent the
 * /intent endpoint can preview against the live feed + paper portfolio.
 *
 * Intents:
 *   order      buy/sell with a coin size, a USD amount, or a fraction of
 *              the open position ("sell half my ETH")
 *   close      "close my SOL position" / "sell all my SOL"
 *   alert      "alert me if BTC goes above 65k" (parsed Day 3, fires Day 4)
 *   needs_size "buy bitcoin" with no size — ask, never guess
 *   unknown    anything else — glasses shows the retry hint, no order
 */

import type { WatchCoin } from './hl.js';

export type Intent =
  | { kind: 'order'; coin: WatchCoin; side: 'buy' | 'sell'; size?: number; usdAmount?: number; fraction?: number }
  | { kind: 'close'; coin: WatchCoin }
  | { kind: 'alert'; coin: WatchCoin; direction: 'above' | 'below'; price: number }
  | { kind: 'needs_size'; coin: WatchCoin; side: 'buy' | 'sell' }
  | { kind: 'unknown'; transcript: string };

const COIN_WORDS: Record<string, WatchCoin> = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
};

const COIN_RE = '(bitcoin|btc|ethereum|eth|solana|sol)';

function coinOf(word: string | undefined): WatchCoin | null {
  if (!word) return null;
  return COIN_WORDS[word.toLowerCase()] ?? null;
}

/** "65k" -> 65000, "1.5m" -> 1500000, "500" -> 500. */
function parseNumber(raw: string, suffix: string | undefined): number {
  const n = Number(raw.replace(/,/g, ''));
  if (suffix === 'k') return n * 1_000;
  if (suffix === 'm') return n * 1_000_000;
  return n;
}

const NUM_RE = String.raw`(\d+(?:\.\d+)?)\s*(k|m)?`;

export function parseIntent(transcript: string): Intent {
  const text = transcript.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return { kind: 'unknown', transcript };

  // Alert: "alert me if btc goes above 65k" / "alert me when eth drops below 1500"
  const alertMatch = text.match(
    new RegExp(`alert me(?: if| when)? ${COIN_RE} (?:goes |go |drops? |falls? )?(above|below|over|under) \\$?${NUM_RE}`),
  );
  if (alertMatch) {
    const coin = coinOf(alertMatch[1]);
    if (coin) {
      return {
        kind: 'alert',
        coin,
        direction: alertMatch[2] === 'above' || alertMatch[2] === 'over' ? 'above' : 'below',
        price: parseNumber(alertMatch[3], alertMatch[4]),
      };
    }
  }

  // Close: "close my sol position" / "sell all my sol" / "close sol"
  const closeMatch = text.match(new RegExp(`(?:close|sell all)(?: my)? ${COIN_RE}(?: position)?$`));
  if (closeMatch) {
    const coin = coinOf(closeMatch[1]);
    if (coin) return { kind: 'close', coin };
  }

  // Sell a fraction of the open position: "sell half my eth" / "sell a quarter of my btc"
  const fractionMatch = text.match(
    new RegExp(`sell (?:a )?(half|quarter|third|all)(?: of)? my ${COIN_RE}$`),
  );
  if (fractionMatch) {
    const coin = coinOf(fractionMatch[2]);
    if (coin) {
      if (fractionMatch[1] === 'all') return { kind: 'close', coin };
      const fraction = fractionMatch[1] === 'half' ? 0.5 : fractionMatch[1] === 'quarter' ? 0.25 : 1 / 3;
      return { kind: 'order', coin, side: 'sell', fraction };
    }
  }

  // Buy/sell a USD amount: "buy $500 bitcoin" / "buy 500 dollars of bitcoin"
  const usdMatch = text.match(
    new RegExp(`(buy|sell) \\$?${NUM_RE} (?:dollars?|usd|bucks?)(?: of)? ${COIN_RE}`),
  );
  if (usdMatch) {
    const coin = coinOf(usdMatch[4]);
    if (coin) {
      return {
        kind: 'order',
        coin,
        side: usdMatch[1] as 'buy' | 'sell',
        usdAmount: parseNumber(usdMatch[2], usdMatch[3]),
      };
    }
  }
  // "$500 of bitcoin" with the $ sign before the number and no "dollars" word.
  const usdShortMatch = text.match(new RegExp(`(buy|sell) \\$${NUM_RE} (?:of )?${COIN_RE}`));
  if (usdShortMatch) {
    const coin = coinOf(usdShortMatch[4]);
    if (coin) {
      return {
        kind: 'order',
        coin,
        side: usdShortMatch[1] as 'buy' | 'sell',
        usdAmount: parseNumber(usdShortMatch[2], usdShortMatch[3]),
      };
    }
  }

  // Buy/sell a coin size: "buy 0.01 bitcoin" / "sell 2 eth"
  const sizeMatch = text.match(new RegExp(`(buy|sell) ${NUM_RE} ${COIN_RE}`));
  if (sizeMatch) {
    const coin = coinOf(sizeMatch[4]);
    if (coin) {
      return {
        kind: 'order',
        coin,
        side: sizeMatch[1] as 'buy' | 'sell',
        size: parseNumber(sizeMatch[2], sizeMatch[3]),
      };
    }
  }

  // Buy/sell with no size: "buy bitcoin" — ask for the size, never guess.
  const bareMatch = text.match(new RegExp(`(buy|sell)(?: my)? ${COIN_RE}$`));
  if (bareMatch) {
    const coin = coinOf(bareMatch[2]);
    if (coin) return { kind: 'needs_size', coin, side: bareMatch[1] as 'buy' | 'sell' };
  }

  return { kind: 'unknown', transcript };
}
