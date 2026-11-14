/**
 * masa-aktif.js — Masa aktif API Key (default 25 hari, config.keyValidityDays).
 *
 * Aturan yang berlaku di seluruh sistem:
 *   1. Key BARU (diterbitkan admin / toko) berlaku 25 hari sejak diterbitkan.
 *   2. Top-up yang dibayar (webhook DANA / konfirmasi admin) menambah kuota
 *      SEKALIGUS memperpanjang masa aktif 25 hari — dihitung dari masa aktif
 *      TERLAMA antara "sisa masa aktif sekarang" dan "waktu pembayaran",
 *      sehingga member yang top-up sebelum kadaluarsa tidak kehilangan sisa
 *      harinya (perilaku standar toko token online).
 *   3. Key yang kedaluwarsa ditolak middleware auth dengan 403 key_expired;
 *      member tetap bisa login ke /portal untuk melihat status & top-up lagi.
 *
 * Format waktu DB mengikuti gaya SQLite UTC: "YYYY-MM-DD HH:MM:SS"
 * (sama dengan kolom created_at yang diisi strftime('now')).
 */
const config = require("../config");
const db = require("../db");

const MS_HARI = 86_400_000;
const MASA_AKTIF_HARI = config.keyValidityDays;

/** Konversi epoch ms → string waktu gaya SQLite (UTC). */
function sqlWaktu(d = new Date()) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** Konversi kolom expires_at (string SQLite) → epoch ms; null → null. */
function expiryMs(expiresAt) {
  if (!expiresAt) return null;
  const t = new Date(String(expiresAt).replace(" ", "T") + "Z").getTime();
  return Number.isFinite(t) ? t : null;
}

/** Masa aktif BARU: `dari` (ms) + 25 hari, sebagai string SQLite. */
function masaAktifBaru(dariMs = Date.now()) {
  return sqlWaktu(new Date(dariMs + MASA_AKTIF_HARI * MS_HARI));
}

/**
 * Masa aktif setelah PERPANJANGAN (top-up lunas):
 * max(waktu sekarang, masa aktif lama) + 25 hari.
 * @param {string|null} expiresAtLama kolom expires_at lama (boleh null)
 */
function perpanjangMasaAktif(expiresAtLama) {
  const lama = expiryMs(expiresAtLama) || 0;
  return masaAktifBaru(Math.max(Date.now(), lama));
}

/** Format tampilan Indonesia (zona WIB): "3 Des 2026, 14.05 WIB". */
function formatWaktuIndo(nilai) {
  const ms = typeof nilai === "number" ? nilai : expiryMs(nilai);
  if (ms == null) return "";
  const tgl = new Date(ms).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const jam = new Date(ms).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return `${tgl}, ${jam.replace(":", ".")} WIB`;
}

/** Format tanggal pendek: "3 Des 2026". */
function formatTanggalIndo(nilai) {
  const ms = typeof nilai === "number" ? nilai : expiryMs(nilai);
  if (ms == null) return "";
  return new Date(ms).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Perkaya baris api_keys dengan info masa aktif untuk respons JSON
 * (dipakai endpoint admin & member).
 */
function decorateKey(row) {
  if (!row) return row;
  const exp = expiryMs(row.expires_at);
  const sisa = exp == null ? null : exp - Date.now();
  return {
    ...row,
    is_active: !!row.is_active,
    tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
    expired: sisa != null && sisa <= 0,
    sisa_ms: sisa,
    days_left: sisa == null ? null : Math.max(0, Math.ceil(sisa / MS_HARI)),
    masa_aktif_label: exp == null ? null : formatWaktuIndo(exp),
    masa_aktif_tanggal: exp == null ? null : formatTanggalIndo(exp),
  };
}

/** Baca masa aktif key dari DB berdasarkan string api_key. */
function expiryKeyDariDb(apiKey) {
  if (!apiKey) return null;
  const row = db.prepare("SELECT expires_at FROM api_keys WHERE api_key = ?").get(apiKey);
  return row ? row.expires_at : null;
}

module.exports = {
  MS_HARI,
  MASA_AKTIF_HARI,
  sqlWaktu,
  expiryMs,
  masaAktifBaru,
  perpanjangMasaAktif,
  formatWaktuIndo,
  formatTanggalIndo,
  decorateKey,
  expiryKeyDariDb,
};
