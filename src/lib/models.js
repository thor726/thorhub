/**
 * models.js — Snapshot resmi daftar model provider utama (Re:Link Gateway).
 *
 * Sumber: https://relink-gateway.biz.id/ (tab Model, via __data.json server-side)
 * Total 42 model, 26 aktif (disinkronkan dengan /v1/models provider). Data ini
 * dipakai sebagai FALLBACK bila provider
 * tidak bisa dihubungi, sehingga halaman dokumentasi tetap menampilkan daftar
 * model yang benar. Bila provider bisa diakses, data live tetap diprioritaskan.
 *
 * Field per entri:
 *   id         — ID model yang dikirim pada field "model" di /v1/chat/completions
 *   label      — nama tampilan
 *   vendor     — pemilik model (OpenAI, Anthropic, DeepSeek, Google, Zhipu AI, ...)
 *   vision     — true bila mendukung input gambar
 *   multiplier — faktor konsumsi token terhadap kuota (1 = 1:1)
 *   active     — true bila model aktif & tersedia di provider
 *
 * Catatan multiplier (definisi resmi Re:Link):
 *   (prompt_token + completion_token) × multiplier, lalu dibulatkan dan
 *   dikurangi dari kuota. Contoh: model 1.5× dengan 2.000 token terpakai
 *   mengurangi kuota 3.000 token. Nilai di bawah ini diambil apa adanya dari
 *   tab Model di situs resmi — JANGAN dikira-kira.
 *
 * Terakhir disinkronkan: 2026-11-08 (42 model, 26 aktif) — diverifikasi terhadap
 * /v1/models provider secara langsung (semua id, aktif, dan vision cocok).
 */

/** Default model yang dipakai di contoh dokumentasi (sesuai docs resmi). */
const DEFAULT_MODEL = "deepseek-v4-pro";

