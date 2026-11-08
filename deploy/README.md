# Panduan Deployment

Cara memasang LLM Proxy Gateway (ThorHub) di server Linux produksi.

Arsitektur yang dipakai:

```
Internet ──HTTPS──> nginx (443) ──proxy_pass──> 127.0.0.1:3000 (systemd: llm-gateway)
```

---

## 1. Prasyarat

- Server Linux (Ubuntu/Debian)
- **Node.js ≥ 18** — cek: `node -v`
- **nginx** — cek: `nginx -v`
- **certbot** (untuk HTTPS) — cek: `certbot --version`
- Domain yang A-record-nya sudah mengarah ke IP server

---

## 2. Siapkan aplikasi

```bash
cd /root/home/projects/llm-gateway-express
npm install
cp .env.example .env
nano .env
```

Isi minimal: `MASTER_API_KEY`, `TARGET_API_BASE_URL`, `ADMIN_API_KEY`, `ADMIN_PASSWORD`.

Uji dulu secara manual di port sementara (jangan port produksi):

```bash
PORT=3999 node src/server.js
# buka terminal lain:
curl http://localhost:3999/health
# Ctrl+C untuk berhenti
```

---

## 3. Pasang systemd service

```bash
sudo cp deploy/llm-gateway.service /etc/systemd/system/llm-gateway.service
sudo nano /etc/systemd/system/llm-gateway.service   # sesuaikan WorkingDirectory bila perlu
sudo systemctl daemon-reload
sudo systemctl enable --now llm-gateway
```

Verifikasi:

```bash
systemctl status llm-gateway
curl http://localhost:3000/health
```

---

## 4. Pasang nginx + HTTPS

```bash
sudo cp deploy/nginx-llm-gateway.conf /etc/nginx/sites-available/llm-gateway
sudo nano /etc/nginx/sites-available/llm-gateway    # ganti domain
sudo ln -s /etc/nginx/sites-available/llm-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d llm.thormarket.site
```

Verifikasi:

```bash
curl https://llm.thormarket.site/health
```

---

## 5. Update kode (rutin)

```bash
cd /root/home/projects/llm-gateway-express
git pull
npm install          # bila ada dependensi baru
sudo systemctl restart llm-gateway
```

> **JANGAN** jalankan `node src/server.js` manual di port 3000 saat service aktif —
> akan bentrok (`EADDRINUSE`) dan service crash-restart berulang.

Untuk uji coba, pakai port terpisah:

```bash
PORT=3999 node src/server.js
```

---

## 6. Perintah operasional

| Tugas | Perintah |
| --- | --- |
| Lihat status | `systemctl status llm-gateway` |
| Log live | `journalctl -u llm-gateway -f` |
| Log terakhir | `journalctl -u llm-gateway -n 50` |
| Hanya error | `journalctl -u llm-gateway -p err` |
| Restart | `systemctl restart llm-gateway` |
| Stop / start | `systemctl stop llm-gateway` / `systemctl start llm-gateway` |
| Cek auto-start | `systemctl is-enabled llm-gateway` |
| Reset counter restart | `systemctl reset-failed llm-gateway` |
| Uji config nginx | `nginx -t` |
| Reload nginx | `systemctl reload nginx` |
| Cek siapa pakai port 3000 | `ss -ltnp \| grep :3000` |

---

## 7. Backup database

Seluruh data kuota pembeli ada di `data/gateway.db`.

```bash
# Backup aman saat server jalan (SQLite .backup)
sqlite3 data/gateway.db ".backup /backup/gateway-$(date +%F).db"

# Restore
sudo systemctl stop llm-gateway
cp /backup/gateway-2026-11-08.db data/gateway.db
sudo systemctl start llm-gateway
```

Pasang cron backup harian (contoh, jam 3 pagi):

```cron
0 3 * * * cd /root/home/projects/llm-gateway-express && sqlite3 data/gateway.db ".backup /backup/gateway-$(date +\%F).db"
```

---

## 8. Pemecahan masalah

| Gejala | Solusi |
| --- | --- |
| `EADDRINUSE :::3000` | Ada proses lain di port 3000. Cek `ss -ltnp \| grep :3000`, kill PID yang salah, lalu `systemctl restart llm-gateway` |
| Service restart berulang | `journalctl -u llm-gateway -n 50` — cari error asli (biasanya `.env` salah) |
| Streaming tidak real-time | Pastikan `proxy_buffering off` ada di config nginx, lalu `systemctl reload nginx` |
| Panel admin tidak bisa login | Cek `ADMIN_PASSWORD` di `.env` sudah diisi, lalu restart service |
| Daftar model kosong | Normal bila provider sedang down — gateway pakai snapshot otomatis |
