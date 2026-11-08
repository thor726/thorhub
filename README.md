# ThorHub — LLM Proxy Gateway

API Proxy Gateway (**Express.js + SQLite + Bottleneck**) untuk **menjual kembali akses LLM API**
dari satu Master API Key. Pembeli mendapat **Sub-API Key** sendiri (`sk-thor-xxx`) dengan kuota
token terukur, sementara semua request ke provider utama melewati satu antrean rate-limit agar
tidak pernah menyentuh limit provider.

Tersedia **3 antarmuka**:

| Antarmuka | URL | Untuk siapa |
| --- | --- | --- |
| **Landing page** | `/` | Umum — status gateway & daftar endpoint |
| **Dokumentasi** | `/docs` | Member — referensi API, daftar model, contoh kode |
| **Portal Member** | `/portal` | Pembeli — pantau kuota & salin Sub-API Key |
| **Panel Admin** | `/admin` | Penjual — terbitkan, blokir, top-up, hapus key |

- **Produksi:** <https://llm.thormarket.site>
- **Lisensi:** MIT · **Node.js:** ≥ 18

---

## Daftar Isi

1. [Arsitektur](#1-arsitektur)
2. [Struktur Folder](#2-struktur-folder)
3. [Persyaratan](#3-persyaratan)
4. [Instalasi & Konfigurasi](#4-instalasi--konfigurasi)
5. [Menjalankan Server](#5-menjalankan-server)
6. [Panel Web (Admin & Portal Member)](#6-panel-web-admin--portal-member)
7. [Menerbitkan & Mengelola Sub-API Key](#7-menerbitkan--mengelola-sub-api-key)
8. [Daftar Model](#8-daftar-model)
9. [API untuk Pembeli](#9-api-untuk-pembeli)
10. [REST API Admin](#10-rest-api-admin)
11. [API Internal Panel Web](#11-api-internal-panel-web)
12. [Rate Limiting & Antrean](#12-rate-limiting--antrean)
13. [Perhitungan Token & Multiplier](#13-perhitungan-token--multiplier)
14. [Keamanan](#14-keamanan)
15. [Uji Lokal (Mock Provider)](#15-uji-lokal-mock-provider)
16. [Deployment Produksi](#16-deployment-produksi)
17. [Backup & Pemeliharaan](#17-backup--pemeliharaan)
18. [Pemecahan Masalah](#18-pemecahan-masalah)

---

## 1. Arsitektur

```
Pembeli (sk-thor-xxx)                    Admin (browser)
        │                                       │
        ▼                                       ▼
┌──────────────────────────────────────────────────────────────┐
│ Express Gateway                                              │
│                                                              │
│  Static web (public/)                                        │
│    /  /docs  /portal  /admin                                 │
│                                                              │
│  Alur request chat:                                          │
│   1. auth.js      → cek key aktif + kuota token (SQLite)     │
│   2. limiter.js   → antrean Bottleneck                       │
│      • 25 request / 60 detik (buffer dari limit provider)    │
│      • maks 3 request paralel, FIFO                         │
│      • timeout antrean 60 dtk → 503 queue_timeout           │
│   3. proxy.js     → forward payload utuh ke provider         │
│      dengan MASTER_API_KEY (JSON & streaming SSE)            │
│   4. usage.total_tokens → tokens_used += total              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
Provider utama (Re:Link Gateway / OpenAI / OpenRouter / dll.)
```

**Data disimpan di SQLite** (`data/gateway.db`): tabel `api_keys` (sub-key + kuota) dan
`sessions` (sesi login panel).

---

## 2. Struktur Folder

```
llm-gateway-express/
├── package.json              # Dependensi & script npm
├── .env.example              # Template konfigurasi (salin jadi .env)
├── .gitignore
├── README.md
├── generate-key.js           # CLI: terbitkan Sub-API Key baru
├── manage-keys.js            # CLI: list/show/enable/disable/topup/delete key
│
├── src/
│   ├── server.js             # Entry point Express (static, route, 404, error)
│   ├── config.js             # Loader konfigurasi .env + validasi
│   ├── db.js                 # SQLite (better-sqlite3) + skema tabel
│   ├── lib/
│   │   ├── session.js        # Sesi login admin & member (cookie + SQLite)
│   │   └── models.js         # Snapshot resmi daftar model + multiplier (fallback)
│   ├── middleware/
│   │   └── auth.js           # Otentikasi Sub-API Key + cek kuota
│   ├── routes/
│   │   ├── chat.js           # POST /v1/chat/completions, GET /v1/models
│   │   ├── portal.js         # Sesi login + daftar model publik (/portal/*)
│   │   └── admin.js          # REST API manajemen key (ADMIN_API_KEY)
│   └── services/
│       ├── limiter.js        # Antrean Bottleneck (25 RPM / 3 paralel)
│       └── proxy.js          # Forwarding + hitung token + timeout
│
├── public/                   # Antarmuka web (tanpa build step)
│   ├── index.html  + inline # Landing page + status live
│   ├── docs.html   + docs.js      # Dokumentasi + tabel model live
│   ├── portal.html + portal.js    # Dashboard member
│   ├── admin.html  + admin.js     # Panel admin
│   ├── login-admin.html  login-member.html   # Fallback halaman login
│   ├── nav.js                # Toggle menu navigasi
│   ├── style.css             # Seluruh gaya (dark theme)
│   ├── 404.html, logo.svg, logo-full.svg, favicon.svg
│
├── deploy/                   # Berkas & panduan deployment produksi
│   ├── README.md             # Langkah deploy dari nol
│   ├── llm-gateway.service   # Unit systemd (siap pakai)
│   └── nginx-llm-gateway.conf# Konfigurasi nginx (siap pakai)
│
├── test/
│   └── mock-provider.js      # Provider tiruan untuk uji tanpa kredit asli
└── data/
    └── gateway.db            # Database SQLite (dibuat otomatis)
```

---

## 3. Persyaratan

- **Node.js ≥ 18** — memakai `fetch` bawaan (tanpa dependensi HTTP tambahan).
- **Tidak perlu database server** — SQLite disimpan sebagai file di `data/gateway.db`.

Dependensi (lihat `package.json`):

| Paket | Kegunaan |
| --- | --- |
| `express` | Web framework & static file |
| `better-sqlite3` | Database SQLite sinkron (cepat, tanpa ORM) |
| `bottleneck` | Antrean & rate limiter in-memory |
| `dotenv` | Membaca konfigurasi dari `.env` |

---

## 4. Instalasi & Konfigurasi

```bash
npm install
cp .env.example .env
```

### Variabel lingkungan (`.env`)

| Variabel | Wajib | Default | Keterangan |
| --- | :---: | --- | --- |
| `PORT` | ✗ | `3000` | Port server gateway |
| `MASTER_API_KEY` | **✓** | — | API key provider utama. **Rahasia**, jangan dibagikan ke pembeli |
| `TARGET_API_BASE_URL` | **✓** | `https://api.openai.com/v1` | Base URL provider (tanpa trailing slash) |
| `ADMIN_API_KEY` | ✓* | — | Kredensial REST API `/admin/*` (Bearer). Kosong → endpoint admin ditolak |
| `ADMIN_PASSWORD` | ✓* | — | Password login panel admin web (`/admin`) |
| `QUEUE_WAIT_TIMEOUT_MS` | ✗ | `60000` | Batas menunggu giliran antrean (ms) |
| `UPSTREAM_TIMEOUT_MS` | ✗ | `120000` | Batas tunggu respons provider (ms) |
| `INJECT_STREAM_USAGE` | ✗ | `false` | `true` = paksa `stream_options.include_usage=true` saat streaming |

\* Minimal salah satu sebaiknya diisi. `ADMIN_API_KEY` untuk integrasi programatik/CLI,
`ADMIN_PASSWORD` untuk login panel web. Keduanya boleh berbeda.

Contoh `.env`:

```env
PORT=3000
MASTER_API_KEY=sk-master-key-asli-anda
TARGET_API_BASE_URL=https://api.relink-gateway.biz.id/v1
ADMIN_API_KEY=secret-admin-untuk-rest-api
ADMIN_PASSWORD=password-panel-admin-web
QUEUE_WAIT_TIMEOUT_MS=60000
UPSTREAM_TIMEOUT_MS=120000
INJECT_STREAM_USAGE=false
```

> **Peringatan:** server menolak start bila `MASTER_API_KEY` kosong. Bila `ADMIN_API_KEY`
> kosong, server hanya memberi peringatan dan endpoint `/admin/*` menolak semua request.

---

## 5. Menjalankan Server

```bash
npm start          # mode produksi
npm run dev        # mode pengembangan (auto-restart saat file berubah)
npm run mock       # jalankan provider tiruan (port 9999)
```

Saat berjalan, server mencetak ringkasan:

```
==============================================
  LLM Proxy Gateway siap menerima request
  Port lokal      : 3000
  Provider target : https://api.relink-gateway.biz.id/v1
  Rate limit      : 25 request/60 dtk, maks 3 paralel
  Timeout antrean : 60 dtk
==============================================
```

Akses cepat: `http://localhost:3000/` (landing), `/health` (status JSON), `/api/info` (daftar endpoint).

---

## 6. Panel Web (Admin & Portal Member)

Seluruh antarmuka memakai **HTML + CSS + JS vanilla — tanpa build step**, jadi cukup buka
browser. Sesi login memakai cookie `HttpOnly` (token acak 256-bit), bukan menyimpan password/key
di cookie.

### 6.1 Landing Page — `/`

Menampilkan status gateway **live** (diambil dari `/health`): status, jumlah antrean, dan request
berjalan. Berguna untuk pemantauan sekilas tanpa login.

### 6.2 Dokumentasi Member — `/docs`

Halaman referensi terbuka (tanpa login) berisi:

- **Base URL** yang otomatis terisi sesuai origin yang diakses
- **Tabel daftar model** live — kolom: Model ID, Vendor, Kemampuan, Multiplier, **Status**
  (● Aktif / ○ Nonaktif)
- Fitur **cari model** (berdasarkan ID atau vendor) dan tombol **Muat Ulang**
- Tombol **Pakai** pada tiap model → otomatis mengisi contoh kode & menyalin ID ke clipboard
- Contoh kode: **cURL**, **Python (OpenAI SDK)**, **Streaming**, dan endpoint daftar model —
  masing-masing dengan tombol **Salin**
- Tabel kode error yang mungkin diterima pembeli

### 6.3 Portal Member — `/portal`

Dashboard untuk **pembeli**. Login memakai **Sub-API Key** mereka sendiri.

Setelah login, member dapat melihat:

| Kartu | Isi |
| --- | --- |
| Sisa Kuota | token yang masih tersedia |
| Terpakai | total token terpakai |
| Total Limit | kuota maksimum key |
| Pemakaian | persentase (%) dengan peringatan bila ≥ 80% |
| Status | Aktif ✅ / Nonaktif ⛔ |
| Terdaftar | tanggal key diterbitkan |

Juga tersedia tombol **Tampilkan** key, **Salin** key, contoh kode siap pakai, dan **Keluar**.

Member **tetap bisa login** meski key dinonaktifkan atau kuota habis, supaya bisa melihat status
dan menghubungi admin. Bila key dihapus admin, sesi member otomatis ditutup saat refresh.

### 6.4 Panel Admin — `/admin`

Login memakai `ADMIN_PASSWORD`. Setelah masuk, tersedia:

- **Kartu statistik**: total key, key aktif, total limit, total token terpakai
- **Status gateway**: kondisi server langsung (dari `/health`)
- **Terbitkan Key**: isi nama member + limit token → key tampil **penuh sekali saja**
- **Tabel semua key**: pemakaian, bar kuota, dengan aksi **Top-up**, **Blokir/Aktifkan**, **Hapus**

Sesi admin berlaku **12 jam**, sesi member **7 hari** (lihat [Keamanan](#14-keamanan)).

---

## 7. Menerbitkan & Mengelola Sub-API Key

### Lewat Panel Admin (cara utama)

Buka `/admin` → login → isi nama & limit token → **Terbitkan Key** → salin key → kirim ke pembeli.

### Lewat CLI

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

### Perintah manajemen (`manage-keys.js`)

```bash
node manage-keys.js list                        # lihat semua key & pemakaian
node manage-keys.js show   sk-thor-xxxx         # detail satu key
node manage-keys.js disable sk-thor-xxxx        # blokir key pembeli nakal
node manage-keys.js enable  sk-thor-xxxx        # aktifkan kembali
node manage-keys.js topup  sk-thor-xxxx 500000  # tambah kuota
node manage-keys.js delete sk-thor-xxxx         # hapus permanen
```

### Skema tabel `api_keys`

| Kolom | Tipe | Keterangan |
| --- | --- | --- |
| `id` | INTEGER | Primary key auto-increment |
| `api_key` | TEXT | Format `sk-thor-<48 hex>`, unik. Boleh prefix lain bila dimasukkan manual |
| `user_name` | TEXT | Nama pembeli |
| `token_limit` | INTEGER | Kuota maksimum (mis. `1000000`) |
| `tokens_used` | INTEGER | Pemakaian terakumulasi (default `0`) |
| `is_active` | INTEGER | `1` = aktif, `0` = diblokir |
| `created_at` | TEXT | Waktu key diterbitkan |

---

## 8. Daftar Model

Daftar model mengikuti sumber resmi <https://relink-gateway.biz.id/#docs> — **42 model,
25 aktif** — dan disimpan sebagai snapshot di `src/lib/models.js`.

Setiap entri memuat: `id`, `label`, `vendor`, `vision`, `multiplier`, `active`.

| Vendor | Jumlah model | Aktif | Contoh |
| --- | :---: | :---: | --- |
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
- **Model nonaktif** tetap ditampilkan di `/docs` dengan penanda, agar member tahu model itu ada.
- Nilai **multiplier** diambil apa adanya dari situs resmi — jangan dikira-kira.

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
  "data": [
    { "id": "deepseek-v4-pro", "label": "Deepseek V4 Pro", "vendor": "DeepSeek",
      "vision": false, "multiplier": 1.15, "active": true }
  ],
  "meta": {
    "total": 42, "active": 25, "returned": 25,
    "default_model": "deepseek-v4-pro",
    "vendors": ["Lainnya", "Anthropic", "DeepSeek", "Google", "Zhipu AI",
                "OpenAI", "Tencent", "Moonshot", "MiniMax"]
  },
  "cached": false
}
```

### Ketahanan bila provider tidak dapat dihubungi

Gateway mengambil daftar model **live** dari provider, lalu menyimpannya di cache **60 detik**.
Bila provider gagal dihubungi:

- `/portal/models` menyajikan **snapshot lokal** (`src/lib/models.js`) dan menandai respons
  dengan `"stale": true`.
- `/v1/models` menyajikan 25 model aktif dari snapshot dengan `"gateway_fallback": true`.

Dengan begitu dokumentasi dan integrasi klien tetap berjalan meski provider bermasalah.

---

## 9. API untuk Pembeli

Base URL: `http://localhost:3000/v1` (produksi: `https://llm.thormarket.site/v1`) —
**OpenAI-compatible**, SDK resmi tinggal diganti `base_url`/`baseURL`.

Auth: header `Authorization: Bearer sk-thor-xxx`

### 9.1 `POST /v1/chat/completions`

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-thor-xxxxxxxx" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Halo, apa kabar?"}]
  }'
```

Seluruh field payload diteruskan **utuh** ke provider, jadi semua parameter OpenAI
(`temperature`, `max_tokens`, `tools`, `response_format`, dll.) didukung.

Contoh streaming:

```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-thor-xxxxxxxx" \
  -d '{"model": "deepseek-v4-pro", "stream": true,
       "messages": [{"role": "user", "content": "Hai"}]}'
```

Contoh SDK Python:

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

### 9.2 `GET /v1/models`

Daftar model dari provider (butuh Sub-API Key). Bila provider offline, otomatis memakai snapshot.

### 9.3 Format respons

Standar OpenAI: `choices[].message.content`, `usage.total_tokens`. Setiap token terpakai
otomatis dipotong dari kuota member.

### 9.4 Kode error

| HTTP | Situasi | `code` di body |
| --- | --- | --- |
| 400 | Body bukan JSON valid / field kurang | `invalid_request_error` |
| 401 | Header hilang / key tidak ditemukan | `missing_api_key`, `invalid_api_key` |
| 403 | Key dinonaktifkan admin | `key_disabled` |
| 403 | Kuota habis (`tokens_used >= limit`) | `quota_exceeded` |
| 4xx/5xx | Error dari provider (diteruskan apa adanya) | format asli provider |
| 503 | Mengantre melebihi 60 detik | `queue_timeout` |
| 504 | Provider tidak merespons tepat waktu | `upstream_timeout` |

Contoh body error:

```json
{ "error": { "message": "Kuota token Anda sudah habis (terpakai 1397 dari 1000). Silakan top up.",
             "type": "insufficient_quota", "code": "quota_exceeded" } }
```

---

## 10. REST API Admin

Untuk integrasi programatik / CLI. Auth: `Authorization: Bearer <ADMIN_API_KEY>`

| Metode | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/admin/keys` | Daftar semua key + sisa kuota |
| GET | `/admin/keys/:apiKey` | Detail satu key |
| PATCH | `/admin/keys/:apiKey` | Ubah `is_active` dan/atau `token_limit` |
| DELETE | `/admin/keys/:apiKey` | Hapus key permanen |
| GET | `/admin/usage` | Ringkasan pemakaian semua key |

```bash
# Daftar semua key
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/keys

# Detail satu key
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/keys/sk-thor-xxxx

# Blokir key
curl -X PATCH -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" -d '{"is_active": false}' \
  http://localhost:3000/admin/keys/sk-thor-xxxx

# Top-up (ubah limit langsung)
curl -X PATCH -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" -d '{"token_limit": 2000000}' \
  http://localhost:3000/admin/keys/sk-thor-xxxx

# Hapus key
curl -X DELETE -H "Authorization: Bearer $ADMIN_API_KEY" \
  http://localhost:3000/admin/keys/sk-thor-xxxx

# Ringkasan pemakaian
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:3000/admin/usage
```

Respons `/admin/usage`:

```json
{ "data": { "total_keys": 5, "active_keys": 4,
            "total_token_limit": 5000000, "total_tokens_used": 1001107 } }
```

---

## 11. API Internal Panel Web

Endpoint ini dipakai oleh halaman `/admin` dan `/portal` di belakang layar. **Berbeda** dari
`/admin/*` (yang pakai Bearer) — di sini otentikasi memakai **cookie sesi**.

### Endpoint publik (tanpa login)

| Metode | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/portal/models` | Daftar model (dukung `?all=1`, `?vendor=X`) |
| GET | `/health` | Status gateway + panjang antrean |
| GET | `/api/info` | Info layanan + daftar endpoint |

### Sesi Admin (`/portal/admin/*`)

| Metode | Endpoint | Body | Keterangan |
| --- | --- | --- | --- |
| POST | `/portal/admin/login` | `{ "password": "..." }` | Login → set cookie admin (12 jam) |
| POST | `/portal/admin/logout` | — | Hapus sesi & cookie |
| GET | `/portal/admin/me` | — | Cek sesi aktif |
| GET | `/portal/admin/keys` | — | Daftar semua key |
| POST | `/portal/admin/keys` | `{ "user_name", "token_limit" }` | Terbitkan key baru |
| PATCH | `/portal/admin/keys/:apiKey` | `{ "is_active"?, "token_limit"? }` | Ubah key |
| DELETE | `/portal/admin/keys/:apiKey` | — | Hapus key |
| GET | `/portal/admin/usage` | — | Ringkasan pemakaian |

### Sesi Member (`/portal/member/*`)

| Metode | Endpoint | Body | Keterangan |
| --- | --- | --- | --- |
| POST | `/portal/member/login` | `{ "api_key": "sk-thor-..." }` | Login → set cookie member (7 hari) |
| POST | `/portal/member/logout` | — | Hapus sesi & cookie |
| GET | `/portal/member/me` | — | Data member + kuota (auth via cookie) |

Contoh alur login member:

```bash
# 1. Login, simpan cookie
curl -c cookies.txt -X POST http://localhost:3000/portal/member/login \
  -H "Content-Type: application/json" -d '{"api_key":"sk-thor-xxxx"}'

# 2. Ambil data member
curl -b cookies.txt http://localhost:3000/portal/member/me
```

---

## 12. Rate Limiting & Antrean

Konfigurasi Bottleneck (`src/services/limiter.js`):

| Parameter | Nilai | Arti |
| --- | --- | --- |
| `reservoir` | 25 | Kapasitas 25 request |
| `reservoirRefreshInterval` | 60.000 ms | Di-reset jadi 25 setiap 60 detik |
| `maxConcurrent` | 3 | Maks 3 request paralel ke provider |
| Timeout antrean | 60.000 ms | Yang masih mengantre → HTTP 503 `queue_timeout` |
| `UPSTREAM_TIMEOUT_MS` | 120.000 ms | Request menggantung ke provider dibatalkan |

- Limit provider (mis. 30 RPM) → gateway hanya mengirim **maks 25 RPM** (buffer 5 request).
- Request berlebih **mengantre (FIFO)**, bukan langsung ditolak — pembeli dilayani begitu giliran
  tiba, selama menunggu ≤ 60 detik.
- Jika provider membalas `429`, gateway menambah *penalty* ke antrean.

**Penting:** limiter berjalan **per proses**. Bila menjalankan banyak instance paralel, gunakan
mode cluster Redis dari Bottleneck atau tetap satu proses.

Monitoring antrean: `GET /health` → `{ "status": "ok", "queue": { "running": …, "queued": 0 } }`

---

## 13. Perhitungan Token & Multiplier

### Cara token dihitung

Rumus resmi: **`(prompt_tokens + completion_tokens) × multiplier`**, hasilnya dibulatkan lalu
dikurangi dari kuota.

Contoh: 800 prompt + 1.200 completion pada model `1.5×` → `(800 + 1200) × 1.5 = 3.000` token
dipotong dari kuota.

- **Non-stream**: `usage.total_tokens` (fallback `prompt_tokens + completion_tokens`) langsung
  ditambahkan ke `tokens_used`, lalu respons diteruskan utuh.
- **Streaming**: gateway mem-"tap" chunk SSE; bila chunk terakhir membawa `usage`, token dihitung.
  Agar pasti selalu ada, set `INJECT_STREAM_USAGE=true`.
- **Gagal**: request yang gagal sebelum provider menjawab (timeout antrean, provider error)
  **tidak dihitung**.

### Arti multiplier

`multiplier` = pengali konsumsi token terhadap kuota. Default `1×` artinya 1:1. Model berat
seperti `claude-opus-5-5` (32×) atau `gemini-4-argon` (60×) memakan kuota jauh lebih cepat.

Nilai multiplier tiap model **diambil dari situs resmi** dan tersimpan di `src/lib/models.js`.
Lihat tabelnya di halaman `/docs` pada kolom **Multiplier**.

---

## 14. Keamanan

| Aspek | Implementasi |
| --- | --- |
| Sub-API Key | Format `sk-thor-<48 hex>` dari `crypto.randomBytes(24)`. Auth mencocokkan string apa adanya, jadi key dengan prefix lain (mis. dibuat manual) tetap valid selama terdaftar di tabel `api_keys` |
| Master key | Hanya ada di server (`.env`), **tidak pernah** dikirim ke browser |
| Cookie sesi | `HttpOnly`, `SameSite=Lax`, `Secure` (otomatis saat HTTPS), isi = token acak 32 byte |
| Data di cookie | **Hanya token sesi** — API key member & password admin tidak pernah disimpan di cookie |
| Password admin | Dibandingkan **timing-safe** (hash SHA-256 + `timingSafeEqual`) |
| TTL sesi | Admin **12 jam**, member **7 hari** (bisa dicabut kapan saja di Redis/SQLite) |
| Isolasi member | Member hanya bisa melihat data miliknya sendiri (`/portal/member/me`) |
| Revoke | Logout menghapus sesi di database, bukan hanya cookie |

**Jangan pernah:**
1. Meng-commit `.env` ke Git (sudah di `.gitignore`).
2. Mengekspos `MASTER_API_KEY` atau `ADMIN_PASSWORD` ke pembeli.
3. Menjalankan tanpa HTTPS di produksi (cookie `Secure` butuh HTTPS).

---

## 15. Uji Lokal (Mock Provider)

Cara menguji tanpa menghabiskan kredit provider:

```bash
# Terminal 1 — provider tiruan (OpenAI-compatible) di port 9999
npm run mock

# Terminal 2 — gateway diarahkan ke mock (port terpisah bila produksi sedang jalan)
PORT=3999 TARGET_API_BASE_URL=http://localhost:9999/v1 \
  MASTER_API_KEY=sk-master-lokal ADMIN_API_KEY=admin-lokal npm start

# Terminal 3 — terbitkan key lalu uji
node generate-key.js "Tester" 1000000
curl http://localhost:3999/v1/chat/completions \
  -H "Authorization: Bearer sk-thor-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"Halo"}]}'
```

> **PENTING di server produksi:** **jangan** menjalankan `node src/server.js` di port yang sama
> (3000) saat service produksi aktif — akan terjadi `EADDRINUSE` dan service produksi
> crash-restart berulang. Selalu pakai `PORT` berbeda untuk uji, atau `systemctl stop llm-gateway`
> dulu. Lihat [Deployment](#16-deployment-produksi).

---

## 16. Deployment Produksi

Gateway ini **sudah live** di <https://llm.thormarket.site>. Berikut konfigurasi yang dipakai.

### 16.1 Ringkasan arsitektur produksi

```
Internet ──HTTPS──> nginx (443) ──proxy_pass──> 127.0.0.1:3000 (systemd: llm-gateway)
```

| Komponen | Detail |
| --- | --- |
| Domain | `llm.thormarket.site` |
| Reverse proxy | **nginx 1.28** — config `/etc/nginx/sites-available/llm-gateway` |
| HTTPS | **Certbot / Let's Encrypt** (auto-renew) |
| Process manager | **systemd** — `llm-gateway.service` |
| Service file | `/etc/systemd/system/llm-gateway.service` |
| Working dir | `/root/home/projects/llm-gateway-express` |
| Port internal | `3000` (hanya lokal; tidak diekspos langsung) |

### 16.2 Konfigurasi nginx

Poin penting pada `/etc/nginx/sites-available/llm-gateway`:

```nginx
server {
    server_name llm.thormarket.site;
    client_max_body_size 8m;          # prompt panjang

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WAJIB untuk streaming SSE (chat streaming)
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    listen 443 ssl;   # dikelola Certbot
    # ssl_certificate ... ; ssl_certificate_key ... ;
}
```

> `proxy_buffering off` **wajib** — tanpa ini, respons streaming SSE akan tertahan
> dan tidak terasa real-time bagi klien.

### 16.3 Unit systemd

`/etc/systemd/system/llm-gateway.service`:

```ini
[Unit]
Description=LLM Proxy Gateway (Express.js + SQLite + Bottleneck)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/home/projects/llm-gateway-express
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=llm-gateway
LimitNOFILE=65535
KillSignal=SIGTERM
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
```

### 16.4 Perintah operasional harian

| Tugas | Perintah |
| --- | --- |
| Lihat status | `systemctl status llm-gateway` |
| Lihat log live | `journalctl -u llm-gateway -f` |
| Log terakhir | `journalctl -u llm-gateway -n 50` |
| Log hari ini | `journalctl -u llm-gateway --since today` |
| Hanya error | `journalctl -u llm-gateway -p err` |
| **Restart setelah update kode** | `systemctl restart llm-gateway` |
| Stop / start | `systemctl stop llm-gateway` / `systemctl start llm-gateway` |
| Cek auto-start | `systemctl is-enabled llm-gateway` |
| Reset counter restart | `systemctl reset-failed llm-gateway` |
| Uji config nginx | `nginx -t` |
| Reload nginx | `systemctl reload nginx` |

> **Update kode:** cukup `git pull` (atau edit file) lalu `systemctl restart llm-gateway`.
> **Jangan** jalankan `node src/server.js` manual di port 3000.

### 16.5 Deploy dari nol (server baru)

```bash
# 1. Siapkan aplikasi
cd /root/home/projects/llm-gateway-express
npm install
cp .env.example .env && nano .env     # isi MASTER_API_KEY, ADMIN_PASSWORD, dll.

# 2. Pasang systemd service
sudo cp deploy/llm-gateway.service /etc/systemd/system/   # atau buat manual (lihat 16.3)
sudo systemctl daemon-reload
sudo systemctl enable --now llm-gateway

# 3. Pasang nginx + HTTPS
sudo cp deploy/nginx-llm-gateway.conf /etc/nginx/sites-available/llm-gateway
sudo ln -s /etc/nginx/sites-available/llm-gateway /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d llm.thormarket.site

# 4. Verifikasi
curl https://llm.thormarket.site/health
```

---

## 17. Backup & Pemeliharaan

### Backup database (WAJIB)

Seluruh data kuota pembeli ada di `data/gateway.db` — **wajib dibackup berkala**:

```bash
# Backup aman (SQLite .backup, tidak korup meski server jalan)
sqlite3 data/gateway.db ".backup /backup/gateway-$(date +%F).db"

# Alternatif: salin file (matikan service dulu agar konsisten)
systemctl stop llm-gateway
cp data/gateway.db /backup/gateway-$(date +%F).db
systemctl start llm-gateway
```

### Restore

```bash
systemctl stop llm-gateway
cp /backup/gateway-2026-11-08.db data/gateway.db
systemctl start llm-gateway
```

### Pemeliharaan rutin

| Frekuensi | Tindakan |
| --- | --- |
| Harian | Cek `journalctl -u llm-gateway -p err` untuk error |
| Mingguan | Backup `data/gateway.db` |
| Bulanan | Sinkronkan daftar model bila provider menambah/mengubah model |
| Bulanan | Cek `du -sh data/` — pastikan DB tidak membengkak aneh |

---

## 18. Pemecahan Masalah

| Gejala | Penyebab | Solusi |
| --- | --- | --- |
| `EADDRINUSE: address already in use :::3000` | Port 3000 dipakai proses lain (sering: server manual tertinggal) | `ss -ltnp \| grep :3000` → kill PID selain service; atau `systemctl restart llm-gateway` |
| Service crash-restart berulang | Sama seperti di atas, atau `.env` salah | `journalctl -u llm-gateway -n 50` untuk lihat error asli |
| `[FATAL] MASTER_API_KEY belum diisi` | `.env` belum diisi | Isi `MASTER_API_KEY` lalu restart |
| Semua request `/admin/*` ditolak 401 | `ADMIN_API_KEY` kosong | Isi di `.env`, restart service |
| Panel admin tidak bisa login | `ADMIN_PASSWORD` kosong/salah | Set `ADMIN_PASSWORD`, restart service |
| Streaming tidak real-time | `proxy_buffering` masih on | Set `proxy_buffering off` di nginx, reload |
| Daftar model kosong/error | Provider tidak bisa dihubungi | Normal — gateway otomatis pakai snapshot (`"stale": true`) |
| Token tidak terhitung saat streaming | Provider tidak kirim `usage` di chunk akhir | Set `INJECT_STREAM_USAGE=true` |
| `/portal/models` lambat | Cache 60 dtk habis, fetch ulang ke provider | Wajar; atau tambah `MODELS_TTL_MS` bila perlu |

### Cek cepat kesehatan sistem

```bash
# 1. Service hidup?
systemctl is-active llm-gateway

# 2. Port benar & hanya satu proses?
ss -ltnp | grep :3000

# 3. Endpoint merespons?
curl -s https://llm.thormarket.site/health

# 4. nginx OK?
nginx -t
```

---

## Lisensi

MIT — bebas dipakai, diubah, dan didistribusikan.
