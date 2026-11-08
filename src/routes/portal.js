/**
 * portal.js — Route website (bukan API OpenAI-compatible).
 *
 * Menangani login/logout panel admin & portal member, serta info sesi.
 * Semua endpoint di sini memakai cookie sesi HttpOnly (lihat src/lib/session.js).
 *
 *   POST /portal/admin/login    { password }   → set cookie admin
 *   POST /portal/admin/logout                  → hapus cookie admin
 *   GET  /portal/admin/me                       → info sesi admin
 *
 *   POST /portal/member/login   { api_key }    → set cookie member
 *   POST /portal/member/logout                 → hapus cookie member
 *   GET  /portal/member/me                      → info sesi member + kuota
 */
const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const db = require("../db");
const session = require("../lib/session");
const models = require("../lib/models");
const bruteforce = require("../lib/bruteforce");
const DEFAULT_MODEL = models.DEFAULT_MODEL;

// Cache sederhana daftar model (hindari spam ke provider tiap request)
let modelsCache = { at: 0, data: null };
const MODELS_TTL_MS = 60 * 1000; // 60 detik

const router = express.Router();

/** Bandingkan dua string waktu-konstan. */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Middleware: wajib sesi admin. */
function requireAdminSession(req, res, next) {
  const token = session.parseCookies(req.headers.cookie)[session.ADMIN_COOKIE];
  const s = session.getSession(token);
  if (!s || s.role !== "admin") {
    return res.status(401).json({ error: { message: "Sesi admin tidak valid. Silakan login.", code: "unauthorized" } });
  }
  req.session = s;
  next();
}

/** Middleware: wajib sesi member. */
function requireMemberSession(req, res, next) {
  const token = session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE];
  const s = session.getSession(token);
  if (!s || s.role !== "member") {
    return res.status(401).json({ error: { message: "Sesi member tidak valid. Silakan login.", code: "unauthorized" } });
  }
  req.session = s;
  next();
}

