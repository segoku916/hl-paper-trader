# Even Realities "Heads Up" Hackathon — Research

> **⚠️ LIVE-PAGE CORRECTIONS (verified 20 Nov 23:34 WIB — supersede parts of this doc):**
> (1) Track 2's listed apps are ONLY Gram Wallet, Polymarket, Hyperliquid, Trust Wallet —
> **CoinGecko is NOT listed and is DROPPED from the plan** (rules: use only listed apps);
> Hyperliquid `allMids` is the sole price source. All CoinGecko mentions below are stale.
> (2) Track 2nd prize is **$375**, not $500 (§2 below is wrong).
> (3) NEW: **Community Partner Award up to $500**; total pool still $10,000 USDT.
> (4) **Judging weights corrected 23 Nov 17:02 WIB (live page): Usefulness 25% / Read-and-write 20% / Technical 20% / UX 15% / Business & safety 20%** — §3 below (30/25/20/15/10) is wrong. Business & safety is worth 20%, not 10% — README/demo must stress the path to launch in Even Hub + money safety.
> (5) **One cash prize per project confirmed 23 Nov** (highest category wins, next project moves up) — Track 1st $1,250 and Best Telegram $1,000 do NOT stack.
> Deadlines unchanged. See `app/PREP-NOTES.md` for the full correction record.

Checked: 20 Nov 2026 ~23:31 WIB · Source: https://dorahacks.io/hackathon/even-realities/detail
Status: Variou said "Gas ikut" (solo). **TRACK DECIDED: Track 2 — Crypto & DeFi.**
Goal: goal_bc1b00ef8d74 · Workspace: ~/workspace/hackathons/even-realities/

## 1. Live page verification

**Caveat:** the only page copy the text fetcher could return is the crawl from **17 Nov 2026 14:00 UTC** — a fresh-copy request (max_age 30 min) failed with `page_too_old`. The 17 Nov copy is **identical, line for line, to the baseline** captured earlier the same day: no changes to prizes, deadlines, tracks, or rules are visible. Before registering or submitting, re-check the live page in the browser — the page itself warns "More sponsor prizes may be announced during registration."

## 2. Verified deadlines & prizes (as of 17 Nov copy)

All times Dubai (GMT+4); WIB = Dubai + 3h.

| Event | Dubai | WIB |
|---|---|---|
| Registration opens | Nov 18 | Nov 18 |
| Online kickoff + tech briefing, build starts | Nov 23, 12:00 | **Nov 23, 15:00** |
| **Submission deadline** | **Nov 29, 23:59** | **Nov 30, 02:59** |
| Judging, finalists announced | Nov 30 – Dec 1 | Nov 30 – Dec 1 |
| Demo Day + awards, Daos Hub Dubai | Dec 3, 14:00–18:00 | Dec 3, 17:00–21:00 |

Prizes — **$10,000 USDT + up to 10 pairs of G2** (refurbished, fully working, standard lenses, shipped worldwide):

| Prize | Cash | Glasses |
|---|---|---|
| Grand Prize | $2,000 | 2 pairs |
| 1st place, each of 4 tracks (×4) | $1,250 each | 1–2 pairs each |
| 2nd place, each of 4 tracks (×4) | $500 each | — |
| Best Telegram integration (special, any track) | $1,000 | — |

One cash prize per project. USDT paid within 7 days of Demo Day. Finalists also get: fast-track pitch to TVM Ventures + partner VCs, Demo Day slot (remote OK), merch.

## 3. Rules & judging (verified)

- Teams 1–4, worldwide, solo allowed, one team per person. Build during Nov 23–29; README must disclose anything pre-existing. Use only the apps listed in your track.
- Submit: public GitHub/GitLab repo + README, demo video ≤ 3 min (simulator or G2), short description. Optional `.ehpk` build.
- Money safety: demos use testnet, paper trading, or read-only data. No holding user funds, no financial advice, never commit API keys/secrets.
- Judging: Usefulness on G2 25% · Read and write 20% · Technical execution 20% · Display/voice UX 15% · Business potential & safety 20% (corrected 23 Nov from the live page; was 30/25/20/15/10 in the 17 Nov copy). Judges: Even Realities, TVM Ventures, partner VCs, sponsors, Daos Hub.
- Organizers: Even Realities × TVM Ventures ($100M fund, Steve Yun) × Daos Hub (Dubai).

