/**
 * store.js — Route TOKO PEMBELIAN OTOMATIS (QRIS DANA).
 *
 * Alur sama dengan toko Thor-market (diporting ke Express + SQLite):
 *
 *   1. Pembeli memilih paket & mode (key baru / top-up) → POST /store/orders
 *      Server menghitung nominal = harga + KODE UNIK 1-999, membuat QRIS
 *      DINAMIS (QRIS statis milik admin + nominal tertanam Tag 54).
 *   2. Pembeli scan & bayar nominal persis via DANA/app QRIS apa pun.
 *   3. Notifikasi DANA di HP admin ditangkap MacroDroid → POST
 *      /store/webhook/dana {"secret_token","text"}. Server mengekstrak
 *      nominal, mencocokkan EKSAK dengan pesanan PENDING, menandai PAID,
 *      lalu otomatis: terbitkan key BARU / tambah kuota key, kirim WA + email.
 *   4. Halaman pembeli polling GET /store/order/:code setiap 5 detik →
 *      begitu COMPLETED, key tampil + tombol salin.
 *
 * Keamanan:
 *   - Webhook dijaga secret timing-safe + brute-force guard 20 salah/10mnt.
 *   - Halaman status: detail (QR & API key) hanya dikirim bila membawa
 *     access_token yang diberikan sekali saat pesanan dibuat.
 *   - Rate limit per IP untuk semua endpoint publik.
 *   - Pembayaran KURANG dari total tidak pernah dilunaskan otomatis.
 */
const express = require("express");
const db = require("../db");
const store = require("../lib/store");
const payment = require("../lib/payment");
const qris = require("../lib/qris");
const notify = require("../lib/notify");
const ratelimit = require("../lib/ratelimit");
const pesanan = require("../lib/pesanan");
const masaAktif = require("../lib/masa-aktif");

const { QRIS_DANA_METHOD, ORDER_EXPIRY_HOURS } = payment;

const router = express.Router();

/** Ambil IP klien (buang awalan ::ffff: dari mapping IPv4 Express). */
function ipKlien(req) {
  return String(req.ip || "").replace(/^::ffff:/, "");
}

/** Catat event webhook ke payment_events (audit). */
function logEvent(amount, matched, orderCode, rawText, note = "", ip = "") {
  try {
    db.prepare(
      "INSERT INTO payment_events (source, raw_text, amount, matched, order_code, note, ip) VALUES ('dana', ?, ?, ?, ?, ?, ?)"
    ).run(String(rawText || "").slice(0, 500), amount, matched ? 1 : 0, orderCode || "", note || "", String(ip || "").slice(0, 64));
  } catch (e) {
    console.error("[store] gagal simpan payment_event:", e.message);
  }
}

/* ================================================================
 * GET /store/packages — katalog paket + status kesiapan toko (publik)
 * ================================================================ */
router.get("/packages", (_req, res) => {
  const q = store.getQrisSettings();
  const tautan = notify.tautanToko();
  res.json({
    data: {
      packages: store.PACKAGES,
      store_ready: !!(q.enabled && q.static && q.secret),
      expiry_hours: ORDER_EXPIRY_HOURS,
      api_base: tautan.api, // ditampilkan di halaman sukses /beli
      portal_url: tautan.portal,
    },
  });
});

/* ================================================================
 * POST /store/orders — buat pesanan (publik)
 * Body: { mode:'key_baru'|'topup', package_id, user_name, email?,
 *         whatsapp?, api_key? (wajib utk topup) }
 * ================================================================ */
