# PREP NOTES — Hyperliquid Paper Trader (Even Realities "Heads Up")

Prepared: 20 Nov 2026 ~23:35–23:50 WIB · Build window: **Nov 23–29** (kickoff Mon 23 Nov 15:00 WIB, submit by Mon 30 Nov 02:59 WIB).
Concept + SDK notes: [research.md](research.md) · Goal: goal_bc1b00ef8d74

> **RULE: no app features were built.** This is infrastructure prep only — scaffold,
> toolchain, connectivity checks, backend skeleton. App logic starts Nov 23.

## ⚠️ Live-page corrections (verified 20 Nov 23:34 WIB — the 17 Nov copy was stale)

1. **CoinGecko is DROPPED.** Track 2's listed apps are ONLY Gram Wallet,
   Polymarket, Hyperliquid, Trust Wallet. Rules say use only the apps listed in
   your track, so CoinGecko is out entirely — no fallback, no watchlist screen
   from CoinGecko. **Hyperliquid's `allMids` feed is the sole price source**
   (it covers 1,428 pairs — everything we need, including a watchlist).
   Do NOT re-add CoinGecko during build week.
2. **Track 2nd prize is $375**, not $500 (research.md §2 said $500).
3. **NEW: Community Partner Award up to $500** exists. Total pool still $10,000 USDT.
4. Deadlines unchanged. 233 hackers registered as of 20 Nov 23:34 WIB.
5. Registration is open (DoraHacks account: email+code / Google / GitHub) —
   **DONE 20 Nov ~23:39 WIB by Variou** (email variousasw@gmail.com, builder
   handle @u_0f4e3031224236, display name hacker6a4c253). GitHub linking to
   the profile **DONE 20 Nov ~23:56 WIB** (verified: "GitHub Connected",
   Github row "Verified", imported name "segoku" / "airdrop hunter").

## What works ✅

### 1. App scaffold — `app/`
- Cloned from the official template: `npx degit even-realities/evenhub-templates/asr app`
- `npm install` — 83 packages, clean. `npm run build` (tsc + vite) — **clean**,
  7 modules, `dist/` produced (73.43 kB JS).
- `npm run dev` — Vite serves on **http://localhost:5173** (HTTP 200 verified).
- The template's mic/STT pipeline is intact: `src/main.ts` (mic start, PCM
  routing, 120ms debounce, double-tap exit) + `src/asr/stt.ts` (blank provider
  stub — wire to OUR backend during build week, see below).
- Template `app.json`: `package_id com.example.evenhubasr`, `edition 202601`,
  `g2-microphone` permission present. **Must change during build week:**
  `package_id` → our own reverse-DNS (lowercase, no hyphens, globally unique),
  `name` → ≤20 chars, no "Even" (e.g. "HL Paper Trader"), add `network`
  permission whitelisting ONLY our backend origin.
- **Do NOT use the template's `VITE_STT_API_KEY` flow** — the Groq key must
  never ship in the app. `stt.ts` will POST PCM to our backend instead.

### 2. Even Hub CLI — global `evenhub` 0.2.0 ✅
- Installed: `npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator`
- `evenhub --help` works. Commands available: `login`, `init`, `pack`, `qr`,
  `self-check`, `create`, `upload`, `update`, `ls`, `promote`.
- `evenhub pack app.json dist` and `evenhub qr` need no login for local use;
  `login`/`create`/`upload` need an Even Realities account (Variou's step if
  we publish to the Hub — submission only requires the public repo + video,
  `.ehpk` is optional).

### 3. Backend skeleton — `backend/` ✅
- `npm install` — 18 packages, clean. `npm run typecheck` — clean.
- `npm run dev` (tsx watch) boots on **:3000**, `GET /health` → 200
  `{"ok":true,"service":"hl-paper-trader-backend","version":"0.1.0"}`.
- Stack decisions (all verified on this VM):
  - **Node 24 + TypeScript**, `node:http` (no web framework — the server is small).
  - **SQLite via built-in `node:sqlite`** — verified working, no native build.
  - **`ws`** for the glasses WS server; **grammY** for the Telegram bot.
  - Node's **global WebSocket client** for the Hyperliquid feed (verified below).
- Modules planned (see `backend/README.md`): `hl.ts` (HL WS client),
  `ledger.ts` (SQLite paper ledger), `stt.ts` (Groq Whisper), `intent.ts`
  (regex command parser), `telegram.ts` (grammY bot), `server.ts` (HTTP+WS API).
- `.env.example` documents `GROQ_API_KEY` + `TELEGRAM_BOT_TOKEN` (backend only).

