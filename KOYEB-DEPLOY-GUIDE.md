# Deploy backend ke Koyeb — langkah Variou (pengganti Render)

Render ternyata mewajibkan kartu sebelum deploy, walau plan Free.
**Koyeb tidak butuh kartu sama sekali** — signup pakai GitHub, deploy dari
repo yang sama. Spek Free: 1 web service, 512 MB RAM, 0.1 vCPU,
100 GB bandwidth/bulan, HTTPS otomatis, URL `*.koyeb.app`.
Catatan: instance Free tidur setelah 1 jam tanpa traffic, bangun lagi
dalam hitungan detik saat ada request — aplikasi kacamata retry tiap 2
detik, jadi pulih sendiri.

## 1. Buat akun Koyeb

- Buka https://app.koyeb.com → sign up **pakai GitHub** (akun segoku916).
- Tidak ada kolom kartu. Verifikasi GitHub sudah cukup.

## 2. Buat service dari repo

- Dashboard Koyeb → **Create App** → pilih **GitHub** →
  authorize Koyeb → pilih repo **`segoku916/hl-paper-trader`**,
  branch `main`.
- **Root directory:** `backend`
- **Builder:** **Dockerfile** (lokasi: `Dockerfile` — sudah disiapkan
  di repo; alternatif: Buildpack dengan Build `npm ci`, Run `npm start`).
- **Instance:** **Free** / Eco (Nano).
- **Region:** biarkan default (Frankfurt / Washington D.C.).

## 3. Isi env var (sebelum deploy)

Di halaman Environment Variables, isi 2 baris ini — KEY = nama
variabelnya, VALUE = isi key-nya (jangan kebalik seperti di Render):

| KEY | VALUE |
|---|---|
| `GROQ_API_KEY` | key Groq lo (awalan `gsk_...`, dari console.groq.com/keys) |
| `TELEGRAM_BOT_TOKEN` | token @Lethal_ape_bot (dari @BotFather → /mybots → API Token) |

`PORT` diisi otomatis oleh Koyeb; server membaca `process.env.PORT`.

## 4. Deploy

- Klik **Deploy**. Build pertama makan waktu beberapa menit
  (Koyeb build image Docker dari `backend/Dockerfile`).
- Kalau build sukses, Koyeb kasih URL, contoh:
  `https://hl-paper-trader-<nama>.koyeb.app`.

## 5. Kirim URL ke Muse

- Copy URL `koyeb.app` itu, kirim ke Muse.
- Muse lalu: (a) cek `https://<url>/health` + `/prices` live,
  (b) tambahkan origin itu ke whitelist `network` di `app/app.json`,
  (c) rebuild aplikasi kacamata dengan backend URL tersebut.

## Kalau Koyeb juga bermasalah

Cadangan: **Hugging Face Spaces (Docker)** — gratis, tanpa kartu,
16 GB RAM, tidur setelah 48 jam tanpa traffic. Butuh akun HF +
Dockerfile yang sama; langkahnya mirip (New Space → SDK Docker →
upload isi `backend/` + env var sebagai secrets).
