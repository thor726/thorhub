/**
 * admin.js — REST API manajemen API Key (khusus admin/penjual).
 *
 * Dilindungi ADMIN_API_KEY (bandingkan timing-safe lewat hash SHA-256).
 *
 *  GET    /admin/keys            → daftar semua API key
 *  GET    /admin/keys/:apiKey    → detail satu key + sisa kuota
 *  PATCH  /admin/keys/:apiKey    → ubah is_active (blokir/unblokir)
 *                                  atau token_limit (top-up/ubah limit)
 *  DELETE /admin/keys/:apiKey    → hapus key permanen
 *  GET    /admin/usage           → ringkasan pemakaian semua key
 */
const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const db = require("../db");

const router = express.Router();

const LIST_COLS = "id, api_key, user_name, token_limit, tokens_used, is_active, created_at";

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!config.adminApiKey || !token || !safeEqual(token, config.adminApiKey)) {
    return res.status(401).json({
      error: { message: "Kredensial admin diperlukan (Authorization: Bearer <ADMIN_API_KEY>).", type: "unauthorized" },
    });
  }
  next();
}

function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    is_active: !!row.is_active,
    tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
  };
}

// GET /admin/keys — daftar semua key
router.get("/keys", requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM api_keys ORDER BY id DESC`).all();
  res.json({ data: rows.map(decorate) });
});

// GET /admin/keys/:apiKey — detail satu key
router.get("/keys/:apiKey", requireAdmin, (req, res) => {
  const row = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE api_key = ?`).get(req.params.apiKey);
  if (!row) return res.status(404).json({ error: { message: "API Key tidak ditemukan." } });
  res.json({ data: decorate(row) });
});

// PATCH /admin/keys/:apiKey — ubah status aktif dan/atau limit token
router.patch("/keys/:apiKey", requireAdmin, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan." } });

  const { is_active, token_limit } = req.body || {};
  if (typeof is_active === "undefined" && typeof token_limit === "undefined") {
    return res.status(400).json({
      error: { message: "Kirim minimal satu field: is_active (boolean) atau token_limit (integer).", type: "invalid_request_error" },
    });
  }
  if (typeof is_active !== "undefined" && typeof is_active !== "boolean") {
    return res.status(400).json({ error: { message: "Field is_active harus boolean.", type: "invalid_request_error" } });
  }
  if (typeof token_limit !== "undefined" && (!Number.isInteger(token_limit) || token_limit < 0)) {
    return res.status(400).json({ error: { message: "Field token_limit harus integer >= 0.", type: "invalid_request_error" } });
  }

  if (typeof is_active !== "undefined") {
    db.prepare("UPDATE api_keys SET is_active = ? WHERE id = ?").run(is_active ? 1 : 0, key.id);
  }
  if (typeof token_limit !== "undefined") {
    db.prepare("UPDATE api_keys SET token_limit = ? WHERE id = ?").run(token_limit, key.id);
  }

  const updated = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(key.id);
  res.json({ data: decorate(updated) });
});

// DELETE /admin/keys/:apiKey — hapus key permanen
router.delete("/keys/:apiKey", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(req.params.apiKey);
  if (info.changes === 0) return res.status(404).json({ error: { message: "API Key tidak ditemukan." } });
  res.json({ data: { deleted: true, api_key: req.params.apiKey } });
});

// GET /admin/usage — ringkasan total
router.get("/usage", requireAdmin, (_req, res) => {
  const agg = db
    .prepare(
      `SELECT COUNT(*)                    AS total_keys,
              COALESCE(SUM(is_active), 0) AS active_keys,
              COALESCE(SUM(token_limit), 0) AS total_token_limit,
              COALESCE(SUM(tokens_used), 0) AS total_tokens_used
       FROM api_keys`
    )
    .get();
  res.json({ data: agg });
});

module.exports = router;
