/**
 * server.js — Entry point LLM Proxy Gateway.
 *
 * Jalankan dengan:  npm start   (atau: node src/server.js)
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
const config = require("./config");
const limiter = require("./services/limiter");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const portalRoutes = require("./routes/portal");
const storeRoutes = require("./routes/store");

const app = express();
app.disable("x-powered-by");

// Body JSON (limit 4 MB untuk prompt panjang)
app.use(express.json({ limit: "4mb" }));

// Percayai HANYA proxy lokal (nginx di loopback) agar req.secure &
// X-Forwarded-Proto terbaca benar. Nilai "loopback" (bukan true) penting untuk
// keamanan: dengan true, Express mempercayai SEMUA hop sehingga X-Forwarded-For
// yang dipalsukan penyerang bisa dipakai untuk mengelabui pembatas per-IP
// (brute-force guard). Dengan loopback, req.ip = IP klien nyata.
app.set("trust proxy", "loopback");

// Mode sandbox/preview (SANDBOX_PREVIEW=1): panel preview menyematkan halaman
// dalam <iframe> lintas subdomain, sehingga header anti-framing dilonggarkan
// agar halaman tetap terlihat di panel. Tanpa env ini (default produksi),
// perilaku tetap ketat seperti semula (X-Frame-Options: DENY).
const IZINKAN_IFRAME_PREVIEW = process.env.SANDBOX_PREVIEW === "1";

// Header keamanan dasar (hardening). Mencegah clickjacking, MIME-sniffing,
// kebocoran referrer, dan membatasi sumber script/iframe.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!IZINKAN_IFRAME_PREVIEW) {
    res.setHeader("X-Frame-Options", "DENY");          // tolak <iframe> ke panel admin (anti clickjacking)
  }
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // CSP: izinkan script/style milik sendiri + inline style (dipakai halaman),
  // blokir objek/frame pihak ketiga. Halaman memakai <script src> lokal & <script> inline.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "font-src 'self'; " +
      "object-src 'none'; " +
      `frame-ancestors ${IZINKAN_IFRAME_PREVIEW ? "*" : "'none'"}; ` +
      "base-uri 'self'; " +
      "form-action 'self'"
  );
  next();
});

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Skrip instalasi integrasi (dipakai: bash <(curl -fsSL .../integrasi/claude)
// dan Windows: irm .../integrasi/claude.ps1 | iex).
// WAJIB didaftarkan SEBELUM express.static di bawah: jika tidak, static akan
// mengambil berkas .ps1 lebih dulu dan mengirimnya dengan Content-Type dari
// ekstensi (application/octet-stream) — merusak `irm | iex`.
// Selalu dikirim sebagai text/plain agar aman dijalankan lewat pipe.
const DIR_INTEGRASI = path.join(PUBLIC_DIR, "integrasi");
app.get("/integrasi/:skrip", (req, res) => {
  // Izinkan huruf, angka, titik, garis bawah, dan strip. Karakter lain dibuang
  // agar tidak ada "/" atau ".." yang bisa keluar dari folder (path traversal).
  const nama = String(req.params.skrip).replace(/[^a-z0-9._-]/gi, "");
  if (!nama || nama.includes("..")) {
    return res.status(404).type("text/plain").send("# Skrip integrasi tidak ditemukan.\n");
  }
  // Coba nama apa adanya (mis. claude.ps1), lalu dengan akhiran .sh (mis. claude).
  const berkas = [path.join(DIR_INTEGRASI, nama), path.join(DIR_INTEGRASI, `${nama}.sh`)]
    .find((b) => fs.existsSync(b) && fs.statSync(b).isFile());
  if (!berkas) {
    return res.status(404).type("text/plain").send("# Skrip integrasi tidak ditemukan.\n");
  }
  // Berkas skrip kecil (±8 KB), dibaca langsung & dikirim sebagai text/plain.
  res.type("text/plain; charset=utf-8").send(fs.readFileSync(berkas));
});

// File statis panel web (HTML/CSS/JS) dari folder public/
// SEMUA aset (termasuk logo/ikon/manifest) selalu revalidasi via ETag
// (max-age=0, must-revalidate): pergantian logo/ikon langsung terlihat
// semua pengunjung, tetap hemat bandwidth lewat respons 304 Not Modified.
// (Dulu ikon/logo di-cache immutable 30 hari — akibatnya logo baru tidak
//  akan pernah terlihat pengunjung lama selama berbulan-bulan.)
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    },
  })
);

// Alias URL cantik → file HTML (dipasang sebelum static agar rapi)
// /admin  → admin.html bila ada, jika belum ada → login-admin.html
// /portal → portal.html bila ada, jika belum ada → login-member.html
app.get("/admin", (_req, res) => {
  const panel = path.join(PUBLIC_DIR, "admin.html");
  res.sendFile(fs.existsSync(panel) ? panel : path.join(PUBLIC_DIR, "login-admin.html"));
});
app.get("/portal", (_req, res) => {
  const panel = path.join(PUBLIC_DIR, "portal.html");
  res.sendFile(fs.existsSync(panel) ? panel : path.join(PUBLIC_DIR, "login-member.html"));
});
app.get("/docs", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "docs.html"));
});
// Halaman toko pembelian (publik — QRIS DANA otomatis)
app.get("/beli", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "beli.html"));
});

// ---------------------------------------------------------------
// URL slug profesional — SETIAP AKSI NAVIGASI punya alamat slash sendiri.
// Semua slug melayani HALAMAN yang sama (panel tetap satu file HTML); yang
// berbeda hanya path URL-nya, sehingga tiap tab/tahap bisa di-bookmark,
// dibagikan, dan tombol Kembali browser berperilaku wajar:
//   /portal/integrasi  /portal/topup  /portal/pesanan  /portal/pemakaian
//   /portal/model  /portal/log  —  /portal/lacak/<kode> (modal pelacakan)
//   /admin/kelola  /admin/aktivitas  /admin/model  /admin/toko
//   —  /admin/pesanan/<kode> (modal detail pesanan)
//   /docs/mulai  /docs/sdk  /docs/aplikasi  /docs/referensi
//   /beli/checkout  /beli/topup  /beli/pembayaran?order=…  /beli/selesai?order=…
// Slug tidak dikenal → halaman 404 (bukan respons JSON API).
// Catatan urutan: alias ini WAJIB terpasang sebelum router API di bawah,
// dan slug di `api:` adalah segmen pertama endpoint REST asli yang tidak
// boleh ditimpa halaman (mis. GET /admin/keys → JSON, bukan admin.html).
// ---------------------------------------------------------------
const HALAMAN_SLUG = {
  // "api:" = segmen pertama endpoint REST asli di bawah prefix ini (router
  // portal.js: /portal/member/*, /portal/admin/*, /portal/models) yang tidak
  // boleh ditimpa halaman. /portal/models penting: dipakai katalog docs.
  portal: { berkas: "portal.html", slug: new Set(["integrasi", "topup", "pesanan", "pemakaian", "model", "log"]), api: new Set(["member", "admin", "models", "usage"]) },
  admin: { berkas: "admin.html", slug: new Set(["kelola", "aktivitas", "model", "toko"]), api: new Set(["keys", "usage"]) },
  docs: { berkas: "docs.html", slug: new Set(["mulai", "sdk", "aplikasi", "referensi"]), api: new Set() },
  beli: { berkas: "beli.html", slug: new Set(["checkout", "topup", "pembayaran", "selesai"]), api: new Set() },
};
for (const [awalan, hal] of Object.entries(HALAMAN_SLUG)) {
  app.get(`/${awalan}/:slug`, (req, res, next) => {
    const slug = String(req.params.slug || "").toLowerCase();
    if (hal.slug.has(slug)) {
      return res.sendFile(path.join(PUBLIC_DIR, hal.berkas));
    }
    if (hal.api.has(slug)) return next(); // milik router API (dipasang di bawah)
    res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), (err) => {
      if (err) res.type("text/plain").send("404 - Halaman tidak ditemukan.");
    });
  });
}

// Modal pelacakan/detail dua segmen — URL langsung ke satu pesanan:
//   /portal/lacak/THX-…  → portal member, modal Lacak Pesanan
//   /admin/pesanan/THX-… → panel admin, modal detail pesanan
// Dipasang SETELAH loop :slug di atas (yang akan menangkap /portal/lacak
// tanpa kode) — dengan :kode di sini rute dua segmen lebih spesifik.
const KIRIM_PORTAL_HTML = (_req, res) => res.sendFile(path.join(PUBLIC_DIR, HALAMAN_SLUG.portal.berkas));
const KIRIM_ADMIN_HTML = (_req, res) => res.sendFile(path.join(PUBLIC_DIR, HALAMAN_SLUG.admin.berkas));
app.get("/portal/lacak/:kode", KIRIM_PORTAL_HTML);
app.get("/admin/pesanan/:kode", KIRIM_ADMIN_HTML);
app.get("/portal/lacak", (_req, res) => res.redirect("/portal/pesanan"));
app.get("/admin/pesanan", (_req, res) => res.redirect("/admin/toko"));

// Log ringkas setiap request
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Info layanan (JSON) — untuk cek cepat tanpa UI
app.get("/api/info", (_req, res) => {
  res.json({
    service: "LLM Proxy Gateway",
    status: "running",
    endpoints: {
      chat: "POST /v1/chat/completions  (Auth: Bearer sk-thor-xxx)",
      models: "GET  /v1/models  (Auth: Bearer sk-thor-xxx)",
      health: "GET  /health",
      admin: "GET/PATCH/DELETE /admin/keys  (Auth: Bearer ADMIN_API_KEY)",
      panelAdmin: "GET /admin (web UI)",
      portalMember: "GET /portal (web UI)",
      toko: "GET /beli (beli kuota / top-up, QRIS DANA otomatis)",
      webhookDana: "POST /store/webhook/dana (MacroDroid)",
    },
  });
});

// Health check + status antrean (untuk monitoring sederhana)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    queue: { running: limiter.running(), queued: limiter.queued() },
  });
});

// Route API untuk pembeli
app.use("/v1", chatRoutes);

// Route REST admin (dilindungi ADMIN_API_KEY — untuk skrip/integrasi)
app.use("/admin", adminRoutes);

// Route website (login/logout sesi panel & portal)
app.use("/portal", portalRoutes);

// Route toko pembelian otomatis (QRIS DANA) — endpoint publik untuk pembeli
app.use("/store", storeRoutes.router);

// 404 — JSON untuk /api|/v1|/admin|/portal|/store, halaman HTML untuk sisanya
app.use((req, res) => {
  const isApi = /^\/(api|v1|admin|portal|store)\b/.test(req.path);
  if (isApi) {
    return res.status(404).json({ error: { message: "Endpoint tidak ditemukan.", type: "not_found" } });
  }
  res.status(404).sendFile(path.join(__dirname, "..", "public", "404.html"), (err) => {
    if (err) res.type("text/plain").send("404 - Halaman tidak ditemukan.");
  });
});

// Penanganan error (termasuk body JSON rusak dari express.json)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: { message: "Body request bukan JSON yang valid.", type: "invalid_request_error" },
    });
  }
  console.error("[server] Error:", err);
  res.status(500).json({ error: { message: "Kesalahan internal gateway.", type: "internal_error" } });
});

// Bind ke loopback secara default: hanya nginx (di mesin yang sama) yang bisa
// menjangkau aplikasi. Ini mencegah penyerang menembus port 3000 langsung dari
// jaringan/LAN dan melewati rate-limit nginx + HSTS. Set HOST=0.0.0.0 di .env
// bila memang ingin mengekspos aplikasi tanpa reverse proxy (tidak disarankan).
const HOST = process.env.HOST || "127.0.0.1";
app.listen(config.port, HOST, () => {
  console.log("==============================================");
  console.log("  LLM Proxy Gateway siap menerima request");
  console.log(`  Bind host       : ${HOST}`);
  console.log(`  Port lokal      : ${config.port}`);
  console.log(`  Provider target : ${config.targetBaseUrl}`);
  console.log(`  Rate limit      : TANPA BATAS (unlimited, tanpa antrean)`);
  console.log(`  Timeout antrean : ${config.queueWaitTimeoutMs / 1000} dtk (nonaktif efektif)`);
  console.log("==============================================");
});
