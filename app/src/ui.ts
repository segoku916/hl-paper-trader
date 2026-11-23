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

type Status = 'connecting' | 'live' | 'error';

let statusEl: HTMLDivElement;
let rowsEl: HTMLDivElement;
let updatedEl: HTMLDivElement;

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
      <footer>Tap the glasses temple to refresh · double-tap to exit.</footer>
    </main>
  `;
  statusEl = app.querySelector<HTMLDivElement>('#status')!;
  rowsEl = app.querySelector<HTMLDivElement>('#rows')!;
  updatedEl = app.querySelector<HTMLDivElement>('#updated')!;
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
    footer { font-size: 12px; color: #7B7B7B; text-align: center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
