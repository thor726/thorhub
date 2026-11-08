/**
 * Uji cepat bg.js di Node tanpa browser: stubs DOM minimal, jalankan skrip,
 * lalu periksa SVG yang dihasilkan (jumlah elemen, tidak ada NaN/undefined,
 * id gradien & mask ada dan saling terhubung).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const kode = fs.readFileSync(path.join(__dirname, "..", "public", "bg.js"), "utf8");

let svgDibuat = null;
function buatEl(ns, tag) {
  const el = {
    tagName: tag,
    attrs: {},
    innerHTML: "",
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
  };
  if (tag === "svg") svgDibuat = el;
  return el;
}

const body = {
  firstChild: { dummy: true },
  insertBefore(node) { this.anak = node; },
};

const document = {
  body,
  createElementNS: buatEl,
  querySelector: () => null,
  addEventListener: () => {},
};

const ctx = vm.createContext({ document, window: {}, Math, console });

let err = 0;
const cek = (nama, ok, info = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${nama}${info ? "  (" + info + ")" : ""}`);
  if (!ok) err++;
};

try {
  vm.runInContext(kode, ctx, { filename: "bg.js" });
} catch (e) {
  console.log("  ✗ bg.js melempar error:", e.message);
  process.exit(1);
}

console.log("=== bg.js — hasil render (Node, tanpa browser) ===");
cek("SVG terbentuk", !!svgDibuat);
cek("disisipkan sebagai anak pertama body", body.anak === svgDibuat);

const svg = svgDibuat.innerHTML;
const attr = svgDibuat.attrs;

cek("class = cc-bg-svg", attr.class === "cc-bg-svg");
cek("aria-hidden = true", attr["aria-hidden"] === "true");
cek("viewBox benar", attr.viewBox === "0 0 1600 1000", attr.viewBox);
cek("preserveAspectRatio = slice", attr.preserveAspectRatio === "xMidYMid slice");

cek("tidak ada NaN", !/NaN/.test(svg));
cek("tidak ada undefined", !/undefined/.test(svg));

// Elemen struktural
const hitung = (re) => (svg.match(re) || []).length;
const garisGrid = hitung(/class="ccbg-garis/g);
const simpul = hitung(/class="ccbg-simpul/g);
const denyut = hitung(/ccbg-denyut/g);
const halo = hitung(/class="ccbg-halo-arc/g);
const kilat = hitung(/class="ccbg-kilat"/g);
const netGaris = hitung(/<line x1=/g) - garisGrid;

console.log(`\n  grid: ${garisGrid} garis | jaringan: ${simpul} simpul, ${netGaris} penghubung`);
console.log(`  denyut: ${denyut} simpul | halo: ${halo} busur | kilat: ${kilat} jalur`);

// Vertikal: 1600/100 + 1 = 17, horizontal: 1000/100 + 1 = 11 → total 28.
cek("grid tergambar (17 vertikal + 11 horizontal = 28 garis)", garisGrid === 28, String(garisGrid));
cek("simpul jaringan ≥ 20", simpul >= 20, String(simpul));
cek("ada penghubung antar simpul", netGaris > 10, String(netGaris));
cek("simpul berdenyut ada", denyut >= 4, String(denyut));
cek("3 busur halo", halo === 3, String(halo));
cek("2 jalur kilat utama", kilat === 2, String(kilat));

// Definisi <defs> ↔ referensi harus cocok
const defIds = [...svg.matchAll(/id="(ccbg-[a-z-]+)"/g)].map((m) => m[1]);
console.log("\n  id di <defs>:", defIds.join(", "));
for (const id of defIds) {
  const dipakai = svg.includes(`url(#${id})`);
  cek(`id "${id}" dipakai (url(#...))`, dipakai);
}
const urlRefs = [...svg.matchAll(/url\(#(ccbg-[a-z-]+)\)/g)].map((m) => m[1]);
for (const u of new Set(urlRefs)) {
  cek(`referensi url(#${u}) punya definisi`, defIds.includes(u));
}

// Koordinat harus dalam (atau dekat) kanvas — hindari elemen "nyasar"
const luar = [...svg.matchAll(/(?:x|cx|y|cy|x1|x2|y1|y2)="(-?\d+(?:\.\d+)?)"/g)]
  .map((m) => Number(m[1]))
  .filter((n) => n < -200 || n > 1800);
cek("tidak ada koordinat nyasar (< -200 atau > 1800)", luar.length === 0, luar.join(","));

console.log("\n=== HASIL ===");
console.log(err === 0 ? "bg.js VALID (0 masalah)" : `${err} masalah ditemukan`);
process.exit(err === 0 ? 0 : 1);
