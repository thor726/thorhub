/**
 * limiter.js — Rate limiting DINONAKTIFKAN (mode UNLIMITED).
 *
 * ---------------------------------------------------------------
 * RIWAYAT
 * ---------------------------------------------------------------
 * Sebelumnya modul ini memakai Bottleneck untuk membatasi laju request:
 *   - reservoir 25 request / 60 detik (buffer dari limit 30 RPM provider)
 *   - maksimal 3 request paralel
 *   - request berlebih MENGANTRE (FIFO), bukan ditolak
 *
 * ---------------------------------------------------------------
 * KONDISI SEKARANG
 * ---------------------------------------------------------------
 * Atas permintaan pemilik sistem, SELURUH pembatasan RPM / rate limit /
 * throttling dimatikan. Setiap request LANGSUNG dieksekusi:
 *   - tanpa batas jumlah request per menit  → unlimited
 *   - tanpa batas jumlah request paralel    → unlimited
 *   - tanpa antrean (FIFO)                  → tidak ada penundaan buatan
 *   - tanpa jeda / delay / timeout antrean  → langsung jalan
 *
 * ---------------------------------------------------------------
 * KOMPATIBILITAS ANTARMUKA
 * ---------------------------------------------------------------
 * Modul ini sengaja mempertahankan antarmuka (interface) SAMA seperti
 * versi Bottleneck, supaya seluruh pemanggil tidak perlu diubah dan
 * logika bisnis inti tetap utuh:
 *
 *   await limiter.schedule(task)           // jalankan task segera
 *   await limiter.schedule({ ... }, task)  // opsi apa pun diabaikan
 *   limiter.running()                      // jumlah request aktif
 *   limiter.queued()                       // selalu 0 (tak ada antrean)
 *
 * Pemanggil saat ini: src/services/proxy.js, src/routes/chat.js,
 * dan src/server.js (status /health).
 */

// Penghitung request yang sedang berjalan (hanya untuk pelaporan /health).
let active = 0;

/**
 * Jalankan `task` SEGERA tanpa rate limit, tanpa antre, tanpa delay.
 * Mendukung dua bentuk pemanggilan demi kompatibilitas:
 *   schedule(task)
 *   schedule(options, task)   // options diabaikan sepenuhnya
 *
 * @param {...any} args argumen terakhir wajib berupa fungsi (task).
 * @returns {Promise<any>} hasil dari task (atau error dari task).
 */
function schedule(...args) {
  const task = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
  if (!task) {
    return Promise.reject(
      new TypeError("limiter.schedule(): argumen task (fungsi) tidak ditemukan")
    );
  }

  active += 1;
  // Promise.resolve() memastikan task dijalankan secara asinkron (mirip
  // perilaku Bottleneck), lalu .finally menurunkan penghitung.
  return Promise.resolve()
    .then(() => task())
    .finally(() => {
      active -= 1;
    });
}

/** Jumlah request yang sedang dieksekusi saat ini. */
function running() {
  return active;
}

/** Jumlah request dalam antrean — selalu 0 karena tidak ada antrean. */
function queued() {
  return 0;
}

module.exports = { schedule, running, queued };
