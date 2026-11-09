/**
 * portal.js — Route website (bukan API OpenAI-compatible).
 *
 * Menangani login/logout panel admin & portal member, serta info sesi.
 * Semua endpoint di sini memakai cookie sesi HttpOnly (lihat src/lib/session.js).
 *
 *   POST /portal/admin/login    { password }   → set cookie admin
 *   POST /portal/admin/logout                  → hapus cookie admin
 *   GET  /portal/admin/me                       → info sesi admin
 *
 *   POST /portal/member/login   { api_key }    → set cookie member
 *   POST /portal/member/logout                 → hapus cookie member
 *   GET  /portal/member/me                      → info sesi member + kuota
 */
const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const db = require("../db");
const session = require("../lib/session");
const models = require("../lib/models");
const bruteforce = require("../lib/bruteforce");
const masaAktif = require("../lib/masa-aktif");
const DEFAULT_MODEL = models.DEFAULT_MODEL;

// Cache sederhana daftar model (hindari spam ke provider tiap request)
let modelsCache = { at: 0, data: null };
const MODELS_TTL_MS = 60 * 1000; // 60 detik

const router = express.Router();

/** Bandingkan dua string waktu-konstan. */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Middleware: wajib sesi admin. */
function requireAdminSession(req, res, next) {
  const token = session.parseCookies(req.headers.cookie)[session.ADMIN_COOKIE];
  const s = session.getSession(token);
  if (!s || s.role !== "admin") {
    return res.status(401).json({ error: { message: "Sesi admin tidak valid. Silakan login.", code: "unauthorized" } });
  }
  req.session = s;
  next();
}

/** Middleware: wajib sesi member. */
function requireMemberSession(req, res, next) {
  const token = session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE];
  const s = session.getSession(token);
  if (!s || s.role !== "member") {
    return res.status(401).json({ error: { message: "Sesi member tidak valid. Silakan login.", code: "unauthorized" } });
  }
  req.session = s;
  next();
}

