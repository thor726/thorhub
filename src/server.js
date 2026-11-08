/**
 * server.js — Entry point LLM Proxy Gateway.
 *
 * Jalankan dengan:  npm start   (atau: node src/server.js)
 */
const path = require("path");
const express = require("express");
const config = require("./config");
const limiter = require("./services/limiter");
const chatRoutes = require("./routes/chat");
const adminRoutes = require("./routes/admin");
const portalRoutes = require("./routes/portal");

const app = express();
app.disable("x-powered-by");

// Body JSON (limit 4 MB untuk prompt panjang)
app.use(express.json({ limit: "4mb" }));

// Percayai proxy (nginx) agar req.secure & X-Forwarded-Proto terbaca benar
app.set("trust proxy", true);

// File statis panel web (HTML/CSS/JS) dari folder public/
const PUBLIC_DIR = path.join(__dirname, "..", "public");
// Aset statis dengan strategi cache berbeda per jenis berkas:
//  - Ikon/logo (jarang berubah) → cache lama + immutable
//  - CSS/JS/HTML → selalu revalidasi via ETag (max-age=0) agar update langsung terlihat
//    namun tetap hemat bandwidth lewat respons 304 Not Modified.
const CACHE_IKON = "public, max-age=2592000, immutable"; // 30 hari
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, berkas) {
      if (/\.(png|svg|webmanifest)$/i.test(berkas)) {
        res.setHeader("Cache-Control", CACHE_IKON);
      } else {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
  })
);

// Alias URL cantik → file HTML (dipasang sebelum static agar rapi)
// /admin  → admin.html bila ada, jika belum ada → login-admin.html
// /portal → portal.html bila ada, jika belum ada → login-member.html
app.get("/admin", (_req, res) => {
  const panel = path.join(PUBLIC_DIR, "admin.html");
  res.sendFile(require("fs").existsSync(panel) ? panel : path.join(PUBLIC_DIR, "login-admin.html"));
});
app.get("/portal", (_req, res) => {
  const panel = path.join(PUBLIC_DIR, "portal.html");
  res.sendFile(require("fs").existsSync(panel) ? panel : path.join(PUBLIC_DIR, "login-member.html"));
});
app.get("/docs", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "docs.html"));
});

// Skrip instalasi integrasi (dipanggil via: bash <(curl -fsSL .../integrasi/claude))
// Content-Type text/plain agar aman dijalankan lewat process substitution.
app.get("/integrasi/:skrip", (req, res) => {
  const nama = String(req.params.skrip).replace(/[^a-z0-9_-]/gi, "");
  const berkas = path.join(PUBLIC_DIR, "integrasi", `${nama}.sh`);
  const fs = require("fs");
  if (!fs.existsSync(berkas)) {
    return res.status(404).type("text/plain").send("# Skrip integrasi tidak ditemukan.\n");
  }
  res.type("text/plain; charset=utf-8").sendFile(berkas);
});

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

// 404 — JSON untuk /api|/v1|/admin, halaman HTML untuk sisanya
app.use((req, res) => {
  const isApi = /^\/(api|v1|admin|portal)\b/.test(req.path);
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

app.listen(config.port, () => {
  console.log("==============================================");
  console.log("  LLM Proxy Gateway siap menerima request");
  console.log(`  Port lokal      : ${config.port}`);
  console.log(`  Provider target : ${config.targetBaseUrl}`);
  console.log(`  Rate limit      : 25 request/60 dtk, maks 3 paralel`);
  console.log(`  Timeout antrean : ${config.queueWaitTimeoutMs / 1000} dtk`);
  console.log("==============================================");
});
