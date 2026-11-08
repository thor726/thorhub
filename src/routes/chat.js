/**
 * chat.js — Route /v1/* yang diakses pembeli.
 * Semua request wajib lolos otentikasi Sub-API Key + cek kuota.
 */
const express = require("express");
const config = require("../config");
const limiter = require("../services/limiter");
const proxy = require("../services/proxy");
const models = require("../lib/models");
const { authenticateSubKey } = require("../middleware/auth");

const router = express.Router();

// ---------------------------------------------------------------
// POST /v1/chat/completions — endpoint utama untuk pembeli
// ---------------------------------------------------------------
router.post("/chat/completions", authenticateSubKey, async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({
      error: {
        message: "Body request harus berupa JSON yang valid, contoh: {\"model\": \"...\", \"messages\": [...]}",
        type: "invalid_request_error",
      },
    });
  }

  try {
    await proxy.runJob({ req, res, subKey: req.subKey, payload: req.body });
  } catch (err) {
    // Pengaman terakhir — error seharusnya sudah ditangani di dalam runJob
    if (!res.headersSent) {
      res.status(500).json({ error: { message: "Kesalahan internal gateway.", type: "internal_error" } });
    }
  }
});

// ---------------------------------------------------------------
// GET /v1/models — bonus: ambil daftar model dari provider
// (tanpa penghitungan token, tetap lewat antrean & otentikasi)
// ---------------------------------------------------------------
router.get("/models", authenticateSubKey, async (_req, res) => {
  try {
    const response = await limiter.schedule(() =>
      fetch(`${config.targetBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.masterApiKey}` },
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      })
    );
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { message: text || `Provider error (HTTP ${response.status})`, type: "upstream_error" } };
    }
    res.status(response.status).json(body);
  } catch (err) {
    // Provider tidak bisa dihubungi → sajikan snapshot resmi agar klien tetap jalan
    res.json({
      object: "list",
      data: models.activeModels().map((m) => ({
        id: m.id,
        object: "model",
        owned_by: m.vendor,
        vision: m.vision,
        enabled: true,
        available: true,
      })),
      gateway_fallback: true,
    });
  }
});

module.exports = router;
