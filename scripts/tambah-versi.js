/**
 * tambah-versi.js — cache-busting semua referensi CSS/JS di public/*.html.
 * Menambahkan query ?v=<VERSI> pada href/src aset yang sering berubah
 * (style.css + 9 file js). Logo/favicon/manifest sengaja tidak di-bust
 * karena jarang berubah dan akan merusak cache PWA bila diubah sering.
 * Idempoten: query versi lama diganti, bukan ditumpuk.
 */
const fs = require("fs");
const path = require("path");

const VERSI = process.argv[2] || "20261110a";
const DIR = path.join(__dirname, "..", "public");
const ASET = [
  "style.css",
  "bg.js",
  "nav.js",
  "portal.js",
  "admin.js",
  "beli.js",
  "docs.js",
  "muncul.js",
  "app-logos.js",
  "vendor-logos.js",
];

let total = 0;
for (const berkas of fs.readdirSync(DIR).filter((f) => f.endsWith(".html"))) {
  const p = path.join(DIR, berkas);
  let html = fs.readFileSync(p, "utf8");
  let n = 0;
  for (const aset of ASET) {
    const ext = path.extname(aset); // .css / .js
    const nama = aset.slice(0, -ext.length);
    const re = new RegExp(`(href|src)="/${nama}\\${ext}(\\?v=[^"]*)?"`, "g");
    html = html.replace(re, (_m, attr) => {
      n++;
      return `${attr}="/${aset}?v=${VERSI}"`;
    });
  }
  if (n) {
    fs.writeFileSync(p, html);
    total += n;
    console.log(`${berkas}: ${n} referensi → ?v=${VERSI}`);
  }
}
console.log(`Total: ${total} referensi di-bust ke versi ${VERSI}`);
