/* Verifikasi URL slug "profesional" (setiap aksi punya alamat slash):
   - Portal: klik tab → /portal/<tab>; refresh → tab pulih; Kembali → tab lama
   - Portal: pill filter pesanan → /portal/pesanan?status=…; refresh → pulih
   - Admin : klik tab → /admin/<tab>; refresh → pulih; filter → ?status=&q=
   - Docs  : klik bagian → /docs/<bagian>; buka langsung → bagian aktif
   - Beli  : /beli/topup → mode top-up terpilih
   - Slug tak dikenal → halaman 404; endpoint API TIDAK tertimpa halaman */
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3000";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const crypto = require("crypto");
const db = require("../src/db");
const TEST_KEY = "sk-thor-5cdc4026cc623ec41fcaa61f8e7fb54683b00b88aa9335f7";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";

let lolos = 0, gagal = 0;
function cek(nama, kondisi, detail = "") {
  if (kondisi) { lolos++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  GAGAL ${nama}${detail ? " — " + detail : ""}`); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();

  const tabAktifPortal = () =>
    page.evaluate(() => document.querySelector(".tab.active")?.dataset.tab || "");
  const tabAktifAdmin = () =>
    page.evaluate(() => document.querySelector("[data-atab].active")?.dataset.atab || "");
  const panelAktifPortal = () =>
    page.evaluate(() => document.querySelector(".tab-panel.active")?.id || "");

  /* ============ 1. PORTAL ============ */
  console.log("[1] Portal — slug tab");
  await page.goto(BASE + "/portal", { waitUntil: "networkidle" });
  await page.fill("#apikey", TEST_KEY);
  await page.click("#btn-login");
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  cek("awal: URL /portal & tab integrasi",
    new URL(page.url()).pathname === "/portal" && (await tabAktifPortal()) === "integrasi",
    `${page.url()} · tab=${await tabAktifPortal()}`);

  await page.click('[data-tab="pesanan"]');
  await page.waitForTimeout(200);
  cek("klik tab pesanan → URL /portal/pesanan",
    new URL(page.url()).pathname === "/portal/pesanan", page.url());
  cek("panel pesanan aktif", (await panelAktifPortal()) === "tab-pesanan");

  await page.click('[data-tab="topup"]');
  await page.waitForTimeout(200);
  cek("klik tab topup → URL /portal/topup",
    new URL(page.url()).pathname === "/portal/topup", page.url());

  // Kembali (popstate) → tab pesanan lagi
  await page.goBack();
  await page.waitForTimeout(300);
  cek("tombol Kembali → URL & tab pesanan pulih",
    new URL(page.url()).pathname === "/portal/pesanan" && (await panelAktifPortal()) === "tab-pesanan",
    `${page.url()} · panel=${await panelAktifPortal()}`);

  // Refresh langsung ke slug → tab pulih tanpa klik
  await page.goto(BASE + "/portal/log", { waitUntil: "networkidle" });
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  cek("buka langsung /portal/log → tab log aktif",
    (await tabAktifPortal()) === "log" && (await panelAktifPortal()) === "tab-log",
    `tab=${await tabAktifPortal()}`);

  console.log("[2] Portal — filter pesanan di URL");
  await page.goto(BASE + "/portal/pesanan", { waitUntil: "networkidle" });
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('#order-pills [data-status="COMPLETED"]');
  await page.waitForTimeout(400);
  cek("pill Selesai → URL ?status=COMPLETED",
    new URL(page.url()).search.includes("status=COMPLETED"), page.url());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  const pillAktif = await page.evaluate(() =>
    document.querySelector("#order-pills .pill.active")?.dataset.status || "");
  cek("refresh → pill COMPLETED tetap aktif", pillAktif === "COMPLETED", `pill=${pillAktif}`);

  /* ============ 3. ADMIN ============ */
  console.log("[3] Admin — slug tab + filter");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.fill("#password", ADMIN_PASS);
  await page.click("#btn-login");
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('[data-atab="toko"]');
  await page.waitForTimeout(200);
  cek("klik tab toko → URL /admin/toko",
    new URL(page.url()).pathname === "/admin/toko" && (await tabAktifAdmin()) === "toko",
    page.url());

  await page.click('[data-ostat="PENDING"]');
  await page.waitForTimeout(400);
  cek("chip PENDING → URL ?status=PENDING",
    new URL(page.url()).search.includes("status=PENDING"), page.url());

  await page.goto(BASE + "/admin/model", { waitUntil: "networkidle" });
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(300);
  cek("buka langsung /admin/model → tab model aktif",
    (await tabAktifAdmin()) === "model", `tab=${await tabAktifAdmin()}`);

  /* ============ 4. DOCS ============ */
  console.log("[4] Docs — slug bagian");
  await page.goto(BASE + "/docs", { waitUntil: "networkidle" });
  await page.click('[data-tab="sdk"]');
  await page.waitForTimeout(200);
  cek("klik SDK & Kode → URL /docs/sdk",
    new URL(page.url()).pathname === "/docs/sdk", page.url());
  const bcDocs = await page.evaluate(() => document.getElementById("bc-docs")?.textContent || "");
  cek("breadcrumb ikut bagian", bcDocs.includes("SDK"), bcDocs);
  await page.goto(BASE + "/docs/referensi", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  cek("buka langsung /docs/referensi → panel referensi aktif",
    await page.evaluate(() => document.querySelector(".tab-panel.active")?.id === "panel-referensi"));
  // ?tab= lama tetap didukung
  await page.goto(BASE + "/docs?tab=aplikasi", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  cek("?tab=aplikasi (kompatibel lama) → panel aplikasi aktif",
    await page.evaluate(() => document.querySelector(".tab-panel.active")?.id === "panel-aplikasi"));

  /* ============ 5. BELI ============ */
  console.log("[5] Beli — slug mode");
  await page.goto(BASE + "/beli/topup", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  cek("/beli/topup → mode top-up terpilih",
    await page.evaluate(() => document.getElementById("mode-topup").classList.contains("active")));

  /* ============ 5b. DEEP-LINK DUA SEGMEN ============ */
  console.log("[5b] Deep-link dua segmen — modal via URL");
  // Suntik satu pesanan uji milik member yang sedang login, lalu buka URL
  // langsung: /portal/lacak/<kode> dan /admin/pesanan/<kode>.
  const me = await page.evaluate(() =>
    fetch("/portal/member/me", { credentials: "same-origin" })
      .then((r) => r.json()).then((j) => j.data.user_name));
  const kodeDl = "THX-DLINK" + crypto.randomBytes(2).toString("hex").toUpperCase();
  const expDl = new Date(Date.now() + 864e5).toISOString();
  const infoDl = db
    .prepare(
      "INSERT INTO orders (order_code, access_token, mode, package_id, quota_tokens, user_name, email, whatsapp, target_api_key, api_key_issued, base_amount, unique_code, amount_to_pay, payment_method, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(kodeDl, "tok-dl", "topup", "20m", 20_000_000, me, "", "", TEST_KEY, "", 16_000, 777, 16_777, "QRIS DANA", "COMPLETED", expDl);
  try {
    // Portal: URL langsung membuka tab pesanan + modal pelacakan
    await page.goto(BASE + "/portal/lacak/" + kodeDl, { waitUntil: "networkidle" });
    await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(700);
    const judulTrk = await page.evaluate(() => document.getElementById("trk-judul")?.textContent || "");
    cek("/portal/lacak/<kode> → modal terbuka + judul memuat kode",
      (await page.evaluate(() => !document.getElementById("modal-lacak").classList.contains("hidden"))) &&
        judulTrk.includes(kodeDl),
      `judul=${judulTrk}`);
    cek("tab pesanan ikut aktif", (await tabAktifPortal()) === "pesanan", `tab=${await tabAktifPortal()}`);

    // Tutup modal → URL dirapikan ke daftar pesanan
    await page.click("#trk-tutup");
    await page.waitForTimeout(300);
    cek("tutup modal → URL jadi /portal/pesanan",
      new URL(page.url()).pathname === "/portal/pesanan", page.url());

    // Admin: URL langsung membuka modal detail pesanan
    await page.goto(BASE + "/admin/pesanan/" + kodeDl, { waitUntil: "networkidle" });
    await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(700);
    const judulAdm = await page.evaluate(() => document.getElementById("modal-title")?.textContent || "");
    cek("/admin/pesanan/<kode> → modal detail terbuka",
      (await page.evaluate(() => !document.getElementById("modal").classList.contains("hidden"))) &&
        judulAdm.includes(kodeDl),
      `judul=${judulAdm}`);
    await page.click("#modal-close");
    await page.waitForTimeout(300);
    cek("tutup modal → URL jadi /admin/toko",
      new URL(page.url()).pathname === "/admin/toko", page.url());
  } finally {
    db.prepare("DELETE FROM order_events WHERE order_id = ?").run(infoDl.lastInsertRowid);
    db.prepare("DELETE FROM orders WHERE order_code = ?").run(kodeDl);
  }

  /* ============ 6. API TIDAK TERTIMPA & SLUG TAK DIKENAL ============ */
  console.log("[6] Batasan rute");
  const resKeys = await page.request.get(BASE + "/admin/keys");
  const ctype = resKeys.headers()["content-type"] || "";
  cek("GET /admin/keys tetap JSON API (bukan halaman)",
    resKeys.status() === 401 && ctype.includes("json"), `${resKeys.status()} ${ctype}`);
  const resMe = await page.request.get(BASE + "/portal/member/me");
  cek("GET /portal/member/me tetap JSON API",
    (resMe.headers()["content-type"] || "").includes("json"), `${resMe.status()}`);

  await page.goto(BASE + "/portal/ngasal", { waitUntil: "domcontentloaded" });
  cek("/portal/ngasal → halaman 404",
    await page.evaluate(() => document.title.includes("404") || !!document.querySelector(".notfound-code")),
    await page.title());

  await browser.close();
  console.log(`\n=== HASIL: ${lolos} PASS, ${gagal} GAGAL ===`);
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