// ---------------------------------------------------------------
// DAFTAR MODEL (publik) — dokumen publik, tanpa auth
// ---------------------------------------------------------------
router.get("/models", async (req, res) => {
  // Parameter opsional: ?all=1 (tampilkan juga yang nonaktif), ?vendor=DeepSeek
  const showAll = req.query.all === "1" || req.query.all === "true";
  const vendorFilter = (req.query.vendor || "").toString().trim().toLowerCase();

  // Pakai cache bila masih segar
  if (modelsCache.data && Date.now() - modelsCache.at < MODELS_TTL_MS) {
    return res.json(buildPayload(modelsCache.data, showAll, vendorFilter, { cached: true }));
  }

  let list = null;
  let stale = false;
  try {
    const url = `${config.targetBaseUrl.replace(/\/$/, "")}/models`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${config.masterApiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Provider membalas HTTP ${r.status}`);
    const j = await r.json();
    list = models.normalizeProviderModels(j && j.data);
    modelsCache = { at: Date.now(), data: list };
  } catch (e) {
    // Fallback: pakai snapshot lokal dari docs resmi, atau cache lama bila ada
    list = modelsCache.data || models.MODELS;
    stale = true;
  }

  res.json(buildPayload(list, showAll, vendorFilter, { cached: !!modelsCache.data && stale, stale }));
});

/** Susun respons daftar model sesuai filter (aktif saja / semua, per vendor). */
function buildPayload(list, showAll, vendorFilter, extra) {
  const filtered = list
    .filter((m) => showAll || m.active)
    .filter((m) => !vendorFilter || String(m.vendor).toLowerCase() === vendorFilter)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));
  return {
    data: filtered,
    meta: {
      total: list.length,
      active: list.filter((m) => m.active).length,
      returned: filtered.length,
      vendors: models.VENDORS,
      default_model: DEFAULT_MODEL,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------
// ADMIN — login / logout / me
// ---------------------------------------------------------------
router.post("/admin/login", bruteforce.guard("admin"), async (req, res) => {
  if (!config.adminPassword) {
    return res.status(503).json({
      error: { message: "ADMIN_PASSWORD belum diatur di server.", code: "admin_not_configured" },
    });
  }
  const password = (req.body && (req.body.password || req.body.admin_password)) || "";
  if (!password) {
    return res.status(400).json({ error: { message: 'Field "password" wajib diisi.', code: "invalid_request" } });
  }
  if (!safeEqual(password, config.adminPassword)) {
    // Catat percobaan gagal; beri jeda kecil untuk memperlambat serangan otomatis.
    const diblokir = bruteforce.catatGagal(req, "admin");
    console.warn(`[SECURITY] Login admin GAGAL dari IP ${(req.ip || "").replace(/^::ffff:/, "")}${diblokir ? " → IP DIBLOKIR sementara" : ""}`);
    await new Promise((r) => setTimeout(r, bruteforce.FAIL_DELAY_MS));
    if (diblokir) {
      return res.status(429).json({ error: { message: "Terlalu banyak percobaan gagal. Coba lagi nanti.", code: "too_many_attempts" } });
    }
    return res.status(401).json({ error: { message: "Password admin salah.", code: "unauthorized" } });
  }
  // Login sukses → bersihkan penghitung brute-force untuk IP ini.
  bruteforce.catatSukses(req, "admin");
  const { token } = session.createSession({ role: "admin", ttlMs: session.ADMIN_TTL_MS });
  res.setHeader("Set-Cookie", session.buildSetCookie(session.ADMIN_COOKIE, token, session.ADMIN_TTL_MS, session.isSecureRequest(req)));
  res.json({ data: { message: "Login admin berhasil.", role: "admin" } });
});

router.post("/admin/logout", (req, res) => {
  const token = session.parseCookies(req.headers.cookie)[session.ADMIN_COOKIE];
  session.destroySession(token);
  res.setHeader("Set-Cookie", session.buildClearCookie(session.ADMIN_COOKIE));
  res.json({ data: { message: "Logout berhasil." } });
});

router.get("/admin/me", requireAdminSession, (req, res) => {
  // expires_at (epoch ms) dikirim ke frontend agar UI bisa menjadwalkan
  // auto-logout tepat saat sesi 2 jam habis.
  res.json({ data: { role: "admin", expires_at: req.session.expires_at, ttl_ms: session.SESSION_TTL_MS } });
});

// ---- Kelola key via sesi panel (tanpa mengekspos ADMIN_API_KEY ke browser) ----
const LIST_COLS = "id, api_key, user_name, token_limit, tokens_used, is_active, created_at";

function decorate(row) {
  if (!row) return row;
  return { ...row, is_active: !!row.is_active, tokens_remaining: Math.max(0, row.token_limit - row.tokens_used) };
}

// GET /portal/admin/keys — daftar semua key
router.get("/admin/keys", requireAdminSession, (_req, res) => {
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM api_keys ORDER BY id DESC`).all();
  res.json({ data: rows.map(decorate) });
});

// GET /portal/admin/usage — ringkasan total
router.get("/admin/usage", requireAdminSession, (_req, res) => {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS total_keys,
              COALESCE(SUM(is_active), 0) AS active_keys,
              COALESCE(SUM(token_limit), 0) AS total_token_limit,
              COALESCE(SUM(tokens_used), 0) AS total_tokens_used
       FROM api_keys`
    )
    .get();
  res.json({ data: agg });
});

// POST /portal/admin/keys — terbitkan key baru { user_name, token_limit }
router.post("/admin/keys", requireAdminSession, (req, res) => {
  const { user_name, token_limit } = req.body || {};
  if (!user_name || typeof user_name !== "string" || !user_name.trim()) {
    return res.status(400).json({ error: { message: "Field user_name wajib diisi.", code: "invalid_request" } });
  }
  if (!Number.isInteger(token_limit) || token_limit <= 0) {
    return res.status(400).json({ error: { message: "Field token_limit harus bilangan bulat positif.", code: "invalid_request" } });
  }
  const apiKey = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
  const info = db
    .prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)")
    .run(apiKey, user_name.trim(), token_limit);
  const row = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ data: decorate(row) });
});

// PATCH /portal/admin/keys/:apiKey — ubah is_active dan/atau token_limit
router.patch("/admin/keys/:apiKey", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const { is_active, token_limit } = req.body || {};
  if (typeof is_active === "undefined" && typeof token_limit === "undefined") {
    return res.status(400).json({ error: { message: "Kirim is_active (boolean) atau token_limit (integer).", code: "invalid_request" } });
  }
  if (typeof is_active !== "undefined" && typeof is_active !== "boolean") {
    return res.status(400).json({ error: { message: "is_active harus boolean.", code: "invalid_request" } });
  }
  if (typeof token_limit !== "undefined" && (!Number.isInteger(token_limit) || token_limit < 0)) {
    return res.status(400).json({ error: { message: "token_limit harus integer >= 0.", code: "invalid_request" } });
  }
  if (typeof is_active !== "undefined") db.prepare("UPDATE api_keys SET is_active = ? WHERE id = ?").run(is_active ? 1 : 0, key.id);
  if (typeof token_limit !== "undefined") db.prepare("UPDATE api_keys SET token_limit = ? WHERE id = ?").run(token_limit, key.id);

  const updated = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(key.id);
  res.json({ data: decorate(updated) });
});

// DELETE /portal/admin/keys/:apiKey — hapus permanen (beserta log pemakaiannya)
router.delete("/admin/keys/:apiKey", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT id FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  // Bersihkan log agar tidak menyisakan baris yatim (dijalankan dalam transaksi)
  const hapus = db.transaction((id) => {
    const log = db.prepare("DELETE FROM usage_logs WHERE api_key_id = ?").run(id);
    const kunci = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
    return { logs: log.changes, keys: kunci.changes };
  });
  const hasil = hapus(key.id);

  res.json({ data: { deleted: true, api_key: req.params.apiKey, logs_removed: hasil.logs } });
});

// POST /portal/admin/keys/:apiKey/reset — nol-kan pemakaian token (log tetap)
router.post("/admin/keys/:apiKey/reset", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const bersihLog = req.body && req.body.hapus_log === true;
  db.prepare("UPDATE api_keys SET tokens_used = 0 WHERE id = ?").run(key.id);
  if (bersihLog) db.prepare("DELETE FROM usage_logs WHERE api_key_id = ?").run(key.id);

  const updated = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(key.id);
  res.json({ data: { ...decorate(updated), logs_dihapus: bersihLog } });
});

// GET /portal/admin/keys/:apiKey/usage — rincian pemakaian satu key (per model)
router.get("/admin/keys/:apiKey/usage", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const byModel = db
    .prepare(
      `SELECT model, COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM usage_logs WHERE api_key_id = ?
       GROUP BY model ORDER BY total_tokens DESC LIMIT 20`
    )
    .all(key.id)
    .map((r) => ({ ...r, model: r.model || "(tidak diketahui)" }));

  const byDay = db
    .prepare(
      `SELECT substr(created_at,1,10) AS tanggal, COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs WHERE api_key_id = ? AND created_at >= date('now','-29 days')
       GROUP BY tanggal ORDER BY tanggal`
    )
    .all(key.id);

  const logs = db
    .prepare(
      `SELECT model, prompt_tokens, completion_tokens, total_tokens, status, created_at
       FROM usage_logs WHERE api_key_id = ? ORDER BY id DESC LIMIT 50`
    )
    .all(key.id)
    .map((l) => ({ ...l, model: l.model || "(tidak diketahui)" }));

  res.json({ data: { key: decorate(key), by_model: byModel, by_day: byDay, logs } });
});

// GET /portal/admin/activity — log aktivitas seluruh member (50 terbaru)
router.get("/admin/activity", requireAdminSession, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = db
    .prepare(
      `SELECT l.id, l.model, l.prompt_tokens, l.completion_tokens, l.total_tokens,
              l.status, l.created_at, k.user_name, k.api_key
       FROM usage_logs l
       LEFT JOIN api_keys k ON k.id = l.api_key_id
       ORDER BY l.id DESC LIMIT ?`
    )
    .all(limit);
  res.json({
    data: rows.map((r) => ({
      ...r,
      user_name: r.user_name || "(key dihapus)",
      api_key: r.api_key ? r.api_key.slice(0, 18) + "…" : "—",
      model: r.model || "(tidak diketahui)",
    })),
  });
});

// GET /portal/admin/models — katalog model + jumlah pemakaian (untuk admin)
router.get("/admin/models", requireAdminSession, (_req, res) => {
  const pakai = db
    .prepare(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs GROUP BY model`
    )
    .all();
  const peta = new Map(pakai.map((r) => [r.model, r]));
  res.json({
    data: models.MODELS.map((m) => {
      const p = peta.get(m.id) || { requests: 0, total_tokens: 0 };
      return { id: m.id, vendor: m.vendor, multiplier: m.multiplier, vision: !!m.vision, enabled: m.enabled !== false, ...p };
    }),
  });
});

