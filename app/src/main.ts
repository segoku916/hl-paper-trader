/**
 * HL Paper Trader — glasses app entry (Day 1 prices + Day 2 positions + Day 3 voice).
 *
 * Home screen: live BTC/ETH/SOL mids + 24h change, polled from our backend
 * (GET /prices, Hyperliquid allMids — the sole price source).
 * Positions screen (Day 2): paper equity/cash/realized PnL + open positions,
 * polled from GET /positions. Tap switches between the two screens.
 *
 * Voice orders (Day 3): scroll DOWN (R1 ring) from Prices or Positions starts
 * a ≤15 s listen; tap stops early; mic PCM goes to POST /stt (Groq Whisper,
 * key backend-only), the transcript to POST /intent, then a one-screen
 * confirm: tap = YES (POST /order), scroll = NO (auto-cancel after 20 s).
 * Double-tap exits from every screen. There is no long-press event in the
 * SDK (OsEventTypeList has no such value), so scroll is the voice trigger.
 *
 * Day 4: voice alerts are stored for real (POST /intent sets the alert and
 * the glasses confirm it); order confirms carry the backend's pending-order
 * id so a Telegram inline Yes and a glasses tap can never double-execute.
 */
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';
import {
  mountUi,
  setStatus,
  setPrices,
  setUpdated,
  setPortfolio,
  setVoicePanel,
  escapeHtml,
  formatGlassesText,
  formatGlassesPositions,
  formatGlassesListening,
  formatGlassesConfirm,
  formatGlassesFill,
  formatGlassesVoiceError,
  BUILD_STAMP,
  type PriceRow,
  type PortfolioView,
  type OrderPreviewView,
  type FillView,
} from './ui';
import { startSttStream, type SttClient } from './asr/stt';

console.log(`[hl] HL Paper Trader build ${BUILD_STAMP}`);

mountUi(transcript => void handleTranscript(transcript));

// Backend origin. Deployed backend (Railway, live since 23 Nov 2026):
// https://hl-paper-trader-production.up.railway.app
// Local dev against a local backend: rebuild/run with
// VITE_BACKEND_URL=http://localhost:3000 — and keep localhost in app.json's
// network whitelist.
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'https://hl-paper-trader-production.up.railway.app';
const POLL_MS = 2000;
const LISTEN_MAX_MS = 15_000;
const CONFIRM_TIMEOUT_MS = 20_000;
const FILL_SHOW_MS = 4_000;

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