// ---------------------------------------------------------------
// DAFTAR MODEL (publik) — dokumen publik, tanpa auth
// ---------------------------------------------------------------
router.get("/models", async (req, res) => {
  // Parameter opsional: ?all=1 (tampilkan juga yang nonaktif), ?vendor=DeepSeek
  const showAll = req.query.all === "1" || req.query.all === "true";
  const vendorFilter = (req.query.vendor || "").toString().trim().toLowerCase();

  // Pakai cache bila masih segar
  if (modelsCache.data && Date.now() - modelsCache.at < MODELS_TTL_MS) {
    return res.json(buildPayload(modelsCache.data, showAll, vendorFilter, { cached: true }));
  }

  let list = null;
  let stale = false;
  try {
    const url = `${config.targetBaseUrl.replace(/\/$/, "")}/models`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${config.masterApiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Provider membalas HTTP ${r.status}`);
    const j = await r.json();
    list = models.normalizeProviderModels(j && j.data);
    modelsCache = { at: Date.now(), data: list };
  } catch (e) {
    // Fallback: pakai snapshot lokal dari docs resmi, atau cache lama bila ada
    list = modelsCache.data || models.MODELS;
    stale = true;
  }

  res.json(buildPayload(list, showAll, vendorFilter, { cached: !!modelsCache.data && stale, stale }));
});

/** Susun respons daftar model sesuai filter (aktif saja / semua, per vendor). */
function buildPayload(list, showAll, vendorFilter, extra) {
  const filtered = list
    .filter((m) => showAll || m.active)
    .filter((m) => !vendorFilter || String(m.vendor).toLowerCase() === vendorFilter)
    .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id));
  return {
    data: filtered,
    meta: {
      total: list.length,
      active: list.filter((m) => m.active).length,
      returned: filtered.length,
      vendors: models.VENDORS,
      default_model: DEFAULT_MODEL,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------
// ADMIN — login / logout / me
// ---------------------------------------------------------------
router.post("/admin/login", bruteforce.guard("admin"), async (req, res) => {
  if (!config.adminPassword) {
    return res.status(503).json({
      error: { message: "ADMIN_PASSWORD belum diatur di server.", code: "admin_not_configured" },
    });
  }
  const password = (req.body && (req.body.password || req.body.admin_password)) || "";
  if (!password) {
    return res.status(400).json({ error: { message: 'Field "password" wajib diisi.', code: "invalid_request" } });
  }
  if (!safeEqual(password, config.adminPassword)) {
    // Catat percobaan gagal; beri jeda kecil untuk memperlambat serangan otomatis.
    const diblokir = bruteforce.catatGagal(req, "admin");
    console.warn(`[SECURITY] Login admin GAGAL dari IP ${(req.ip || "").replace(/^::ffff:/, "")}${diblokir ? " → IP DIBLOKIR sementara" : ""}`);
    await new Promise((r) => setTimeout(r, bruteforce.FAIL_DELAY_MS));
    if (diblokir) {
      return res.status(429).json({ error: { message: "Terlalu banyak percobaan gagal. Coba lagi nanti.", code: "too_many_attempts" } });
    }
    return res.status(401).json({ error: { message: "Password admin salah.", code: "unauthorized" } });
  }
  // Login sukses → bersihkan penghitung brute-force untuk IP ini.
  bruteforce.catatSukses(req, "admin");
  const { token } = session.createSession({ role: "admin", ttlMs: session.ADMIN_TTL_MS });
  res.setHeader("Set-Cookie", session.buildSetCookie(session.ADMIN_COOKIE, token, session.ADMIN_TTL_MS, session.isSecureRequest(req)));
  res.json({ data: { message: "Login admin berhasil.", role: "admin" } });
});

router.post("/admin/logout", (req, res) => {
  const token = session.parseCookies(req.headers.cookie)[session.ADMIN_COOKIE];
  session.destroySession(token);
  res.setHeader("Set-Cookie", session.buildClearCookie(session.ADMIN_COOKIE));
  res.json({ data: { message: "Logout berhasil." } });
});

router.get("/admin/me", requireAdminSession, (req, res) => {
  // expires_at (epoch ms) dikirim ke frontend agar UI bisa menjadwalkan
  // auto-logout tepat saat sesi 2 jam habis.
  res.json({ data: { role: "admin", expires_at: req.session.expires_at, ttl_ms: session.SESSION_TTL_MS } });
});

// ---- Kelola key via sesi panel (tanpa mengekspos ADMIN_API_KEY ke browser) ----
const LIST_COLS = "id, api_key, user_name, token_limit, tokens_used, is_active, created_at, expires_at";

function decorate(row) {
  return masaAktif.decorateKey(row); // tambah expired / days_left / masa_aktif_label
}

// GET /portal/admin/keys — daftar semua key
router.get("/admin/keys", requireAdminSession, (_req, res) => {
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM api_keys ORDER BY id DESC`).all();
  res.json({ data: rows.map(decorate) });
});

// GET /portal/admin/usage — ringkasan total
router.get("/admin/usage", requireAdminSession, (_req, res) => {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS total_keys,
              COALESCE(SUM(is_active), 0) AS active_keys,
              COALESCE(SUM(token_limit), 0) AS total_token_limit,
              COALESCE(SUM(tokens_used), 0) AS total_tokens_used
       FROM api_keys`
    )
    .get();
  res.json({ data: agg });
});

// POST /portal/admin/keys — terbitkan key baru { user_name, token_limit }
// Masa aktif key otomatis 25 hari (config.keyValidityDays) sejak diterbitkan.
router.post("/admin/keys", requireAdminSession, (req, res) => {
  const { user_name, token_limit } = req.body || {};
  if (!user_name || typeof user_name !== "string" || !user_name.trim()) {
    return res.status(400).json({ error: { message: "Field user_name wajib diisi.", code: "invalid_request" } });
  }
  if (!Number.isInteger(token_limit) || token_limit <= 0) {
    return res.status(400).json({ error: { message: "Field token_limit harus bilangan bulat positif.", code: "invalid_request" } });
  }
  const apiKey = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
  const expiresAt = masaAktif.masaAktifBaru();
  const info = db
    .prepare("INSERT INTO api_keys (api_key, user_name, token_limit, expires_at) VALUES (?, ?, ?, ?)")
    .run(apiKey, user_name.trim(), token_limit, expiresAt);
  const row = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ data: decorate(row) });
});

// PATCH /portal/admin/keys/:apiKey — ubah is_active dan/atau token_limit
router.patch("/admin/keys/:apiKey", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const { is_active, token_limit } = req.body || {};
  if (typeof is_active === "undefined" && typeof token_limit === "undefined") {
    return res.status(400).json({ error: { message: "Kirim is_active (boolean) atau token_limit (integer).", code: "invalid_request" } });
  }
  if (typeof is_active !== "undefined" && typeof is_active !== "boolean") {
    return res.status(400).json({ error: { message: "is_active harus boolean.", code: "invalid_request" } });
  }
  if (typeof token_limit !== "undefined" && (!Number.isInteger(token_limit) || token_limit < 0)) {
    return res.status(400).json({ error: { message: "token_limit harus integer >= 0.", code: "invalid_request" } });
  }
  if (typeof is_active !== "undefined") db.prepare("UPDATE api_keys SET is_active = ? WHERE id = ?").run(is_active ? 1 : 0, key.id);
  if (typeof token_limit !== "undefined") db.prepare("UPDATE api_keys SET token_limit = ? WHERE id = ?").run(token_limit, key.id);

  const updated = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(key.id);
  res.json({ data: decorate(updated) });
});

// DELETE /portal/admin/keys/:apiKey — hapus permanen (beserta log pemakaiannya)
router.delete("/admin/keys/:apiKey", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT id FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  // Bersihkan log agar tidak menyisakan baris yatim (dijalankan dalam transaksi)
  const hapus = db.transaction((id) => {
    const log = db.prepare("DELETE FROM usage_logs WHERE api_key_id = ?").run(id);
    const kunci = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
    return { logs: log.changes, keys: kunci.changes };
  });
  const hasil = hapus(key.id);

  res.json({ data: { deleted: true, api_key: req.params.apiKey, logs_removed: hasil.logs } });
});

// POST /portal/admin/keys/:apiKey/reset — nol-kan pemakaian token (log tetap)
router.post("/admin/keys/:apiKey/reset", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const bersihLog = req.body && req.body.hapus_log === true;
  db.prepare("UPDATE api_keys SET tokens_used = 0 WHERE id = ?").run(key.id);
  if (bersihLog) db.prepare("DELETE FROM usage_logs WHERE api_key_id = ?").run(key.id);

  const updated = db.prepare(`SELECT ${LIST_COLS} FROM api_keys WHERE id = ?`).get(key.id);
  res.json({ data: { ...decorate(updated), logs_dihapus: bersihLog } });
});

// GET /portal/admin/keys/:apiKey/usage — rincian pemakaian satu key (per model)
router.get("/admin/keys/:apiKey/usage", requireAdminSession, (req, res) => {
  const key = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.params.apiKey);
  if (!key) return res.status(404).json({ error: { message: "API Key tidak ditemukan.", code: "not_found" } });

  const byModel = db
    .prepare(
      `SELECT model, COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM usage_logs WHERE api_key_id = ?
       GROUP BY model ORDER BY total_tokens DESC LIMIT 20`
    )
    .all(key.id)
    .map((r) => ({ ...r, model: r.model || "(tidak diketahui)" }));

  const byDay = db
    .prepare(
      `SELECT substr(created_at,1,10) AS tanggal, COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs WHERE api_key_id = ? AND created_at >= date('now','-29 days')
       GROUP BY tanggal ORDER BY tanggal`
    )
    .all(key.id);

  const logs = db
    .prepare(
      `SELECT model, prompt_tokens, completion_tokens, total_tokens, status, created_at
       FROM usage_logs WHERE api_key_id = ? ORDER BY id DESC LIMIT 50`
    )
    .all(key.id)
    .map((l) => ({ ...l, model: l.model || "(tidak diketahui)" }));

  res.json({ data: { key: decorate(key), by_model: byModel, by_day: byDay, logs } });
});

// GET /portal/admin/activity — log aktivitas seluruh member (50 terbaru)
router.get("/admin/activity", requireAdminSession, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = db
    .prepare(
      `SELECT l.id, l.model, l.prompt_tokens, l.completion_tokens, l.total_tokens,
              l.status, l.created_at, k.user_name, k.api_key
       FROM usage_logs l
       LEFT JOIN api_keys k ON k.id = l.api_key_id
       ORDER BY l.id DESC LIMIT ?`
    )
    .all(limit);
  res.json({
    data: rows.map((r) => ({
      ...r,
      user_name: r.user_name || "(key dihapus)",
      api_key: r.api_key ? r.api_key.slice(0, 18) + "…" : "—",
      model: r.model || "(tidak diketahui)",
    })),
  });
});

// GET /portal/admin/models — katalog model + jumlah pemakaian (untuk admin)
router.get("/admin/models", requireAdminSession, (_req, res) => {
  const pakai = db
    .prepare(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs GROUP BY model`
    )
    .all();
  const peta = new Map(pakai.map((r) => [r.model, r]));
  res.json({
    data: models.MODELS.map((m) => {
      const p = peta.get(m.id) || { requests: 0, total_tokens: 0 };
      return { id: m.id, vendor: m.vendor, multiplier: m.multiplier, vision: !!m.vision, enabled: m.enabled !== false, ...p };
    }),
  });
});

