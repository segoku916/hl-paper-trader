/**
 * Pending orders — Day 4.
 *
 * ONE in-memory store shared by both confirm paths (glasses tap YES and
 * Telegram inline Yes/No). A voice order previewed by POST /intent becomes
 * a pending order; whichever surface confirms first claims it atomically,
 * and the other path then finds it already decided — so one order can never
 * execute twice. Pending orders expire after 5 minutes so a stale Telegram
 * Yes cannot execute an old preview at a new price.
 *
 * In-memory is deliberate: pending orders are ephemeral confirm windows
 * (the glasses auto-cancel after 20 s). A server restart clears them and
 * the user simply re-voices the order.
 */

import { randomUUID } from 'node:crypto';
import type { WatchCoin } from './hl.js';

export type PendingOrderStatus = 'pending' | 'executed' | 'cancelled' | 'expired';

export interface PendingOrder {
  id: string;
  coin: WatchCoin;
  side: 'buy' | 'sell' | 'close';
  size: number;
  /** Mid at preview time (display only — execution re-prices at the live mid). */
  price: number;
  notional: number;
  cashAfter: number;
  createdAt: number;
  expiresAt: number;
  status: PendingOrderStatus;
  /** Telegram inline-confirm message, once sent (for the FILLED/CANCELLED edit). */
  telegramChatId?: number;
  telegramMessageId?: number;
}

export const PENDING_ORDER_TTL_MS = 5 * 60 * 1000;

export class PendingOrderStore {
  private orders = new Map<string, PendingOrder>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = PENDING_ORDER_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(input: {
    coin: WatchCoin;
    side: 'buy' | 'sell' | 'close';
    size: number;
    price: number;
    notional: number;
    cashAfter: number;
  }): PendingOrder {
    const now = Date.now();
    const order: PendingOrder = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      status: 'pending',
    };
    this.orders.set(order.id, order);
    return order;
  }

  get(id: string): PendingOrder | undefined {
    return this.orders.get(id);
  }

  /**
   * Atomically claim a pending order for execution. Returns the order and
   * marks it executed, or null when it is already decided or expired.
   * Execution itself is synchronous (node:sqlite), so no interleaving can
   * slip a second claim between this check and the ledger write.
   */
  claimForExecution(id: string): PendingOrder | null {
    const order = this.orders.get(id);
    if (!order || order.status !== 'pending') return null;
    if (Date.now() > order.expiresAt) {
      order.status = 'expired';
      return null;
    }
    order.status = 'executed';
    return order;
  }

  /** Mark an optimistically-claimed order cancelled (execution failed). */
  markCancelled(id: string): void {
    const order = this.orders.get(id);
    if (order && order.status === 'executed') order.status = 'cancelled';
  }

  /** Cancel a still-pending order (Telegram No / user cancel). False when already decided. */
  cancel(id: string): boolean {
    const order = this.orders.get(id);
    if (!order || order.status !== 'pending') return false;
    if (Date.now() > order.expiresAt) {
      order.status = 'expired';
      return false;
    }
    order.status = 'cancelled';
    return true;
  }

  /** Expire stale pending orders; returns how many were expired. */
  sweepExpired(now: number = Date.now()): number {
    let expired = 0;
    for (const order of this.orders.values()) {
      if (order.status === 'pending' && now > order.expiresAt) {
        order.status = 'expired';
        expired++;
      }
    }
    return expired;
  }
}
