# LLM Proxy Gateway

API Proxy Gateway (Express.js) untuk **menjual kembali akses LLM API** dari satu Master API Key.
Pembeli mendapat Sub-API Key sendiri (`sk-thor-xxx`) dengan kuota token terukur, sementara semua
request ke provider utama melewati satu antrean rate-limit agar tidak pernah menyentuh limit 30 RPM.

## Arsitektur / Alur Request

```
Pembeli (sk-thor-xxx)
        │
        ▼
┌─────────────────────────────────────────────────┐
│ Express Gateway                                 │
│  1. auth.js      → cek key aktif + kuota token  │
│  2. limiter.js   → antrean Bottleneck           │
│     • 25 request / 60 detik (buffer dari 30 RPM)│
│     • maks 3 request paralel                    │
│     • timeout antrean 60 detik → 503            │
│  3. proxy.js     → forward payload utuh ke      │
│     provider dengan MASTER_API_KEY              │
│  4. usage.total_tokens → tokens_used += ...     │
└─────────────────────────────────────────────────┘
        │
        ▼
Provider utama (OpenAI/OpenRouter/dll.)
```

## Struktur Folder

```
llm-proxy-gateway/
├── package.json              # Dependensi & script npm
├── .env.example              # Template konfigurasi (salin jadi .env)
├── .gitignore
├── README.md
├── generate-key.js           # CLI: terbitkan Sub-API Key baru
├── manage-keys.js            # CLI: list/show/enable/disable/topup/delete key
├── src/
│   ├── server.js             # Entry point Express
│   ├── config.js             # Loader konfigurasi .env
│   ├── db.js                 # SQLite (better-sqlite3) + skema
│   ├── lib/
│   │   ├── session.js        # Sesi login panel admin & portal member (cookie)
│   │   └── models.js         # Snapshot resmi daftar model provider (fallback)
│   ├── middleware/
│   │   └── auth.js           # Otentikasi Sub-API Key + cek kuota
│   ├── routes/
│   │   ├── chat.js           # POST /v1/chat/completions, GET /v1/models
│   │   ├── portal.js         # Login sesi + daftar model publik (/portal/models)
│   │   └── admin.js          # REST API manajemen key (khusus admin)
│   └── services/
│       ├── limiter.js        # Antrean Bottleneck (25 RPM / 3 paralel)
│       └── proxy.js          # Forwarding + penghitungan token + timeout
├── public/                   # Panel web admin & portal member (HTML/CSS/JS)
├── test/
│   └── mock-provider.js      # Provider tiruan untuk uji tanpa kredit asli
└── data/
    └── gateway.db            # Database SQLite (dibuat otomatis)
```

## Skema Data Sub-API Key (tabel `api_keys`)

| Kolom         | Tipe    | Keterangan                              |
| ------------- | ------- | --------------------------------------- |
| `id`          | INTEGER | Primary key auto-increment              |
| `api_key`     | TEXT    | Format `sk-thor-<48 hex>`, unik       |
| `user_name`   | TEXT    | Nama pembeli                            |
| `token_limit` | INTEGER | Kuota maksimum, mis. `1000000`          |
| `tokens_used` | INTEGER | Pemakaian terakumulasi (default 0)      |
| `is_active`   | INTEGER | 1 = aktif, 0 = diblokir                 |
| `created_at`  | TEXT    | Waktu key diterbitkan                   |

## Persyaratan

- **Node.js ≥ 18** (memakai `fetch` bawaan).
- Tidak perlu database server — SQLite disimpan di `data/gateway.db`.

## 1. Instalasi & Konfigurasi

```bash
npm install
cp .env.example .env
```

Lalu edit `.env`:

```env
PORT=3000
MASTER_API_KEY=sk-master-key-asli-anda
TARGET_API_BASE_URL=https://api.openai.com/v1   # sesuaikan provider
ADMIN_API_KEY=secret-admin-anda
```

## 2. Menjalankan Server

```bash
npm start          # mode produksi
npm run dev        # mode pengembangan (auto-restart saat file berubah)
```

Server akan berjalan di `http://localhost:3000` dan mencetak ringkasan konfigurasi.

## 3. Menerbitkan Sub-API Key untuk Pembeli

```bash
node generate-key.js "Budi Santoso" 1000000
```

Output:

```
✅ Sub-API Key berhasil diterbitkan!
=================================================
ID           : 1
Nama user    : Budi Santoso
API Key      : sk-thor-3f9c2a...   (48 karakter hex)
Token limit  : 1.000.000
Token terpakai: 0
Status       : aktif
=================================================
```

