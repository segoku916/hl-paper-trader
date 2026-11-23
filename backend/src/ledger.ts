/**
 * Paper ledger — Day 2.
 *
 * Single-user paper-trading account backed by SQLite (built-in `node:sqlite`,
 * no native deps). Starting paper equity is $10,000. Orders execute at the
 * live Hyperliquid mid supplied by the caller (the feed); no real funds ever
 * move. Long-only: selling requires an open position (no shorting in Day 2
 * scope). A buy's average entry is the size-weighted average of fills.
 *
 * Tables:
 *   positions — one row per coin: size, avgEntry, updatedAt
 *   fills     — every executed order: coin, side, size, price, notional,
 *               realizedPnl (0 for buys; size*(price-avgEntry) for sells)
 *   meta      — single-row cash balance, key 'cash'
 *
 * NOTE (demo): on Render's free tier the SQLite file lives on ephemeral disk,
 * so a redeploy/restart resets the paper account to $10,000. That is fine for
 * the hackathon demo (paper money), but do not treat fills as durable history.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WATCH_COINS, type WatchCoin } from './hl.js';

export const STARTING_EQUITY_USD = 10_000;

export type OrderSide = 'buy' | 'sell' | 'close';

export interface Fill {
  id: number;
  coin: WatchCoin;
  side: 'buy' | 'sell';
  size: number;
  price: number;
  notional: number;
  realizedPnl: number;
  createdAt: string;
}

export interface PositionView {
  coin: WatchCoin;
  size: number;
  avgEntry: number;
  mark: number | null;
  value: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

export interface PortfolioView {
  cash: number;
  equity: number;
  realizedPnl: number;
  positions: PositionView[];
  fills: Fill[];
}

export class LedgerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;
const roundSize = (n: number): number => Math.round(n * 1e8) / 1e8;

export class PaperLedger {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        coin TEXT PRIMARY KEY,
        size REAL NOT NULL,
        avgEntry REAL NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coin TEXT NOT NULL,
        side TEXT NOT NULL,
        size REAL NOT NULL,
        price REAL NOT NULL,
        notional REAL NOT NULL,
        realizedPnl REAL NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.db
      .prepare(`INSERT OR IGNORE INTO meta(key, value) VALUES ('cash', ?)`)
      .run(String(STARTING_EQUITY_USD));
  }

  /** Execute a confirmed order at the given live mid. Throws LedgerError. */
  executeOrder(coin: string, side: string, size: unknown, mid: number | null): Fill {
    if (!(WATCH_COINS as readonly string[]).includes(coin)) {
      throw new LedgerError(400, `unknown coin: ${coin} (Day 2 scope: BTC, ETH, SOL)`);
    }
    if (side !== 'buy' && side !== 'sell' && side !== 'close') {
      throw new LedgerError(400, `unknown side: ${side} (buy, sell, close)`);
    }
    if (mid === null || !Number.isFinite(mid) || mid <= 0) {
      throw new LedgerError(503, 'live price unavailable — feed not connected yet, retry in a moment');
    }

    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cashRow = this.db.prepare(`SELECT value FROM meta WHERE key = 'cash'`).get() as
        | { value: string }
        | undefined;
      const cash = Number(cashRow?.value ?? STARTING_EQUITY_USD);
      const posRow = this.db.prepare(`SELECT size, avgEntry FROM positions WHERE coin = ?`).get(coin) as
        | { size: number; avgEntry: number }
        | undefined;
      const posSize = posRow?.size ?? 0;
      const avgEntry = posRow?.avgEntry ?? 0;

      let execSide: 'buy' | 'sell';
      let execSize: number;
      if (side === 'close') {
        if (posSize <= 0) throw new LedgerError(400, `nothing to close: no open ${coin} position`);
        execSide = 'sell';
        execSize = posSize;
      } else {
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
          throw new LedgerError(400, `size must be a positive number (got ${JSON.stringify(size)})`);
        }
        execSide = side;
        execSize = size;
      }

      const notional = execSize * mid;
      let realizedPnl = 0;
      let newCash = cash;
      let newSize = posSize;
      let newAvg = avgEntry;

      if (execSide === 'buy') {
        if (notional > cash) {
          throw new LedgerError(
            400,
            `insufficient paper cash: ${execSize} ${coin} @ $${mid} = $${roundMoney(notional)}, cash $${roundMoney(cash)}`,
          );
        }
        newCash = cash - notional;
        newAvg = posSize > 0 ? (posSize * avgEntry + execSize * mid) / (posSize + execSize) : mid;
        newSize = posSize + execSize;
      } else {
        if (execSize > posSize) {
          throw new LedgerError(
            400,
            `insufficient position: trying to sell ${execSize} ${coin} but holding ${posSize}`,
          );
        }
        realizedPnl = execSize * (mid - avgEntry);
        newCash = cash + notional;
        newSize = posSize - execSize;
        if (newSize < 1e-12) newSize = 0;
      }

      const insert = this.db.prepare(
        `INSERT INTO fills (coin, side, size, price, notional, realizedPnl, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const result = insert.run(coin, execSide, execSize, mid, notional, realizedPnl, now);
      this.db.prepare(`UPDATE meta SET value = ? WHERE key = 'cash'`).run(String(newCash));
      if (newSize > 0) {
        this.db
          .prepare(
            `INSERT INTO positions (coin, size, avgEntry, updatedAt) VALUES (?, ?, ?, ?)
             ON CONFLICT(coin) DO UPDATE SET size = excluded.size, avgEntry = excluded.avgEntry, updatedAt = excluded.updatedAt`,
          )
          .run(coin, newSize, newAvg, now);
      } else {
        this.db.prepare(`DELETE FROM positions WHERE coin = ?`).run(coin);
      }
      this.db.exec('COMMIT');
      return {
        id: Number(result.lastInsertRowid),
        coin: coin as WatchCoin,
        side: execSide,
        size: roundSize(execSize),
        price: mid,
        notional: roundMoney(notional),
        realizedPnl: roundMoney(realizedPnl),
        createdAt: new Date(now).toISOString(),
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Full portfolio view, marking positions at the given live mids. */
  getPortfolio(marks: Record<string, number | null>): PortfolioView {
    const cashRow = this.db.prepare(`SELECT value FROM meta WHERE key = 'cash'`).get() as
      | { value: string }
      | undefined;
    const cash = roundMoney(Number(cashRow?.value ?? STARTING_EQUITY_USD));
    const posRows = this.db
      .prepare(`SELECT coin, size, avgEntry FROM positions ORDER BY coin`)
      .all() as { coin: string; size: number; avgEntry: number }[];
    const fillRows = this.db
      .prepare(`SELECT id, coin, side, size, price, notional, realizedPnl, createdAt FROM fills ORDER BY id DESC LIMIT 50`)
      .all() as {
      id: number;
      coin: string;
      side: string;
      size: number;
      price: number;
      notional: number;
      realizedPnl: number;
      createdAt: number;
    }[];

    const positions: PositionView[] = posRows.map(row => {
      const mark = marks[row.coin] ?? null;
      const value = mark === null ? null : roundMoney(row.size * mark);
      const unrealizedPnl = mark === null ? null : roundMoney(row.size * (mark - row.avgEntry));
      const unrealizedPnlPct =
        mark === null || row.avgEntry <= 0 ? null : Math.round(((mark - row.avgEntry) / row.avgEntry) * 10000) / 100;
      return {
        coin: row.coin as WatchCoin,
        size: roundSize(row.size),
        avgEntry: roundMoney(row.avgEntry),
        mark,
        value,
        unrealizedPnl,
        unrealizedPnlPct,
      };
    });
    const positionsValue = positions.reduce((sum, p) => sum + (p.value ?? 0), 0);
    const realizedPnl = roundMoney(fillRows.reduce((sum, f) => sum + f.realizedPnl, 0));
    const fills: Fill[] = fillRows.map(f => ({
      id: f.id,
      coin: f.coin as WatchCoin,
      side: f.side as 'buy' | 'sell',
      size: roundSize(f.size),
      price: f.price,
      notional: roundMoney(f.notional),
      realizedPnl: roundMoney(f.realizedPnl),
      createdAt: new Date(f.createdAt).toISOString(),
    }));
    return { cash, equity: roundMoney(cash + positionsValue), realizedPnl, positions, fills };
  }
}
