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
const pesanan = require("./pesanan");
const masaAktif = require("./masa-aktif");

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
 * Masa aktif key = 25 hari sejak diterbitkan (masaAktif.masaAktifBaru).
 * @returns {{apiKey: string, expiresAt: string}} API key & masa aktifnya
 */
function terbitkanKeyUntukPesanan(order) {
  const apiKey = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
  const expiresAt = masaAktif.masaAktifBaru();
  db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit, expires_at) VALUES (?, ?, ?, ?)").run(
    apiKey,
    order.user_name,
    order.quota_tokens,
    expiresAt
  );
  return { apiKey, expiresAt };
}

/**
 * Tambah kuota untuk pesanan 'topup' — SEKALIGUS perpanjang masa aktif key
 * menjadi max(sekarang, masa aktif lama) + 25 hari (aturan toko token:
 * top-up selalu memperpanjang, sisa masa aktif lama tidak hangus).
 * @returns {string|null} masa aktif baru (string SQLite) bila sukses, null bila key target hilang
 */
function tambahKuotaUntukPesanan(order) {
  const key = db.prepare("SELECT id, expires_at FROM api_keys WHERE api_key = ?").get(order.target_api_key);
  if (!key) return null;
  const masaBaru = masaAktif.perpanjangMasaAktif(key.expires_at);
  db.prepare("UPDATE api_keys SET token_limit = token_limit + ?, expires_at = ? WHERE id = ?").run(
    order.quota_tokens,
    masaBaru,
    key.id
  );
  return masaBaru;
}

/**
 * Tandai pesanan PAID (idempoten: hanya dari PENDING), lalu eksekusi:
 *   mode key_baru → terbitkan key & simpan ke api_key_issued
 *   mode topup    → token_limit += quota_tokens pada key target
 * Setelah COMPLETED, kirim notifikasi (WA + email) best-effort.
 *
 * @param {object} order  baris orders lengkap
 * @param {object} opts   { actor: 'webhook'|'admin', alasan: string } —
 *                        dicatat ke linimasa pesanan untuk pelacakan admin.
 * @returns {{ok: boolean, sudahSelesai: boolean, pesan: string}}
 */
