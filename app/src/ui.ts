/**
 * HL Paper Trader — glasses home screen (Day 1).
 *
 * Glanceable live prices: BTC/ETH/SOL mids + 24h change, fed by our backend
 * (Hyperliquid allMids — the sole price source; CoinGecko is not used).
 * The same data is pushed to the G2 text container by main.ts.
 */

export interface PriceRow {
  coin: string;
  mid: number | null;
  change24h: number | null;
}

export interface PositionView {
  coin: string;
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
}

type Status = 'connecting' | 'live' | 'error';

let statusEl: HTMLDivElement;
let rowsEl: HTMLDivElement;
let updatedEl: HTMLDivElement;
let positionsEl: HTMLDivElement;

export function mountUi() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <main class="panel">
      <header>
        <h1>HL Paper Trader</h1>
        <div id="status" class="status status-connecting">Connecting…</div>
      </header>
      <section id="rows" class="rows" aria-live="polite"></section>
      <div id="updated" class="updated"></div>
      <section id="positions" class="positions" aria-live="polite"></section>
      <footer>Tap the glasses temple to switch Prices ⇄ Positions · double-tap to exit.</footer>
    </main>
  `;
  statusEl = app.querySelector<HTMLDivElement>('#status')!;
  rowsEl = app.querySelector<HTMLDivElement>('#rows')!;
  updatedEl = app.querySelector<HTMLDivElement>('#updated')!;
  positionsEl = app.querySelector<HTMLDivElement>('#positions')!;
  injectStyles();
  setPrices([
    { coin: 'BTC', mid: null, change24h: null },
    { coin: 'ETH', mid: null, change24h: null },
    { coin: 'SOL', mid: null, change24h: null },
  ]);
}

export function setStatus(kind: Status, text: string) {
  if (!statusEl) return;
  statusEl.className = `status status-${kind}`;
  statusEl.textContent = text;
}

export function setPrices(prices: PriceRow[]) {
  if (!rowsEl) return;
  rowsEl.innerHTML = prices
    .map(row => {
      const price = row.mid === null ? '—' : formatPrice(row.mid);
      const change =
        row.change24h === null
          ? '<span class="chg chg-flat">—</span>'
          : `<span class="chg ${row.change24h >= 0 ? 'chg-up' : 'chg-down'}">${formatChange(row.change24h)}</span>`;
      return `<div class="row">
        <span class="coin">${row.coin}</span>
        <span class="price">$${price}</span>
        ${change}
      </div>`;
    })
    .join('');
}

export function setUpdated(text: string) {
  if (!updatedEl) return;
  updatedEl.textContent = text;
}

/** Day 2 — paper portfolio (positions + PnL) for the web preview panel. */
export function setPortfolio(p: PortfolioView) {
  if (!positionsEl) return;
  const head = `<div class="pos-head">
      <span>Equity <b>$${formatPrice(p.equity)}</b></span>
      <span>Cash $${formatPrice(p.cash)}</span>
      <span>Realized <span class="${p.realizedPnl >= 0 ? 'chg-up' : 'chg-down'}">${formatSigned(p.realizedPnl)}</span></span>
    </div>`;
  if (p.positions.length === 0) {
    positionsEl.innerHTML = `${head}<div class="pos-empty">No open positions</div>`;
    return;
  }
  positionsEl.innerHTML =
    head +
    p.positions
      .map(pos => {
        const pnl =
          pos.unrealizedPnl === null
            ? '<span class="chg chg-flat">—</span>'
            : `<span class="chg ${pos.unrealizedPnl >= 0 ? 'chg-up' : 'chg-down'}">${formatSigned(pos.unrealizedPnl)} (${pos.unrealizedPnlPct === null ? '—' : formatChange(pos.unrealizedPnlPct)})</span>`;
        return `<div class="row pos-row">
          <span class="coin">${pos.coin}</span>
          <span class="pos-detail">${trimSize(pos.size)} @ $${formatPrice(pos.avgEntry)}<br>
            <span class="pos-sub">Val ${pos.value === null ? '—' : '$' + formatPrice(pos.value)}</span></span>
          ${pnl}
        </div>`;
      })
      .join('');
}

function trimSize(size: number): string {
  return String(Number(size.toFixed(6)));
}

export function formatSigned(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${formatPrice(Math.abs(n))}`;
}

