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
`);

module.exports = db;
