/**
 * db.js — Koneksi SQLite (better-sqlite3) + skema tabel API Key.
 *
 * Dipakai bersama oleh server (src/server.js) dan CLI (generate-key.js /
 * manage-keys.js). Mode WAL membuat akses multi-proses tetap aman & cepat.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "gateway.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key      TEXT    NOT NULL UNIQUE,
    user_name    TEXT    NOT NULL,
    token_limit  INTEGER NOT NULL,
    tokens_used  INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys (api_key);

  -- Tabel sesi login (admin & member) — dipakai panel web
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    role        TEXT    NOT NULL,               -- 'admin' | 'member'
    user_name   TEXT,                           -- untuk member (nama pembeli)
    api_key     TEXT,                           -- untuk member (API key miliknya)
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    expires_at  INTEGER NOT NULL                -- epoch ms
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  -- Log pemakaian per request (untuk grafik & riwayat di dashboard member)
  CREATE TABLE IF NOT EXISTS usage_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id    INTEGER NOT NULL,           -- FK logis ke api_keys.id
    model         TEXT,                        -- model yang dipakai
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens  INTEGER NOT NULL DEFAULT 0,  -- token efektif yang dipotong dari kuota
    status        TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_key_time ON usage_logs (api_key_id, created_at);

  -- Pembatas brute-force login yang PERSISTEN (bertahan setelah restart).
  -- kunci = "label:ip" (mis. "admin:1.2.3.4"), terpisah per tipe login.
  CREATE TABLE IF NOT EXISTS login_attempts (
    kunci         TEXT    PRIMARY KEY,
    count_gagal   INTEGER NOT NULL DEFAULT 0,   -- jumlah percobaan gagal
    first_at      INTEGER NOT NULL,             -- awal jendela (epoch ms)
    blocked_until INTEGER NOT NULL DEFAULT 0,   -- diblokir sampai (epoch ms), 0 = tidak
    last_at       INTEGER NOT NULL              -- percobaan terakhir (epoch ms)
  );

  CREATE INDEX IF NOT EXISTS idx_login_attempts_blocked ON login_attempts (blocked_until);

  -- =============================================================
  -- TOKO PEMBELIAN OTOMATIS (QRIS DANA)
  -- =============================================================

  -- Pesanan pembelian: key API baru ATAU top-up kuota key lama.
  -- Alur: PENDING → (webhook DANA cocok) → PAID → fulfillment → COMPLETED.
  -- Kode unik 1-999 ditambahkan ke nominal agar webhook bisa mencocokkan
  -- pembayaran secara EKSAK per pesanan (sama seperti Thor-market).
  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code      TEXT    NOT NULL UNIQUE,            -- THX-XXXXXXXX
    access_token    TEXT    NOT NULL,                   -- kunci akses halaman status (anti begas)
    mode            TEXT    NOT NULL,                   -- 'key_baru' | 'topup'
    package_id      TEXT    NOT NULL,                   -- '10m' … '500m'
    quota_tokens    INTEGER NOT NULL,                   -- token yang dibeli
    user_name       TEXT    NOT NULL,                   -- nama pembeli
    email           TEXT    NOT NULL DEFAULT '',        -- tujuan struk + key (opsional)
    whatsapp        TEXT    NOT NULL DEFAULT '',        -- tujuan notifikasi WA (opsional)
    target_api_key  TEXT    NOT NULL DEFAULT '',        -- mode topup: key yang ditambah
    api_key_issued  TEXT    NOT NULL DEFAULT '',        -- mode key_baru: key yang diterbitkan saat PAID
    base_amount     INTEGER NOT NULL,                   -- harga paket (sebelum kode unik)
    unique_code     INTEGER NOT NULL DEFAULT 0,         -- 1-999
    amount_to_pay   INTEGER NOT NULL,                   -- base_amount + unique_code
    payment_method  TEXT    NOT NULL DEFAULT 'QRIS DANA',
    status          TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING|PAID|COMPLETED|CANCELLED
    note            TEXT    NOT NULL DEFAULT '',        -- catatan fulfillment/admin
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    paid_at         TEXT,
    completed_at    TEXT,
    expires_at      INTEGER NOT NULL                    -- epoch ms (masa berlaku tagihan)
  );

  -- Pencocokan webhook selalu menyaring by amount_to_pay → indeks wajib
  CREATE INDEX IF NOT EXISTS idx_orders_amount ON orders (amount_to_pay);
  CREATE INDEX IF NOT EXISTS idx_orders_status_exp ON orders (status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);

  -- Riwayat webhook pembayaran (audit): setiap notifikasi DANA yang masuk
  -- dicatat beserta hasil pencocokannya agar admin bisa menelusuri.
  CREATE TABLE IF NOT EXISTS payment_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT    NOT NULL DEFAULT 'dana',
    raw_text   TEXT    NOT NULL DEFAULT '',
    amount     INTEGER NOT NULL DEFAULT 0,
    matched    INTEGER NOT NULL DEFAULT 0,              -- boolean 0/1
    order_code TEXT    NOT NULL DEFAULT '',
    note       TEXT    NOT NULL DEFAULT '',              -- 'secret-invalid ip=…', 'kurang-biaya-admin:…'
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_payment_events_time ON payment_events (created_at);

  -- Konfigurasi toko (JSON per kunci): 'qris' {enabled,static,secret},
  -- 'notify' {fonnteToken, adminWa, resendKey, emailFrom, ...}.
  -- Disimpan di DB (bukan .env) agar bisa diubah dari panel admin tanpa deploy.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

module.exports = db;
