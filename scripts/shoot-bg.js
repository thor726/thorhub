/**
 * shoot-bg.js — ukur skala render latar NYATA di browser (bukan simulasi Node).
 *
 * Untuk 4 ukuran layar representatif: buka halaman, baca viewBox SVG latar +
 * ukuran elemen ter-render, hitung skala slice dan ukuran grid di layar
 * (grid kanvas 100px x skala). Harus ~55px (SKALA_TARGET 0.55) di SEMUA
 * viewport — itulah perbaikan "masih ngezoom": dulu 75px (HP) s.d. 115px
 * (ultrawide) karena viewBox statis 2000x1250.
 *
 * Sekalian mengambil screenshot tiap viewport ke /tmp/render/bg-*.png
 * untuk audit layout mobile/desktop.
 *
 * Jalankan: NODE_PATH=/home/z/.npm-global/lib/node_modules node scripts/shoot-bg.js
 */
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const VIEWPORTS = [
  ["mobile-390", 390, 844],
  ["desktop-1440", 1440, 900],
  ["desktop-1920", 1920, 1080],
  ["ultra-2560", 2560, 1440],
];

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  });
  require("fs").mkdirSync("/tmp/render", { recursive: true });

  for (const [nama, w, h] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
    // Tunggu SVG latar terpasang oleh bg.js
    await page.waitForSelector("svg[viewBox]", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);

    const data = await page.evaluate(() => {
      const svg = document.querySelector("svg[viewBox]");
      if (!svg) return null;
      const vb = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
      const r = svg.getBoundingClientRect();
      // Elemen slice: skala = max(rasio lebar, rasio tinggi)
      const skala = Math.max(r.width / vb[2], r.height / vb[3]);
      return {
        viewBox: `${vb[2]}x${vb[3]}`,
        elem: `${Math.round(r.width)}x${Math.round(r.height)}`,
        skala: +skala.toFixed(3),
        gridPx: Math.round(100 * skala),
      };
    });

    console.log(nama.padEnd(14), data ? JSON.stringify(data) : '{"error":"svg latar tidak ditemukan"}');
    await page.screenshot({ path: path.join("/tmp/render", `bg-${nama}.png`) });
    await page.close();
  }

  // Screenshot tambahan untuk audit layout: login portal (HP) & checkout (desktop)
  const shot = async (url, nama, w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join("/tmp/render", `${nama}.png`) });
    await page.close();
  };
  await shot("/portal", "portal-login-390", 390, 844);
  await shot("/beli", "beli-1920", 1920, 1080);

  await browser.close();
  console.log("selesai — screenshot di /tmp/render/");
})();
