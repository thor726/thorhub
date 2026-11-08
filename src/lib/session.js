/**
 * session.js — Manajemen sesi login (admin & member) berbasis SQLite.
 *
 * Sesi disimpan di tabel `sessions` dengan token acak 32 byte (64 hex).
 * Cookie yang dikirim ke browser: HttpOnly, SameSite=Lax, Path=/.
 * Verifikasi waktu-konstan tidak diperlukan di sini karena pencarian
 * dilakukan lewat PRIMARY KEY (nilai token acak, bukan rahasia yang bocor).
 *
 * KEBIJAKAN KEDALUWARSA (BERLAKU SAMA UNTUK ADMIN & MEMBER):
 *   Masa berlaku sesi = tepat 2 jam (7200000 ms).
 *   Setelah lewat 2 jam, getSession() otomatis menghapus baris sesi dari
 *   database dan mengembalikan null, sehingga middleware otentikasi
 *   (requireAdminSession / requireMemberSession) membalas HTTP 401 dan
 *   frontend mengarahkan pengguna kembali ke halaman Login.
 *   Cookie juga dibatasi lewat Max-Age = 7200000 detik-ms yang sama,
 *   sehingga browser berhenti mengirim cookie basi.
 */
const crypto = require("crypto");
const db = require("../db");

// Nama cookie
const ADMIN_COOKIE = "gw_admin";
const MEMBER_COOKIE = "gw_member";

// Masa berlaku sesi: tepat 2 jam (7200000 ms).
// Dipakai seragam oleh admin maupun member — tidak ada pengecualian role.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 7200000 ms = 2 jam
const ADMIN_TTL_MS = SESSION_TTL_MS;
const MEMBER_TTL_MS = SESSION_TTL_MS;

// ---- Prepared statements ----
const stmtInsert = db.prepare(
  "INSERT INTO sessions (token, role, user_name, api_key, expires_at) VALUES (?, ?, ?, ?, ?)"
);
const stmtGet = db.prepare("SELECT * FROM sessions WHERE token = ?");
const stmtDelete = db.prepare("DELETE FROM sessions WHERE token = ?");
const stmtDeleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

/** Buat token sesi baru dan simpan ke database. */
function createSession({ role, userName = null, apiKey = null, ttlMs }) {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : SESSION_TTL_MS;
  const expiresAt = Date.now() + ttl;
  stmtInsert.run(token, role, userName, apiKey, expiresAt);
  return { token, expiresAt, ttlMs: ttl };
}

/** Ambil sesi valid (belum kedaluwarsa). Kembalikan null bila tidak ada/expired. */
function getSession(token) {
  if (!token) return null;
  const row = stmtGet.get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    // Sesi sudah lewat 2 jam → hapus otomatis dari database.
    stmtDelete.run(token);
    return null;
  }
  return row;
}

/** Hapus sesi (logout). */
function destroySession(token) {
  if (token) stmtDelete.run(token);
}

/** Bersihkan sesi kedaluwarsa (boleh dipanggil berkala). */
function cleanupExpired() {
  return stmtDeleteExpired.run(Date.now()).changes;
}

/** Parse cookie mentah dari header Cookie menjadi objek sederhana. */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** Bangun header Set-Cookie. `secure` true bila diakses via HTTPS. */
function buildSetCookie(name, value, maxAgeMs, secure = false) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Bangun header hapus cookie (logout). */
function buildClearCookie(name) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Deteksi HTTPS dari header (di belakang proxy nginx: X-Forwarded-Proto). */
function isSecureRequest(req) {
  return req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

module.exports = {
  ADMIN_COOKIE,
  MEMBER_COOKIE,
  SESSION_TTL_MS,
  ADMIN_TTL_MS,
  MEMBER_TTL_MS,
  createSession,
  getSession,
  destroySession,
  cleanupExpired,
  parseCookies,
  buildSetCookie,
  buildClearCookie,
  isSecureRequest,
};
