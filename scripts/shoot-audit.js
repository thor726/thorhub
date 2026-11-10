/**
 * shoot-audit.js — tangkap halaman kunci di mobile & desktop untuk audit UI/UX.
 * Output: /tmp/render/audit-*.png
 * Jalankan: NODE_PATH=/home/z/.npm-global/lib/node_modules node scripts/shoot-audit.js
 */
const path = require("path");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3000";
const DAFTAR = [
  ["beli-mobile-390-top", "/beli", 390, 844, 0],
  ["beli-mobile-390-form", "/beli", 390, 844, 900],
  ["beli-mobile-390-ringkas", "/beli", 390, 844, 2400],
  ["docs-mobile-390", "/docs", 390, 844, 0],
  ["docs-mobile-390-mid", "/docs", 390, 844, 1100],
  ["admin-login-mobile-390", "/admin", 390, 844, 0],
  ["landing-mobile-390-orbit", "/", 390, 844, 1500],
  ["landing-mobile-390-footer", "/", 390, 844, 3200],
  ["landing-1440-mid", "/", 1440, 900, 900],
];

(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox", "--force-device-scale-factor=1"] });
  for (const [nama, url, w, h, scrollY] of DAFTAR) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(400);
    if (scrollY) await p.evaluate((y) => window.scrollTo(0, y), scrollY).catch(() => {});
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join("/tmp/render", `audit-${nama}.png`) });
    await p.close();
    console.log("ok", nama);
  }
  await b.close();
})();
