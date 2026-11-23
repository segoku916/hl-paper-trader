# Hyperliquid Paper Trader — Backend

Node + TypeScript server for the Even Realities "Heads Up" hackathon entry
(Track 2 — Crypto & DeFi). **The backend owns ALL secrets and API keys.**
The glasses app (in `../app/`) never sees a key — it talks only to this server.

> Status: DAY 2 DONE (23 Nov 2026, built ahead of schedule).
> `src/ledger.ts` (SQLite paper ledger, $10,000 starting equity, orders at the
> live mid), `GET /positions`, `POST /order`, WS `/stream` fill broadcasts —
> typecheck clean, ledger math unit-verified (weighted avg entry, realized
> PnL, all 9 error cases, DB persistence). Live end-to-end order test against
> the real feed is still to run in an unrestricted session (this run's sandbox
> blocks api.hyperliquid.xyz, so the server correctly 503'd orders while the
> feed had no mid). Modules below marked (Day 3+) are still to build.

## Run

```bash
cp .env.example .env   # fill in GROQ_API_KEY + TELEGRAM_BOT_TOKEN (never commit .env)
npm install
npm run dev            # tsx watch, http://localhost:3000/health
```

## Planned modules (build week)

| Module | File (planned) | What it does |
|---|---|---|
| Hyperliquid WS client | `src/hl.ts` | ✅ DONE Day 1: one persistent WS to `wss://api.hyperliquid.xyz/ws`, subscribed to `allMids`, with reconnect backoff; 24h change from REST `candleSnapshot` (1h candles). Fans live mids out to connected glasses clients. **Sole price source** — CoinGecko is NOT in Track 2's live app list (dropped 20 Nov after live verification; rules say use only listed apps). |
| Paper ledger | `src/ledger.ts` | ✅ DONE Day 2: SQLite via built-in `node:sqlite` (no native deps). Tables: `positions`, `fills`, `meta` (cash). Starting paper equity $10,000. Orders execute at the live mid; long-only (sell needs an open position); weighted avg entry; realized PnL on sells. DB file `data/paper-ledger.db` (override with `LEDGER_DB`); on Render free tier the disk is ephemeral, so a redeploy resets the paper account to $10,000 — fine for the demo. |
| STT endpoint | `src/stt.ts` | Receives mic PCM (16 kHz s16le mono) from the glasses app, wraps to WAV, calls Groq Whisper `whisper-large-v3-turbo` (free tier, verified reachable 20 Nov). Returns transcript text. |
| Intent parser | `src/intent.ts` | Deterministic regex/command parser for the narrow command set: buy/sell/close/alert ("Buy 0.01 Bitcoin", "Close my SOL position", "Alert me if BTC goes above 65k"). Optional Groq LLM fallback for free-form phrases. |
| Telegram bot | `src/telegram.ts` | grammY bot (long polling — no webhook/public URL needed for the demo). Pairing via code; every paper fill posts to the user's chat; **two-way confirm**: voice orders can be confirmed from Telegram inline Yes/No buttons; `/positions`, `/pnl`, `/price <coin>` commands; price alerts fire to Telegram even when the glasses app is closed. Bot: @Lethal_ape_bot (created 23 Nov 2026, token in Muse's Secure Vault as
`custom.telegram-bot`). For the deployed backend, Variou pastes the token into
the host's env vars himself — never in the repo. |
| Glasses API | `src/server.ts` | HTTP + WS endpoints for the app: `GET /prices`, `GET /positions`, `POST /order` (confirm flow), `POST /stt`, `WS /stream` (live mids + fills). |

## Endpoints (planned)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe (implemented in skeleton) |
| `GET /prices` | Current mids for watched coins (BTC/ETH/SOL + watchlist) — ✅ live Day 1 |
| `GET /positions` | Open paper positions + equity + today's PnL — ✅ live Day 2 |
| `POST /order` | Execute a confirmed paper order (buy/sell/close) — ✅ live Day 2 (body `{"coin":"BTC","side":"buy","size":0.001}`; `side:"close"` sells the whole position; rejects unknown coin/side, bad size, insufficient cash/position, and 503s while the feed has no mid) |
| `POST /stt` | Transcribe mic PCM → text (Groq Whisper) — Day 3 |
| `POST /alerts` | Create a voice-set price alert — Day 4 |
| `WS /stream` | Live mids + fill notifications pushed to the glasses — ✅ live Day 1 (mids; fills Day 2+) |

## Data sources (verified 20 Nov 2026)

- Hyperliquid public Info API WS `allMids` — **PASS**: live mids received
  (BTC/ETH/SOL, 1,428 pairs). No key needed. REST `https://api.hyperliquid.xyz/info`
  for `candleSnapshot` / `meta` if needed.
- Groq Whisper `whisper-large-v3-turbo` — **PASS**: HTTP 200 via the
  `custom.groq` connector (audio transcription endpoint).
- Telegram Bot API — **PASS**: `api.telegram.org` reachable, endpoint shape
  verified (dummy token → `401 {"ok":false,"error_code":401}` as expected).
  No bot created yet.
- CoinGecko — **DROPPED**: not in Track 2's live app list; do not use.

## Hosting (demo)

Render free tier (or Railway/Fly.io free). The deployed backend URL must go in
`../app/app.json` under the `network` permission whitelist. During development
the simulator hits `localhost:3000` directly.

## Security notes

- No API keys in the app bundle, ever. The `asr` template's
  `VITE_STT_API_KEY` flow is NOT used — STT goes through this backend.
- Paper trading only. No wallet, no signing, no real funds.
- The glasses app's `app.json` network whitelist must list ONLY this backend's
  origin (plus nothing else).
