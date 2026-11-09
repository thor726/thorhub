/**
 * pesanan.js — Linimasa pesanan (audit trail ala toko online).
 *
 * Setiap kejadian penting pada sebuah pesanan dicatat ke tabel order_events
 * sehingga admin dapat MELACAK kendala pembayaran dari panel:
 *
 *   dibuat      → pesanan dibuat pembeli, menunggu pembayaran QRIS
 *   webhook     → notifikasi DANA masuk (cocok / kurang nominal / gagal parse)
 *   lunas       → pembayaran diterima (otomatis via webhook / manual admin)
 *   fulfillment → eksekusi pesanan (terbit key / tambah kuota; sukses-gagal)
 *   notifikasi  → hasil pengiriman key & struk (WA / email / WA admin)
 *   admin       → aksi manual admin (konfirmasi, batal, kirim ulang, catatan)
 *   batal       → pesanan dibatalkan (pembeli / admin / kedaluwarsa)
 *   info        → catatan lain
 *
 * Semua fungsi BEST-EFFORT: pencatatan tidak boleh pernah memutus alur
 * pembayaran utama — error ditelan dan hanya di-log.
 */
const db = require("../db");

/**
 * Catat satu event ke linimasa pesanan.
 * @param {number} orderId  id baris orders
 * @param {string} type     dibuat|webhook|lunas|fulfillment|notifikasi|admin|batal|info
 * @param {string} actor    sistem|webhook|pembeli|admin
 * @param {string} detail   keterangan manusiawi (boleh multi baris)
 */
function catatEvent(orderId, type, actor = "sistem", detail = "") {
  try {
    db.prepare(
      "INSERT INTO order_events (order_id, type, actor, detail) VALUES (?, ?, ?, ?)"
    ).run(orderId, String(type || "info"), String(actor || "sistem"), String(detail || "").slice(0, 1000));
  } catch (e) {
    console.error("[pesanan] gagal mencatat order_event:", e.message);
  }
}

/** Riwayat linimasa satu pesanan (urut lama → baru). */
function riwayat(orderId) {
  return db
    .prepare("SELECT type, actor, detail, created_at FROM order_events WHERE order_id = ? ORDER BY id ASC")
    .all(orderId);
}

/** Format Rupiah untuk detail event. */
function rupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

module.exports = { catatEvent, riwayat, rupiah };