export function formatPrice(mid: number): string {
  return mid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatChange(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Compact one-line-per-coin text for the G2 display (576x288 container). */
export function formatGlassesText(prices: PriceRow[]): string {
  return prices
    .map(row => {
      const price = row.mid === null ? '—' : formatPrice(row.mid);
      const change = row.change24h === null ? '' : ` ${formatChange(row.change24h)}`;
      return `${row.coin} $${price}${change}`;
    })
    .join('\n');
}

/** Compact positions + PnL text for the G2 display (576x288 container). */
export function formatGlassesPositions(p: PortfolioView): string {
  const lines = [
    'HL Paper Trader · Positions',
    `Equity $${formatPrice(p.equity)}`,
    `Cash $${formatPrice(p.cash)} · Realized ${formatSigned(p.realizedPnl)}`,
  ];
  if (p.positions.length === 0) {
    lines.push('No open positions');
    return lines.join('\n');
  }
  for (const pos of p.positions) {
    lines.push(`${pos.coin} ${trimSize(pos.size)} @ $${formatPrice(pos.avgEntry)}`);
    const val = pos.value === null ? '—' : `$${formatPrice(pos.value)}`;
    const pnl =
      pos.unrealizedPnl === null
        ? ''
        : ` · ${formatSigned(pos.unrealizedPnl)}${pos.unrealizedPnlPct === null ? '' : ` (${formatChange(pos.unrealizedPnlPct)})`}`;
    lines.push(`Val ${val}${pnl}`);
  }
  return lines.join('\n');
}

function injectStyles() {
  // ER brand dark-theme surfaces: #232323 / #2E2E2E / #3E3E3E.
  // ER OS green (#3CFA44) + signal red (#FF453A) for state chips.
  const css = `
    :root { color-scheme: dark; }
    html, body { margin: 0; height: 100%; background: #232323; color: #E5E5E5;
      font: 16px/1.4 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif;
      touch-action: manipulation; -webkit-text-size-adjust: 100%;
      overscroll-behavior: none; }
    #app { display: flex; height: 100%; }
    .panel { display: flex; flex-direction: column; gap: 16px;
      width: 100%; max-width: 640px; margin: 0 auto; padding: 24px; box-sizing: border-box; }
    header { display: flex; align-items: center; justify-content: space-between; }
    h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
    .status { font-size: 12px; padding: 4px 10px; border-radius: 999px;
      border: 1px solid transparent; letter-spacing: 0.04em; text-transform: uppercase; }
    .status-connecting { color: #A7A7A7; border-color: #3E3E3E; }
    .status-live { color: #3CFA44; border-color: #3CFA44; background: rgba(60,250,68,0.08); }
    .status-error { color: #FF453A; border-color: #FF453A; background: rgba(255,69,58,0.08); }
    .rows { display: flex; flex-direction: column; gap: 12px; }
    .row { display: flex; align-items: baseline; gap: 12px; background: #2E2E2E;
      border: 1px solid #3E3E3E; border-radius: 12px; padding: 18px 20px; }
    .coin { font-size: 20px; font-weight: 700; width: 56px; letter-spacing: 0.02em; }
    .price { flex: 1; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .chg { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .chg-up { color: #3CFA44; }
    .chg-down { color: #FF453A; }
    .chg-flat { color: #919191; }
    .updated { font-size: 12px; color: #7B7B7B; text-align: right; min-height: 16px; }
    .positions { display: flex; flex-direction: column; gap: 12px; }
    .pos-head { display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #A7A7A7;
      background: #2E2E2E; border: 1px solid #3E3E3E; border-radius: 12px; padding: 12px 16px; }
    .pos-head b { color: #E5E5E5; }
    .pos-empty { font-size: 14px; color: #7B7B7B; text-align: center; padding: 8px 0; }
    .pos-detail { flex: 1; font-size: 16px; font-variant-numeric: tabular-nums; }
    .pos-sub { font-size: 13px; color: #A7A7A7; }
    footer { font-size: 12px; color: #7B7B7B; text-align: center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
