# HL Paper Trader — Hyperliquid on Even G2

Your Hyperliquid trading desk on your glasses: glance at BTC/ETH/SOL prices,
place and confirm paper orders by voice, set price alerts by voice, and
confirm or reject every order from Telegram as well as on the glasses.

Built solo for the Even Realities **"Heads Up"** hackathon (DoraHacks,
Nov 23–29, 2026) — **Track 2: Crypto & DeFi**, also aiming for the
**Best Telegram Integration** special prize.

> **Paper trading only.** The account starts with $10,000 of simulated
> money. No wallet, no signing, no real funds, no real orders — fills
> execute at the live mid against a local paper ledger.

**Live backend:** https://hl-paper-trader-production.up.railway.app
(`/health` reports the running version; app + backend are both at **0.4.1**.)

## Demo flow

1. **Glance** — the home screen shows BTC/ETH/SOL live mids + 24h change.
   Tap the temple to switch to Positions (equity, cash, realized PnL,
   open positions with mark + unrealized PnL).
2. **Voice order** — scroll down (R1 ring) and say *"buy 0.01 BTC"*.
   Mic PCM goes to the backend, Groq Whisper transcribes it, a
   deterministic parser turns it into an order, and a one-screen confirm
   appears: **tap = YES, scroll = NO** (auto-cancel after 20 s).
3. **Fill** — the fill executes at the live mid and shows on the glasses;
   the same fill is pushed to the paired Telegram chat.
4. **Telegram two-way confirm** — every glasses confirm also appears in
   Telegram with inline **Yes/No** buttons. Both surfaces claim ONE shared
   pending order, so an order can never execute twice; a No (or the 20 s
   glasses timeout) cancels it for both surfaces.
5. **Voice alerts** — say *"alert me if BTC goes above 65,000"*: the alert
   is stored, fires once to Telegram when the live mid crosses it, and
   pops up once on the glasses too.

Telegram commands: `/start` (pairing), `/positions`, `/pnl`,
`/price [BTC|ETH|SOL]`, `/help`.

## Edge cases (Day 5 polish)

Failure modes get named screens, never silent fallbacks:

- **No mic / no audio received** → "Mic unavailable — prices still live".
- **STT failure** → "Couldn't hear that — try again"; unparseable phrases
  get the same retry-hint treatment. No phantom orders, ever.
- **Feed down** → prices show a **STALE · reconnecting — last known**
  marker, and Telegram `/price` says the feed is reconnecting instead of
  quoting a dead number as live.
- **Backend unreachable** → "Prices unavailable — tap to retry".
- **Empty portfolio** → an explicit "No open positions — paper equity $X".
- **Close with no position / selling more than held** → named refusal
  ("nothing to close", "insufficient position"); no fill, no ledger write.

## How it works

```
Even G2 glasses (display + mic + temple touch / R1 ring)
        │  Even Hub SDK, WebView in the Even Realities app
        ▼
Glasses app (app/, Vite + TypeScript)
        │  HTTP — talks ONLY to our backend, holds no keys
        ▼
Backend (backend/, Node 24 + TypeScript + SQLite)
        ├── Hyperliquid allMids WebSocket (live mids) + candle REST (24h change)
        ├── Groq Whisper (speech-to-text for voice orders)
        └── Telegram bot via grammY (pairing, fill/alert pushes, Yes/No confirm)
```

## Data honesty

Prices come **only** from Hyperliquid's public Info API (`allMids`
WebSocket for mids, candle snapshots for 24h change). **CoinGecko is not
used** — it is not in Track 2's live-app list. Telegram is the
notification/confirmation channel; the trading core is Hyperliquid.

## Repo structure

```
app/        Glasses app (Even Hub SDK, Vite + TS). package_id com.lethal.hlpapertrader
backend/    Node server: Hyperliquid feed, paper ledger, STT, Telegram bot
research.md Concept + SDK notes (from prep)
```

## Run it locally

### Backend

```bash
cd backend
npm install
npx -y tsx src/server.ts   # :3000 — /health, /prices, /positions, POST /order,
                           # POST /stt, POST /intent, /alerts, WS /stream
```

> Plain `npm start` crashes (`ERR_MODULE_NOT_FOUND` for the ESM `./hl.js`
> specifier under type-stripping) — use the `tsx` command above, locally
> and on the host.

No key is needed for the price feed (Hyperliquid's public API is keyless).
Two secrets are read from the environment, set by the project owner in the
hosting provider's variables — **never in this repo**:

- `GROQ_API_KEY` — voice transcription (Groq Whisper).
- `TELEGRAM_BOT_TOKEN` — the Telegram bot.

Without them the server still runs: `/stt` fails loud with a named error
and `/health` reports `telegram: "unavailable"`.

Verification suites (temp DBs only, no network, no real Telegram):
`npx tsx scripts/day3-verify.mts`, `day4-verify.mts`, `day5-verify.mts`.

### Glasses app

```bash
cd app
npm install
npm run dev        # Vite on :5173 (set VITE_BACKEND_URL to reach a local backend)
npm run build      # tsc + vite build -> dist/
npm run simulate   # Even Hub simulator (needs WebKitGTK libs + Xvfb on Linux)
npx evenhub pack app.json dist -o hl-paper-trader.ehpk --sdk-ver 0.0.10
```

The app talks only to the backend origin whitelisted in `app/app.json`
(the Railway backend + `localhost:3000` for development).

## What existed before Nov 23 (disclosure)

Per the hackathon rules, this is what pre-dated the build week:

- The Even Hub **`asr` template** (`even-realities/evenhub-templates/asr`)
  as the app scaffold. Template-derived files: the base structure of
  `app/src/main.ts` (startup container, event routing, double-tap exit)
  and the `SttClient` interface in `app/src/asr/stt.ts`.
- A backend **skeleton**: Node + TypeScript server with a `/health`
  endpoint only, plus dependency installs.
- Prep notes and connectivity checks (Hyperliquid WS, Groq Whisper,
  Telegram API reachability).

Everything else was written **23–26 Nov 2026** for this hackathon: the
prices/positions screens, the paper ledger (positions/PnL/alerts), the
voice-intent parser, the Whisper wiring (buffer-and-POST STT client), the
Telegram bot (pairing, two-way shared-order confirm, fire-once alerts),
and the Day 5 edge-case states.

## License

MIT.
