/**
 * verify-docs.js — Verifikasi halaman dokumentasi /docs.
 * Memastikan semua blok kode terisi nilai yang benar (base URL, key, model).
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(dir, "public/docs.html"), "utf8");
const js = fs.readFileSync(path.join(dir, "public/docs.js"), "utf8");

const BASE = "https://llm.thormarket.site";
const V1 = BASE + "/v1";
const KEY = "sk-thor-XXXXXXXX";
const M = "deepseek-v4-pro";
const M2 = "kimi-k2.7-code";

// Ambil tiap pemanggilan set("ex-...", `...`) dan resolve variabelnya
const re = /set\("(ex-[a-z-]+)",\s*`([\s\S]*?)`\);/g;
let match;
const hasil = {};
while ((match = re.exec(js))) {
  const id = match[1];
  let body = match[2];
  // Resolve ${variabel} sesuai nilai sebenarnya
  body = body
    .replace(/\$\{BASE\}/g, BASE)
    .replace(/\$\{V1\}/g, V1)
    .replace(/\$\{KEY\}/g, KEY)
    .replace(/\$\{m2\}/g, M2)
    .replace(/\$\{m\}/g, M);
  hasil[id] = body;
}

console.log("=== BLOK KODE TERISI ===");
const ids = Object.keys(hasil);
for (const id of ids) {
  const first = hasil[id].split("\n")[0];
  console.log(`${id.padEnd(16)} | ${first.slice(0, 70)}`);
}
console.log("");
console.log("total blok terisi:", ids.length);

// Cek tidak ada lagi template yang belum ter-resolve
console.log("");
console.log("=== CEK SISA TEMPLATE BELUM TERISI ===");
let sisa = 0;
for (const id of ids) {
  const bad = hasil[id].match(/\$\{[A-Za-z0-9_]*\}/g);
  if (bad && bad.length) {
    // mengandung ${...} yang bukan bagian dari contoh kode sengaja (mis. shell)
    const mencurigakan = bad.filter((b) => /^\$\{(BASE|V1|KEY|m|m2)\}$/.test(b));
    if (mencurigakan.length) {
      console.log(`  ${id}: ${mencurigakan.join(", ")}`);
      sisa++;
    }
  }
}
console.log(sisa === 0 ? "  (bersih — semua variabel ter-resolve)" : `  ${sisa} blok masih bermasalah`);

// Cek semua tombol data-copy punya target yang ada
console.log("");
console.log("=== CEK TOMBOL SALIN ===");
const copyTargets = [...html.matchAll(/data-copy="([a-z0-9-]+)"/g)].map((m) => m[1]);
const missingCopy = copyTargets.filter((t) => !hasil[t] && !html.includes(`id="${t}"`));
console.log("tombol salin:", copyTargets.length, "| target hilang:", missingCopy.length);
if (missingCopy.length) console.log("  HILANG:", missingCopy.join(", "));

// Cek konsistensi tab
console.log("");
console.log("=== CEK TAB ===");
const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
const panels = [...html.matchAll(/id="panel-([a-z]+)"/g)].map((m) => m[1]);
const okTabs = tabs.length === panels.length && tabs.every((t) => panels.includes(t));
console.log("tab:", tabs.join(", "));
console.log("panel:", panels.join(", "));
console.log(okTabs ? "OK: semua tab punya panel" : "MISMATCH!");

// Ringkasan akhir
console.log("");
console.log("=== RINGKASAN ===");
console.log("kartu   :", (html.match(/class="card"/g) || []).length);
console.log("blok kode:", ids.length);
console.log("tombol salin:", copyTargets.length);
console.log("tab     :", tabs.length);
process.exit(sisa === 0 && okTabs && missingCopy.length === 0 ? 0 : 1);
