/* Verifikasi breadcrumb ala Thor-market:
   - Markup tampil di semua halaman (Beranda / … / <kini>)
   - Portal: segmen terakhir berubah SETIAP klik tab
   - Admin: idem
   - Beli: segmen ikut tahap Checkout → Pembayaran → Selesai */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:3000";
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const TEST_KEY = "sk-thor-5cdc4026cc623ec41fcaa61f8e7fb54683b00b88aa9335f7";

let lolos = 0, gagal = 0;
function cek(nama, kondisi, detail = "") {
  if (kondisi) { lolos++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  GAGAL ${nama}${detail ? " — " + detail : ""}`); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();

  // Bantu ambil teks breadcrumb saat ini
  const bcText = async () =>
    page.evaluate(() => {
      const nav = document.querySelector("nav.breadcrumb");
      if (!nav) return null;
      return [...nav.children].map((el) => el.textContent.trim()).filter(Boolean).join(" ");
    });

  console.log("[1] Halaman statis");
  for (const [path, harus] of [
    ["/docs", "Beranda / Mulai Cepat"], // docs.js kini dinamis: segmen terakhir = bagian aktif
    ["/login-member.html", "Beranda / Portal Member / Masuk"],
    ["/login-admin.html", "Beranda / Panel Admin / Masuk"],
    ["/halaman-tidak-ada-xyz", "Beranda / Halaman Tidak Ditemukan"],
  ]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    const t = await bcText();
    cek(`breadcrumb ${path} = "${harus}"`, t === harus, `dapat: ${t}`);
  }

  console.log("[2] /beli — segmen ikut tahap");
  await page.goto(BASE + "/beli", { waitUntil: "networkidle" });
  cek("tahap Checkout", (await bcText()) === "Beranda / Beli Token / Checkout", String(await bcText()));

  console.log("[3] Portal — breadcrumb ikut klik tab");
  await page.goto(BASE + "/portal", { waitUntil: "networkidle" });
  await page.fill("#apikey", TEST_KEY);
  await page.click("#btn-login");
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  cek("setelah login: tab awal", (await bcText()) === "Beranda / Portal Member / Integrasi API", String(await bcText()));
  for (const [tab, label] of [
    ["topup", "Top Up"],
    ["pesanan", "Pesanan Saya"],
    ["pemakaian", "Pemakaian"],
    ["model", "Model"],
    ["log", "Log Aktivitas"],
    ["integrasi", "Integrasi API"],
  ]) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForTimeout(120);
    cek(`klik tab ${tab}`, (await bcText()) === `Beranda / Portal Member / ${label}`, String(await bcText()));
  }
  // Klik tombol "Top Up" di kartu kuota → aktifkanTab("topup") → breadcrumb ikut
  await page.click("#btn-buka-topup");
  await page.waitForTimeout(150);
  cek("klik tombol Top Up kartu kuota", (await bcText()) === "Beranda / Portal Member / Top Up", String(await bcText()));

  // Logout → kembali ke "Masuk"
  await page.click("#btn-logout");
  await page.waitForTimeout(400);
  cek("logout → Masuk", (await bcText()) === "Beranda / Portal Member / Masuk", String(await bcText()));

  console.log("[4] Admin — breadcrumb ikut klik tab");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.fill("#password", process.env.ADMIN_PASSWORD || "thor-dana-2026");
  await page.click("#btn-login");
  await page.waitForSelector("#panel:not(.hidden)", { timeout: 15000 });
  cek("admin: tab awal", (await bcText()) === "Beranda / Panel Admin / Kelola Key", String(await bcText()));
  for (const [tab, label] of [
    ["aktivitas", "Aktivitas"],
    ["model", "Model"],
    ["toko", "Toko & Pesanan"],
    ["kelola", "Kelola Key"],
  ]) {
    await page.click(`[data-atab="${tab}"]`);
    await page.waitForTimeout(120);
    cek(`klik tab admin ${tab}`, (await bcText()) === `Beranda / Panel Admin / ${label}`, String(await bcText()));
  }

  console.log("[5] Screenshot verifikasi visual");
  fs.mkdirSync("/tmp/render", { recursive: true });
  await page.goto(BASE + "/docs", { waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/render/bc-docs.png", clip: { x: 0, y: 0, width: 1360, height: 420 } });
  await page.goto(BASE + "/beli", { waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/render/bc-beli.png", clip: { x: 0, y: 0, width: 1360, height: 640 } });

  await browser.close();
  console.log(`\nHASIL: ${lolos} PASS, ${gagal} GAGAL`);
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
