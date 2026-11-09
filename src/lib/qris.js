/**
 * qris.js — Konversi QRIS statis → QRIS dinamis per-transaksi.
 *
 * Diporting dari src/lib/qrisHelper.ts di repo Thor-market (sistem yang sama,
 * porting ke CommonJS + better-sqlite3 proyek ini).
 *
 * Cara kerja:
 *  - Admin menempel STRING QRIS statis miliknya (salin "QRIS" / "Print QR"
 *    dari aplikasi DANA/merchant). String itu adalah payload EMVCo QRIS.
 *  - Untuk setiap pesanan, string statis diubah jadi DINAMIS: Tag 01 diubah
 *    "11"→"12", nominal dimasukkan ke Tag 54, lalu CRC16 (Tag 63) dihitung
 *    ulang. Hasilnya QR yang saat dipindai DANA/GoPay/OVO otomatis mengisi
 *    nominal pembayaran persis (harga + kode unik).
 *  - Tidak ada payment gateway pihak ketiga — konfirmasi tetap lewat webhook
 *    notifikasi DANA (MacroDroid) di sisi server.
 */
const QRCode = require("qrcode");

/** CRC-16/CCITT-FALSE: polinomial 0x1021, init 0xFFFF — standar EMVCo/QRIS (Tag 63). */
function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Pecah string QRIS menjadi daftar objek TLV { tag, value }. */
function parseQrisTlv(qris) {
  const out = [];
  let i = 0;
  while (i + 4 <= qris.length) {
    const tag = qris.slice(i, i + 2);
    const len = parseInt(qris.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len)) break;
    const value = qris.slice(i + 4, i + 4 + len);
    if (value.length !== len) break;
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

/** Gabungkan daftar TLV kembali menjadi string payload. */
function tlvToString(tlv) {
  return tlv.map((t) => t.tag + String(t.value.length).padStart(2, "0") + t.value).join("");
}

/**
 * Ubah QRIS statis menjadi dinamis dengan nominal tertentu.
 * @param {string} staticQris payload QRIS statis (dari aplikasi merchant)
 * @param {number} amount nominal Rupiah (harga + kode unik)
 * @returns {string} payload QRIS dinamis siap dirender
 */
function buildDynamicQris(staticQris, amount) {
  const s = (staticQris ?? "").trim();
  const amountInt = Math.round(amount);
  if (!Number.isFinite(amountInt) || amountInt < 1 || amountInt > 500_000_000) {
    throw new Error("Nominal tidak valid untuk QRIS dinamis.");
  }
  let tlv = parseQrisTlv(s);
  if (!tlv.length || tlv[0].tag !== "00") {
    throw new Error("String QRIS tidak dikenali. Salin ulang dari aplikasi DANA (menu QRIS).");
  }
  tlv = tlv.filter((t) => t.tag !== "63"); // buang CRC lama
  tlv = tlv.map((t) => (t.tag === "01" ? { tag: "01", value: "12" } : t)); // statis → dinamis
  tlv = tlv.filter((t) => t.tag !== "54"); // buang nominal lama
  const amountStr = String(amountInt);
  const insertBefore = tlv.findIndex((t) => t.tag === "58"); // sisip sebelum Tag 58 (negara)
  tlv.splice(insertBefore === -1 ? tlv.length : insertBefore, 0, { tag: "54", value: amountStr });
  const body = tlvToString(tlv);
  const withCrcHeader = `${body}6304`;
  return `${withCrcHeader}${crc16(withCrcHeader)}`;
}

/**
 * Validasi string QRIS statis yang ditempel admin (dari panel admin):
 * - struktur TLV utuh sampai habis (seluruh string terkonsumsi parser),
 * - Tag 00 = "01" (QRIS statis) & Tag 63 di posisi terakhir,
 * - Tag 53 (mata uang) wajib 360 (IDR) karena nominal rupiah disisipkan,
 * - CRC16 dihitung ulang dan harus sama dengan 4 karakter terakhir.
 * Spasi INTERNAL nilai TLV adalah bagian sah (mis. "TOKO BU SITI").
 *
 * @returns {{ok: boolean, error?: string, merchantName?: string, merchantCity?: string}}
 */
function validateStaticQris(raw) {
  const s = (raw ?? "").trim();
  if (s.length < 40) {
    return { ok: false, error: "String QRIS terlalu pendek — pastikan kode QRIS disalin lengkap dari aplikasi DANA." };
  }
  const tlv = parseQrisTlv(s);
  if (tlv.length === 0 || tlv[0]?.tag !== "00" || tlv[0]?.value !== "01") {
    return { ok: false, error: "Tag 00 (Payload Format) tidak ditemukan / bukan QRIS statis — string bukan QRIS yang valid." };
  }
  // Tag 01 (statis/dinamis): "11" = statis. QRIS dinamis/transaksional (12)
  // adalah QR sekali-pakai untuk satu nominal — jangan diterima sebagai QRIS
  // dasar toko; buildDynamicQris akan menanam nominal sendiri per pesanan.
  const t01 = tlv.find((t) => t.tag === "01");
  if (t01 && t01.value !== "11") {
    return { ok: false, error: "Ini QRIS DINAMIS (sekali pakai, nominal terkunci). Gunakan QRIS statis Anda — menu 'QRIS Saya' / 'Terima Uang' di aplikasi DANA." };
  }
  const crcIdx = tlv.findIndex((t) => t.tag === "63");
  if (crcIdx === -1 || crcIdx !== tlv.length - 1) {
    return { ok: false, error: "Tag 63 (CRC) tidak ada / tidak di posisi terakhir." };
  }
  const consumed = tlvToString(tlv).length;
  if (consumed !== s.length) {
    return { ok: false, error: "Struktur TLV tidak utuh — string berisi karakter liar di akhir." };
  }
  const currency = tlv.find((t) => t.tag === "53");
  if (!currency || currency.value !== "360") {
    return { ok: false, error: "Tag 53 (mata uang) harus 360 (IDR) — QRIS ini tidak dalam rupiah." };
  }
  const expected = s.slice(-4);
  const actual = crc16(s.slice(0, s.length - 4));
  if (expected !== actual) {
    return { ok: false, error: `CRC tidak cocok (diharapkan ${actual}, ditemukan ${expected}) — string berubah/salah salin.` };
  }
  return {
    ok: true,
    merchantName: tlv.find((t) => t.tag === "59")?.value ?? "",
    merchantCity: tlv.find((t) => t.tag === "60")?.value ?? "",
  };
}

/** Render payload QRIS menjadi PNG data-URL (untuk <img src>). */
async function qrisToDataUrl(qrisString, width = 512) {
  return QRCode.toDataURL(qrisString, {
    errorCorrectionLevel: "M",
    margin: 2,
    width,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}

module.exports = { crc16, buildDynamicQris, validateStaticQris, qrisToDataUrl };
