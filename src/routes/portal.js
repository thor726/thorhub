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
const DEFAULT_MODEL = models.DEFAULT_MODEL;

// Cache sederhana daftar model (hindari spam ke provider tiap request)
let modelsCache = { at: 0, data: null };
const MODELS_TTL_MS = 60 * 1000; // 60 detik
const https = require("https");

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
router.post("/admin/login", (req, res) => {
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
    return res.status(401).json({ error: { message: "Password admin salah.", code: "unauthorized" } });
  }
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

router.get("/admin/me", requireAdminSession, (_req, res) => {
  res.json({ data: { role: "admin" } });
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
  if (!key) return res.status(404).json({ error: { message: "Sub-API Key tidak ditemukan.", code: "not_found" } });

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

// DELETE /portal/admin/keys/:apiKey — hapus permanen
router.delete("/admin/keys/:apiKey", requireAdminSession, (req, res) => {
  const info = db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(req.params.apiKey);
  if (info.changes === 0) return res.status(404).json({ error: { message: "Sub-API Key tidak ditemukan.", code: "not_found" } });
  res.json({ data: { deleted: true, api_key: req.params.apiKey } });
});

// ---------------------------------------------------------------
// MEMBER — login / logout / me
// ---------------------------------------------------------------
router.post("/member/login", (req, res) => {
  const apiKey = (req.body && req.body.api_key) || "";
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: { message: 'Field "api_key" wajib diisi.', code: "invalid_request" } });
  }
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey.trim());
  if (!row) {
    return res.status(401).json({ error: { message: "API Key tidak ditemukan.", code: "invalid_api_key" } });
  }
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
  res.json({
    data: {
      role: "member",
      user_name: row.user_name,
      api_key: row.api_key,
      token_limit: row.token_limit,
      tokens_used: row.tokens_used,
      tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
      is_active: !!row.is_active,
      created_at: row.created_at,
    },
  });
});

module.exports = router;
