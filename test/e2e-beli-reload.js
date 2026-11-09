/**
 * test/e2e-beli-reload.js — Uji E2E (Playwright) alur pembeli di /beli:
 *   1. Checkout → QR + stepper tahap 2 + URL ?order=TERBENTUK
 *   2. RELOAD halaman → tampilan pembayaran DIPULIHKAN utuh (bug "QR hilang"
 *      saat halaman di-restart) — QR dibangun ulang server dari ?order= + token
 *   3. Webhook DANA cocok → halaman sukses + key (stepper tahap 3)
 *   4. RELOAD setelah lunas → sukses + key tetap tampil (token jadi struk)
 *   5. /beli tanpa ?order= → kartu "Lanjutkan Pembayaran" dari localStorage
 *   6. Browser lain (tanpa token) → QR tidak bocor, hanya status ringkas
 *
 * Butuh Playwright + Chromium:
 *   npm i -g playwright && playwright install chromium
 *   NODE_PATH=$(npm root -g) node test/e2e-beli-reload.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3000";
function readEnv(p) {
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const ENV = readEnv(path.join(__dirname, "..", ".env"));

let PASS = 0, FAIL = 0;
function cek(nama, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "GAGAL"}  ${nama}${detail && !ok ? " → " + detail : ""}`);
  ok ? PASS++ : FAIL++;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  console.log("== 1. Checkout: beli key baru ==");
  await page.goto(BASE + "/beli", { waitUntil: "networkidle" });
  await page.click(".pkg >> nth=0");
  await page.fill("#f-nama", "tes-e2e-reload");
  await page.fill("#f-email", "tes-e2e-reload@contoh.com");
  await page.click("#btn-beli");
  await page.waitForSelector("#step-bayar:not(.hidden)");
  const kode = (await page.textContent("#pay-kode")).trim();
  const nominal = (await page.textContent("#pay-amount")).trim();
  cek("QR tampil setelah submit", await page.isVisible("#qr-img"));
  cek("stepper tahap 2 aktif", await page.$eval(".st[data-st='2']", (el) => el.classList.contains("active")));
  cek("URL memuat ?order=", page.url().includes("order=" + kode), page.url());
  const harga1 = (await page.textContent("#pay-harga")).trim();
  const unik1 = (await page.textContent("#pay-kode-unik")).trim();
  cek("info harga terisi", harga1 !== "—", harga1);
  cek("kode unik terisi", unik1 !== "+—", unik1);
  console.log(`    kode=${kode} nominal=${nominal} harga=${harga1} unik=${unik1}`);

  console.log("== 2. RELOAD halaman → pembayaran harus tetap ada ==");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  cek("step pembayaran tampil lagi", await page.$eval("#step-bayar", (el) => !el.classList.contains("hidden")));
  cek("form checkout disembunyikan", await page.$eval("#step-form", (el) => el.classList.contains("hidden")));
  cek("QR muncul kembali", await page.$eval("#qr-img", (el) => !!el.src && !el.classList.contains("hidden")));
  cek("kode pesanan sama", (await page.textContent("#pay-kode")).trim() === kode);
  cek("nominal sama", (await page.textContent("#pay-amount")).trim() === nominal);
  cek("harga tidak jadi \u2014", (await page.textContent("#pay-harga")).trim() === harga1);
  cek("kode unik tidak jadi \u2014", (await page.textContent("#pay-kode-unik")).trim() === unik1);
  cek("stepper tetap tahap 2", await page.$eval(".st[data-st='2']", (el) => el.classList.contains("active")));
  cek("countdown berjalan", /\dmnt/.test((await page.textContent("#pay-expired")).trim()));

  console.log("== 3. Webhook DANA → lunas → halaman sukses ==");
  const adminLogin = await fetch(BASE + "/portal/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ENV.ADMIN_PASSWORD }),
  });
  const cookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0];
  const storeInfo = await (await fetch(BASE + "/portal/admin/store", { headers: { cookie } })).json();
  const secret = storeInfo?.data?.qris?.secret || "";
  cek("secret webhook tersedia", !!secret);
  const angka = Number(nominal.replace(/[^\d]/g, ""));
  const wh = await fetch(BASE + "/store/webhook/dana", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_token: secret, text: `DANA: Kamu menerima Rp${angka.toLocaleString("id-ID")} dari TES E2E` }),
  });
  cek("webhook diterima (200)", wh.status === 200, String(wh.status));
  await page.click("#btn-cek-status");
  await page.waitForSelector("#step-selesai:not(.hidden)", { timeout: 12000 });
  cek("halaman sukses tampil", true);
  cek("stepper tahap 3 aktif", await page.$eval(".st[data-st='3']", (el) => el.classList.contains("active")));
  const keyTampil = (await page.textContent("#key-final")).trim();
  cek("API key tampil di halaman sukses", keyTampil.startsWith("sk-thor-"), keyTampil.slice(0, 12) + "…");

  console.log("== 4. RELOAD setelah lunas → sukses tetap tampil ==");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  cek("halaman sukses dipulihkan", await page.$eval("#step-selesai", (el) => !el.classList.contains("hidden")));
  cek("key tetap tampil (token sah)", ((await page.textContent("#key-final")).trim() || "").startsWith("sk-thor-"));

  console.log("== 5. Kembali ke /beli tanpa ?order= (storage masih ada) → kartu lanjutkan ==");
  // Buat pesanan PENDING baru untuk uji kartu lanjutkan
  await page.evaluate(() => localStorage.removeItem("thorhub_order_aktif"));
  await page.goto(BASE + "/beli", { waitUntil: "networkidle" });
  await page.click(".pkg >> nth=0");
  await page.fill("#f-nama", "tes-e2e-lanjut");
  await page.fill("#f-email", "tes-e2e-lanjut@contoh.com");
  await page.click("#btn-beli");
  await page.waitForSelector("#step-bayar:not(.hidden)");
  const kode2 = (await page.textContent("#pay-kode")).trim();
  await page.goto(BASE + "/beli", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const adaKartu = await page.isVisible("#btn-lanjut");
  cek("kartu 'Lanjutkan Pembayaran' tampil", adaKartu);
  if (adaKartu) {
    await page.click("#btn-lanjut");
    await page.waitForSelector("#step-bayar:not(.hidden)");
    cek("lanjut → pembayaran tampil", (await page.textContent("#pay-kode")).trim() === kode2);
    cek("URL kembali memuat ?order=", page.url().includes("order=" + kode2));
  }

  console.log("== 6. Browser baru (tanpa token) → /beli?order=… status ringkas ==");
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/beli?order=" + kode2, { waitUntil: "networkidle" });
  await p2.waitForTimeout(800);
  cek("QR TIDAK bocor di browser lain", !(await p2.$eval("#step-bayar", (el) => !el.classList.contains("hidden"))));
  cek("status ringkas tampil", (await p2.textContent("#order-lama")).includes(kode2));
  await ctx2.close();

  await browser.close();
  console.log(`\nHASIL: ${PASS} PASS, ${FAIL} GAGAL`);
  process.exit(FAIL ? 1 : 0);
})();
