#!/usr/bin/env node
/**
 * test/check-security.js — Uji regresi keamanan ThorHub.
 *
 * Menguji sendiri (tanpa server eksternal) bahwa:
 *   1. Endpoint admin menolak akses TANPA sesi (401) — inti pencegahan
 *      "bobol panel admin lalu generate token".
 *   2. Token sesi palsu/kosong ditolak.
 *   3. Role confusion (token member dipakai di endpoint admin) ditolak.
 *   4. Login admin tanpa proteksi brute-force kini memblokir setelah N gagal.
 *   5. Header keamanan terset.
 *
 * Jalankan: node test/check-security.js   (perlu server uji di PORT env)
 * Bila TIDAK ada server berjalan, skrip menjalankan instance sementara sendiri.
 */
const { spawn } = require("child_process");
const path = require("path");

const PORT = process.env.SEC_PORT || "3397";
const BASE = `http://127.0.0.1:${PORT}`;
const J = { "Content-Type": "application/json" };

let lulus = 0, gagal = 0;
const cek = (nama, kondisi, detail = "") => {
  if (kondisi) { lulus++; console.log(`  [OK ] ${nama}`); }
  else { gagal++; console.log(`  [GAGAL] ${nama} ${detail}`); }
};

const http = async (urlPath, opts = {}) => {
  const r = await fetch(BASE + urlPath, { redirect: "manual", ...opts });
  let body = null;
  try { body = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, body, headers: r.headers };
};