> Key hanya ditampilkan sekali saat pembuatan. Simpan sebelum menyerahkan ke pembeli.

Perintah manajemen lanjutan:

```bash
node manage-keys.js list                      # lihat semua key & pemakaian
node manage-keys.js show  sk-thor-xxxx      # detail satu key
node manage-keys.js disable sk-thor-xxxx    # blokir key pembeli nakal
node manage-keys.js enable  sk-thor-xxxx    # aktifkan kembali
node manage-keys.js topup  sk-thor-xxxx 500000   # tambah kuota
node manage-keys.js delete sk-thor-xxxx     # hapus permanen
```

## Daftar Model (disinkronkan dengan docs Re:Link Gateway)

Daftar model mengikuti sumber resmi <https://relink-gateway.biz.id/#docs> — **42 model,
25 aktif** — dan disimpan sebagai snapshot di `src/lib/models.js`.

Setiap entri memuat: `id`, `label`, `vendor`, `vision`, `multiplier`, dan `active`.

| Vendor | Jumlah model | Aktif | Contoh |
| --- | --- | --- | --- |
| DeepSeek | 10 | 9 | `deepseek-v4-pro`, `deepseek-v4.1-flash-1017` |
| Zhipu AI | 8 | 6 | `glm-5.3`, `glm-5.3-flash` |
| OpenAI | 7 | 2 | `gpt-6-astra`, `gpt-6-luna` |
| Moonshot | 7 | 3 | `kimi-k2.7-code`, `kimi-k2.8` |
| Anthropic | 3 | 0 | `claude-opus-5` (menunggu aktif) |
| MiniMax | 3 | 3 | `mimo-v2.6-pro` |
| Tencent | 2 | 0 | `hy3`, `hy4` |
| Google | 1 | 1 | `gemini-4-argon` |
| Lainnya | 1 | 1 | `auto` |

- **Default contoh** di dokumentasi & portal: `deepseek-v4-pro` (sama dengan docs resmi).
- **Multiplier** = faktor konsumsi token terhadap kuota (mis. `claude-opus-5-5` = 32×).
- Model **nonaktif** tetap ditampilkan di halaman `/docs` dengan penanda, agar member
  tahu model tersebut ada tetapi belum tersedia.

### Endpoint daftar model

```bash
# Hanya model aktif (default)
curl http://localhost:3000/portal/models

# Semua model, termasuk yang nonaktif
curl "http://localhost:3000/portal/models?all=1"

# Filter per vendor (case-insensitive)
curl "http://localhost:3000/portal/models?vendor=DeepSeek"

# Endpoint OpenAI-compatible (butuh Sub-API Key)
curl http://localhost:3000/v1/models -H "Authorization: Bearer sk-thor-xxxx"
```

Respons `/portal/models` menyertakan `meta`:

```json
{
  "meta": {
    "total": 42,
    "active": 25,
    "returned": 25,
    "default_model": "deepseek-v4-pro",
    "vendors": ["Lainnya", "Anthropic", "DeepSeek", "Google", "Zhipu AI", "OpenAI", "Tencent", "Moonshot", "MiniMax"]
  }
}
```

### Ketahanan bila provider tidak dapat dihubungi

Gateway mengambil daftar model **live** dari provider, lalu menyimpannya di cache 60 detik.
Bila provider gagal dihubungi:

- `/portal/models` otomatis menyajikan **snapshot lokal** (`src/lib/models.js`) dan menandai
  respons dengan `"stale": true` (bila ada cache lama, dipakai cache tersebut).
- `/v1/models` otomatis menyajikan daftar 25 model aktif dari snapshot dengan
  `"gateway_fallback": true`.

Dengan begitu dokumentasi dan integrasi klien tetap berjalan meski provider sedang bermasalah.

## 4. Cara Pembeli Memakai API

Endpoint untuk pembeli: `POST http://localhost:3000/v1/chat/completions`
(compatibel format OpenAI — SDK OpenAI tinggal diganti `baseURL`-nya).

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-thor-xxxxxxxx" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Halo, apa kabar?"}]
  }'
```

Contoh streaming:

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-thor-xxxxxxxx" \
  -d '{"model": "deepseek-v4-pro", "stream": true, "messages": [{"role": "user", "content": "Hai"}]}'
```

Contoh pemakaian dengan SDK Python:

```python
from openai import OpenAI
client = OpenAI(
    api_key="sk-thor-xxxxxxxx",
    base_url="http://localhost:3000/v1",
)
resp = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Halo!"}],
)
print(resp.choices[0].message.content)
```

### Kode error yang mungkin diterima pembeli