## 4. Even Hub SDK — fastest path from zero to a working demo

**Docs:** https://hub.evenrealities.com/docs — start at "Your First App" (https://hub.evenrealities.com/docs/get-started/quickstart/first-app, last updated 2026-07-04). Note: some older doc URLs (e.g. /docs/guides/networking, /docs/reference/packaging) now redirect to Get Started — the docs were restructured; use the first-app page's "Where to go next" links.

**What an app is:** a normal web app (HTML/CSS/JS/TS, Vite + TypeScript) running in a WebView inside the Even Realities phone app. The glasses are only display + input (mic, temple touch, R1 ring). Display: monochrome green, 576×288 per eye. No camera, no speaker.

**Toolchain (npm):**

| Package | Purpose | Version seen |
|---|---|---|
| `@evenrealities/even_hub_sdk` | TS SDK, per-project dependency | ~0.0.12 (`min_sdk_version` in first-app doc) |
| `@evenrealities/evenhub-cli` | `evenhub`/`eh`: init, qr, pack, login | 0.1.5 |
| `@evenrealities/evenhub-simulator` | Desktop simulator, 576×288 green canvas | 0.7.3–0.8.0 |

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

**Scaffold (fastest):** clone an official template — `npx degit even-realities/evenhub-templates/<name> my-app && cd my-app && npm install`. Templates (github.com/even-realities/evenhub-templates): `minimal` (single page + click handler), `text-heavy` (pagination, long-form reading), `asr` (**the one to start from for voice**: mic audio pipeline wired, provider-agnostic STT stub, mic UI states, `g2-microphone` permission), `image` (greyscale image rendering). Alternative: `npm create vite@latest -- --template vanilla-ts`, then `npm install @evenrealities/even_hub_sdk@latest` + `evenhub init` (generates `app.json` only).

**Core SDK model (from the first-app doc):**

- `await waitForEvenAppBridge()` FIRST — before it, all SDK calls silently no-op.
- The screen is built from containers on a 576×288 canvas: `TextContainerProperty` (x/y/width/height/content, `isEventCapture: 1` to receive input), rendered via `bridge.createStartUpPageContainer(...)`. Update text flicker-free with `textContainerUpgrade`; reserve `rebuildPageContainer` for layout changes.
- All input arrives through one subscription: `bridge.onEvenHubEvent(...)` — inspect `event.textEvent / listEvent / sysEvent`, switch on `eventType` (CLICK, DOUBLE_CLICK, swipe, long-press; note the SDK normalizes click to `undefined` in some cases — handle both).
- Exit: `shutDownPageContainer(1)` — mode 1 shows the system exit-confirmation dialog and is **required on the root page**; silent exit (mode 0) is rejected in QA.
- Audio: `audioControl(true|false)`; PCM arrives via `event.audioEvent.audioPcm` — **16 kHz, signed 16-bit little-endian, mono**. **Bring your own STT** — send audio to your backend (e.g. Whisper). The `asr` template has this wired.
- Serialize ALL bridge writes through one promise chain; log each write's result (community lesson from real G2 builders — stale-build confusion is otherwise undebuggable; put a BUILD stamp on-screen and bump it every iteration).

**Manifest (`app.json`, required for packaging):** `package_id` (reverse-DNS, lowercase, NO hyphens, globally unique), `name` (≤20 chars, may not contain "Even"), `version`, `edition: "202601"`, `min_sdk_version`, `entrypoint: "index.html"`, `permissions`. Network access needs `{"name": "network", "desc": "...", "whitelist": ["https://your-backend..."]}`; mic needs `{"name": "g2-microphone", "desc": "..."}`.

**Run / test / ship:**

```bash
npm run dev                                   # Terminal 1 — Vite dev server (default :5173)
evenhub-simulator http://localhost:5173      # Terminal 2 — simulator window; hot-reload works
evenhub-simulator http://localhost:5173 --automation-port 9898   # headless control plane (scripted input)
evenhub qr --url "http://<LAN-IP>:5173"       # sideload on real G2 via Even phone app (needs Dev Mode)
evenhub pack app.json dist -o myapp.ehpk      # package (.ehpk optional for submission)
```

**Hard constraints that shape the design:**

