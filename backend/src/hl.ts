/**
 * Hyperliquid price feed — the SOLE price source for HL Paper Trader.
 *
 * Live mids come from the public `allMids` WebSocket (wss://api.hyperliquid.xyz/ws,
 * no key needed). 24h change is derived from the public REST candle endpoint
 * (1h candles, last 25h). CoinGecko is NOT in Track 2's live app list and is
 * never used — do not add it.
 *
 * Day 1 scope: BTC/ETH/SOL only. Watchlist expansion is Day 4.
 */

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';
const HL_REST_URL = 'https://api.hyperliquid.xyz/info';

export const WATCH_COINS = ['BTC', 'ETH', 'SOL'] as const;
export type WatchCoin = (typeof WATCH_COINS)[number];

export interface CoinPrice {
  coin: WatchCoin;
  /** Latest mid price, null until the first allMids snapshot arrives. */
  mid: number | null;
  /** Percent change vs ~24h ago, null until the first candle fetch succeeds. */
  change24h: number | null;
}

type Listener = () => void;

interface Candle {
  t: number;
  o: string;
  c: string;
}

export class HyperliquidFeed {
  private ws: WebSocket | null = null;
  private mids: Record<string, string> = {};
  private changes: Record<string, number | null> = { BTC: null, ETH: null, SOL: null };
  private listeners = new Set<Listener>();
  private reconnectDelayMs = 1000;
  private stopped = false;
  private changeTimer: NodeJS.Timeout | null = null;
  private lastMidAt = 0;

  start(): void {
    this.connectWs();
    void this.refreshChanges();
    // 24h change moves slowly; refresh every 5 minutes.
    this.changeTimer = setInterval(() => void this.refreshChanges(), 5 * 60 * 1000);
    this.changeTimer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.changeTimer) clearInterval(this.changeTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Current snapshot for the watched coins. */
  snapshot(): CoinPrice[] {
    return WATCH_COINS.map(coin => ({
      coin,
      mid: this.mids[coin] !== undefined ? Number(this.mids[coin]) : null,
      change24h: this.changes[coin],
    }));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get lastMidAtMs(): number {
    return this.lastMidAt;
  }

  onUpdate(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private connectWs(): void {
    if (this.stopped) return;
    const ws = new WebSocket(HL_WS_URL);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectDelayMs = 1000; // reset backoff on a good connection
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      console.log('[hl] connected to Hyperliquid WS, subscribed to allMids');
    });

    ws.addEventListener('message', event => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          channel?: string;
          data?: { mids?: Record<string, string> };
        };
        if (msg.channel === 'allMids' && msg.data?.mids) {
          this.mids = msg.data.mids;
          this.lastMidAt = Date.now();
          this.notify();
        }
      } catch (err) {
        console.warn('[hl] unparsable WS message:', err);
      }
    });

    ws.addEventListener('error', err => {
      console.warn('[hl] WS error:', (err as unknown as Error)?.message ?? err);
    });

    ws.addEventListener('close', () => {
      if (this.stopped) return;
      console.warn(`[hl] WS closed, reconnecting in ${this.reconnectDelayMs}ms`);
      const delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
      setTimeout(() => this.connectWs(), delay);
    });
  }

  /** Fetch 1h candles for the last ~25h and derive the 24h change per coin. */
  private async refreshChanges(): Promise<void> {
    const endTime = Date.now();
    const startTime = endTime - 26 * 60 * 60 * 1000;
    await Promise.all(
      WATCH_COINS.map(async coin => {
        try {
          const res = await fetch(HL_REST_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'candleSnapshot',
              req: { coin, interval: '1h', startTime, endTime },
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            console.warn(`[hl] candle fetch ${coin} -> HTTP ${res.status}`);
            return;
          }
          const candles = (await res.json()) as Candle[];
          if (candles.length < 2) return;
          const first = Number(candles[0].c);
          const last = Number(candles[candles.length - 1].c);
          if (first > 0 && last > 0) {
            this.changes[coin] = ((last - first) / first) * 100;
          }
        } catch (err) {
          console.warn(`[hl] candle fetch ${coin} failed:`, (err as Error)?.message ?? err);
        }
      }),
    );
    this.notify();
  }
}
