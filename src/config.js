/**
 * config.js — Memuat & memvalidasi konfigurasi dari file .env
 */
require("dotenv").config();

const intOr = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  port: intOr(process.env.PORT, 3000),
  masterApiKey: process.env.MASTER_API_KEY || "",
  // Buang trailing slash agar penambahan path ("/chat/completions") selalu benar
  targetBaseUrl: (process.env.TARGET_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  adminApiKey: process.env.ADMIN_API_KEY || "",
  // Password untuk login panel admin web (berbeda dari ADMIN_API_KEY untuk REST admin)
  adminPassword: process.env.ADMIN_PASSWORD || "",
  queueWaitTimeoutMs: intOr(process.env.QUEUE_WAIT_TIMEOUT_MS, 60_000),
  upstreamTimeoutMs: intOr(process.env.UPSTREAM_TIMEOUT_MS, 120_000),
  // Default TRUE (aman): memaksa include_usage pada stream agar token tidak
  // luput dihitung. Set "false" hanya bila provider menolak stream_options.
  injectStreamUsage: String(process.env.INJECT_STREAM_USAGE ?? "true").toLowerCase() !== "false",
};

if (!config.masterApiKey) {
  console.error("[FATAL] MASTER_API_KEY belum diisi. Salin .env.example menjadi .env lalu isi nilainya.");
  process.exit(1);
}

if (!config.adminApiKey) {
  console.warn("[PERINGATAN] ADMIN_API_KEY kosong — endpoint /admin/* akan ditolak semua.");
}

module.exports = config;