- One app on screen at a time; when the user switches away, no display, no pop-up alerts.
- No access to other apps' notifications — talk to each service's API directly.
- **Use a backend:** external calls must be whitelisted in `app.json` and pass CORS; route API calls through your own server; never ship API keys in the app.
- Google sign-in does not work inside the WebView — use a separate login page or a pairing code.
- Design for a glance: one thing on screen, a few words, one action by tap/ring/short phrase. Think "trading session", not dashboard.

**Catalogue check (differentiation):** the Even Hub catalogue has 200+ apps (Nov 2026). Notable existing: Weather, Books, Messages (WhatsApp/Signal/Telegram **via Beeper — needs Beeper Desktop at home**), a stocks indicator, several AI assistants (OcuClaw, Aside, IRIS, Constella). **No dedicated crypto-trading app with voice orders / paper trading was found** — a Hyperliquid voice paper-trader is a genuinely open niche, and a *direct* Telegram integration (no Beeper) is a clear improvement over the existing Messages app.

**Community resources worth bookmarking:** `github.com/even-realities/everything-evenhub` (official Claude Code plugin, 13 skills: quickstart, template, build-and-deploy, glasses-ui, handle-input, device-features, test-with-simulator, simulator-automation…); `github.com/pxi10/even-g2-development-skill` (field guide verified on real glasses, incl. a mirror/debug rig); `github.com/marcometz/daily-app-even-g2` (SDK notes + even_agent skill).

## 5. TRACK 2 — Crypto & DeFi: deep dive (DECIDED TRACK)

Track 2 apps (only these qualify): Polymarket · Kalshi · Hyperliquid · CoinGecko · Gram Wallet · Trust Wallet.

### Concept A — ⭐ RECOMMENDED: "Hyperliquid Paper Trader" (+ Telegram confirmations)

**One-line pitch:** Your Hyperliquid trading desk on your glasses — glance at prices and paper PnL, place and confirm paper orders by voice, get every fill on Telegram.

**Why it wins:** it is the strongest read-AND-write story in the track (25% of judging), it reuses Variou's deepest knowledge (Hyperliquid + paper trading — the Panel Bot Terminal already implements paper positions/PnL logic), it needs zero wallet/auth friction (paper ledger, no real funds — fully rule-compliant), and the Telegram layer makes it a contender for the $1,000 special prize on top of the $1,250 track 1st.

**Glasses experience (glanceable + voice/one-tap):**
- Home screen: BTC / ETH / SOL mids + 24h change, one line each; paper equity + today's PnL at the top. Swipe/ring to cycle coins.
- Positions screen: open paper positions with entry, mark, uPnL (green/red by sign — on a mono display use +/- and arrows, not color).
- Voice order: hold tap / say "Buy 0.01 Bitcoin" → mic audio → STT → parsed order shown as one confirmation screen ("BUY 0.01 BTC @ $61,902 · ≈$619 · Say YES / tap to confirm") → tap or "yes" executes against the paper ledger; "no" cancels. Same flow for "Close my SOL position" and "Sell half my ETH".
- Price alerts: "Alert me if BTC goes above 65k" by voice; when it fires, the glasses show it (while the app is open) and Telegram delivers it too.
- Fills feed: last 3 paper fills, one line each.

**Data sources / APIs:**
- Hyperliquid public Info API (no key): `allMids` for live prices, `candleSnapshot` for charts/sparkline data, `meta` for market list. Public REST + WebSocket (`wss://api.hyperliquid.xyz/ws`) — the backend subscribes once and fans out to the glasses.
- Paper ledger: own backend (no exchange account needed). Optional stretch: Hyperliquid **testnet** for real orders — more impressive but adds wallet setup + testnet USDC; paper ledger is the safe default, testnet is a stretch goal only if time remains.
- CoinGecko free API as a fallback price source and for non-HL tokens on a watchlist screen.