// ---------------------------------------------------------------
// ADMIN — TOKO & PEMBAYARAN (QRIS DANA otomatis)
// Konfigurasi toko disimpan di tabel settings (bukan .env) sehingga
// bisa diubah dari panel ini tanpa edit server / restart layanan.
// ---------------------------------------------------------------
const storeLib = require("../lib/store");
const storeRoutes = require("./store");
const qrisLib = require("../lib/qris");

/** GET /portal/admin/store — konfigurasi toko + daftar paket. */
router.get("/admin/store", requireAdminSession, (_req, res) => {
  const q = storeLib.getQrisSettings();
  const n = storeLib.getNotifySettings();
  res.json({
    data: {
      packages: storeLib.PACKAGES,
      qris: { enabled: !!q.enabled, static: q.static || "", secret: q.secret || "", secret_ada: !!q.secret },
      notify: {
        fonnteToken: n.fonnteToken || "",
        adminWa: n.adminWa || "",
        resendKey: n.resendKey || "",
        emailFrom: n.emailFrom || "",
        waKePembeli: n.waKePembeli !== false,
        emailKePembeli: n.emailKePembeli !== false,
      },
      expiry_hours: storeLib.payment.ORDER_EXPIRY_HOURS,
      webhook_path: "/store/webhook/dana",
    },
  });
});

/** POST /portal/admin/store/qris — simpan string QRIS statis + on/off. */
router.post("/admin/store/qris", requireAdminSession, (req, res) => {
  const { static: staticQris, enabled } = req.body || {};
  const q = storeLib.getQrisSettings();
  let merchant = null;

  if (typeof staticQris !== "undefined") {
    const nilai = String(staticQris || "").trim();
    const cek = qrisLib.validateStaticQris(nilai);
    if (!cek.ok) {
      return res.status(400).json({ error: { message: cek.error, code: "qris_invalid" } });
    }
    q.static = nilai;
    merchant = { name: cek.merchantName, city: cek.merchantCity };
  }
  if (typeof enabled !== "undefined") q.enabled = !!enabled; // niat admin murni — kesiapan toko dicek runtime (enabled+static+secret)
  storeLib.simpanSetting("qris", q);
  res.json({
    data: {
      message: "Pengaturan QRIS disimpan.",
      enabled: q.enabled,
      qris_valid: !!q.static,
      merchant,
    },
  });
});

/** POST /portal/admin/store/secret — (re)generate secret webhook. */
router.post("/admin/store/secret", requireAdminSession, (_req, res) => {
  const q = storeLib.getQrisSettings();
  q.secret = storeLib.generateWebhookSecret();
  storeLib.simpanSetting("qris", q);
  res.json({ data: { message: "Secret webhook baru dibuat. Perbarui konfigurasi MacroDroid Anda.", secret: q.secret } });
});

/** POST /portal/admin/store/notify — simpan konfigurasi notifikasi. */
router.post("/admin/store/notify", requireAdminSession, (req, res) => {
  const b = req.body || {};
  const n = storeLib.getNotifySettings();
  if (typeof b.fonnteToken !== "undefined") n.fonnteToken = String(b.fonnteToken || "").trim().slice(0, 200);
  if (typeof b.adminWa !== "undefined") {
    let wa = String(b.adminWa || "").trim().replace(/[^\d]/g, "");
    if (wa.startsWith("0")) wa = "62" + wa.slice(1);
    n.adminWa = wa.slice(0, 20);
  }
  if (typeof b.resendKey !== "undefined") n.resendKey = String(b.resendKey || "").trim().slice(0, 200);
  if (typeof b.emailFrom !== "undefined") n.emailFrom = String(b.emailFrom || "").trim().slice(0, 120);
  if (typeof b.waKePembeli !== "undefined") n.waKePembeli = !!b.waKePembeli;
  if (typeof b.emailKePembeli !== "undefined") n.emailKePembeli = !!b.emailKePembeli;
  storeLib.simpanSetting("notify", n);
  res.json({ data: { message: "Pengaturan notifikasi disimpan." } });
});

