# HL Paper Trader — glasses app

The Even G2 front end for **HL Paper Trader** (see the repo-root README
for the full story). It shows live Hyperliquid BTC/ETH/SOL mids, the paper
portfolio, and the voice-order flow. It holds **no API keys** and talks
only to our own backend.

Derived from the Even Hub `asr` template (startup container, event
routing, double-tap exit, and the `SttClient` interface in
`src/asr/stt.ts`); every screen and the whole voice state machine were
written for this hackathon, 23–26 Nov 2026.

## Controls

| Input | Action |
|---|---|
| Tap (temple) | Switch Prices ⇄ Positions · on Confirm: **YES** · stop listening early · dismiss info/error/alert screens |
| Scroll down (R1 ring) | From Prices/Positions: start listening (≤15 s) · on Confirm: **NO** (cancels on both surfaces) |
| Double-tap | Exit (system confirmation) |

There is no long-press event in the SDK, so scroll-down is the voice
trigger.

## Screens & states

- **Prices** — BTC/ETH/SOL mids + 24h change, polled every 2 s. While the
  feed is down they carry a **STALE · reconnecting — last known** marker;
  while the backend is down, an explicit "Prices unavailable" state.
- **Positions** — equity / cash / realized PnL + open positions; an
  explicit "No open positions — paper equity $X" empty state.
- **Listening** — elapsed-seconds counter; tap stops early.
- **Confirm** — one screen: order, notional, cash after. Auto-cancels
  after 20 s (which also cancels the Telegram confirm — one shared
  pending order, executable at most once).
- **Fill** — executed order at the live mid; returns to Prices after 4 s.
- **Alert fired** — a stored price alert that crossed pops up once
  (polled from the backend), auto-dismisses after 8 s.
- **Mic unavailable** — no audio received (mic denied/unavailable):
  named state, prices keep working.
- **Voice error** — STT failure or unparseable phrase: "Couldn't hear
  that — try again" / the backend's message verbatim. No phantom orders.

## Run

```bash
npm install
npm run dev        # Vite on :5173
npm run build      # tsc --noEmit + vite build -> dist/
npm run simulate   # desktop simulator (WebKitGTK libs + Xvfb on Linux)
npx evenhub pack app.json dist -o hl-paper-trader.ehpk --sdk-ver 0.0.10
```

The backend origin is `VITE_BACKEND_URL` at build/dev time, defaulting
to the deployed Railway backend; it must be whitelisted in `app.json`
(the manifest already lists the Railway origin + `localhost:3000`).

In dev builds only (`import.meta.env.DEV`), two test hooks exist: a
`?voice=<transcript>` URL param and a web-preview transcript input, both
feeding the same `/intent` pipeline as the real mic — the simulator
cannot produce mic PCM. Production builds contain neither hook.

## Files

| File | Purpose |
|---|---|
| `src/main.ts` | App entry: screens, polling, voice state machine, event routing, alert polling. |
| `src/ui.ts` | WebView mirror UI + every glasses text formatter (prices, positions, confirm, fill, edge-case states). |
| `src/asr/stt.ts` | Buffer-and-POST STT client: mic PCM (s16le, 16 kHz, mono, ≤15 s) → backend `/stt` → one final transcript snapshot. The Groq key lives only in the backend. |
| `app.json` | Manifest: `g2-microphone` + `network` (backend origins only), version aligned with the backend (0.4.1). |
