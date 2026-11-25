# Hyperliquid Paper Trader — Backend

Node + TypeScript server for the Even Realities "Heads Up" hackathon entry
(Track 2 — Crypto & DeFi). **The backend owns ALL secrets and API keys.**
The glasses app (in `../app/`) never sees a key — it talks only to this server.

> Status: DAY 4 DONE (25 Nov 2026, built a day early).
> `src/telegram.ts` (grammY bot: /start pairing, /positions, /pnl,
> /price, inline Yes/No two-way confirm), `src/pendingOrders.ts` (one
> shared pending-order store — a Telegram Yes and a glasses tap can never
> double-execute), price alerts stored in SQLite (`alerts` table) with a
> 5 s checker that fires each once to the paired chat, `POST /alerts`,
> `GET /alerts`, `POST /order/cancel`, `/health` v0.4.0. Verified:
> `scripts/day4-verify.mts` 63 checks (mocked Telegram API, no real
> sends), HTTP smoke test, simulator end-to-end. Live Telegram delivery
> (one real fill + one real alert to the paired chat) still needs the
> Railway deploy + Variou's tap — the bot token lives only in Railway
> Variables, never in the repo.
>
> Telegram is the notification/confirmation channel; the core app is
> Hyperliquid (Track 2). Telegram is not in Track 2's app list, but the
> Best Telegram Integration special prize ($1,000) is explicitly open to
> all tracks.

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
| Telegram bot | `src/telegram.ts` | ✅ DONE Day 4: grammY bot (long polling — no webhook/public URL needed for the demo). Pairing via code; every paper fill posts to the user's chat; **two-way confirm**: voice orders can be confirmed from Telegram inline Yes/No buttons (one shared pending-order store with the glasses, `src/pendingOrders.ts`); `/positions`, `/pnl`, `/price <coin>` commands; price alerts fire to Telegram even when the glasses app is closed. Bot: @Lethal_ape_bot (created 23 Nov 2026, token in Muse's Secure Vault as
`custom.telegram-bot`). For the deployed backend, Variou pastes the token into
the host's env vars himself — never in the repo. Note: grammY is constructed
with a native-fetch wrapper (client.fetch) that bridges its
`abort-controller` polyfill signal onto a native AbortController — without
it every API call fails before touching the network on Node 24 (see the
header comment in `src/telegram.ts`). |
| Glasses API | `src/server.ts` | HTTP + WS endpoints for the app: `GET /prices`, `GET /positions`, `POST /order` (confirm flow), `POST /stt`, `WS /stream` (live mids + fills). |

## Endpoints (planned)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe — ✅ v0.4.0 (Day 4), reports Telegram status (`paired`/`unpaired`/`unavailable`) |
| `GET /prices` | Current mids for watched coins (BTC/ETH/SOL + watchlist) — ✅ live Day 1 |
| `GET /positions` | Open paper positions + equity + today's PnL — ✅ live Day 2 |
| `POST /order` | Execute a confirmed paper order (buy/sell/close) — ✅ live Day 2 (body `{"coin":"BTC","side":"buy","size":0.001}`; `side:"close"` sells the whole position; rejects unknown coin/side, bad size, insufficient cash/position, and 503s while the feed has no mid). Day 4: also accepts `{"pendingOrderId":"…"}` — the shared confirm path; a second claim 409s |
| `POST /order/cancel` | Cancel a pending order (Day 4) — ✅ live (body `{"pendingOrderId":"…"}`; glasses scroll-No + 20 s timeout call it so a Telegram Yes can no longer execute) |
| `POST /stt` | Transcribe mic PCM → text (Groq Whisper) — ✅ live Day 3 |
| `POST /intent` | Parse a transcript + preview the order (Day 3) — ✅ live; Day 4: alert intents are stored for real and order previews return a `pendingOrderId` |
| `POST /alerts` | Create a voice-set price alert — ✅ live Day 4 (body `{"coin":"BTC","direction":"above","price":65000}`) |
| `GET /alerts` | List price alerts, newest first — ✅ live Day 4 |
| `WS /stream` | Live mids + fill notifications pushed to the glasses — ✅ live Day 1 (mids; fills Day 2+; alert events Day 4) |

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