/** POST /portal/admin/store/test — uji webhook DANA (secret + parser + pencocokan). */
router.post("/admin/store/test", requireAdminSession, (req, res) => {
  const q = storeLib.getQrisSettings();
  if (!q.secret) {
    return res.status(400).json({ error: { message: "Buat secret webhook dulu sebelum menguji.", code: "no_secret" } });
  }
  // Payload uji: nominal 499.999.999 pasti tidak pernah menjadi nominal pesanan
  // (maks paket hanya 300.000 + 999) sehingga uji TIDAK melunaskan pesanan.
  const teks = "DANA: Kamu menerima Rp499.999.999 dari TES ADMIN (uji webhook ThorHub)";
  const hasil = storeRoutes.prosesWebhookDana(
    JSON.stringify({ secret_token: q.secret, text: teks }),
    "application/json",
    "",
    "selftest-admin",
    { uji: true }
  );
  res.status(hasil.status === 401 ? 400 : 200).json({
    data: { ok: !!hasil.payload.success && hasil.payload.matched === true, hasil: hasil.payload },
  });
});

// ---------------------------------------------------------------
// PESANAN & PELACAKAN PEMBAYARAN (ala toko online)
// Admin dapat: daftar terfilter + statistik, detail pesanan beserta
// linimasa (order_events) & notifikasi DANA terkait, aksi manual
// (lunaskan / batal / kirim ulang notifikasi) — semua tercatat.
// ---------------------------------------------------------------
const pesananLib = require("../lib/pesanan");
const notifyLib = require("../lib/notify");
const paymentLib = require("../lib/payment");

const STATUS_VALID = new Set(["PENDING", "PAID", "COMPLETED", "CANCELLED"]);

/** Label status gaya toko online (dipakai juga frontend). */
const LABEL_STATUS = {
  PENDING: "Menunggu Bayar",
  PAID: "Dibayar",
  COMPLETED: "Selesai",
  CANCELLED: "Batal",
};

/** GET /portal/admin/orders — daftar pesanan + statistik + log webhook.
 *  Query: ?status=PENDING|PAID|COMPLETED|CANCELLED&q=<cari>&limit&offset
 *  q dicari ke: kode pesanan, nama, email, WA, key target, key terbit.
 */
router.get("/admin/orders", requireAdminSession, (req, res) => {
  const status = String(req.query.status || "").trim().toUpperCase();
  const q = String(req.query.q || "").trim().slice(0, 80);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const where = [];
  const args = [];
  if (STATUS_VALID.has(status)) {
    where.push("status = ?");
    args.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(
      "(order_code LIKE ? OR user_name LIKE ? OR email LIKE ? OR whatsapp LIKE ? OR target_api_key LIKE ? OR api_key_issued LIKE ?)"
    );
    args.push(like, like, like, like, like, like);
  }
  const klausa = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT id, order_code, mode, package_id, quota_tokens, user_name, email, whatsapp,
              target_api_key, api_key_issued, base_amount, unique_code, amount_to_pay,
              payment_method, status, note, created_at, paid_at, completed_at, expires_at
       FROM orders ${klausa} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${klausa}`).get(...args).n;

  // Statistik ala dashboard toko: jumlah per status + omzet (lunas)
  const perStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`)
    .all()
    .reduce((acc, r) => ((acc[r.status] = r.n), acc), {});
  const omzet = db
    .prepare(
      `SELECT COALESCE(SUM(amount_to_pay), 0) AS total,
              COALESCE(SUM(CASE WHEN date(completed_at) = date('now','localtime') THEN amount_to_pay ELSE 0 END), 0) AS hari_ini,
              COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime') THEN 1 ELSE 0 END), 0) AS pesanan_hari_ini
       FROM orders WHERE status = 'COMPLETED'`
    )
    .get();

  const events = db
    .prepare(`SELECT id, amount, matched, order_code, note, ip, created_at FROM payment_events ORDER BY id DESC LIMIT 50`)
    .all();

  res.json({
    data: {
      orders: rows.map((o) => ({ ...o, status_label: LABEL_STATUS[o.status] || o.status })),
      events,
      stats: {
        per_status: perStatus,
        total_semua: Object.values(perStatus).reduce((a, b) => a + b, 0),
        omzet_lunas: omzet.total,
        omzet_hari_ini: omzet.hari_ini,
        pesanan_hari_ini: omzet.pesanan_hari_ini,
        menunggu_bayar: perStatus.PENDING || 0,
      },
      paging: { total, limit, offset },
    },
  });
});

/** GET /portal/admin/orders/:code — detail 1 pesanan + linimasa + log DANA terkait. */
router.get("/admin/orders/:code", requireAdminSession, (req, res) => {
  const order = db
    .prepare("SELECT * FROM orders WHERE order_code = ?")
    .get(String(req.params.code || "").trim().toUpperCase());
  if (!order) return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });

  // Linimasa pesanan (order_events) — urut lama → baru
  const timeline = pesananLib.riwayat(order.id);

  // Notifikasi DANA yang berhubungan dengan pesanan ini:
  //   - langsung tercatat dengan order_code, ATAU
  //   - tidak cocok tapi kodenya disebut di catatan (mis. kurang-biaya-admin)
  const events = db
    .prepare(
      `SELECT id, amount, matched, order_code, note, ip, created_at FROM payment_events
       WHERE order_code = ? OR (order_code = '' AND note LIKE ?)
       ORDER BY id DESC LIMIT 30`
    )
    .all(order.order_code, `%${order.order_code}%`);

  res.json({
    data: {
      order: { ...order, status_label: LABEL_STATUS[order.status] || order.status },
      timeline,
      events,
    },
  });
});

/** POST /portal/admin/orders/:code/confirm — konfirmasi manual (lunas + eksekusi).
 *  Body opsional: { alasan: "…" } — dicatat di linimasa untuk audit.
 */