**Telegram angle (Best Telegram Integration, $1,000 — open to any track):**
- The backend runs a Telegram bot (Bot API, `node-telegram-bot-api` or grammY). Linking: user opens the bot, sends `/start`, gets a pairing code; the glasses show the same code flow (no keyboard on glasses — pairing happens phone-side, code shown on glasses for confirmation).
- Every paper fill posts to the user's Telegram chat ("✅ FILLED: BUY 0.01 BTC @ $61,902 · Paper equity $10,619").
- **Two-way confirm:** voice orders can also be confirmed from Telegram — the bot sends the order with inline Yes/No buttons; tapping Yes executes it, and the glasses update. This is the "Telegram on G2" story for the judges: the trade lives in both places, confirmed from either.
- `/positions`, `/pnl`, `/price BTC` bot commands mirror the glasses screens; price alerts fire to Telegram even when the glasses app is closed (covers the "no background alerts" limitation honestly — alerts live in Telegram, the glasses are the glance + act surface).
- Note: Telegram is not in Track 2's app list, but the special prize is explicitly open to projects from any track — the core app is Hyperliquid (Track 2), Telegram is the notification/confirmation channel. Say so plainly in the README.

**Backend needs:**
- One small Node/TypeScript server (Express or Fastify): Hyperliquid WS client, paper ledger (SQLite — single file, zero ops), REST + WS endpoints for the glasses app, Telegram bot (polling — no webhook/public URL needed for the demo), Whisper STT calls.
- STT: **Groq Whisper API** (free tier, `whisper-large-v3-turbo`, fast; Variou already has Groq connected) — mic PCM (16 kHz s16le mono) → WAV → Groq. Fallback: OpenAI Whisper API (cheap).
- Intent parsing: deterministic regex/command parser for the narrow command set ("buy/sell/close/alert …") — no LLM needed for v1; optional Groq LLM fallback for free-form phrases.
- Hosting: Render free tier (or Railway/Fly.io free) for the demo; the simulator can also hit `localhost` during development. Backend URL goes in the `app.json` network whitelist.
- Secrets: Groq key + Telegram bot token live ONLY on the backend, never in the app bundle.

**Effort estimate (solo): ~4–5 build days inside the 7-day window.** Day 1: scaffold from `asr` template + simulator + live prices screen. Day 2: paper ledger + positions/PnL screens. Day 3: voice order → parse → confirm → execute flow. Day 4: Telegram bot + alerts + two-way confirm. Day 5: polish, edge cases, `.ehpk`, demo video, README. Days 6–7: buffer + submit.

### Concept B — "Polymarket Odds Glance" (paper bets by voice)

**One-line pitch:** Live Polymarket odds on your glasses — follow the markets you care about, place paper bets by voice, get settled alerts on Telegram.

**Glasses experience:** home = your followed markets with Yes/No prices (one line each); tap to open a market (price history sparkline as text, volume, end date); voice "Bet $50 Yes on Bitcoin above 100k" → confirm screen → paper bet recorded; results/settlements as a feed.

**Data sources / APIs:** Polymarket Gamma API (public, no key — market search, prices, volume) + CLOB API (orderbook, public). Paper ledger on the backend (same pattern as Concept A). Real testnet betting (Polygon Amoy) is possible but adds wallet + testnet USDC friction — paper only for v1.

**Telegram angle:** market-moved alerts ("BTC >$100k Yes now 62%, was 55%") + bet confirmations with inline Yes/No, same two-way pattern as Concept A.

**Backend needs:** same stack as A (Node server, SQLite paper ledger, Groq Whisper, Telegram bot). Slightly simpler market-data side (REST polling instead of WS).

**Effort estimate: ~3–4 days.** Weaker than A: Variou knows Hyperliquid mechanics far better than Polymarket's, and "odds glance" is a thinner write story (bets are rarer, slower actions than trading). Keep as the fallback if Hyperliquid's API proves troublesome during Day 1.

### Concept C — "DeFi Wallet Glance + Alerts" (read-first, simplest)

**One-line pitch:** Your wallets on your glasses — balances and portfolio PnL at a glance, voice-set price alerts, Telegram delivers the pings.

**Glasses experience:** home = total portfolio value + 24h change; per-wallet screens (balances by token, one line each); voice "Alert me when ETH drops below 3000"; alerts feed.

**Data sources / APIs:** CoinGecko free API (prices, portfolio valuation) + EVM RPC for balances (Alchemy free tier — already connected for Variou; Ethereum/Base/BSC/Arbitrum). Read-only: user pastes a watch address on the phone-side pairing page — no keys, no signing.

**Telegram angle:** alerts + daily portfolio digest to the bot chat; `/balance` command.

