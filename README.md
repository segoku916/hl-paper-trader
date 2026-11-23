# HL Paper Trader — Hyperliquid on Even G2

Your Hyperliquid trading desk on your glasses: glance at BTC/ETH/SOL prices,
place and confirm paper orders by voice, get every fill on Telegram.

Built solo for the Even Realities **"Heads Up"** hackathon (DoraHacks,
Nov 23–29, 2026) — **Track 2: Crypto & DeFi**, also aiming for the
**Best Telegram Integration** special prize.

> **Paper trading only.** The account starts with $10,000 of simulated
> money. No wallet, no signing, no real funds — fully compliant with the
> hackathon's money-safety rules.

## How it works

```
Even G2 glasses (display + mic + touch/R1 ring)
        │  Even Hub SDK, WebView in the Even Realities app
        ▼
Glasses app (app/, Vite + TypeScript)
        │  HTTP + WebSocket — talks ONLY to our backend
        ▼
Backend (backend/, Node 24 + TypeScript + SQLite)
        ├── Hyperliquid allMids WebSocket (live mids, 1,428 pairs)
        ├── Groq Whisper (speech-to-text for voice orders)
        └── Telegram bot via grammY (fill alerts, price alerts, Yes/No confirm)
```

- **Glance:** home screen shows BTC/ETH/SOL mids + 24h change, paper equity
  and today's PnL. Swipe/ring cycles coins.
- **Voice order:** mic PCM → backend `/stt` (Groq Whisper) → intent parse →
  one-screen confirm (tap or say "yes") → execute at the live mid → fill shown.
- **Positions:** open paper positions with entry, mark, unrealized PnL.
- **Telegram:** every fill is pushed to the paired Telegram chat; price
  alerts ("alert me if BTC goes above 65k"); orders can be confirmed from
  Telegram with inline Yes/No buttons.

## Repo structure

```
app/        Glasses app (Even Hub, Vite + TS). package_id com.lethal.hlpapertrader
backend/    Node server: Hyperliquid feed, paper ledger, STT, Telegram bot
research.md Concept + SDK notes (from prep)
```

## Run it locally

### Backend

```bash
cd backend
npm install
npm run dev        # :3000 — /health, /prices, /positions, POST /order, /stream
```

No secrets needed for the price feed: Hyperliquid's public `allMids` WS +
candle REST need no key. `GROQ_API_KEY` (voice orders) and
`TELEGRAM_BOT_TOKEN` (Telegram features) are only used from Day 3/4 onward —
set them in the hosting provider's env vars, never in this repo.

### Glasses app

```bash
cd app
npm install
npm run dev        # Vite on :5173
npm run simulate   # Even Hub simulator (needs WebKitGTK libs + Xvfb on Linux)
npm run build      # tsc + vite build -> dist/
```

Point the simulator at `http://localhost:5173`. The app fetches prices
from the backend (`VITE_BACKEND_URL`, default `http://localhost:3000`).

## Deploy the backend (Render, free tier)

See [RENDER-DEPLOY-GUIDE.md](RENDER-DEPLOY-GUIDE.md) (Indonesian, step by
step) or the short version in [backend/RENDER.md](backend/RENDER.md).
After deploy, add the `https://<name>.onrender.com` origin to the
`network` whitelist in `app/app.json` and rebuild the app.

## What existed before Nov 23 (disclosure)

Per the hackathon rules, this is what pre-dated the build week:

- The Even Hub **ASR template** (`even-realities/evenhub-templates/asr`) as
  the app scaffold, with its mic/STT pipeline intact.
- A backend **skeleton**: Node + TypeScript server with a `/health` endpoint
  only, plus dependency installs.
- Prep notes and connectivity checks (Hyperliquid WS, Groq Whisper,
  Telegram API reachability).

Everything else — the prices screen, the paper ledger (positions/PnL),
voice-order flow, Telegram integration, and this README — was built during
the Nov 23–29 build week.

## License

MIT.
