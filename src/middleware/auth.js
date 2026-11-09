/**
 * auth.js — Middleware otentikasi API Key + validasi kuota & masa aktif.
 *
 * Urutan pemeriksaan (sesuai spesifikasi):
 *   1. 401 → header Authorization hilang / format salah / key tidak ditemukan
 *   2. 403 → key dinonaktifkan (is_active = false)
 *   3. 403 → masa aktif habis (expires_at terlewati — default 25 hari)
 *   4. 403 → kuota habis (tokens_used >= token_limit)
 *
 * Format error meniru gaya OpenAI agar SDK/_client pembeli tetap kompatibel.
 */
const db = require("../db");
const masaAktif = require("../lib/masa-aktif");

const stmtGetByKey = db.prepare("SELECT * FROM api_keys WHERE api_key = ?");

function authenticateSubKey(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  // Dukung dua gaya header: OpenAI (Authorization: Bearer) dan
  // Anthropic (x-api-key) — agar klien Claude/Anthropic juga bisa langsung dipakai.
  const dariApiKey = (req.headers["x-api-key"] || "").trim();
  const apiKey = match ? match[1].trim() : dariApiKey || null;

  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: "Header Authorization wajib diisi dengan format: Bearer sk-thor-xxx (atau x-api-key)",
        type: "invalid_request_error",
        code: "missing_api_key",
      },
    });
  }

  const row = stmtGetByKey.get(apiKey);

  if (!row) {
    return res.status(401).json({
      error: {
        message: "API Key tidak ditemukan atau tidak valid.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  }

  if (!row.is_active) {
    return res.status(403).json({
      error: {
        message: "API Key Anda sedang dinonaktifkan. Silakan hubungi admin.",
        type: "insufficient_quota",
        code: "key_disabled",
      },
    });
  }

  // 3. Masa aktif habis (25 hari sejak terbit / top-up terakhir).
  //    Tetap diarahkan ke portal agar member tahu cara memperpanjang.
  const expMs = masaAktif.expiryMs(row.expires_at);
  if (expMs != null && Date.now() >= expMs) {
    return res.status(403).json({
      error: {
        message: `Masa aktif API Key Anda berakhir pada ${masaAktif.formatWaktuIndo(expMs)}. Lakukan top-up untuk menambah kuota & memperpanjang masa aktif ${masaAktif.MASA_AKTIF_HARI} hari.`,
        type: "insufficient_quota",
        code: "key_expired",
      },
    });
  }

  if (row.tokens_used >= row.token_limit) {
    return res.status(403).json({
      error: {
        message: `Kuota token Anda sudah habis (terpakai ${row.tokens_used} dari ${row.token_limit}). Silakan top up.`,
        type: "insufficient_quota",
        code: "quota_exceeded",
      },
    });
  }

  // Simpan data key untuk dipakai handler berikutnya
  req.subKey = row;
  req.remainingQuota = row.token_limit - row.tokens_used;
  next();
}

module.exports = { authenticateSubKey };
