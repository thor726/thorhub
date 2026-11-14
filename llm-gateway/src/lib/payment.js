/**
 * payment.js — Logika pembayaran QRIS DANA otomatis.
 *
 * Diporting dari src/lib/payment.ts di repo Thor-market, disesuaikan ke
 * better-sqlite3 (sinkron) proyek ini:
 *
 *  - Kode unik 1-999 ditambahkan ke harga paket agar setiap pesanan PENDING
 *    punya nominal unik → webhook bisa mencocokkan pembayaran EKSAK.
 *  - Parser payload webhook MacroDroid (JSON / form / teks polos).
 *  - Ekstraksi nominal uang masuk dari teks notifikasi DANA (regex).
 *  - Pengaman: uang keluar (tarik/kirim/bayar) tidak pernah dicocokkan.
 */
const crypto = require("crypto");
const db = require("../db");

/** Label payment_method yang disimpan di tabel orders untuk QRIS dinamis. */
const QRIS_DANA_METHOD = "QRIS DANA";
/** Masa berlaku tagihan (jam) — dipilih pemilik toko: 2 jam. */
const ORDER_EXPIRY_HOURS = 2;

/* ================================================================
 * KODE PESANAN & KODE UNIK
 * ================================================================ */

/** Kode pesanan THX-XXXXXXXX (40-bit acak, mirip pola THR- Thor-market). */
function generateOrderCode() {
  const alfabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // tanpa I,L,O,0,1 (anti salah baca)
  const byte = crypto.randomBytes(8);
  let kode = "";
  for (let i = 0; i < 8; i++) kode += alfabet[byte[i] % alfabet.length];
  return `THX-${kode}`;
}

/** Token akses halaman status (32 hex) — QR & key hanya dikirim ke pemilik token. */
function generateAccessToken() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Pilih kode unik 1-999 untuk nominal dasar tertentu.
 * Kode dianggap terpakai bila ada pesanan PENDING lain dengan amount_to_pay
 * yang sama (dicek pada rentang [base+1, base+999]).
 *
 * Catatan konkurensi: better-sqlite3 sinkron & satu koneksi → tidak ada
 * interleaving antara baca dan tulis di dalam proses; guard tabrakan tetap
 * dijalankan setelah INSERT sebagai lapisan kedua (lihat resolveAmountCollision).
 */
function generateUniqueCode(baseAmount) {
  const ambil = db
    .prepare(
      `SELECT amount_to_pay FROM orders
       WHERE status = 'PENDING' AND amount_to_pay >= ? AND amount_to_pay <= ?`
    )
    .all(baseAmount + 1, baseAmount + 999);
  const terpakai = new Set(ambil.map((r) => r.amount_to_pay));

  // Acak dulu supaya kode tidak berpola / mudah ditebak
  for (let i = 0; i < 40; i++) {
    const kode = 1 + Math.floor(Math.random() * 999);
    if (!terpakai.has(baseAmount + kode)) return kode;
  }
  // Cadangan: berurutan dari 1
  for (let kode = 1; kode <= 999; kode++) {
    if (!terpakai.has(baseAmount + kode)) return kode;
  }
  const err = new Error("Sistem sedang sibuk memproses pesanan. Tunggu beberapa saat lalu coba lagi.");
  err.code = "unique_code_habis";
  throw err;
}

/**
 * Race guard nominal — dipanggil SETELAH INSERT. Bila ternyata ada pesanan
 * PENDING lain dengan nominal identik (mis. dibuat proses lain), ganti kode
 * unik pesanan ini. Mengembalikan nominal FINAL yang dipakai QRIS.
 */