| HTTP | Situasi                                | `code` di body                     |
| ---- | -------------------------------------- | ---------------------------------- |
| 401  | Header hilang / key tidak ditemukan    | `missing_api_key`, `invalid_api_key` |
| 403  | Key dinonaktifkan admin                | `key_disabled`                     |
| 403  | Kuota habis (`tokens_used >= limit`)   | `quota_exceeded`                   |
| 4xx/5xx | Error dari provider (diteruskan)   | format asli provider               |
| 503  | Mengantre melebihi 60 detik            | `queue_timeout`                    |
| 504  | Provider tidak merespons tepat waktu   | `upstream_timeout`                 |

## 5. REST API Admin (bonus)

Semua butuh header `Authorization: Bearer <ADMIN_API_KEY>`:

```bash
# Daftar semua key + sisa kuota
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/keys

# Detail satu key
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/keys/sk-thor-xxxx

# Blokir / aktifkan key, atau ubah limit (top-up)
curl -X PATCH -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"is_active": false}' \
  http://localhost:3000/admin/keys/sk-thor-xxxx

curl -X PATCH -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"token_limit": 2000000}' \
  http://localhost:3000/admin/keys/sk-thor-xxxx

# Hapus key / ringkasan pemakaian
curl -X DELETE -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/keys/sk-thor-xxxx
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/usage
```

Monitoring antrean: `GET /health` → `{ status, queue: { running, queued } }`.

## Cara Kerja Rate Limiting & Antrean

Konfigurasi Bottleneck (`src/services/limiter.js`):

| Parameter                    | Nilai     | Arti                                             |
| ---------------------------- | --------- | ------------------------------------------------ |
| `reservoir`                  | 25        | Kapasitas 25 request                             |
| `reservoirRefreshInterval`   | 60.000 ms | di-reset jadi 25 lagi setiap 60 detik            |
| `maxConcurrent`              | 3         | maksimal 3 request berjalan paralel ke provider  |
| Timeout antrean              | 60.000 ms | yang masih mengantre → HTTP 503 `queue_timeout`  |
| `UPSTREAM_TIMEOUT_MS`        | 120.000 ms| request yang menggantung ke provider dibatalkan  |

- Limit asli provider 30 RPM → gateway hanya mengirim **maks 25 RPM** (buffer 5 request).
- Request yang melebihi kapasitas **otomatis mengantre** (FIFO), bukan langsung ditolak; pembeli
  mendapat respons begitu giliran tiba, selama menunggu ≤ 60 detik.
- Jika provider tetap membalas `429`, gateway menambahkan *penalty* ke antrean agar makin hemat.

## 6. Penghitungan Token

- Response non-stream: `usage.total_tokens` (fallback `prompt_tokens + completion_tokens`)
  langsung ditambahkan ke `tokens_used` pembeli, lalu response diteruskan utuh.
- Response streaming: gateway mem-"tap" chunk SSE; bila chunk terakhir membawa `usage`
  (praktik standar OpenAI), token dihitung juga. Agar pasti selalu ada, set
  `INJECT_STREAM_USAGE=true` di `.env` untuk memaksa `stream_options.include_usage=true`.
- Request yang gagal sebelum provider menjawab (timeout antrean, provider error) **tidak dihitung**.

## 7. Uji Lokal Tanpa Menghabiskan Kredit (Mock Provider)

```bash
# Terminal 1 — provider tiruan (OpenAI-compatible) di port 9999
npm run mock

# Terminal 2 — gateway diarahkan ke mock
TARGET_API_BASE_URL=http://localhost:9999/v1 MASTER_API_KEY=sk-master-lokal ADMIN_API_KEY=admin-lokal npm start

# Terminal 3 — terbitkan key lalu uji
node generate-key.js "Tester" 1000000
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-thor-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"Halo"}]}'
```

## 8. Catatan Produksi

1. **Jalankan di balik reverse proxy** (Nginx/Caddy) untuk HTTPS + header standar.
2. **Backup `data/gateway.db`** secara berkala — di sanalah seluruh data kuota pembeli.
3. **Jangan pernah commit `.env`** (sudah masuk `.gitignore`) dan jangan pernah mengekspos
   `MASTER_API_KEY` ke pembeli — mereka hanya menerima `sk-thor-xxx`.
4. Limiter Bottleneck ini berjalan **per proses**. Jika menjalankan banyak instance secara
   paralel (cluster), gunakan `bottleneck` mode Redis (cluster) atau tetap satu proses.
5. Tambahkan log/alert eksternal (PM2, Docker, dsb.) sesuai infrastruktur Anda.
