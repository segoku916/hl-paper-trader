/**
 * HL Paper Trader — glasses app entry (Day 1).
 *
 * Home screen: live BTC/ETH/SOL mids + 24h change, polled from our backend
 * (GET /prices, Hyperliquid allMids — the sole price source).
 *
 * The mic/STT voice-order flow is Day 3 — `src/asr/stt.ts` stays the
 * template stub until then, and no API key is needed (or shipped) today.
 * Tap refreshes prices; double-tap exits.
 */
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import { mountUi, setStatus, setPrices, setUpdated, formatGlassesText, type PriceRow } from './ui';

mountUi();

// Backend origin. Local dev: http://localhost:3000. When the backend is
// deployed (Render, Variou's step), rebuild with VITE_BACKEND_URL set to the
// deployed origin — and add that origin to app.json's network whitelist.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3000';
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
window.setInterval(() => void refreshPrices(), POLL_MS);

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
//   • Tap → refresh prices now. Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent);
  const textType = eventTypeOf(event.textEvent);

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1);
    return;
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    void refreshPrices();
    return;
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup();
  }
});

window.addEventListener('beforeunload', cleanup);