function prosesPesananLunas(order, opts = {}) {
  const actor = opts.actor === "admin" ? "admin" : "webhook";
  const alasan = String(opts.alasan || "").trim().slice(0, 300);

  // 1. Transisi PENDING → PAID (guard status; idempoten terhadap webhook ganda)
  const r = db
    .prepare(`UPDATE orders SET status = 'PAID', paid_at = ? WHERE id = ? AND status = 'PENDING'`)
    .run(waktuSql(), order.id);
  if (r.changes === 0) {
    // Sudah diproses request lain — jangan kirim notifikasi dobel
    return { ok: true, sudahSelesai: true, pesan: "Pesanan sudah tercatat dibayar sebelumnya." };
  }
  pesanan.catatEvent(
    order.id,
    "lunas",
    actor,
    `Pembayaran ${pesanan.rupiah(order.amount_to_pay)} diterima` +
      (actor === "admin" ? ` — dikonfirmasi MANUAL oleh admin${alasan ? ` (\u201c${alasan}\u201d)` : ""}` : " otomatis via notifikasi DANA.")
  );

  // 2. Fulfillment
  let selesai = false;
  let catatan = "";
  let masaAktifBaru = "";
  try {
    if (order.mode === "key_baru") {
      const terbit = terbitkanKeyUntukPesanan(order);
      db.prepare(`UPDATE orders SET api_key_issued = ? WHERE id = ?`).run(terbit.apiKey, order.id);
      order.api_key_issued = terbit.apiKey;
      // Linkage dua arah: pesanan tanpa owner (dibeli tamu / browser lain)
      // dimiliki oleh key yang diterbitkan — pelacakan tetap tampil ketika
      // pembeli login dengan key barunya.
      if (!order.owner_api_key) {
        db.prepare(`UPDATE orders SET owner_api_key = ? WHERE id = ?`).run(terbit.apiKey, order.id);
        order.owner_api_key = terbit.apiKey;
      }
      masaAktifBaru = terbit.expiresAt;
      catatan = "key baru diterbitkan";
      selesai = true;
      pesanan.catatEvent(
        order.id,
        "fulfillment",
        "sistem",
        `API Key baru diterbitkan: ${terbit.apiKey.slice(0, 14)}… (${order.quota_tokens.toLocaleString("id-ID")} token, masa aktif ${masaAktif.MASA_AKTIF_HARI} hari s.d. ${masaAktif.formatWaktuIndo(terbit.expiresAt)})`
      );
    } else {
      const masaBaru = tambahKuotaUntukPesanan(order);
      catatan = masaBaru
        ? `kuota +${order.quota_tokens} token ditambahkan, masa aktif diperpanjang s.d. ${masaAktif.formatWaktuIndo(masaBaru)}`
        : `key target tidak ditemukan saat fulfillment`;
      selesai = !!masaBaru;
      masaAktifBaru = masaBaru || "";
      pesanan.catatEvent(
        order.id,
        masaBaru ? "fulfillment" : "info",
        "sistem",
        masaBaru
          ? `Kuota +${order.quota_tokens.toLocaleString("id-ID")} token ditambahkan ke ${order.target_api_key.slice(0, 18)}… — masa aktif diperpanjang s.d. ${masaAktif.formatWaktuIndo(masaBaru)}`
          : `GAGAL: key target ${order.target_api_key} tidak ditemukan di database — perlu tindakan admin.`
      );
    }
  } catch (e) {
    catatan = `fulfillment gagal: ${e.message}`;
    db.prepare(`UPDATE orders SET note = ? WHERE id = ?`).run(catatan, order.id);
    pesanan.catatEvent(order.id, "info", "sistem", `Fulfillment GAGAL: ${e.message} — perlu tindakan admin.`);
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

  // 4. Notifikasi pembeli + admin (best-effort — tidak boleh memutus alur).
  //    Hasilnya (terkirim/gagal per saluran) dicatat ke linimasa pesanan agar
  //    admin bisa melihat & mengulang pengiriman dari panel bila gagal.
  const orderFinal = selesai ? db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id) : final;
  notify
    .kirimNotifikasiLunas(orderFinal)
    .then((hasil) => {
      const ringkas = [
        hasil.waSent ? "WA pembeli terkirim ✓" : orderFinal.whatsapp ? "WA pembeli GAGAL ✗" : "WA pembeli dilewati (tanpa nomor)",
        hasil.emailSent ? "Email struk terkirim ✓" : orderFinal.email ? "Email struk GAGAL/nonaktif ✗" : "Email dilewati (tanpa alamat)",
        hasil.adminSent ? "WA admin terkirim ✓" : "WA admin gagal/nonaktif",
      ].join(" · ");
      pesanan.catatEvent(order.id, "notifikasi", "sistem", ringkas);
    })
    .catch((e) => {
      console.error("[store] notifikasi lunas gagal:", e.message);
      pesanan.catatEvent(order.id, "notifikasi", "sistem", `Pengiriman notifikasi GAGAL: ${e.message} — gunakan \u201cKirim Ulang\u201d di panel admin.`);
    });

  return {
    ok: selesai,
    sudahSelesai: false,
    pesan: selesai
      ? order.mode === "key_baru"
        ? "Key baru berhasil diterbitkan & dikirim ke pembeli."
        : `Kuota ${order.quota_tokens.toLocaleString("id-ID")} token berhasil ditambahkan — masa aktif diperpanjang ${masaAktif.MASA_AKTIF_HARI} hari s.d. ${masaAktif.formatWaktuIndo(masaAktifBaru)}.`
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