router.post("/admin/orders/:code/confirm", requireAdminSession, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(String(req.params.code || "").toUpperCase());
  if (!order) return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
  if (order.status === "COMPLETED") {
    return res.status(409).json({ error: { message: "Pesanan sudah selesai sebelumnya.", code: "already_completed" } });
  }
  const alasan = String((req.body && req.body.alasan) || "").trim().slice(0, 300);
  if (order.status === "CANCELLED") {
    // Pembayaran terlambat setelah kedaluwarsa → izinkan admin mengaktifkan kembali
    db.prepare(`UPDATE orders SET status = 'PENDING', note = 'dibuka ulang admin' WHERE id = ?`).run(order.id);
    order.status = "PENDING";
    pesananLib.catatEvent(order.id, "admin", "admin", "Pesanan CANCELLED dibuka ulang oleh admin (dugaan pembayaran terlambat masuk).");
  }
  const hasil = storeLib.prosesPesananLunas(order, { actor: "admin", alasan });
  storeRoutes.logEvent(order.amount_to_pay, true, order.order_code, "", "konfirmasi-manual", "panel-admin");
  if (!hasil.ok && !hasil.sudahSelesai) {
    pesananLib.catatEvent(order.id, "admin", "admin", `Konfirmasi manual GAGAL dieksekusi: ${hasil.pesan}`);
  }
  const final = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(order.order_code);
  res.json({ data: { ok: hasil.ok, message: hasil.pesan, order: final } });
});

/** POST /portal/admin/orders/:code/cancel — admin batalkan pesanan menunggu bayar.
 *  Body opsional: { alasan: "…" } — mis. "pembeli minta batal via WA".
 */
router.post("/admin/orders/:code/cancel", requireAdminSession, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(String(req.params.code || "").toUpperCase());
  if (!order) return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
  if (order.status !== "PENDING") {
    return res.status(409).json({
      error: { message: `Hanya pesanan Menunggu Bayar yang bisa dibatalkan (status sekarang: ${order.status}).`, code: "not_cancellable" },
    });
  }
  const alasan = String((req.body && req.body.alasan) || "").trim().slice(0, 300);
  db.prepare(`UPDATE orders SET status = 'CANCELLED', note = ? WHERE id = ? AND status = 'PENDING'`).run(
    alasan ? `dibatalkan admin: ${alasan}` : "dibatalkan admin",
    order.id
  );
  pesananLib.catatEvent(
    order.id,
    "batal",
    "admin",
    `Pesanan dibatalkan oleh ADMIN${alasan ? ` (“${alasan}”)` : ""} — kode unik dilepas kembali ke pool.`
  );
  const final = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(order.order_code);
  res.json({ data: { ok: true, message: `Pesanan ${order.order_code} dibatalkan.`, order: final } });
});

/** POST /portal/admin/orders/:code/resend — kirim ulang key/struk (WA + email).
 *  Untuk pesanan COMPLETED yang pengirimannya gagal (mis. Fonnte/Resend error).
 *  Body opsional: { alasan: "…" }.
 */
router.post("/admin/orders/:code/resend", requireAdminSession, async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(String(req.params.code || "").toUpperCase());
  if (!order) return res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
  if (order.status !== "COMPLETED") {
    return res.status(409).json({
      error: { message: "Kirim ulang hanya untuk pesanan SELESAI (key sudah terbit). Untuk menunda, batalkan atau lunaskan dulu.", code: "not_resendable" },
    });
  }
  const alasan = String((req.body && req.body.alasan) || "").trim().slice(0, 300);
  const hasil = await notifyLib.kirimNotifikasiLunas(order);
  const ringkas = [
    hasil.waSent ? "WA pembeli terkirim ✓" : order.whatsapp ? "WA pembeli GAGAL ✗" : "WA dilewati (tanpa nomor)",
    hasil.emailSent ? "Email struk terkirim ✓" : order.email ? "Email struk GAGAL/nonaktif ✗" : "Email dilewati (tanpa alamat)",
    hasil.adminSent ? "WA admin terkirim ✓" : "WA admin gagal/nonaktif",
  ].join(" · ");
  pesananLib.catatEvent(order.id, "notifikasi", "admin", `KIRIM ULANG notifikasi oleh admin${alasan ? ` (“${alasan}”)` : ""}: ${ringkas}`);
  res.json({
    data: {
      ...hasil,
      message: `Percobaan kirim ulang selesai — ${ringkas}`,
    },
  });
});

// ---------------------------------------------------------------
// MEMBER — login / logout / me
// ---------------------------------------------------------------
router.post("/member/login", bruteforce.guard("member"), async (req, res) => {
  const apiKey = (req.body && req.body.api_key) || "";
  if (!apiKey || typeof apiKey !== "string") {
    return res.status(400).json({ error: { message: 'Field "api_key" wajib diisi.', code: "invalid_request" } });
  }
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey.trim());
  if (!row) {
    // Batasi juga tebak-tebakan API key (mencegah enumerasi key sk-thor-…).
    const diblokir = bruteforce.catatGagal(req, "member");
    console.warn(`[SECURITY] Login member GAGAL (key tak dikenal) dari IP ${(req.ip || "").replace(/^::ffff:/, "")}${diblokir ? " → IP DIBLOKIR sementara" : ""}`);
    await new Promise((r) => setTimeout(r, bruteforce.FAIL_DELAY_MS));
    if (diblokir) {
      return res.status(429).json({ error: { message: "Terlalu banyak percobaan gagal. Coba lagi nanti.", code: "too_many_attempts" } });
    }
    return res.status(401).json({ error: { message: "API Key tidak ditemukan.", code: "invalid_api_key" } });
  }
  bruteforce.catatSukses(req, "member");
  // Key nonaktif / kuota habis tetap boleh login agar member bisa melihat statusnya.
  const { token } = session.createSession({
    role: "member",
    userName: row.user_name,
    apiKey: row.api_key,
    ttlMs: session.MEMBER_TTL_MS,
  });
  res.setHeader("Set-Cookie", session.buildSetCookie(session.MEMBER_COOKIE, token, session.MEMBER_TTL_MS, session.isSecureRequest(req)));
  res.json({ data: { message: "Login berhasil.", user_name: row.user_name } });
});

