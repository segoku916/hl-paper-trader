# Deploy backend ke Hugging Face Spaces — langkah Variou

Render mewajibkan kartu, Koyeb sudah tutup untuk signup baru
(dashboard-nya tinggal pengumuman gabung ke Mistral). **Hugging Face
Spaces gratis, tanpa kartu**, 16 GB RAM / 2 vCPU, tidur setelah 48 jam
tanpa traffic (bangun lagi ~1 menit saat ada request).

## 1. Buat akun Hugging Face (gratis)

- Buka https://huggingface.co/join → daftar pakai email
  (atau GitHub kalau ada pilihannya). Verifikasi email.
- Tidak ada kolom kartu.

## 2. Buat Space Docker

- Buka https://huggingface.co/new-space
- **Space name:** `hl-paper-trader`
- **License:** MIT
- **SDK:** pilih **Docker**
- **Visibility:** Public
- **Hardware:** biarkan default (CPU basic, gratis)
- Klik **Create Space**.

## 3. Sambungkan repo GitHub (auto-deploy)

- Di halaman Space → tab **Settings** → bagian **Linked GitHub repo**
  (atau "Repository" / "GitHub") → sambungkan ke
  **`segoku916/hl-paper-trader`**, branch `main`.
- HF akan sync repo dan build image dari `Dockerfile` di root repo
  (sudah disiapkan — isinya hanya backend).
- Build pertama makan waktu 5–10 menit. Pantau di tab **Logs**.

## 4. Isi secrets (env var)

- Space → **Settings** → **Variables and secrets** → tambah 2 secrets:
  - `GROQ_API_KEY` = key Groq lo (awalan `gsk_...`)
  - `TELEGRAM_BOT_TOKEN` = token @Lethal_ape_bot
- KEY = nama variabelnya, VALUE = isi key-nya (jangan kebalik).
- Setelah tambah secret, Space restart otomatis (atau klik
  **Restart Space** / **Factory reboot** di Settings).

## 5. Kirim URL ke Muse

- URL Space lo: `https://<username>-hl-paper-trader.hf.space`
  (tertera di halaman Space).
- Copy URL itu, kirim ke Muse.
- Muse lalu: (a) cek `https://<url>/health` + `/prices` live,
  (b) tambahkan origin itu ke whitelist `network` di `app/app.json`,
  (c) rebuild aplikasi kacamata dengan backend URL tersebut.

## Catatan

- Kalau "Linked GitHub repo" tidak ketemu di Settings: alternatifnya
  upload manual — di tab **Files** Space, upload isi folder `backend/`
  + file `Dockerfile` dari root repo (atau kabari Muse).
- SQLite paper ledger tersimpan di disk container (ephemeral) —
  redeploy mereset saldo paper ke $10.000. Normal untuk demo.