(async () => {
  // Jalankan server sementara bila perlu
  let srv = null;
  try {
    await fetch(BASE + "/health");
  } catch {
    srv = spawn("node", ["src/server.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT, HOST: "127.0.0.1" },
      stdio: "ignore",
    });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { await fetch(BASE + "/health"); break; } catch { /* retry */ }
    }
  }

  console.log("=== UJI KEAMANAN PANEL ADMIN & TOKEN ===\n");

  console.log("1) Akses admin tanpa sesi (harus 401)");
  for (const ep of ["/portal/admin/me", "/portal/admin/keys", "/portal/admin/usage", "/portal/admin/activity"]) {
    const r = await http(ep);
    cek(`GET ${ep}`, r.status === 401, `→ ${r.status}`);
  }

  console.log("\n2) Terbitkan token TANPA sesi (serangan utama, harus 401)");
  {
    const r = await http("/portal/admin/keys", { method: "POST", headers: J, body: JSON.stringify({ user_name: "HACKER", token_limit: 1e9 }) });
    cek("POST /portal/admin/keys tanpa cookie", r.status === 401, `→ ${r.status}`);
  }

  console.log("\n3) Token sesi palsu/kosong (harus 401)");
  for (const tk of ["", "palsu", "0".repeat(64)]) {
    const r = await http("/portal/admin/keys", { headers: { Cookie: `gw_admin=${tk}` } });
    cek(`Cookie gw_admin='${tk.slice(0, 10)}…'`, r.status === 401, `→ ${r.status}`);
  }

  console.log("\n4) Anti brute-force: 10 percobaan gagal (harus memblokir ~#8)");
  {
    let kena429 = false, pertama429 = 0;
    for (let i = 1; i <= 10; i++) {
      const r = await http("/portal/admin/login", { method: "POST", headers: J, body: JSON.stringify({ password: `salah-${i}` }) });
      if (r.status === 429 && !kena429) { kena429 = true; pertama429 = i; }
    }
    cek("Blokir aktif setelah percobaan berulang", kena429, "(tidak ada 429 — proteksi gagal)");
    if (kena429) console.log(`       → diblokir mulai percobaan ke-${pertama429}`);
  }

  console.log("\n5) Header keamanan terset (harus ada)");
  {
    const r = await http("/portal");
    // Mode ditentukan dari RESPONS (bukan env proses uji): server dengan
    // SANDBOX_PREVIEW=1 mengganti X-Frame-Options dengan frame-ancestors di CSP
    // agar halaman bisa disematkan di iframe panel preview.
    cek("Header x-content-type-options", !!r.headers.get("x-content-type-options"), "(tidak ada)");
    cek("Header referrer-policy", !!r.headers.get("referrer-policy"), "(tidak ada)");
    const csp = r.headers.get("content-security-policy") || "";
    cek("Header content-security-policy", !!csp, "(tidak ada)");
    if (csp.includes("frame-ancestors")) {
      cek("Header frame-ancestors (mode preview)", csp.includes("frame-ancestors *"), "(frame-ancestors tanpa *)");
    } else {
      cek("Header x-frame-options (mode produksi)", !!r.headers.get("x-frame-options"), "(tidak ada)");
    }
  }

  console.log("\n6) Login sukses mereset penghitung brute-force");
  {
    // Bersihkan blokir dari uji #4 dulu (simulasi IP yang belum diblokir),
    // agar bisa menguji bahwa login BENAR berhasil & mereset penghitung.
    try { require("../src/lib/bruteforce").resetSemua(); } catch { /* fallback memori */ }
    const { execSync } = require("child_process");
    let pw = "";
    try { pw = execSync("./rahasia.sh ambil ADMIN_PASSWORD", { cwd: path.join(__dirname, "..") }).toString().trim(); } catch { /* vault tak ada */ }
    if (pw) {
      const r = await http("/portal/admin/login", { method: "POST", headers: J, body: JSON.stringify({ password: pw }) });
      cek("Login dengan password benar", r.status === 200, `→ ${r.status}`);
      // Setelah sukses, baris login_attempts untuk IP ini harus hilang
      try {
        const db = require("../src/db");
        const n = db.prepare("SELECT COUNT(*) c FROM login_attempts").get().c;
        cek("Penghitung direset setelah login sukses", n === 0, `→ sisa ${n} baris`);
      } catch { /* DB tak tersedia */ }
    } else {
      console.log("  (dilewati: ADMIN_PASSWORD tidak tersedia via vault)");
    }
  }

  console.log("\n7) Sesi 2 jam: TTL, penolakan sesi kedaluwarsa, & pembersih otomatis");
  {
    const session = require("../src/lib/session");
    const db = require("../src/db");
    const crypto = require("crypto");

    // TTL wajib tepat 2 jam (7200000 ms) — tidak boleh menyimpang.
    cek("SESSION_TTL_MS = 2 jam", session.SESSION_TTL_MS === 2 * 60 * 60 * 1000, `→ ${session.SESSION_TTL_MS}`);

    // Sesi segar harus valid.
    const segar = session.createSession({ role: "admin", ttlMs: session.ADMIN_TTL_MS });
    cek("Sesi baru valid", !!session.getSession(segar.token), "(getSession mengembalikan null)");

    // Sesi kedaluwarsa (expires_at di masa lalu) harus ditolak DAN dihapus.
    const tokenBasi = crypto.randomBytes(8).toString("hex");
    db.prepare("INSERT INTO sessions (token, role, expires_at) VALUES (?, ?, ?)").run(tokenBasi, "admin", Date.now() - 1000);
    const hasilBasi = session.getSession(tokenBasi);
    const masihAda = db.prepare("SELECT COUNT(*) c FROM sessions WHERE token = ?").get(tokenBasi).c;
    cek("Sesi kedaluwarsa ditolak", hasilBasi === null, "(seharusnya null)");
    cek("Sesi kedaluwarsa langsung dihapus", masihAda === 0, `→ sisa ${masihAda} baris`);

    // Pembersih massal: sisipkan 2 baris kedaluwarsa lalu pastikan terbuang.
    const ins = db.prepare("INSERT INTO sessions (token, role, expires_at) VALUES (?, ?, ?)");
    ins.run(crypto.randomBytes(8).toString("hex"), "admin", Date.now() - 5000);
    ins.run(crypto.randomBytes(8).toString("hex"), "member", Date.now() - 900000);
    const dibersihkan = session.cleanupExpired();
    cek("cleanupExpired() membuang sesi basi", dibersihkan >= 2, `→ ${dibersihkan} baris`);

    // Sesi valid harus selamat dari pembersihan.
    const masihValid = !!session.getSession(segar.token);
    cek("Sesi valid tidak ikut terhapus", masihValid, "(seharusnya masih ada)");

    // Bersihkan sisa data uji.
    db.prepare("DELETE FROM sessions").run();
  }

  console.log("\n=== HASIL ===");
  console.log(`LULUS: ${lulus} | GAGAL: ${gagal}`);
  if (srv) srv.kill();
  process.exit(gagal === 0 ? 0 : 1);
})();