### 4. Connectivity checks
| Check | Result | Evidence |
|---|---|---|
| Hyperliquid WS `allMids` (`wss://api.hyperliquid.xyz/ws`) | ✅ **PASS** | Subscribed, 2 live snapshots in 20s: BTC 59490.5 / ETH 1644.65 / SOL 69.27, **1,428 pairs**. Note: `allMids` pushes on change, not on a fixed cadence — don't expect 1 msg/sec. Script: `/tmp/hl-ws-check.mjs` (Node global WebSocket, no deps). |
| Groq Whisper `whisper-large-v3-turbo` | ✅ **PASS** | HTTP 200 via `custom.groq` connector; 1s 16 kHz s16le WAV (same format as G2 mic PCM) transcribed. Model confirmed in the account's model list (11 models). Script: `/tmp/groq-whisper-check.py`. |
| Telegram Bot API | ✅ **PASS** | `api.telegram.org` reachable; dummy token → `401 {"ok":false,"error_code":401,"description":"Unauthorized"}` — expected shape. **No bot created** (do that in build week via @BotFather). |
| CoinGecko | ⛔ **SKIPPED / DROPPED** | Not in Track 2's live app list — do not use, do not test. |

## Simulator status

### ✅ VERIFIED on this VM (under Xvfb) — 20 Nov 2026 ~23:50 WIB
- Global simulator installed: `@evenrealities/evenhub-simulator` **0.9.5**
  (project-local: 0.7.3). `evenhub-simulator --version` → `0.9.5`.
- **Initial blocker (FIXED):** the binary failed to start — missing
  `libwebkit2gtk-4.1.so.0`, `libsoup-3.0.so.0`, `libjavascriptcoregtk-4.1.so.0`.
  Fixed with:
  ```bash
  sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-0 libsoup-3.0-0 libjavascriptcoregtk-4.1-0
  ```
  Note: `apt-get update` took **~11 min** on this VM (~111 kB/s to
  azure.archive.ubuntu.com; one non-fatal backports InRelease fetch failure).
  After install, `ldd` shows **all libs resolved**.
- **Run under Xvfb** (no real X display on this VM; Xvfb IS installed):
  ```bash
  xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898
  ```
- **Verification evidence (20 Nov ~23:50 WIB):** simulator process running,
  automation HTTP server live on :9898; `GET /api/console` shows
  `[EvenAppBridge] Bridge initialized` + `[Simulator] Flutter Bridge
  intercepted: evenAppMessage`; `GET /api/screenshot/webview` returns a
  600×800 PNG of the app rendering ("ASR Demo" + the expected red
  "STT PROVIDER NOT IMPLEMENTED" chip — the template's by-design first-run
  state). Only console entries are the expected STT-stub warnings
  (`VITE_STT_API_KEY is not set`, `STT startup failed`) — not real failures.
  Harmless `libEGL warning: DRI3 error` lines appear (no GPU under Xvfb).
