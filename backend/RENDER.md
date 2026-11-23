# Deploying the backend to Render — Variou's steps (Day 1 prep)

The backend is ready to deploy; **no account exists yet and nothing is
deployed**. These steps need Variou (Render account + the two secrets).

## 1. Create the Render account

- Go to https://render.com and sign up (GitHub sign-in is easiest — the
  hackathon repo is public on GitHub).
- Free tier is enough: 750 instance-hours/month. Note: free web services
  spin down after 15 min idle; the first request after sleep takes ~30–60s.
  That is fine for the demo (the glasses app retries every 2s).

## 2. Deploy from this repo

- In Render: **New → Web Service** → connect the public hackathon repo →
  select the `backend/` directory as the Root Directory.
- Or use the Blueprint: **New → Blueprint** → connect the repo → Render
  reads `backend/render.yaml` and creates the service with the commands
  already filled in (build: `npm ci`, start: `npm start`).
- Runtime: Node 24 (the repo requires `node >= 24`).

## 3. Set the secrets (dashboard only — never in git/chat)

In the service's **Environment** tab, add:

| Variable | Value | Where Variou has it |
|---|---|---|
| `GROQ_API_KEY` | Groq API key (Whisper STT) | Muse's `custom.groq` connector / Groq console — paste the key yourself |
| `TELEGRAM_BOT_TOKEN` | Token for @Lethal_ape_bot | Muse's Secure Vault (`custom.telegram-bot`) — paste the token yourself |

`PORT` is set by Render automatically; the server reads `process.env.PORT`.

## 4. Wire the deployed URL into the glasses app

1. Copy the service URL from Render, e.g. `https://hl-paper-trader-backend.onrender.com`.
2. In `app/app.json`, add that origin to the `network` permission whitelist
   (it currently whitelists only `http://localhost:3000` for local dev).
3. Rebuild the app with the backend URL baked in:
   `VITE_BACKEND_URL=https://hl-paper-trader-backend.onrender.com npm run build`
4. Verify: `curl https://<your-url>/health` → `{"ok":true,...}` and
   `curl https://<your-url>/prices` → live BTC/ETH/SOL mids.

## Local dev (no account needed)

```bash
cd backend
npm install
npm run dev        # :3000 — /health, /prices, /stream
```

No secrets are needed to run the price feed locally: Hyperliquid's public
`allMids` WS + candle REST need no key. `GROQ_API_KEY` / `TELEGRAM_BOT_TOKEN`
are only used from Day 3 (STT) / Day 4 (Telegram bot) onward.
