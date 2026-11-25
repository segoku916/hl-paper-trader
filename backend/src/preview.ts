/**
 * Order preview — Day 3.
 *
 * Pure function: price a parsed voice intent against live mids + the paper
 * portfolio. Returns a preview the glasses confirm screen can show, or an
 * error string to show verbatim instead. No order is ever executed here —
 * execution stays on POST /order after the user confirms on the glasses.
 */

import type { Intent } from './intent.js';
import type { PortfolioView } from './ledger.js';
import type { WatchCoin } from './hl.js';

export interface OrderPreview {
  coin: WatchCoin;
  side: 'buy' | 'sell' | 'close';
  size: number;
  price: number;
  notional: number;
  cashAfter: number;
  realizedPnl?: number;
}

export interface PreviewResult {
  preview: OrderPreview | null;
  alert?: { coin: WatchCoin; direction: 'above' | 'below'; price: number };
  error?: string;
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;
const roundSize = (n: number): number => Math.round(n * 1e8) / 1e8;

export function buildPreview(
  intent: Intent,
  marks: Record<string, number | null>,
  portfolio: PortfolioView,
): PreviewResult {
  if (intent.kind === 'unknown') {
    return { preview: null, error: 'Didn\'t catch that — try "buy 0.01 BTC"' };
  }
  if (intent.kind === 'needs_size') {
    return { preview: null, error: `How much ${intent.coin}? Try "buy 0.01 ${intent.coin}"` };
  }
  if (intent.kind === 'alert') {
    // Day 4: alerts are real now — server.ts stores the alert and returns a
    // "set" confirmation. No error, no preview; nothing to price here.
    return { preview: null, alert: intent };
  }

  const mid = marks[intent.coin] ?? null;
  if (mid === null || !Number.isFinite(mid) || mid <= 0) {
    return { preview: null, error: 'live price unavailable — feed not connected yet, retry in a moment' };
  }
  const position = portfolio.positions.find(p => p.coin === intent.coin);
  const held = position?.size ?? 0;
  const avgEntry = position?.avgEntry ?? 0;

  if (intent.kind === 'close') {
    if (held <= 0) return { preview: null, error: `nothing to close: no open ${intent.coin} position` };
    const notional = roundMoney(held * mid);
    return {
      preview: {
        coin: intent.coin,
        side: 'close',
        size: held,
        price: mid,
        notional,
        cashAfter: roundMoney(portfolio.cash + notional),
        realizedPnl: roundMoney(held * (mid - avgEntry)),
      },
    };
  }

  // intent.kind === 'order'
  if (intent.side === 'buy') {
    let size: number;
    let notional: number;
    if (intent.usdAmount !== undefined) {
      notional = roundMoney(intent.usdAmount);
      size = roundSize(intent.usdAmount / mid);
    } else if (intent.size !== undefined) {
      size = intent.size;
      notional = roundMoney(size * mid);
    } else {
      return { preview: null, error: `How much ${intent.coin}? Try "buy 0.01 ${intent.coin}"` };
    }
    if (notional > portfolio.cash) {
      return {
        preview: null,
        error: `insufficient paper cash: ${size} ${intent.coin} @ $${mid} = $${notional}, cash $${portfolio.cash}`,
      };
    }
    return { preview: { coin: intent.coin, side: 'buy', size, price: mid, notional, cashAfter: roundMoney(portfolio.cash - notional) } };
  }

  // Sell: explicit size or a fraction of the open position.
  let size: number;
  if (intent.fraction !== undefined) {
    if (held <= 0) return { preview: null, error: `nothing to sell: no open ${intent.coin} position` };
    size = roundSize(held * intent.fraction);
  } else if (intent.size !== undefined) {
    size = intent.size;
  } else {
    return { preview: null, error: `How much ${intent.coin}? Try "sell 0.01 ${intent.coin}"` };
  }
  if (size > held) {
    return { preview: null, error: `insufficient position: trying to sell ${size} ${intent.coin} but holding ${held}` };
  }
  const notional = roundMoney(size * mid);
  return {
    preview: {
      coin: intent.coin,
      side: 'sell',
      size,
      price: mid,
      notional,
      cashAfter: roundMoney(portfolio.cash + notional),
      realizedPnl: roundMoney(size * (mid - avgEntry)),
    },
  };
}