// ---------------------------------------------------------------
// MEMBER — login / logout / me
// ---------------------------------------------------------------
router.post("/member/login", bruteforce.guard("member"), async (req, res) => {
  const apiKey = (req.body && req.body.api_key) || "";
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: { message: 'Field "api_key" wajib diisi.', code: "invalid_request" } });
  }
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey.trim());
  if (!row) {
    // Batasi juga tebak-tebakan API key (mencegah enumerasi key sk-thor-…).
    const diblokir = bruteforce.catatGagal(req, "member");
    console.warn(`[SECURITY] Login member GAGAL (key tak dikenal) dari IP ${(req.ip || "").replace(/^::ffff:/, "")}${diblokir ? " → IP DIBLOKIR sementara" : ""}`);
    await new Promise((r) => setTimeout(r, bruteforce.FAIL_DELAY_MS));
    if (diblokir) {
      return res.status(429).json({ error: { message: "Terlalu banyak percobaan gagal. Coba lagi nanti.", code: "too_many_attempts" } });
    }
    return res.status(401).json({ error: { message: "API Key tidak ditemukan.", code: "invalid_api_key" } });
  }
  bruteforce.catatSukses(req, "member");
  // Key nonaktif / kuota habis tetap boleh login agar member bisa melihat statusnya.
  const { token } = session.createSession({
    role: "member",
    userName: row.user_name,
    apiKey: row.api_key,
    ttlMs: session.MEMBER_TTL_MS,
  });
  res.setHeader("Set-Cookie", session.buildSetCookie(session.MEMBER_COOKIE, token, session.MEMBER_TTL_MS, session.isSecureRequest(req)));
  res.json({ data: { message: "Login berhasil.", user_name: row.user_name } });
});