router.post("/member/logout", (req, res) => {
  const token = session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE];
  session.destroySession(token);
  res.setHeader("Set-Cookie", session.buildClearCookie(session.MEMBER_COOKIE));
  res.json({ data: { message: "Logout berhasil." } });
});

router.get("/member/me", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }

  // Ringkasan tambahan dari log pemakaian (jumlah request & rincian token)
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens
       FROM usage_logs WHERE api_key_id = ? AND status = 'ok'`
    )
    .get(row.id);

  res.json({
    data: {
      role: "member",
      expires_at: req.session.expires_at,
      ttl_ms: session.SESSION_TTL_MS,
      id: row.id,
      user_name: row.user_name,
      api_key: row.api_key,
      token_limit: row.token_limit,
      tokens_used: row.tokens_used,
      tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
      is_active: !!row.is_active,
      created_at: row.created_at,
      // Masa aktif key (25 hari / perpanjangan top-up terakhir):
      key_expires_at: row.expires_at || null,
      key_expired: masaAktif.expiryMs(row.expires_at) != null && Date.now() >= masaAktif.expiryMs(row.expires_at),
      key_days_left:
        masaAktif.expiryMs(row.expires_at) == null
          ? null
          : Math.max(0, Math.ceil((masaAktif.expiryMs(row.expires_at) - Date.now()) / masaAktif.MS_HARI)),
      key_masa_aktif_label: masaAktif.formatWaktuIndo(row.expires_at),
      requests: agg.requests,
      prompt_tokens: agg.prompt_tokens,
      completion_tokens: agg.completion_tokens,
    },
  });
});

// ---------------------------------------------------------------
// MEMBER — PELACAKAN PESANAN (ala e-commerce besar)
// Member melihat HANYA pesanan miliknya: top-up ke key-nya sendiri,
// pesanan key_baru yang menerbitkan key-nya, ATAU pesanan yang ia
// buat saat sesi portal aktif (owner_api_key) — termasuk seluruh
// "keluarga key" (lineage): key lama → beli key baru → key itu
// beli lagi, dst. Semua endpoint memakai sesi cookie member —
// tidak ada access_token yang perlu disimpan, tidak ada data
// member lain yang bocor.
// ---------------------------------------------------------------

/**
 * Hitung "keluarga key" (lineage) milik sebuah key — ala akun belanja
 * e-commerce: semua key yang terhubung lewat riwayat pesanan dianggap
 * satu akun, sehingga SEMUA pesanan keluarga tampil di pelacakan
 * berapa pun key yang dipakai login.
 *
 * Perluasan:
 *   1. Linkage langsung — target_api_key, api_key_issued, owner_api_key.
 *   2. Identitas pembeli — email/WA yang dipakai pada pesanan keluarga;
 *      pesanan lain dengan email/WA identik ikut (pembeli yang sama).
 * Iterasi sampai titik-titik (fixed point) — tabel orders kecil, aman.
 *
 * @param {string} apiKey  key sesi member
 * @returns {string[]} daftar key keluarga (selalu memuat apiKey itu sendiri)
 */
function keluargaKey(apiKey) {
  const kel = new Set([apiKey]);
  const identitas = new Set(); // email & WA terbukti milik keluarga ini
  for (let i = 0; i < 20; i++) {
    const keys = [...kel];
    const tanda = keys.map(() => "?").join(",");
    const baris = db
      .prepare(
        `SELECT target_api_key, api_key_issued, owner_api_key, email, whatsapp
         FROM orders
         WHERE target_api_key IN (${tanda})
            OR api_key_issued IN (${tanda})
            OR owner_api_key IN (${tanda})
            OR (email != '' AND email IN (SELECT value FROM json_each(?)))
            OR (whatsapp != '' AND whatsapp IN (SELECT value FROM json_each(?)))`
      )
      .all(...keys, ...keys, ...keys, JSON.stringify([...identitas]), JSON.stringify([...identitas]));

    let bertambah = false;
    for (const o of baris) {
      for (const k of [o.target_api_key, o.api_key_issued, o.owner_api_key]) {
        if (k && !kel.has(k)) {
          kel.add(k);
          bertambah = true;
        }
      }
      if (o.email && !identitas.has(o.email)) {
        identitas.add(o.email);
        bertambah = true;
      }
      if (o.whatsapp && !identitas.has(o.whatsapp)) {
        identitas.add(o.whatsapp);
        bertambah = true;
      }
    }
    if (!bertambah) break;
  }
  return [...kel];
}

/** Label paket yang ramah ("20 Juta") dari package_id ("20m"). */
function labelPaket(packageId) {
  const p = storeLib.PACKAGES.find((x) => x.id === packageId);
  return p ? p.label : packageId;
}

/** Label event linimasa versi pembeli (bukan istilah internal admin). */
const LABEL_EVENT_MEMBER = {
  dibuat: "Pesanan dibuat",
  webhook: "Notifikasi pembayaran masuk",
  lunas: "Pembayaran diterima",
  fulfillment: "Pesanan diproses",
  notifikasi: "Struk & konfirmasi dikirim",
  admin: "Diperbarui oleh admin",
  batal: "Pesanan dibatalkan",
  info: "Catatan",
};

const LABEL_ACTOR_MEMBER = {
  sistem: "Sistem",
  webhook: "Otomatis (DANA)",
  admin: "Admin",
  pembeli: "Anda",
};

/** Bersihkan detail event agar layak dilihat member: klausa internal
 *  admin (mis. status WA ke admin) dibuang, sisanya tetap informatif. */
function detailUntukMember(ev) {
  let detail = String(ev.detail || "");
  if (ev.type === "notifikasi") {
    detail = detail
      .split(" · ")
      .filter((seg) => !/wa admin/i.test(seg))
      .join(" · ");
  }
  // Slice API key milik member sendiri — tampilkan penuh saja agar jelas.
  return detail;
}

/** Empat langkah pelacakan gaya marketplace (dipakai stepper frontend).
 *  state: done | current | pending | failed */
function langkahPelacakan(order) {
  const batal = order.status === "CANCELLED";
  const selesai = order.status === "COMPLETED";
  const dibayar = !!order.paid_at; // PAID atau COMPLETED
  return [
    { key: "dibuat", label: "Pesanan Dibuat", at: order.created_at, state: "done" },
    {
      key: "bayar",
      label: dibayar ? "Pembayaran Diterima" : "Pembayaran",
      at: order.paid_at || null,
      state: dibayar ? "done" : batal ? "failed" : "current",
    },
    {
      key: "proses",
      label: order.mode === "topup" ? "Kuota Ditambahkan" : "Key Diterbitkan",
      at: order.completed_at || null,
      state: selesai ? "done" : dibayar ? "current" : batal ? "failed" : "pending",
    },
    {
      key: "selesai",
      label: batal ? "Dibatalkan" : "Selesai",
      at: selesai ? order.completed_at : null,
      state: selesai ? "done" : batal ? "failed" : "pending",
    },
  ];
}

/** Susun payload detail satu pesanan versi member (terverifikasi milik). */
async function payloadDetailMember(order, apiKey) {
  // Pesanan PENDING yang kedaluwarsa di-ralat dulu (PENDING → CANCELLED)
  // supaya pelacakan member selalu menampilkan status terkini.
  paymentLib.expireStaleOrders();
  const segar = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  const o = segar || order;

  const canPay = o.status === "PENDING" && o.expires_at >= Date.now();
  const canCancel = o.status === "PENDING";

  // QR dibangun ulang on-the-fly untuk pesanan yang masih bisa dibayar —
  // member tidak perlu menyimpan access_token lama dari halaman /beli.
  let qrImage = "";
  if (canPay) {
    const q = storeLib.getQrisSettings();
    if (q.enabled && q.static && q.secret) {
      try {
        const dynamic = qrisLib.buildDynamicQris(q.static, o.amount_to_pay);
        qrImage = await qrisLib.qrisToDataUrl(dynamic, 512);
      } catch {
        /* QR gagal dibangun → respons lanjut tanpa qr_image */
      }
    }
  }

  // Masa aktif key terkait (baru diterbitkan / diperpanjang) bila selesai.
  let masaAktifSampai = null;
  if (o.status === "COMPLETED") {
    const apiK = o.mode === "key_baru" ? o.api_key_issued : o.target_api_key;
    const expMs = masaAktif.expiryMs(masaAktif.expiryKeyDariDb(apiK));
    if (expMs != null) masaAktifSampai = masaAktif.formatWaktuIndo(expMs);
  }

  const timeline = pesananLib.riwayat(o.id).map((ev) => ({
    type: ev.type,
    label: LABEL_EVENT_MEMBER[ev.type] || "Catatan",
    actor: LABEL_ACTOR_MEMBER[ev.actor] || ev.actor,
    detail: detailUntukMember(ev),
    created_at: ev.created_at,
  }));

  return {
    order: {
      order_code: o.order_code,
      mode: o.mode,
      mode_label: o.mode === "key_baru" ? "Pembelian Key Baru" : "Top-up Kuota",
      package_id: o.package_id,
      package_label: labelPaket(o.package_id),
      quota_tokens: o.quota_tokens,
      user_name: o.user_name,
      base_amount: o.base_amount,
      unique_code: o.unique_code,
      amount_to_pay: o.amount_to_pay,
      payment_method: o.payment_method,
      status: o.status,
      status_label: LABEL_STATUS[o.status] || o.status,
      note: o.note,
      created_at: o.created_at,
      paid_at: o.paid_at,
      completed_at: o.completed_at,
      expires_at: o.expires_at,
      // Untuk mode key_baru, key yang diterbitkan ADALAH key milik member
      // (ia login dengan key itu) — aman ditampilkan.
      api_key_terkait: o.mode === "key_baru" ? o.api_key_issued : o.target_api_key,
    },
    steps: langkahPelacakan(o),
    timeline,
    can_pay: canPay,
    can_cancel: canCancel,
    qr_image: qrImage,
    masa_aktif_sampai: masaAktifSampai,
    server_now: Date.now(),
  };
}

/** Cari pesanan milik member by kode; 404-generik bila bukan miliknya. */
function pesananMemberAtau404(req, res, apiKey) {
  const code = String(req.params.code || "").trim().toUpperCase();
  const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(code);
  const kel = keluargaKey(apiKey);
  const milik =
    !!order &&
    (kel.includes(order.owner_api_key) ||
      kel.includes(order.target_api_key) ||
      (order.mode === "key_baru" && kel.includes(order.api_key_issued)));
  if (!order || !milik) {
    res.status(404).json({ error: { message: "Pesanan tidak ditemukan.", code: "not_found" } });
    return null;
  }
  return order;
}

// GET /portal/member/orders — daftar pesanan milik member ini.
// Query: ?status=PENDING|PAID|COMPLETED|CANCELLED&q=<kode>&limit&offset
// Disertai stats per status (chip ala marketplace) & flag can_pay.
router.get("/member/orders", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT id, api_key FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }

  // Segarkan dulu pesanan kedaluwarsa agar status daftar akurat.
  paymentLib.expireStaleOrders();

  const status = String(req.query.status || "").trim().toUpperCase();
  const q = String(req.query.q || "").trim().slice(0, 40).toUpperCase();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  // Keluarga key member (lineage) — semua pesanan keluarga tampil, seperti
  // riwayat akun di e-commerce: berapa pun key yang dipakai login.
  const kel = keluargaKey(row.api_key);
  const tanda = kel.map(() => "?").join(",");
  const milik = `(
    owner_api_key IN (${tanda})
    OR target_api_key IN (${tanda})
    OR (mode = 'key_baru' AND api_key_issued IN (${tanda}))
  )`;
  const where = [milik];
  const args = [...kel, ...kel, ...kel];
  if (STATUS_VALID.has(status)) {
    where.push("status = ?");
    args.push(status);
  }
  if (q) {
    where.push("order_code LIKE ?");
    args.push(`%${q}%`);
  }
  const klausa = `WHERE ${where.join(" AND ")}`;

  const rows = db
    .prepare(
      `SELECT order_code, mode, package_id, quota_tokens, base_amount, unique_code, amount_to_pay,
              payment_method, status, note, created_at, paid_at, completed_at, expires_at
       FROM orders ${klausa}
       ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${klausa}`).get(...args).n;

  // Statistik milik member ini (tidak terpengaruh filter) — untuk chip.
  const perStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE ${milik} GROUP BY status`)
    .all(...kel, ...kel, ...kel)
    .reduce((acc, r) => ((acc[r.status] = r.n), acc), {});
  const totalSemua = Object.values(perStatus).reduce((a, b) => a + b, 0);

  res.json({
    data: {
      orders: rows.map((o) => ({
        ...o,
        status_label: LABEL_STATUS[o.status] || o.status,
        package_label: labelPaket(o.package_id),
        mode_label: o.mode === "key_baru" ? "Pembelian Key Baru" : "Top-up Kuota",
        can_pay: o.status === "PENDING" && o.expires_at >= Date.now(),
      })),
      stats: {
        total: totalSemua,
        pending: perStatus.PENDING || 0,
        paid: perStatus.PAID || 0,
        completed: perStatus.COMPLETED || 0,
        cancelled: perStatus.CANCELLED || 0,
      },
      paging: { total, limit, offset },
    },
  });
});