**Backend needs:** lightest of the three — Node server, CoinGecko polling + RPC balance reads, SQLite for alerts/watchlists, Groq Whisper, Telegram bot. No ledger, no order flow.

**Effort estimate: ~3 days.** Simplest and safest, but the weakest read-and-write story (mostly read + alerts) — it would score lower on the 25% write criterion. Best as a secondary screen inside Concept A (a watchlist screen), not as the standalone entry.

## 6. Other tracks — one-liners (not pursued)

- **Track 1 — Messaging & News:** "Telegram Channel Digest" — AI summaries of followed Telegram crypto channels on the glasses, voice-reply to DMs; direct Telegram (gram.js MTProto) beats the existing Beeper-based Messages app; ~4–5 days. (Telegram depth is folded into Concept A instead.)
- **Track 3 — Exchanges & Stocks:** "Binance Paper Session" — paper trading session (PnL, positions, alerts) with voice confirmations on Binance public market data; ~4 days. (Overlaps Concept A; Hyperliquid was the better fit.)
- **Track 4 — AI Assistants & Work:** "Inbox in 30 Seconds" — Gmail triage with AI summaries and voice reply/archive; ~4–5 days, heaviest auth burden (Google OAuth pairing outside the WebView).

## 7. Recommended 7-day plan (Concept A, solo)

| Day | Date (WIB) | Work |
|---|---|---|
| 1 | Mon 23 Nov | Kickoff 15:00 WIB. Scaffold from `asr` template; simulator running; live prices screen (HL `allMids`). |
| 2 | Tue 24 Nov | Paper ledger backend + positions/PnL screens. |
| 3 | Wed 25 Nov | Voice order flow: mic → Groq Whisper → parse → confirm screen → execute. |
| 4 | Thu 26 Nov | Telegram bot: fills, alerts, two-way inline confirm; CoinGecko watchlist screen. |
| 5 | Fri 27 Nov | Polish, edge cases, `.ehpk` build, README. |
| 6 | Sat 28 Nov | Demo video (≤3 min, simulator screen recording + voiceover), repo cleanup. |
| 7 | Sun 29 Nov | Buffer + submit before 23:59 Dubai = **Mon 30 Nov 02:59 WIB**. |

## 8. Open items for the parent agent

- **Registration is NOT done** (research only, per instructions) — registration opened Nov 18 on the DoraHacks page; needs Variou's DoraHacks account (his step, or a browser task with his login).
- **Live page re-check:** the fresh-copy fetch failed, so the verification above rests on the 17 Nov crawl; re-check the live page (browser) before registering — especially for newly announced sponsor prizes.
- **Kickoff Nov 23 15:00 WIB** — Even Realities shares "what makes a G2 app successful" tips there; worth attending/reading the recap before finalizing the design.
- No glasses needed for the build (simulator only). If Variou wants on-device testing later, he needs the Even Realities phone app + Dev Mode + a LAN-reachable dev server.

## Live verification corrections — 20 Nov 2026 23:34 WIB (browser, read-only)
- Track 2nd prize is **$375**, not $500 (17 Nov copy was stale). Total pool still $10,000: 2000 + 4×1250 + 4×375 + 1000 + up to 500 Community Partner Award.
- NEW: **Community Partner Award up to $500** (most points: 1 per valid submission with demo, +3 per finalist, +5 per winner; min 3 valid submissions; community named in "How did you hear about this hackathon?").
- Track 2 live app list: Gram Wallet, Polymarket, Hyperliquid, Trust Wallet ONLY — **CoinGecko and Kalshi are NOT listed**. Rule: use only the apps listed in your track → CoinGecko DROPPED as a data source; Hyperliquid allMids is the sole price feed.
- Track 3 live: Binance, OKX, Bybit, Coinbase, Interactive Brokers (no Alpaca). Track 4 live: Claude, ChatGPT, OpenRouter, Notion, Google Workspace (no Gemini/Perplexity/Outlook).
- Deadlines confirmed unchanged. Status: Upcoming / Pre-registration, "Submission starts in 2 days", 233 hackers. Registration open, requires DoraHacks account (email+code, Google, or GitHub). Submission also requires up to 5 feature requests; GitHub/GitLab/Bitbucket link + demo video mandatory.
