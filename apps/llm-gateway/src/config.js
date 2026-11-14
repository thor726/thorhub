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
  // URL publik toko (opsional) — dipakai untuk tautan di WA/email notifikasi,
  // mis. "https://llm.thormarket.site". Tanpa ini tautan memakai path relatif.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  // Masa aktif API Key (hari) sejak diterbitkan — permintaan pemilik toko: 25 hari.
  // Setiap top-up yang dibayar otomatis memperpanjang masa aktif 25 hari lagi
  // (dihitung dari masa aktif terlama: sisa masa aktif lama ATAU sekarang).
  keyValidityDays: intOr(process.env.KEY_VALIDITY_DAYS, 25),
};

if (!config.masterApiKey) {
  console.error("[FATAL] MASTER_API_KEY belum diisi. Salin .env.example menjadi .env lalu isi nilainya.");
  process.exit(1);
}

if (!config.adminApiKey) {
  console.warn("[PERINGATAN] ADMIN_API_KEY kosong — endpoint /admin/* akan ditolak semua.");
}

module.exports = config;