// GET /portal/member/orders/:code — detail + langkah + linimasa + QR bila
// masih bisa dibayar. Pesanan member lain → 404 (tanpa membocorkan ada/tidak).
router.get("/member/orders/:code", requireMemberSession, async (req, res) => {
  const row = db.prepare("SELECT id, api_key FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }
  const order = pesananMemberAtau404(req, res, row.api_key);
  if (!order) return;
  const payload = await payloadDetailMember(order, row.api_key);
  res.setHeader("Cache-Control", "no-store");
  res.json({ data: payload });
});

// POST /portal/member/orders/:code/cancel — pembeli batalkan sendiri
// pesanan Menunggu Bayar miliknya dari dashboard (ala e-commerce).
router.post("/member/orders/:code/cancel", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT id, api_key FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }
  const order = pesananMemberAtau404(req, res, row.api_key);
  if (!order) return;
  if (order.status !== "PENDING") {
    return res.status(409).json({
      error: { message: `Hanya pesanan Menunggu Bayar yang bisa dibatalkan (status sekarang: ${LABEL_STATUS[order.status] || order.status}).`, code: "not_cancellable" },
    });
  }
  const r = db
    .prepare(`UPDATE orders SET status = 'CANCELLED', note = 'dibatalkan pembeli (portal member)' WHERE id = ? AND status = 'PENDING'`)
    .run(order.id);
  if (r.changes === 0) {
    return res.status(409).json({ error: { message: "Pesanan sudah diproses / tidak bisa dibatalkan.", code: "not_cancellable" } });
  }
  pesananLib.catatEvent(order.id, "batal", "pembeli", "Pesanan dibatalkan oleh pembeli dari dashboard member.");
  const final = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  res.json({ data: { cancelled: true, status: final.status, status_label: LABEL_STATUS[final.status] } });
});