router.post("/orders", async (req, res) => {
  // Rate limit 10 order/menit/IP
  const rl = ratelimit.hit("order", ipKlien(req), 10, 60_000);
  if (rl.limited) {
    return res.status(429).json({ error: { message: "Terlalu banyak pesanan. Coba lagi nanti.", code: "rate_limited" } });
  }

  const body = req.body || {};
  const mode = String(body.mode || "").trim();
  const packageId = String(body.package_id || "").trim();

  // 1. Toko harus siap (QRIS aktif + string + secret terisi dari panel admin)
  const q = store.getQrisSettings();
  if (!q.enabled || !q.static || !q.secret) {
    return res.status(503).json({
      error: { message: "Toko sedang tutup — pembayaran QRIS belum diaktifkan admin.", code: "store_closed" },
    });
  }
  if (!qris.validateStaticQris(q.static).ok) {
    return res.status(503).json({
      error: { message: "Konfigurasi QRIS tidak valid. Hubungi admin.", code: "qris_invalid" },
    });
  }

  // 2. Validasi input
  if (mode !== "key_baru" && mode !== "topup") {
    return res.status(400).json({ error: { message: "mode harus 'key_baru' atau 'topup'.", code: "invalid_request" } });
  }
  const paket = store.packageById(packageId);
  if (!paket) {
    return res.status(400).json({ error: { message: "Paket tidak dikenal.", code: "invalid_request" } });
  }

  const userName = String(body.user_name || "").trim().slice(0, 60);
  if (!userName) {
    return res.status(400).json({ error: { message: "Nama wajib diisi.", code: "invalid_request" } });
  }

  const email = String(body.email || "").trim().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: { message: "Format email tidak valid.", code: "invalid_request" } });
  }
  if (mode === "key_baru" && !email) {
    // Email wajib untuk key baru: API key dikirim juga ke email (permintaan pemilik toko)
    return res.status(400).json({
      error: { message: "Email wajib diisi — API key akan dikirim juga ke email Anda.", code: "invalid_request" },
    });
  }

  // Normalisasi nomor WA: 08xx → 628xx (format target Fonnte)
  let whatsapp = String(body.whatsapp || "").trim().replace(/[^\d+]/g, "").slice(0, 20);
  if (whatsapp.startsWith("+")) whatsapp = whatsapp.slice(1);
  if (whatsapp.startsWith("0")) whatsapp = "62" + whatsapp.slice(1);
  if (whatsapp && !/^62\d{7,15}$/.test(whatsapp)) {
    return res.status(400).json({
      error: { message: "Nomor WhatsApp tidak valid (contoh: 0812xxxx atau 62812xxxx).", code: "invalid_request" },
    });
  }

  // 3. Mode topup: key target harus ada & aktif (dicek sekarang, eksekusi saat PAID)
  let targetKey = "";
  if (mode === "topup") {
    targetKey = String(body.api_key || "").trim();
    const row = db.prepare("SELECT id, is_active FROM api_keys WHERE api_key = ?").get(targetKey);
    if (!row) {
      return res.status(404).json({ error: { message: "API Key tidak ditemukan. Periksa kembali key Anda.", code: "invalid_api_key" } });
    }
    if (!row.is_active) {
      return res.status(403).json({ error: { message: "API Key Anda dinonaktifkan. Hubungi admin untuk top-up.", code: "key_disabled" } });
    }
  }

  // 4. Bersihkan order kedaluwarsa (kode unik lama lepas) lalu pilih kode unik
  payment.expireStaleOrders();
  let uniqueCode = payment.generateUniqueCode(paket.price);
  let amountToPay = paket.price + uniqueCode;

  // 5. Simpan pesanan PENDING
  const orderCode = payment.generateOrderCode();
  const accessToken = payment.generateAccessToken();
  const expiresAt = Date.now() + ORDER_EXPIRY_HOURS * 3600_000;
  const info = db
    .prepare(
      `INSERT INTO orders
        (order_code, access_token, mode, package_id, quota_tokens, user_name, email, whatsapp,
         target_api_key, base_amount, unique_code, amount_to_pay, payment_method, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderCode, accessToken, mode, paket.id, paket.tokens, userName,
      email, whatsapp, targetKey, paket.price, uniqueCode, amountToPay,
      QRIS_DANA_METHOD, expiresAt
    );
  const orderId = info.lastInsertRowid;

  // 6. Race guard nominal (lapisan kedua setelah INSERT)
  amountToPay = payment.resolveAmountCollision(orderId, paket.price, amountToPay);
  uniqueCode = amountToPay - paket.price;
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);

  // 7. Bangun QRIS dinamis + render PNG (gagal → batalkan pesanan)
  let qrImage = "";
  try {
    const dynamic = qris.buildDynamicQris(q.static, amountToPay);
    qrImage = await qris.qrisToDataUrl(dynamic, 512);
  } catch (e) {
    console.error("[store] gagal membangun QRIS dinamis:", e.message);
    db.prepare(`UPDATE orders SET status = 'CANCELLED', note = 'qris gagal dibangun' WHERE id = ?`).run(orderId);
    pesanan.catatEvent(orderId, "info", "sistem", `Gagal membangun QRIS dinamis (${e.message}) — pesanan dibatalkan otomatis.`);
    return res.status(503).json({ error: { message: "Gagal menyiapkan QRIS. Hubungi admin.", code: "qris_error" } });
  }

  // Linimasa: pesanan resmi dibuat & menunggu pembayaran (pelacakan admin)
  pesanan.catatEvent(
    orderId,
    "dibuat",
    "pembeli",
    `Pesanan dibuat — ${paket.label} (${paket.tokens.toLocaleString("id-ID")} token), ` +
      `tagihan ${pesanan.rupiah(amountToPay)} (kode unik +${uniqueCode}), berlaku ${ORDER_EXPIRY_HOURS} jam.`
  );

  // 8. Notifikasi WA admin (best-effort, tanpa menahan respons)
  notify.notifyAdminNewOrder(order).catch(() => {});

  res.status(201).json({
    data: {
      order: {
        order_code: order.order_code,
        mode: order.mode,
        package_id: order.package_id,
        quota_tokens: order.quota_tokens,
        user_name: order.user_name,
        status: order.status,
      },
      payment: {
        order_code: order.order_code,
        base_amount: paket.price,
        unique_code: uniqueCode,
        amount_to_pay: amountToPay,
        qr_image: qrImage,
        expires_at: expiresAt,
        server_now: Date.now(),
        access_token: accessToken, // dikirim SEKALI — disimpan halaman (localStorage)
        expiry_hours: ORDER_EXPIRY_HOURS,
      },
    },
  });
});

/* ================================================================
 * GET /store/order/:code — status pesanan (polling, publik + token)
 * ?t=<access_token> → detail lengkap (QR saat PENDING, API key saat selesai)
 * Tanpa token → hanya status ringkas (QR/key tidak bocor).
 * ================================================================ */
router.get("/order/:code", async (req, res) => {
  const rl = ratelimit.hit("status", ipKlien(req), 120, 60_000);
  if (rl.limited) {
    return res.status(429).json({ error: { message: "Terlalu banyak permintaan.", code: "rate_limited" } });
  }

  const code = String(req.params.code || "").trim().toUpperCase();
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(code);
  if (!order) {
    return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
  }

  const token = String(req.query.t || "").trim();
  const berhak = !!token && payment.safeCompare(token, order.access_token);

  // Polling juga memicu pembersihan order kedaluwarsa (best-effort)
  payment.expireStaleOrders();
  if (order.status === "PENDING") {
    // Refresh status setelah pembersihan (mungkin baru saja ter-batalkan)
    order.status = db.prepare("SELECT status FROM orders WHERE id = ?").get(order.id).status;
  }

  const payload = {
    order_code: order.order_code,
    status: order.status,
    amount_to_pay: order.amount_to_pay,
    unique_code: order.unique_code,
    base_amount: order.base_amount,
    package_id: order.package_id,
    quota_tokens: order.quota_tokens,
    mode: order.mode,
    expires_at: order.expires_at,
    server_now: Date.now(),
  };

  res.setHeader("Cache-Control", "no-store");
  if (!berhak) {
    payload.limited = true;
    return res.json({ data: payload });
  }

  // Detail penuh untuk pemegang access_token
  if (order.status === "PENDING" && order.expires_at >= Date.now()) {
    const q = store.getQrisSettings();
    try {
      const dynamic = qris.buildDynamicQris(q.static, order.amount_to_pay);
      payload.qr_image = await qris.qrisToDataUrl(dynamic, 512);
    } catch {
      /* gagal membangun ulang QR → respons lanjut tanpa qr_image */
    }
  }
  if (order.status === "COMPLETED") {
    payload.completed_at = order.completed_at;
    if (order.mode === "key_baru") payload.api_key = order.api_key_issued;
    if (order.mode === "topup") {
      payload.target_api_key_masked = order.target_api_key.slice(0, 18) + "…";
      payload.added_tokens = order.quota_tokens;
    }
    // Masa aktif key terkait (baru diterbitkan ATAU diperpanjang top-up) —
    // ditampilkan di halaman sukses pembeli & dipakai polling portal member.
    const apiK = order.mode === "key_baru" ? order.api_key_issued : order.target_api_key;
    const exp = masaAktif.expiryKeyDariDb(apiK);
    const expMs = masaAktif.expiryMs(exp);
    if (expMs != null) {
      payload.masa_aktif_sampai = masaAktif.formatWaktuIndo(expMs);
      payload.key_days_left = Math.max(0, Math.ceil((expMs - Date.now()) / masaAktif.MS_HARI));
    }
  }

  res.json({ data: payload });
});

/* ================================================================
 * POST /store/order/:code/cancel — pembeli batalkan pesanan (butuh token)
 * ================================================================ */
router.post("/order/:code/cancel", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(code);
  if (!order) {
    return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
  }
  const token = String((req.body && req.body.access_token) || "").trim();
  if (!token || !payment.safeCompare(token, order.access_token)) {
    return res.status(403).json({ error: { message: "Token akses tidak valid.", code: "forbidden" } });
  }
  const r = db
    .prepare(`UPDATE orders SET status = 'CANCELLED', note = 'dibatalkan pembeli' WHERE id = ? AND status = 'PENDING'`)
    .run(order.id);
  if (r.changes === 0) {
    return res.status(409).json({ error: { message: "Pesanan sudah diproses / tidak bisa dibatalkan.", code: "not_cancellable" } });
  }
  pesanan.catatEvent(order.id, "batal", "pembeli", "Pesanan dibatalkan oleh pembeli sebelum pembayaran.");
  res.json({ data: { cancelled: true } });
});

/* ================================================================
 * WEBHOOK DANA — inti dipisah agar bisa diuji dari panel admin
 * ================================================================ */

// Brute-force guard secret: 20 salah / 10 menit / IP → blokir 10 menit.
// Threshold sengaja tinggi agar MacroDroid (yang berbagi IP carrier-NAT
// dengan penyerang) tidak ikut terblokir; hitungan di-reset oleh notif valid.
const wfFails = new Map(); // ip → { count, windowStart, blockedUntil }
const WF_WINDOW_MS = 10 * 60_000;
const WF_MAX_FAILS = 20;
const WF_BLOCK_MS = 10 * 60_000;

function webhookBlockedSec(ip) {
  const r = wfFails.get(ip);
  if (r && r.blockedUntil > Date.now()) return Math.ceil((r.blockedUntil - Date.now()) / 1000);
  return 0;
}
function recordWebhookFail(ip) {
  const now = Date.now();
  const r = wfFails.get(ip);
  if (!r || now - r.windowStart > WF_WINDOW_MS) {
    wfFails.set(ip, { count: 1, windowStart: now, blockedUntil: 0 });
    return;
  }
  r.count += 1;
  if (r.count >= WF_MAX_FAILS) r.blockedUntil = now + WF_BLOCK_MS;
}

/**
 * Inti proses webhook DANA — dipisah dari HTTP agar bisa dipanggil
 * dari uji webhook panel admin (portal.js).
 * @param {string} raw body mentah (string)
 * @param {string} ctype Content-Type request
 * @param {string} hSecret secret dari header (x-secret-token/x-webhook-secret)
 * @param {string} ip IP pemanggil
 * @param {object} opts { uji: boolean } → mode uji: tidak eksekusi fulfillment
 * @returns {{status: number, payload: object}}
 */
function prosesWebhookDana(raw, ctype, hSecret, ip, opts = {}) {
  const { secret, text, candidates, placeholder } = payment.parseWebhookPayload(ctype, hSecret, raw);

  // 1. Verifikasi secret (timing-safe)
  const q = store.getQrisSettings();
  const expected = (q.secret || "").trim();
  if (!expected) {
    return { status: 401, payload: { success: false, message: "Webhook belum dikonfigurasi admin." } };
  }
  if (!payment.safeCompare((secret || "").trim(), expected)) {
    if (!opts.uji) recordWebhookFail(ip);
    logEvent(0, false, "", "", `secret-invalid`, ip);
    return {
      status: 401,
      payload: {
        success: false,
        message: "Secret token tidak valid. Kirim secret lewat header x-secret-token atau field secret_token di body (bukan query URL).",
      },
    };
  }
  if (!opts.uji) wfFails.delete(ip); // notifikasi valid → reset hitungan

  // 2. Placeholder MacroDroid tidak ter-expand?
  if (placeholder) {
    logEvent(0, false, "", raw, `placeholder:${placeholder}`, ip);
    return {
      status: 200,
      payload: {
        success: true,
        matched: false,
        placeholder,
        message: `MacroDroid mengirim variabel apa adanya ("${placeholder}") — isi notifikasi TIDAK ikut terkirim. Perbaiki aksi HTTP Request: sisipkan variabel lewat tombol Magic Text (Notification Text). Contoh body: {"secret_token":"...","text":"[notif_text]"}.`,
      },
    };
  }

  // 3. Ekstrak nominal dari teks notifikasi
  const amount = payment.extractDanaAmount(text) ?? payment.extractDanaAmountFrom(candidates);
  if (!amount) {
    logEvent(0, false, "", raw, "nominal-tidak-terdeteksi", ip);
    return {
      status: 200,
      payload: {
        success: true,
        matched: false,
        message: "Nominal tidak terdeteksi dari teks notifikasi. Pastikan MacroDroid mengirim ISI notifikasi (Magic Text: Notification Text), bukan teks statis.",
      },
    };
  }

  // 3b. Mode UJI: secret valid + parser jalan + nominal terbaca → cukup.
  //     Berhenti di sini supaya uji TIDAK PERNAH menyentuh/melunaskan
  //     pesanan PENDING yang nyata.
  if (opts.uji) {
    return {
      status: 200,
      payload: {
        success: true,
        matched: true,
        amount,
        message: `UJI BERHASIL: secret valid, payload terbaca, nominal Rp ${amount.toLocaleString("id-ID")} terdeteksi. Webhook siap menerima notifikasi DANA asli.`,
      },
    };
  }

  // 4. Pencocokan eksak 4 tahap — pesanan TERLAMA didahulukan
  const sekarang = Date.now();
  const cari = (ekstra, args) =>
    db
      .prepare(
        `SELECT * FROM orders WHERE status = 'PENDING' AND amount_to_pay = ? ${ekstra}
         ORDER BY created_at ASC, id ASC LIMIT 1`
      )
      .get(...[amount, ...args]);

  let order =
    cari(`AND payment_method = ? AND unique_code > 0 AND expires_at >= ?`, [QRIS_DANA_METHOD, sekarang]) ||
    cari(`AND payment_method = ? AND unique_code > 0`, [QRIS_DANA_METHOD]) ||
    cari(`AND expires_at >= ?`, [sekarang]) ||
    cari(``, []);

  // 5. Pembayaran kurang dari total → TIDAK dilunaskan otomatis (catat utk admin)
  if (!order) {
    const near = db
      .prepare(`SELECT * FROM orders WHERE status = 'PENDING' AND amount_to_pay >= ? AND amount_to_pay <= ? ORDER BY created_at DESC LIMIT 10`)
      .all(amount + 1, amount + 999);
    const fresh = near.filter((o) => o.expires_at >= sekarang);
    const pool = fresh.length ? fresh : near;
    if (pool.length) {
      const daftar = pool
        .slice(0, 5)
        .map((o) => `${o.order_code} (${pesanan.rupiah(o.amount_to_pay)})`)
        .join(", ");
      logEvent(amount, false, pool.length === 1 ? pool[0].order_code : "", raw, `kurang-biaya-admin:${daftar}`, ip);
      // Bila persis SATU kandidat, ikat event ke linimasa pesanan itu agar
      // admin melihat dugaan pembayaran kurang langsung di detail pesanan.
      if (pool.length === 1) {
        pesanan.catatEvent(
          pool[0].id,
          "webhook",
          "webhook",
          `Notifikasi DANA masuk ${pesanan.rupiah(amount)} — KURANG dari tagihan ${pesanan.rupiah(pool[0].amount_to_pay)} (biaya admin belum dibayar?). TIDAK dilunaskan otomatis.`
        );
      }
      return {
        status: 200,
        payload: {
          success: true,
          matched: false,
          amount,
          message: `Nominal Rp ${amount.toLocaleString("id-ID")} kurang dari total pesanan: ${daftar} — biaya admin belum dibayar. Pesanan TIDAK dilunaskan otomatis; konfirmasi manual di Panel Admin → Toko bila dana benar-benar masuk.`,
        },
      };
    }
  }

  if (!order) {
    logEvent(amount, false, "", raw, "", ip);
    return {
      status: 200,
      payload: {
        success: true,
        matched: false,
        amount,
        message: `Tidak ada pesanan menunggu dengan nominal ${pesanan.rupiah(amount)}.`,
      },
    };
  }

  logEvent(amount, true, order.order_code, raw, "", ip);
  pesanan.catatEvent(order.id, "webhook", "webhook", `Notifikasi DANA masuk: nominal ${pesanan.rupiah(amount)} cocok dengan tagihan — diproses otomatis.`);

  // 6. Tandai PAID + eksekusi otomatis (idempoten terhadap notif ulang)
  const hasil = store.prosesPesananLunas(order);
  if (!hasil.ok && !hasil.sudahSelesai) {
    console.error(`[store] fulfillment pesanan ${order.order_code} gagal: ${hasil.pesan}`);
  }

  // 7. Bersihkan order kedaluwarsa lainnya (best-effort)
  payment.expireStaleOrders();

  return {
    status: 200,
    payload: {
      success: true,
      matched: true,
      amount,
      order_code: order.order_code,
      message: `Pembayaran ${pesanan.rupiah(amount)} cocok dengan pesanan ${order.order_code}. ${hasil.pesan}`,
    },
  };
}

/* --------------------------------------------------------------
 * POST /store/webhook/dana — endpoint MacroDroid
 * express.text(type:()=>true) menangkap SEMUA content-type ke raw string
 * (JSON global middleware sudah mem-parsing application/json lebih dulu,
 *  jadi object juga dinormalisasi kembali ke string).
 * -------------------------------------------------------------- */
router.post(
  "/webhook/dana",
  express.text({ type: () => true, limit: "16kb" }),
  (req, res) => {
    const ip = ipKlien(req);

    // Rate limit 30/menit/IP
    const rl = ratelimit.hit("webhook", ip, 30, 60_000);
    if (rl.limited) {
      return res.status(429).json({ success: false, message: "Terlalu banyak permintaan webhook." });
    }
    // Brute-force guard
    const blocked = webhookBlockedSec(ip);
    if (blocked > 0) {
      return res
        .status(429)
        .set("Retry-After", String(blocked))
        .json({ success: false, message: "Terlalu banyak percobaan tidak valid." });
    }

    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    const hSecret = req.headers["x-secret-token"] || req.headers["x-webhook-secret"] || "";
    const hasil = prosesWebhookDana(raw, req.headers["content-type"] || "", hSecret, ip);
    return res.status(hasil.status).json(hasil.payload);
  }
);

module.exports = { router, prosesWebhookDana, logEvent };