function resolveAmountCollision(orderId, baseAmount, currentAmount) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const dupe = db
      .prepare(`SELECT id FROM orders WHERE status = 'PENDING' AND amount_to_pay = ? AND id != ?`)
      .get(currentAmount, orderId);
    if (!dupe) return currentAmount; // aman — nominal ini milik kita
    let kodeBaru;
    try {
      kodeBaru = generateUniqueCode(baseAmount);
    } catch {
      return currentAmount; // rentang habis → webhook mengutamakan pesanan TERLAMA
    }
    currentAmount = baseAmount + kodeBaru;
    db.prepare("UPDATE orders SET unique_code = ?, amount_to_pay = ? WHERE id = ?").run(kodeBaru, currentAmount, orderId);
  }
  return currentAmount;
}

/* ================================================================
 * PARSER PAYLOAD WEBHOOK (MacroDroid → /store/webhook/dana)
 * ================================================================ */

/** Nama field yang mungkin dipakai MacroDroid untuk isi notifikasi. */
const TEXT_FIELDS = [
  "text",
  "notif_text",
  "notification_text",
  "notificationtext",
  "not_text",
  "notification",
  "message",
  "content",
  "body",
  "notif_big_text",
  "big_text",
  "notif_title",
  "not_title",
  "title",
];

const SECRET_FIELDS = ["secret_token", "secret", "token"];

/** Deteksi placeholder Magic Text yang tidak ter-expand (mis. "[not_text]"). */
function detectPlaceholder(...inputs) {
  const re =
    /(\[(?:not|notif|notification|notificationtext)[\s_]*(?:text|title|msg|message|content|body|app|big[\s_]?text)\]|%[a-z_]*text%|\{(?:notif|notification)[a-z_]*\})/i;
  for (const s of inputs) {
    if (!s) continue;
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Kumpulkan semua nilai string dari objek JSON (rekursif, berbatas). */
function collectStrings(o, depth = 0) {
  if (depth > 4 || o == null) return [];
  if (typeof o === "string") return [o];
  if (typeof o === "number" || typeof o === "boolean") return [];
  if (Array.isArray(o)) return o.flatMap((v) => collectStrings(v, depth + 1));
  if (typeof o === "object") {
    return Object.entries(o).flatMap(([k, v]) =>
      SECRET_FIELDS.includes(k) ? [] : collectStrings(v, depth + 1)
    );
  }
  return [];
}

function firstNonEmpty(...vals) {
  for (const v of vals) if (v && v.trim()) return v;
  return "";
}

/**
 * Parse body webhook DANA dari MacroDroid. Mendukung JSON, form-urlencoded,
 * dan teks polos; banyak nama field diterima karena tiap versi MacroDroid
 * menamai variabel notifikasi berbeda.
 */
function parseWebhookPayload(ctype, hSecret, raw) {
  const ct = (ctype ?? "").toLowerCase();
  const candidates = [];
  const pushCand = (s) => {
    if (s && s.trim() && !candidates.includes(s)) candidates.push(s);
  };

  // --- Form-urlencoded ---
  if (ct.includes("form")) {
    const f = new URLSearchParams(raw);
    const text = firstNonEmpty(...TEXT_FIELDS.map((k) => f.get(k)));
    for (const k of TEXT_FIELDS) pushCand(f.get(k) ?? "");
    const secret = hSecret || firstNonEmpty(...SECRET_FIELDS.map((k) => f.get(k)));
    pushCand(raw);
    return { secret, text, candidates, placeholder: detectPlaceholder(raw, text) };
  }

  // --- JSON ---
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const o = j;
      const text = firstNonEmpty(...TEXT_FIELDS.map((k) => (typeof o[k] === "string" ? o[k] : "")));
      const secret = hSecret || firstNonEmpty(...SECRET_FIELDS.map((k) => (typeof o[k] === "string" ? o[k] : "")));
      for (const s of collectStrings(o)) pushCand(s);
      return { secret, text, candidates, placeholder: detectPlaceholder(raw, text) };
    }
    return { secret: hSecret, text: String(j), candidates: [String(j)], placeholder: detectPlaceholder(raw) };
  } catch {
    // --- Teks polos ---
    return { secret: hSecret, text: raw, candidates: [raw], placeholder: detectPlaceholder(raw) };
  }
}

