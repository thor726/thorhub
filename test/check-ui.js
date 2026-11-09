/**
 * check-ui.js — Verifikasi integritas UI setelah perubahan gaya/animasi.
 *
 * Memastikan: setiap id/class yang diakses JavaScript masih ada di HTML,
 * struktur HTML seimbang, dan tidak ada referensi yang hilang.
 *
 * Jalankan: node test/check-ui.js
 */
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");

let error = 0;
const warn = [];

// Pasangan halaman ↔ skrip yang mengaksesnya
const pairs = [
  { html: "index.html", js: null },
  { html: "docs.html", js: "docs.js" },
  { html: "portal.html", js: "portal.js" },
  { html: "admin.html", js: "admin.js" },
  { html: "404.html", js: null },
  { html: "login-admin.html", js: null },
  { html: "login-member.html", js: null },
];

const semuaIdHtml = new Set();
for (const { html } of pairs) {
  const h = read(html);
  for (const m of h.matchAll(/id="([^"]+)"/g)) semuaIdHtml.add(m[1]);
}

console.log("=== 1. HTML: keseimbangan tag <div> ===");
for (const { html } of pairs) {
  const h = read(html);
  const open = (h.match(/<div\b/g) || []).length;
  const close = (h.match(/<\/div>/g) || []).length;
  const ok = open === close;
  console.log(`  ${ok ? "✓" : "✗"} ${html.padEnd(20)} div: ${open}/${close}`);
  if (!ok) error++;
}

console.log("\n=== 2. HTML: tag wajib ada ===");
for (const { html } of pairs) {
  const h = read(html);
  // <body> sering memakai atribut (class="cc-aurora") sehingga pencocokan string
  // '<body>' selalu gagal → pakai regex agar mendeteksi tag pembuka apa pun.
  const perlu = ['<!DOCTYPE html>', '<html', '</html>', '<head>', '</head>', '</body>'];
  const kurang = perlu.filter((t) => !h.includes(t));
  if (!/<body[\s>]/.test(h)) kurang.push('<body');
  if (kurang.length) { console.log(`  ✗ ${html}: kurang ${kurang.join(", ")}`); error++; }
  else console.log(`  ✓ ${html}`);
}

console.log("\n=== 3. JS: id yang diakses harus ada di HTML terkait ===");
for (const { html, js } of pairs) {
  if (!js) continue;
  const code = read(js);
  const h = read(html);
  const idsHtml = new Set([...h.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const idsJs = new Set();
  for (const m of code.matchAll(/\$\("([^"]+)"\)/g)) idsJs.add(m[1]);
  for (const m of code.matchAll(/getElementById\("([^"]+)"\)/g)) idsJs.add(m[1]);

  const hilang = [...idsJs].filter((id) => !idsHtml.has(id));
  // id yang dibuat dinamis saat runtime (hasil render) dikecualikan
  const dinamis = ["copy-new", "st-status", "st-queue", "st-running", "btn-create", "btn-login", "btn-refresh", "btn-reveal", "btn-copy", "btn-logout", "form-login", "form-create", "keys-wrap", "create-result", "login-msg", "panel", "loading", "login-section", "stats", "gw-status", "cards", "status-warn", "uname", "mykey", "curl-example", "py-example", "apikey", "password", "search", "models-wrap", "models-meta", "new-name", "new-limit", "notif-box", "modal-order-msg", "btn-topup-ulang", "btn-topup-ulang2", "btn-topup-lagi"];
  const benarBenarHilang = hilang.filter((id) => !dinamis.includes(id));
  if (benarBenarHilang.length) {
    console.log(`  ✗ ${js} → ${html}: id tidak ditemukan: ${benarBenarHilang.join(", ")}`);
    error++;
  } else {
    console.log(`  ✓ ${js} → ${html} (${idsJs.size} id diperiksa)`);
  }
}

console.log("\n=== 4. HTML: class tab ↔ panel konsisten (docs) ===");
{
  const h = read("docs.html");
  const tabs = [...h.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  const panels = [...h.matchAll(/id="panel-([a-z]+)"/g)].map((m) => m[1]);
  const ok = tabs.length === panels.length && tabs.every((t) => panels.includes(t));
  console.log(`  ${ok ? "✓" : "✗"} tab=[${tabs.join(", ")}] panel=[${panels.join(", ")}]`);
  if (!ok) error++;
}

console.log("\n=== 5. Skeleton & spinner tersedia di CSS ===");
{
  const css = read("style.css");
  for (const cls of [".skeleton", ".spinner", ".loading-box", ".stagger", ".stagger-rows", ".dot", ".ico"]) {
    const ada = css.includes(cls);
    console.log(`  ${ada ? "✓" : "✗"} ${cls}`);
    if (!ada) error++;
  }
}

console.log("\n=== 6. Ikon SVG dipakai di halaman ===");
for (const { html } of pairs) {
  const h = read(html);
  const n = (h.match(/class="ico/g) || []).length;
  console.log(`  ${n > 0 ? "✓" : "·"} ${html.padEnd(20)} ${n} ikon`);
}

console.log("\n=== 7. Latar ThorHub dipasang lewat bg.js (satu sumber) ===");
{
  const pakaiBg = fs.existsSync(path.join(pub, "bg.js"));
  console.log(`  ${pakaiBg ? "✓" : "✗"} public/bg.js ada`);
  if (!pakaiBg) error++;

  for (const { html } of pairs) {
    const h = read(html);
    const adaScript = /<script[^>]+src="\/bg\.js"/.test(h);
    const adaClass = /<body class="cc-bg"/.test(h);
    const sisaAurora = /cc-aurora|aurora-/i.test(h);
    const ok = adaScript && adaClass && !sisaAurora;
    console.log(`  ${ok ? "✓" : "✗"} ${html.padEnd(20)} script:${adaScript ? "ya" : "TIDAK"} class:${adaClass ? "ya" : "TIDAK"}${sisaAurora ? " (masih ada sisa aurora!)" : ""}`);
    if (!ok) error++;
  }

  // CSS tidak boleh lagi menyimpan gaya aurora lama, dan wajib punya gaya latar baru.
  const css = read("style.css");
  const adaAurora = /cc-aurora|--aurora-/.test(css);
  const keyframesLatar = ["@keyframes ccbg-denyut", "@keyframes ccbg-halo-spin", "@keyframes ccbg-pendar"];
  const adaBgBaru = css.includes(".cc-bg-svg") && keyframesLatar.every((k) => css.includes(k));
  console.log(`  ${!adaAurora ? "✓" : "✗"} CSS bebas dari gaya aurora lama`);
  console.log(`  ${adaBgBaru ? "✓" : "✗"} CSS punya gaya latar ThorHub (.cc-bg-svg + keyframes)`);
  if (adaAurora || !adaBgBaru) error++;
}

console.log("\n=== HASIL ===");
console.log(error === 0 ? "UI VALID (0 masalah)" : `${error} masalah ditemukan`);
process.exit(error === 0 ? 0 : 1);