const MODELS = [
  { id: "auto", label: "Auto", vendor: "Lainnya", vision: false, multiplier: 1, active: true },
  { id: "claude-opus-5", label: "Claude Opus 5", vendor: "Anthropic", vision: true, multiplier: 20, active: false },
  { id: "claude-opus-5-5", label: "Claude Opus 5 5", vendor: "Anthropic", vision: true, multiplier: 32, active: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", vendor: "Anthropic", vision: true, multiplier: 10, active: false },
  { id: "deepseek-v4-flash", label: "Deepseek V4 Flash", vendor: "DeepSeek", vision: false, multiplier: 2, active: true },
  { id: "deepseek-v4-flash-0731", label: "Deepseek V4 Flash 0731", vendor: "DeepSeek", vision: false, multiplier: 2, active: true },
  { id: "deepseek-v4-flash-vision-exp", label: "Deepseek V4 Flash Vision Exp", vendor: "DeepSeek", vision: true, multiplier: 2.5, active: true },
  { id: "deepseek-v4-mod", label: "Deepseek V4 Mod", vendor: "DeepSeek", vision: false, multiplier: 3, active: true },
  { id: "deepseek-v4-pro", label: "Deepseek V4 Pro", vendor: "DeepSeek", vision: false, multiplier: 1.15, active: true },
  { id: "deepseek-v4-pro-0813", label: "Deepseek V4 Pro 0813", vendor: "DeepSeek", vision: false, multiplier: 1.8, active: false },
  { id: "deepseek-v4.1-flash", label: "Deepseek V4.1 Flash", vendor: "DeepSeek", vision: true, multiplier: 2.56, active: true },
  { id: "deepseek-v4.1-flash-1017", label: "Deepseek V4.1 Flash 1017", vendor: "DeepSeek", vision: true, multiplier: 3, active: true },
  { id: "deepseek-v4.1-flash-1017-mod", label: "Deepseek V4.1 Flash 1017 Mod", vendor: "DeepSeek", vision: true, multiplier: 3.5, active: true },
  { id: "deepseek-v4.1-flash-mod", label: "Deepseek V4.1 Flash Mod", vendor: "DeepSeek", vision: true, multiplier: 3.2, active: true },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", vendor: "Google", vision: true, multiplier: 60, active: true },
  { id: "glm-5.2", label: "GLM 5.2", vendor: "Zhipu AI", vision: false, multiplier: 1.25, active: true },
  { id: "glm-5.2-mod", label: "GLM 5.2 Mod", vendor: "Zhipu AI", vision: false, multiplier: 3, active: true },
  { id: "glm-5.3", label: "GLM 5.3", vendor: "Zhipu AI", vision: false, multiplier: 2, active: true },
  { id: "glm-5.3-flash", label: "GLM 5.3 Flash", vendor: "Zhipu AI", vision: true, multiplier: 2, active: true },
  { id: "glm-5.3-flash-mod", label: "GLM 5.3 Flash Mod", vendor: "Zhipu AI", vision: true, multiplier: 3.5, active: true },
  { id: "glm-5.3-flashx", label: "GLM 5.3 FlashX", vendor: "Zhipu AI", vision: true, multiplier: 3, active: false },
  { id: "glm-5.3-flashx-mod", label: "GLM 5.3 FlashX Mod", vendor: "Zhipu AI", vision: true, multiplier: 5, active: false },
  { id: "glm-5.3-mod", label: "GLM 5.3 Mod", vendor: "Zhipu AI", vision: false, multiplier: 3.2, active: true },
  { id: "gpt-5.6", label: "GPT-5.6", vendor: "OpenAI", vision: true, multiplier: 5, active: false },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", vendor: "OpenAI", vision: true, multiplier: 5, active: false },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", vendor: "OpenAI", vision: true, multiplier: 25, active: false },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", vendor: "OpenAI", vision: true, multiplier: 10, active: false },
  { id: "gpt-6-astra", label: "GPT-6 Astra", vendor: "OpenAI", vision: true, multiplier: 42, active: true },
  { id: "gpt-6-luna", label: "GPT-6 Luna", vendor: "OpenAI", vision: true, multiplier: 8, active: true },
  { id: "gpt-6-sol", label: "GPT-6 Sol", vendor: "OpenAI", vision: true, multiplier: 30, active: false },
  { id: "hy3", label: "HY3", vendor: "Tencent", vision: false, multiplier: 1, active: false },
  { id: "hy4", label: "HY4", vendor: "Tencent", vision: false, multiplier: 1.4, active: false },
  { id: "kimi-k2.5", label: "Kimi K2.5", vendor: "Moonshot", vision: false, multiplier: 1, active: false },
  { id: "kimi-k2.6", label: "Kimi K2.6", vendor: "Moonshot", vision: false, multiplier: 1, active: false },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", vendor: "Moonshot", vision: false, multiplier: 1, active: true },
  { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", vendor: "Moonshot", vision: false, multiplier: 1.5, active: true },
  { id: "kimi-k2.8", label: "Kimi K2.8", vendor: "Moonshot", vision: true, multiplier: 2, active: true },
  { id: "kimi-k3", label: "Kimi K3", vendor: "Moonshot", vision: false, multiplier: 6, active: false },
  { id: "kimi-k3-mod", label: "Kimi K3 Mod", vendor: "Moonshot", vision: false, multiplier: 8, active: false },
  { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", vendor: "MiniMax", vision: true, multiplier: 1.4, active: true },
  { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash", vendor: "MiniMax", vision: true, multiplier: 2, active: true },
  { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro", vendor: "MiniMax", vision: true, multiplier: 2, active: true },
];

/** Daftar vendor unik (untuk filter di UI), urut sesuai kemunculan. */
const VENDORS = [...new Set(MODELS.map((m) => m.vendor))];

/** Hanya model yang aktif & tersedia. */
function activeModels() {
  return MODELS.filter((m) => m.active);
}

/**
 * Ambil multiplier konsumsi token sebuah model (default 1 bila tak dikenal).
 * Dipakai oleh proxy untuk menghitung token efektif yang dipotong dari kuota:
 *   (prompt_tokens + completion_tokens) × multiplier, lalu dibulatkan.
 */
function multiplierOf(id) {
  if (!id) return 1;
  const m = MODELS.find((x) => x.id === id);
  return m && Number.isFinite(m.multiplier) ? m.multiplier : 1;
}

/**
 * Normalisasi daftar model dari provider (bentuk OpenAI /models) menjadi
 * bentuk seragam gateway. Metadata lokal (vendor, label, multiplier) dipakai
 * bila tersedia; sisanya menyesuaikan data provider.
 *
 * Catatan: API provider TIDAK mengirim multiplier — nilai selalu diambil dari
 * snapshot lokal agar konsisten dengan tab Model di situs resmi.
 */
function normalizeProviderModels(list) {
  const byId = new Map(MODELS.map((m) => [m.id, m]));
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && typeof m.id === "string")
    .map((m) => {
      const local = byId.get(m.id);
      // Provider versi lama belum mengirim field enabled/available → anggap aktif.
      const hasFlags = typeof m.enabled !== "undefined" || typeof m.available !== "undefined";
      return {
        id: m.id,
        label: local ? local.label : m.id,
        vendor: local ? local.vendor : "Lainnya",
        vision: typeof m.vision !== "undefined" ? !!m.vision : local ? local.vision : false,
        multiplier: local ? local.multiplier : 1,
        active: hasFlags ? !!m.enabled && !!m.available : true,
      };
    });
}

module.exports = {
  DEFAULT_MODEL,
  MODELS,
  VENDORS,
  activeModels,
  multiplierOf,
  normalizeProviderModels,
};