router.post("/member/logout", (req, res) => {
  const token = session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE];
  session.destroySession(token);
  res.setHeader("Set-Cookie", session.buildClearCookie(session.MEMBER_COOKIE));
  res.json({ data: { message: "Logout berhasil." } });
});

router.get("/member/me", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }

  // Ringkasan tambahan dari log pemakaian (jumlah request & rincian token)
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM usage_logs WHERE api_key_id = ? AND status = 'ok'`
    )
    .get(row.id);

  res.json({
    data: {
      role: "member",
      expires_at: req.session.expires_at,
      ttl_ms: session.SESSION_TTL_MS,
      id: row.id,
      user_name: row.user_name,
      api_key: row.api_key,
      token_limit: row.token_limit,
      tokens_used: row.tokens_used,
      tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
      is_active: !!row.is_active,
      created_at: row.created_at,
      requests: agg.requests,
      prompt_tokens: agg.prompt_tokens,
      completion_tokens: agg.completion_tokens,
    },
  });
});

// GET /portal/member/usage — pemakaian per model, harian (30 hari), dan log terakhir
router.get("/member/usage", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }

  // Pemakaian per model (urut terbanyak). Multiplier diambil dari katalog model.
  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0)      AS total_tokens
       FROM usage_logs
       WHERE api_key_id = ? AND status = 'ok'
       GROUP BY model
       ORDER BY total_tokens DESC
       LIMIT 20`
    )
    .all(row.id)
    .map((r) => ({
      ...r,
      model: r.model || "(tidak diketahui)",
      multiplier: models.multiplierOf(r.model),
    }));

  // Pemakaian harian 30 hari terakhir (termasuk hari tanpa pemakaian = 0)
  const hari = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS tanggal,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM usage_logs
       WHERE api_key_id = ? AND status = 'ok'
         AND created_at >= date('now', '-29 days')
       GROUP BY tanggal`
    )
    .all(row.id);
  const petaHari = new Map(hari.map((h) => [h.tanggal, h]));
  const byDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const h = petaHari.get(d);
    byDay.push({ tanggal: d, requests: h ? h.requests : 0, total_tokens: h ? h.total_tokens : 0 });
  }

  // Log request terakhir
  const logs = db
    .prepare(
      `SELECT model, prompt_tokens, completion_tokens, total_tokens, status, created_at
       FROM usage_logs WHERE api_key_id = ?
       ORDER BY id DESC LIMIT 50`
    )
    .all(row.id)
    .map((l) => ({ ...l, model: l.model || "(tidak diketahui)" }));

  res.json({
    data: {
      summary: {
        token_limit: row.token_limit,
        tokens_used: row.tokens_used,
        tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
        percent_used: row.token_limit > 0 ? Math.round((row.tokens_used / row.token_limit) * 100) : 0,
        is_active: !!row.is_active,
      },
      by_model: byModel,
      by_day: byDay,
      logs,
    },
  });
});

module.exports = router;