/* ================================================================
 * EKSTRAKSI NOMINAL DARI TEKS NOTIFIKASI DANA
 * ================================================================ */

/** Normalisasi teks rupiah → angka: "50.002,00" → 50002. */
function normalizeRupiah(raw) {
  let s = (raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/,(\d{1,2})$/, ""); // buang desimal ",00"
  s = s.replace(/\./g, ""); // buang pemisah ribuan
  s = s.replace(/[^\d]/g, ""); // sisakan angka
  if (!s) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1000 || n > 500_000_000) return null;
  return n;
}

/**
 * Ekstrak nominal uang MASUK dari teks notifikasi DANA.
 * Prioritas kalimat penerimaan (menerima/masuk/…); tanpa itu, pola "Rp"
 * pertama — TAPI ditolak bila teks berbau transaksi keluar (mengirim,
 * menarik, beli, top up, bayar) supaya tidak salah cocok.
 * Contoh: "DANA: Kamu menerima Rp50.012 dari BUDI" → 50012
 */
function extractDanaAmount(raw) {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const KEYWORD =
    /(?:menerima|diterima|terima|masuk|penjualan|bertambah|received)[^0-9R]{0,40}?Rp[\s.]*(\d[\d.,]*)/i;
  const ANY = /Rp[\s.]*(\d[\d.,]*)/i;
  const OUTGOING = /(?:mengirim|kirim|menarik|tarik|beli|top\s?up|bayar|keluar|refund|withdraw)/i;

  const kw = text.match(KEYWORD);
  if (kw) return normalizeRupiah(kw[1]);
  if (OUTGOING.test(text)) return null; // uang keluar → jangan cocokkan
  const any = text.match(ANY);
  if (!any) return null;
  return normalizeRupiah(any[1]);
}

/** Cari nominal dari daftar kandidat teks (urut prioritas). */
function extractDanaAmountFrom(candidates) {
  for (const c of candidates) {
    const n = extractDanaAmount(c);
    if (n) return n;
  }
  return null;
}

/* ================================================================
 * KEDALUWARSA & PERBANDINGAN AMAN
 * ================================================================ */

/**
 * Tandai pesanan PENDING yang sudah lewat expires_at menjadi CANCELLED.
 * Dipanggil best-effort saat membuat pesanan & pada setiap webhook agar
 * kode unik lama cepat lepas dan bisa dipakai pembeli berikutnya.
 */
function expireStaleOrders() {
  const now = Date.now();
  const stale = db
    .prepare(`SELECT id, order_code FROM orders WHERE status = 'PENDING' AND expires_at < ? LIMIT 50`)
    .all(now);
  if (!stale.length) return 0;
  const upd = db.prepare(`UPDATE orders SET status = 'CANCELLED', note = 'kedaluwarsa otomatis' WHERE id = ? AND status = 'PENDING'`);
  let n = 0;
  for (const s of stale) {
    const r = upd.run(s.id); // guard status = idempoten terhadap balapan webhook
    if (r.changes > 0) {
      n += r.changes;
      // Linimasa: kedaluwarsa otomatis (penting saat pelacakan "kenapa bayaranku hangus")
      require("./pesanan").catatEvent(
        s.id,
        "batal",
        "sistem",
        `Pesanan ${s.order_code} kedaluwarsa otomatis — tagihan tidak dibayar dalam batas waktu.`
      );
    }
  }
  return n;
}

/** Bandingkan secret webhook secara timing-safe (anti timing attack). */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  QRIS_DANA_METHOD,
  ORDER_EXPIRY_HOURS,
  generateOrderCode,
  generateAccessToken,
  generateUniqueCode,
  resolveAmountCollision,
  parseWebhookPayload,
  normalizeRupiah,
  extractDanaAmount,
  extractDanaAmountFrom,
  expireStaleOrders,
  safeCompare,
};