/** Push one screen to both the glasses container and the web preview panel. */
function showScreen(glassesText: string, webHtml: string | null) {
  currentContent = glassesText;
  scheduleGlassesRender();
  setVoicePanel(webHtml);
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

interface IntentResponse {
  ok: boolean;
  transcript?: string;
  preview?: OrderPreviewView | null;
  alert?: { coin: string; direction: string; price: number } | null;
  alertId?: number | null;
  /** Day 4: "Alert set: …" confirmation text for a stored alert. */
  message?: string | null;
  /** Day 4: id of the pending order both confirm paths share. */
  pendingOrderId?: string | null;
  error?: string | null;
}

interface OrderResponse {
  ok: boolean;
  fill?: FillView;
  error?: string;
}

type View = 'prices' | 'positions';
let view: View = 'prices';

// ── Voice state machine (Day 3) ──────────────────────────────────────────
// idle: normal Prices/Positions polling. Every other mode pauses the 2 s
// poll so a refresh can never overwrite a voice screen.
type VoiceMode =
  | { mode: 'idle' }
  | { mode: 'listening'; startedAt: number }
  | { mode: 'thinking'; transcript: string }
  | { mode: 'confirm'; preview: OrderPreviewView; transcript: string; pendingOrderId: string | null }
  | { mode: 'info'; message: string }
  | { mode: 'fill'; fill: FillView }
  | { mode: 'error'; message: string };

let voice: VoiceMode = { mode: 'idle' };
let sttClient: SttClient | null = null;
let voiceTimer: number | null = null; // one-shot (listen cap / confirm timeout / fill return)
let listenTicker: number | null = null; // 1 s elapsed-seconds refresh while listening

function clearVoiceTimers() {
  if (voiceTimer !== null) {
    window.clearTimeout(voiceTimer);
    voiceTimer = null;
  }
  if (listenTicker !== null) {
    window.clearInterval(listenTicker);
    listenTicker = null;
  }
}

async function stopMicQuietly() {
  try {
    await bridge.audioControl(false);
  } catch (err) {
    console.warn('audioControl(false) failed:', err);
  }
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
// Polling pauses while any voice screen is up (listening/confirm/fill/…),
// so a refresh can never overwrite it; it resumes on return to idle.
window.setInterval(() => {
  if (voice.mode === 'idle') void refreshCurrent();
}, POLL_MS);

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

/** Back to the Prices screen: clear voice state, resume polling. */
function backToPrices() {
  clearVoiceTimers();
  sttClient = null;
  voice = { mode: 'idle' };
  view = 'prices';
  setVoicePanel(null);
  void refreshPrices();
}

function showVoiceError(message: string) {
  voice = { mode: 'error', message };
  showScreen(formatGlassesVoiceError(message), escapeHtml(message));
  setStatus('error', 'Voice — tap to go back');
}

function showVoiceInfo(message: string) {
  voice = { mode: 'info', message };
  showScreen(formatGlassesVoiceError(message), escapeHtml(message));
  setStatus('live', 'Voice');
}

/** Start a ≤15 s listen window (scroll down from Prices/Positions). */
async function startListening() {
  if (voice.mode !== 'idle') return;
  const startedAt = Date.now();
  voice = { mode: 'listening', startedAt };
  const renderListening = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    showScreen(formatGlassesListening(elapsed), `Listening…<br>Tap to stop · ${elapsed}s`);
  };
  renderListening();
  setStatus('live', 'Listening… tap to stop');
  listenTicker = window.setInterval(renderListening, 1000);
  voiceTimer = window.setTimeout(() => void stopListening(), LISTEN_MAX_MS);

  sttClient = startSttStream(
    BACKEND_URL,
    snap => {
      if (snap.finished) void handleTranscript(snap.finalText);
    },
    err => {
      console.warn('STT failed:', err);
      showVoiceError(err instanceof Error ? err.message : 'Voice transcription failed');
    },
  );
  try {
    await bridge.audioControl(true);
  } catch (err) {
    console.warn('audioControl(true) failed (mic may be unavailable in the simulator):', err);
  }
}

/** Stop the mic early (tap) or at the 15 s cap; STT POSTs and the snapshot flows on. */
async function stopListening() {
  if (voice.mode !== 'listening') return;
  clearVoiceTimers();
  await stopMicQuietly();
  const client = sttClient;
  sttClient = null;
  voice = { mode: 'thinking', transcript: '' };
  showScreen('Heard…\nChecking…', 'Heard…<br>Checking…');
  client?.close();
}

/**
 * The single transcript pipeline — shared by the real mic path (STT snapshot),
 * the DEV `?voice=` query param, and the DEV web-preview test input.
 */
async function handleTranscript(transcript: string) {
  const text = transcript.trim();
  if (!text) {
    showVoiceError('Didn\'t catch that — try "buy 0.01 BTC"');
    return;
  }
  clearVoiceTimers();
  voice = { mode: 'thinking', transcript: text };
  showScreen(`"${text}"\nChecking…`, `“${escapeHtml(text)}”<br>Checking…`);
  setStatus('live', 'Checking intent…');
  try {
    const res = await fetch(`${BACKEND_URL}/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: text }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as IntentResponse;
    if (!res.ok || !data.ok) {
      showVoiceError(typeof data.error === 'string' ? data.error : `Intent failed (HTTP ${res.status})`);
      return;
    }
    if (data.preview) {
      voice = { mode: 'confirm', preview: data.preview, transcript: text, pendingOrderId: data.pendingOrderId ?? null };
      showScreen(formatGlassesConfirm(data.preview), formatGlassesConfirm(data.preview).replace(/\n/g, '<br>'));
      setStatus('live', 'Confirm on glasses — tap YES, scroll NO');
      voiceTimer = window.setTimeout(() => {
        console.log('[hl] confirm timed out after 20 s, cancelling');
        cancelPendingOrder();
        backToPrices();
      }, CONFIRM_TIMEOUT_MS);
      return;
    }
    // Day 4: a voice alert is stored for real — the backend confirms it was
    // SET (the Day 3 "alerts land on Day 4" text is gone). Tap to go back.
    if (data.alert) {
      showVoiceInfo(
        data.message ??
          `Alert set: ${data.alert.coin} ${data.alert.direction} $${data.alert.price.toLocaleString('en-US')}`,
      );
      return;
    }
    // No preview and no alert: needs_size or unknown — the backend error
    // text is the screen, verbatim. No order is attempted.
    showVoiceInfo(data.error ?? 'Didn\'t catch that — try "buy 0.01 BTC"');
  } catch (err) {
    console.warn('Intent request failed:', err);
    showVoiceError('Backend unreachable — retrying');
  }
}

/** Day 4: tell the backend the shared pending order is cancelled (scroll-No
 * or the 20 s timeout) so a Telegram Yes can no longer execute it either.
 * Best-effort — the glasses return to Prices whether or not the call lands. */
function cancelPendingOrder() {
  if (voice.mode !== 'confirm' || !voice.pendingOrderId) return;
  const pendingOrderId = voice.pendingOrderId;
  void fetch(`${BACKEND_URL}/order/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pendingOrderId }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => console.warn('Cancel request failed:', err));
}

/** Confirm screen, tap = YES: execute the previewed order. */
async function executeConfirmedOrder() {
  if (voice.mode !== 'confirm') return;
  const { preview, pendingOrderId } = voice;
  clearVoiceTimers();
  voice = { mode: 'thinking', transcript: '' };
  showScreen('Placing order…', 'Placing order…');
  try {
    // Day 4: send the pending-order id so the backend claims the ONE shared
    // order — a Telegram Yes that already filled it makes this a no-op.
    const body: Record<string, unknown> = { coin: preview.coin, side: preview.side, size: preview.size };
    if (pendingOrderId) body.pendingOrderId = pendingOrderId;
    const res = await fetch(`${BACKEND_URL}/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as OrderResponse;
    if (!res.ok || !data.ok || !data.fill) {
      showVoiceError(typeof data.error === 'string' ? data.error : `Order failed (HTTP ${res.status})`);
      return;
    }
    voice = { mode: 'fill', fill: data.fill };
    // A close executes as a sell in the ledger — keep the CLOSE wording from
    // the confirm screen so the fill doesn't read as a plain SELL.
    const fillVerb = preview.side === 'close' ? 'CLOSE' : undefined;
    showScreen(formatGlassesFill(data.fill, fillVerb), formatGlassesFill(data.fill, fillVerb).replace(/\n/g, '<br>'));
    setStatus('live', 'Order filled');
    voiceTimer = window.setTimeout(backToPrices, FILL_SHOW_MS);
  } catch (err) {
    console.warn('Order request failed:', err);
    showVoiceError('Backend unreachable — retrying');
  }
}

/** Normalize a PCM chunk: the host may deliver Uint8Array, number[], or base64. */
function normalizePcm(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  if (typeof raw === 'string') {
    try {
      const bin = atob(raw);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  clearVoiceTimers();
  void stopMicQuietly();
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
//     can always exit the app — from every screen, including voice screens.
//     System exit confirmation dialog appears; SYSTEM_EXIT_EVENT fires on
//     confirm and we clean up there.
//   • Tap → depends on the voice state: idle toggles Prices ⇄ Positions;
//     listening stops early (then STT runs); confirm executes the order;
//     info/error/fill returns to Prices. Ignored while thinking.
//   • Scroll down (R1 ring) → from idle, starts listening; on the confirm
//     screen, any scroll cancels the order. Otherwise ignored.
//   • Mic PCM chunks → fed to the STT buffer while listening.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = eventTypeOf(event.sysEvent);
  const textType = eventTypeOf(event.textEvent);

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void stopMicQuietly();
    bridge.shutDownPageContainer(1);
    return;
  }

  if (event.audioEvent?.audioPcm && voice.mode === 'listening' && sttClient) {
    const pcm = normalizePcm(event.audioEvent.audioPcm);
    if (pcm) sttClient.sendPcm(pcm);
    return;
  }

  const isClick = sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT;
  const isScrollDown =
    sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT;
  const isScroll =
    isScrollDown ||
    sysType === OsEventTypeList.SCROLL_TOP_EVENT ||
    textType === OsEventTypeList.SCROLL_TOP_EVENT;

  if (isClick) {
    switch (voice.mode) {
      case 'idle':
        view = view === 'prices' ? 'positions' : 'prices';
        void refreshCurrent();
        break;
      case 'listening':
        void stopListening();
        break;
      case 'confirm':
        void executeConfirmedOrder();
        break;
      case 'info':
      case 'error':
      case 'fill':
        backToPrices();
        break;
      case 'thinking':
        break; // ignore taps while STT/intent/order is in flight
    }
    return;
  }

  if (isScroll) {
    if (voice.mode === 'confirm') {
      console.log('[hl] confirm cancelled by scroll');
      cancelPendingOrder();
      backToPrices();
      return;
    }
    if (isScrollDown && voice.mode === 'idle') {
      void startListening();
      return;
    }
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup();
  }
});

window.addEventListener('beforeunload', cleanup);

// DEV ONLY — the simulator cannot produce mic PCM, so `?voice=<transcript>`
// feeds a transcript into the SAME handleTranscript → /intent → Confirm →
// /order pipeline as the real mic path. import.meta.env.DEV is false in
// production builds: never active in a shipped app.
if (import.meta.env.DEV) {
  const voiceParam = new URLSearchParams(window.location.search).get('voice');
  if (voiceParam) {
    window.setTimeout(() => void handleTranscript(voiceParam), 500);
  }
}
