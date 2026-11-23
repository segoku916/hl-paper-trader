# Panduan Deploy Backend ke Render (langkah demi langkah)

Backend HL Paper Trader sudah siap deploy. Repo GitHub-nya sudah publik:
**https://github.com/segoku916/hl-paper-trader**. Panduan ini yang
mengerjakan cuma kamu — akun Render dan 2 API key adalah milikmu.

> **Jangan paste API key di chat / repo / mana pun selain dashboard Render.**

## Yang kamu butuhkan sebelum mulai

1. **Akun Render** — daftar di https://dashboard.render.com/register
   (paling gampang: **Sign up with GitHub**, pakai akun GitHub `segoku916`).
2. **Groq API key** — dari https://console.groq.com/keys
   (login → API Keys → Create API Key → copy).
3. **Token bot Telegram** — dari @BotFather di Telegram: kirim `/mybots` →
   pilih **@Lethal_ape_bot** → API Token → copy.
   (Bot ini sudah dibuat 23 Nov 2026; tokennya jangan dibagikan ke siapa pun.)

## Langkah 1 — Buat Web Service baru

1. Login ke https://dashboard.render.com/
2. Klik tombol **New +** (kanan atas) → pilih **Web Service**.
3. Pilih **"Build and deploy from a Git repository"** → **Next**.
4. Cari dan pilih repo **`segoku916/hl-paper-trader`**.
   - Kalau repo belum muncul di daftar: klik **Configure account** (atau
     "Adjust GitHub App permissions") → beri Render akses ke repo itu →
     kembali dan pilih lagi.
5. Isi formnya persis seperti ini:

| Field | Isi |
|---|---|
| Name | `hl-paper-trader-backend` |
| Region | `Singapore` (paling dekat dari Indonesia; region lain juga boleh) |
| Branch | `main` |
| Root Directory | `backend` |
| Runtime | `Node` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | `Free` |

6. **JANGAN klik Create dulu** — isi environment variables dulu di langkah 2.

## Langkah 2 — Isi environment variables (SEBELUM deploy pertama)

Di halaman yang sama, scroll ke bagian **Environment Variables** → **Add
Environment Variable**, tambahkan 4 ini:

| Key | Value |
|---|---|
| `GROQ_API_KEY` | API key Groq kamu (dari console.groq.com/keys) |
| `TELEGRAM_BOT_TOKEN` | Token @Lethal_ape_bot (dari @BotFather) |
| `NODE_ENV` | `production` |
| `PORT` | `10000` |

> `GROQ_API_KEY` dipakai mulai Day 3 (voice order) dan `TELEGRAM_BOT_TOKEN`
> mulai Day 4 (notifikasi Telegram). Isi keduanya sekarang supaya nggak
> perlu redeploy nanti. Harga live (Day 1–2) jalan tanpa key apa pun.

## Langkah 3 — Deploy

1. Klik **Create Web Service**.
2. Tunggu deploy selesai (~2–3 menit). Di tab **Logs**, kalau berhasil akan
   muncul baris seperti:
   `hl-paper-trader-backend listening on :10000 (...)`
3. Salin URL service-nya dari atas dashboard, bentuknya:
   `https://hl-paper-trader-backend.onrender.com`

## Langkah 4 — Verifikasi (opsional, 30 detik)

Buka di browser (atau kirim ke Muse untuk dicek):

- `https://hl-paper-trader-backend.onrender.com/health`
  → harus muncul `{"ok":true,...}`
- `https://hl-paper-trader-backend.onrender.com/prices`
  → harus muncul harga live BTC/ETH/SOL

## Langkah 5 — Kirim URL-nya ke Muse

Kirim URL `https://...onrender.com` ke Muse. Yang Muse kerjakan setelah itu:

1. Tambahkan URL itu ke whitelist `network` di `app/app.json`
   (saat ini cuma `http://localhost:3000`).
2. Rebuild aplikasi kacamata dengan `VITE_BACKEND_URL` yang baru.
3. Tes end-to-end: harga live tampil di simulator lewat backend Render.

## Catatan free tier

- Free instance **tidur setelah 15 menit tidak ada request**; request
  pertama setelah tidur butuh ~30–60 detik. Untuk demo ini tidak masalah —
  aplikasi kacamata me-refresh harga tiap 2 detik.
- Jangan khawatir soal kuota: 750 jam instance/bulan, cukup untuk demo.
- Kalau suatu hari service-nya error, cek tab **Logs** di dashboard Render
  dan kirim screenshot error-nya ke Muse.

## Alternatif: Blueprint (kalau mau lebih cepat)

Kalau langkah manual di atas terasa ribet: di dashboard Render pilih
**New → Blueprint** → pilih repo `segoku916/hl-paper-trader` → Render
membaca `backend/render.yaml` dan mengisi sendiri nama service, build/start
command, dan env var-nya. Kamu tetap harus mengisi `GROQ_API_KEY` dan
`TELEGRAM_BOT_TOKEN` secara manual di tab **Environment** sebelum deploy.
