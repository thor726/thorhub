/**
 * store.js — Katalog paket, konfigurasi toko, dan fulfillment pesanan.
 *
 * Paket harga kuota token (ditetapkan pemilik toko):
 *   10jt → Rp 8.000 · 20jt → Rp 16.000 · 50jt → Rp 36.000
 *   100jt → Rp 70.000 · 200jt → Rp 130.000 · 500jt → Rp 300.000
 *
 * Konfigurasi toko (QRIS statis, secret webhook, token Fonnte/Resend)
 * disimpan di tabel settings sebagai JSON — diatur dari panel admin,
 * tanpa perlu menyentuh .env / restart layanan.
 */
const crypto = require("crypto");
const db = require("../db");
const payment = require("./payment");
const notify = require("./notify");

/** Katalog paket kuota — harga Rupiah tetap, token per paket. */
const PACKAGES = [
  { id: "10m", label: "10 Juta", tokens: 10_000_000, price: 8_000 },
  { id: "20m", label: "20 Juta", tokens: 20_000_000, price: 16_000 },
  { id: "50m", label: "50 Juta", tokens: 50_000_000, price: 36_000 },
  { id: "100m", label: "100 Juta", tokens: 100_000_000, price: 70_000 },
  { id: "200m", label: "200 Juta", tokens: 200_000_000, price: 130_000 },
  { id: "500m", label: "500 Juta", tokens: 500_000_000, price: 300_000 },
];

function packageById(id) {
  return PACKAGES.find((p) => p.id === id) || null;
}

/* ================================================================
 * SETTINGS (tabel settings — JSON per kunci)
 * ================================================================ */

const QRIS_DEFAULT = { enabled: false, static: "", secret: "" };
const NOTIFY_DEFAULT = {
  fonnteToken: "", // token device Fonnte (https://fonnte.com) — kirim WA
  adminWa: "", // nomor WA admin (62…) — notifikasi order masuk/lunas
  resendKey: "", // API key Resend (https://resend.com) — struk email + key
  emailFrom: "", // pengirim terverifikasi di Resend, mis. "ThorHub <no-reply@domain>"
  waKePembeli: true, // kirim key/konfirmasi ke WA pembeli bila nomornya diisi
  emailKePembeli: true, // kirim struk+key ke email pembeli bila diisi
};

function bacaSetting(kunci, bawaan) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(kunci);
    if (!row) return { ...bawaan };
    return { ...bawaan, ...JSON.parse(row.value) };
  } catch {
    return { ...bawaan };
  }
}

function simpanSetting(kunci, nilai) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(kunci, JSON.stringify(nilai));
}

const getQrisSettings = () => bacaSetting("qris", QRIS_DEFAULT);
const getNotifySettings = () => bacaSetting("notify", NOTIFY_DEFAULT);

/** Secret webhook belum ada? Buat otomatis (dipanggil dari panel admin). */
function generateWebhookSecret() {
  return crypto.randomBytes(24).toString("hex");
}

/* ================================================================
 * FULFILLMENT — eksekusi otomatis pesanan yang sudah dibayar
 * ================================================================ */

/** Format waktu gaya SQLite (UTC) untuk kolom paid_at / completed_at. */
function waktuSql(d = new Date()) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Buat key API baru untuk pesanan 'key_baru' (mirip POST /portal/admin/keys).
 * @returns {string} API key yang diterbitkan
 */
function terbitkanKeyUntukPesanan(order) {
  const apiKey = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
  db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)").run(
    apiKey,
    order.user_name,
    order.quota_tokens
  );
  return apiKey;
}

/**
 * Tambah kuota untuk pesanan 'topup'.
 * @returns {boolean} true bila key target masih ada (dan kuota ditambah)
 */
function tambahKuotaUntukPesanan(order) {
  const key = db.prepare("SELECT id FROM api_keys WHERE api_key = ?").get(order.target_api_key);
  if (!key) return false;
  db.prepare("UPDATE api_keys SET token_limit = token_limit + ? WHERE id = ?").run(order.quota_tokens, key.id);
  return true;
}

/**
 * Tandai pesanan PAID (idempoten: hanya dari PENDING), lalu eksekusi:
 *   mode key_baru → terbitkan key & simpan ke api_key_issued
 *   mode topup    → token_limit += quota_tokens pada key target
 * Setelah COMPLETED, kirim notifikasi (WA + email) best-effort.
 *
 * @returns {{ok: boolean, sudahSelesai: boolean, pesan: string}}
 */
function prosesPesananLunas(order) {
  // 1. Transisi PENDING → PAID (guard status; idempoten terhadap webhook ganda)
  const r = db
    .prepare(`UPDATE orders SET status = 'PAID', paid_at = ? WHERE id = ? AND status = 'PENDING'`)
    .run(waktuSql(), order.id);
  if (r.changes === 0) {
    // Sudah diproses request lain — jangan kirim notifikasi dobel
    return { ok: true, sudahSelesai: true, pesan: "Pesanan sudah tercatat dibayar sebelumnya." };
  }

  // 2. Fulfillment
  let selesai = false;
  let catatan = "";
  try {
    if (order.mode === "key_baru") {
      const apiKey = terbitkanKeyUntukPesanan(order);
      db.prepare(`UPDATE orders SET api_key_issued = ? WHERE id = ?`).run(apiKey, order.id);
      order.api_key_issued = apiKey;
      catatan = "key baru diterbitkan";
      selesai = true;
    } else {
      const ok = tambahKuotaUntukPesanan(order);
      catatan = ok ? `kuota +${order.quota_tokens} token ditambahkan` : `key target tidak ditemukan saat fulfillment`;
      selesai = ok;
    }
  } catch (e) {
    catatan = `fulfillment gagal: ${e.message}`;
    db.prepare(`UPDATE orders SET note = ? WHERE id = ?`).run(catatan, order.id);
    return { ok: false, sudahSelesai: false, pesan: catatan };
  }

  // 3. PAID → COMPLETED
  const final = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
  if (selesai) {
    db.prepare(`UPDATE orders SET status = 'COMPLETED', completed_at = ?, note = ? WHERE id = ?`).run(
      waktuSql(),
      catatan,
      order.id
    );
  } else {
    db.prepare(`UPDATE orders SET note = ? WHERE id = ?`).run(catatan, order.id);
  }

  // 4. Notifikasi pembeli + admin (best-effort — tidak boleh memutus alur)
  const orderFinal = selesai ? db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) : final;
  notify
    .kirimNotifikasiLunas(orderFinal)
    .catch((e) => console.error("[store] notifikasi lunas gagal:", e.message));

  return {
    ok: selesai,
    sudahSelesai: false,
    pesan: selesai
      ? order.mode === "key_baru"
        ? "Key baru berhasil diterbitkan & dikirim ke pembeli."
        : `Kuota ${order.quota_tokens.toLocaleString("id-ID")} token berhasil ditambahkan.`
      : "Fulfillment gagal — perlu tindakan admin (key target tidak ditemukan).",
  };
}

module.exports = {
  PACKAGES,
  packageById,
  getQrisSettings,
  getNotifySettings,
  simpanSetting,
  generateWebhookSecret,
  prosesPesananLunas,
  payment,
};