// GET /portal/member/usage — pemakaian per model, harian (30 hari), dan log terakhir
router.get("/member/usage", requireMemberSession, (req, res) => {
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(req.session.api_key);
  if (!row) {
    session.destroySession(session.parseCookies(req.headers.cookie)[session.MEMBER_COOKIE]);
    return res.status(401).json({ error: { message: "Key Anda sudah tidak terdaftar.", code: "invalid_api_key" } });
  }

  // Pemakaian per model (urut terbanyak). Multiplier diambil dari katalog model.
  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
              COALESCE(SUM(total_tokens), 0)      AS total_tokens
       FROM usage_logs
       WHERE api_key_id = ? AND status = 'ok'
       GROUP BY model
       ORDER BY total_tokens DESC
       LIMIT 20`
    )
    .all(row.id)
    .map((r) => ({
      ...r,
      model: r.model || "(tidak diketahui)",
      multiplier: models.multiplierOf(r.model),
    }));

  // Pemakaian harian 30 hari terakhir (termasuk hari tanpa pemakaian = 0)
  const hari = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS tanggal,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM usage_logs
       WHERE api_key_id = ? AND status = 'ok'
         AND created_at >= date('now', '-29 days')
       GROUP BY tanggal`
    )
    .all(row.id);
  const petaHari = new Map(hari.map((h) => [h.tanggal, h]));
  const byDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const h = petaHari.get(d);
    byDay.push({ tanggal: d, requests: h ? h.requests : 0, total_tokens: h ? h.total_tokens : 0 });
  }

  // Log request terakhir
  const logs = db
    .prepare(
      `SELECT model, prompt_tokens, completion_tokens, total_tokens, status, created_at
       FROM usage_logs WHERE api_key_id = ?
       ORDER BY id DESC LIMIT 50`
    )
    .all(row.id)
    .map((l) => ({ ...l, model: l.model || "(tidak diketahui)" }));

  res.json({
    data: {
      summary: {
        token_limit: row.token_limit,
        tokens_used: row.tokens_used,
        tokens_remaining: Math.max(0, row.token_limit - row.tokens_used),
        percent_used: row.token_limit > 0 ? Math.round((row.tokens_used / row.token_limit) * 100) : 0,
        is_active: !!row.is_active,
      },
      by_model: byModel,
      by_day: byDay,
      logs,
    },
  });
});

module.exports = router;