- **Automation API** (base `http://127.0.0.1:9898`, documented in the
  simulator's README): `GET /api/screenshot/webview` (PNG),
  `GET /api/console` (+ `?since_id=N`, `DELETE` to clear),
  `POST /api/input` (`{"action": "up"|"down"|"click"|"double_click"|"long_press"|"long_press_release"|"context_menu"}`).
  Use these during build week to drive + screenshot the app without a display.
- **⚠️ VM reboots wipe /usr/lib + apt installs** (like the baw lesson):
  after a reboot, re-run `npm install -g ...` AND the apt install above, then
  re-verify with `ldd` + `xvfb-run -a evenhub-simulator --version`.
- Fallbacks if the VM simulator ever breaks again: (1) dev-server + browser
  check (Vite serves fine; only the glasses bridge no-ops outside the
  simulator/G2); (2) simulator on Variou's own desktop;
  (3) real G2 via `evenhub qr` (needs Even phone app + Dev Mode).

## Exact versions (20 Nov 2026)

| Component | Version |
|---|---|
| Node / npm | v24.22.1 / 10.9.4 |
| `@evenrealities/even_hub_sdk` (project) | 0.0.10 |
| `@evenrealities/evenhub-cli` global / project | 0.2.0 / 0.1.14 |
| `@evenrealities/evenhub-simulator` global / project | 0.9.5 / 0.7.3 |
| vite / typescript (app) | 5.4.21 / 5.9.3 |
| `ws` / `grammy` / `tsx` (backend) | 8.23.0 / 1.46.0 / 4.23.15 |

## Commands that work

```bash
# App (Terminal 1)
cd ~/workspace/hackathons/even-realities/app
npm run dev                       # Vite on :5173
npm run build                     # tsc + vite build -> dist/
npm run simulate                  # evenhub-simulator http://localhost:5173 (needs libs+Xvfb, see above)

# Backend (Terminal 2)
cd ~/workspace/hackathons/even-realities/backend
npm run dev                       # tsx watch on :3000, /health only for now
npm run typecheck

# Simulator (once WebKitGTK libs are installed)
xvfb-run -a evenhub-simulator http://localhost:5173
xvfb-run -a evenhub-simulator http://localhost:5173 --automation-port 9898

# Packaging (build week, after app.json is ours)
cd ~/workspace/hackathons/even-realities/app
npm run build && evenhub pack app.json dist -o hl-paper-trader.ehpk
```

## Blockers for the Nov 23 build

1. **Registration DONE** (20 Nov ~23:39 WIB, Variou). GitHub linking to the
   DoraHacks profile **DONE 20 Nov ~23:56 WIB** (verified "GitHub Connected"
   + Github row "Verified"). **Builder profile CREATED 20 Nov ~23:58 WIB**
   ("Saved successfully"; GitHub link confirmed https://github.com/segoku916,
   X https://x.com/koch814; Organization + Community Affiliation "N/A";
   profile 25% complete — optional fields empty).
2. **Telegram bot CREATED + CONNECTED 23 Nov ~12:28 WIB** —
   @Lethal_ape_bot ("Lethal ape trader", id 9269090463), token in Muse's
   Secure Vault as connector `custom.telegram-bot` (helper
   `~/workspace/custom-connectors/custom.telegram-bot/bin/telegram_bot.py`,
   getMe verified). Backend uses grammY with the same bot — do NOT poll
   updates from both the helper and the backend at once. For the
   Render/hosted backend, Variou pastes the real token into the host's env
   vars himself (like the Groq key). Variou started the bot 23 Nov ~12:31
   WIB (his Telegram @Tobibradley, chat id 7322242672); test message
   delivered (message_id 2). The backend pairing flow discovers the chat id
   at runtime from /start — do not hardcode it.
3. **Groq key for the deployed backend** — the key lives in the `custom.groq`
   connector (Muse-side). For the Render/hosted backend, the key must be
   pasted into the host's env vars — Variou's step (never in chat, never in
   the repo).
4. **Backend hosting not chosen** — Render free tier recommended; decide Day 1.
5. **Kickoff Nov 23 15:00 WIB** — Even Realities shares G2 app tips; worth
   attending/reading the recap before finalizing screens.
6. **VM reboot risk** — a reboot wipes the global npm installs AND the apt
   WebKitGTK libs (both live outside `~`). Re-run on Nov 23 if the VM
   restarted: `npm install -g @evenrealities/evenhub-cli
   @evenrealities/evenhub-simulator` + the apt install in the Simulator
   section, then re-verify. (The `app/` and `backend/` dirs + node_modules
   live under `~/workspace` and survive.)

## Day-by-day build plan (Nov 23–29, solo, Concept A)

| Day | Date (WIB) | Work |
|---|---|---|
| 1 | Mon 23 Nov | Kickoff 15:00 WIB. Confirm simulator (or fallback). `app.json` ours (package_id, name, network whitelist → backend URL). Live prices screen: backend `hl.ts` (allMids WS) + glasses home screen (BTC/ETH/SOL mids + 24h change). Deploy backend skeleton to Render. |
| 2 | Tue 24 Nov | Paper ledger (`ledger.ts`, SQLite): positions/fills tables, $10k starting equity, execute-at-mid. Positions + PnL screens on glasses. |
| 3 | Wed 25 Nov | Voice order flow: mic PCM → backend `/stt` (Groq Whisper) → `intent.ts` parse → one-screen confirm (tap or "yes") → execute → fill shown. "Close my SOL position" / "Sell half my ETH" too. |
| 4 | Thu 26 Nov | Telegram bot (`telegram.ts`): pairing code, fill notifications, price alerts ("Alert me if BTC goes above 65k"), **two-way inline Yes/No confirm**. Watchlist screen (HL pairs only). |
| 5 | Fri 27 Nov | Polish + edge cases (no-mic, STT failure, empty positions, alert firing while app open). `.ehpk` build. README (disclose pre-existing work: template + prep scaffold). |
| 6 | Sat 28 Nov | Demo video ≤3 min (simulator screen recording + voiceover showing: glance prices → voice order → confirm → fill → Telegram). Repo cleanup (no keys anywhere — grep for `sk-`, `GROQ`, bot token). |
| 7 | Sun 29 Nov | Buffer + submit before 23:59 Dubai = **Mon 30 Nov 02:59 WIB**. Public repo + README + video + description on DoraHacks. |

## Files

- `~/workspace/hackathons/even-realities/research.md` — concept + SDK notes (note: §2 prize $500 2nd and CoinGecko mentions are SUPERSEDED by the corrections above)
- `~/workspace/hackathons/even-realities/app/` — scaffolded app (asr template, deps installed)
- `~/workspace/hackathons/even-realities/app/PREP-NOTES.md` — this file
- `~/workspace/hackathons/even-realities/backend/` — skeleton server (package.json, README, src/server.ts, .env.example)
- `/tmp/hl-ws-check.mjs`, `/tmp/groq-whisper-check.py` — connectivity check scripts (ephemeral; re-create if needed)
