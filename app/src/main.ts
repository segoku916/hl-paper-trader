/**
 * HL Paper Trader — glasses app entry (Day 1 prices + Day 2 positions).
 *
 * Home screen: live BTC/ETH/SOL mids + 24h change, polled from our backend
 * (GET /prices, Hyperliquid allMids — the sole price source).
 * Positions screen (Day 2): paper equity/cash/realized PnL + open positions,
 * polled from GET /positions. Tap switches between the two screens.
 *
 * The mic/STT voice-order flow is Day 3 — `src/asr/stt.ts` stays the
 * template stub until then, and no API key is needed (or shipped) today.
 * Tap switches screens; double-tap exits.
 */
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import { mountUi, setStatus, setPrices, setUpdated, setPortfolio, formatGlassesText, formatGlassesPositions, type PriceRow, type PortfolioView } from './ui';

mountUi();

// Backend origin. Deployed backend (Railway, live since 23 Nov 2026):
// https://hl-paper-trader-production.up.railway.app
// Local dev against a local backend: rebuild/run with
// VITE_BACKEND_URL=http://localhost:3000 — and keep localhost in app.json's
// network whitelist.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'https://hl-paper-trader-production.up.railway.app';
const POLL_MS = 2000;

const bridge = await waitForEvenAppBridge();

const pricesText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'prices',
  content: 'HL Paper Trader\nConnecting…',
  isEventCapture: 1,
});

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [pricesText] }),
);
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`);
  console.error('Failed to create startup page');
}

let lastRender = '';
let renderTimer: number | null = null;
let currentContent = 'HL Paper Trader\nConnecting…';

function scheduleGlassesRender() {
  if (renderTimer !== null) return;
  renderTimer = window.setTimeout(async () => {
    renderTimer = null;
    if (currentContent === lastRender) return;
    lastRender = currentContent;
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'prices',
        content: currentContent,
      }),
    );
  }, 120); // debounce display writes — BLE render queue is slow
}

interface PricesResponse {
  ok: boolean;
  hlConnected?: boolean;
  updatedAt?: string;
  prices?: PriceRow[];
}

interface PositionsResponse extends PortfolioView {
  ok: boolean;
}

type View = 'prices' | 'positions';
let view: View = 'prices';

async function refreshPrices() {
  try {
    const res = await fetch(`${BACKEND_URL}/prices`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PricesResponse;
    if (!data.ok || !data.prices) throw new Error('bad /prices response');
    setPrices(data.prices);
    setStatus('live', data.hlConnected === false ? 'Live · HL reconnecting' : 'Live · Hyperliquid');
    setUpdated(data.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleTimeString()}` : '');
    currentContent = `HL Paper Trader\n${formatGlassesText(data.prices)}`;
    scheduleGlassesRender();
  } catch (err) {
    setStatus('error', 'Backend unreachable — retrying');
    console.warn('Price refresh failed:', err);
    currentContent = 'HL Paper Trader\nPrices unavailable\nTap to retry';
    scheduleGlassesRender();
  }
}

await refreshPrices();
window.setInterval(() => void refreshCurrent(), POLL_MS);

async function refreshCurrent() {
  if (view === 'positions') await refreshPositions();
  else await refreshPrices();
}

async function refreshPositions() {
  try {
    const res = await fetch(`${BACKEND_URL}/positions`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PositionsResponse;
    if (!data.ok) throw new Error('bad /positions response');
    setPortfolio(data);
    setStatus('live', 'Live · Paper portfolio');
    setUpdated('Tap to switch to Prices');
    currentContent = formatGlassesPositions(data);
    scheduleGlassesRender();
  } catch (err) {
    setStatus('error', 'Backend unreachable — retrying');
    console.warn('Positions refresh failed:', err);
    currentContent = 'HL Paper Trader · Positions\nPortfolio unavailable\nTap to retry';
    scheduleGlassesRender();
  }
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  unsubscribe();
}

// Reads the event type out of one envelope.
//
// CLICK_EVENT is 0, and protobuf omits zero-value fields on the wire, so a
// single tap arrives as an envelope whose `eventType` is `undefined`. The
// default has to be resolved INSIDE the envelope check. Writing
// `event.sysEvent?.eventType ?? OsEventTypeList.CLICK_EVENT` instead would
// read CLICK on events that carry no `sysEvent` at all.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null;
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT;
}

// Event routing:
//   • Double-tap → `shutDownPageContainer(1)` is a root-level check: it
//     must fire no matter which envelope the event arrives in, so users
//     can always exit the app. System exit confirmation dialog appears;
//     SYSTEM_EXIT_EVENT fires on confirm and we clean up there.
//   • Tap → switch between the Prices and Positions screens (Day 2).
//     Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent);
  const textType = eventTypeOf(event.textEvent);

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1);
    return;
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    view = view === 'prices' ? 'positions' : 'prices';
    void refreshCurrent();
    return;
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup();
  }
});

window.addEventListener('beforeunload', cleanup);
