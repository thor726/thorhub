/**
 * limiter.js — Antrean & rate limiting global menuju provider utama.
 *
 * Limit asli provider: 30 request/menit (30 RPM).
 * Kita memakai 25 RPM sebagai buffer agar tidak pernah menyentuh limit asli.
 *
 * Cara kerja "reservoir": setiap 60 detik kapasitas di-reset menjadi 25.
 * Setiap request yang dieksekusi memakai 1 kapasitas. Jika reservoir kosong,
 * request berikutnya otomatis MENGANTRE (bukan ditolak) hingga kapasitas
 * berikutnya tersedia atau timeout antrean tercapai.
 */
const Bottleneck = require("bottleneck");

const limiter = new Bottleneck({
  // --- Batas laju: 25 request per 60 detik ---
  reservoir: 25,                     // kapasitas awal per interval
  reservoirRefreshAmount: 25,        // jumlah kapasitas saat refresh
  reservoirRefreshInterval: 60_000,  // interval refresh: 60 detik

  // --- Batas paralel ---
  maxConcurrent: 3,                  // maksimal 3 request berjalan bersamaan

  // Jika antrean tak terkendali, tolak (jangan tumpuk memori)
  highWater: 1000,
  rejectOnDrop: true,
});

module.exports = limiter;
