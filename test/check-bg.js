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
// Garis grid selalu memakai atribut class, sedangkan garis jaringan TIDAK —
// jadi pola "<line x1=" hanya menangkap garis jaringan.
const netGaris = hitung(/<line x1=/g);

console.log(`\n  grid: ${garisGrid} garis | jaringan: ${simpul} simpul, ${netGaris} penghubung`);
console.log(`  denyut: ${denyut} simpul | halo: ${halo} busur | kilat: ${kilat} jalur`);

// Vertikal: 1600/100 + 1 = 17, horizontal: 1000/100 + 1 = 11 → total 28.
cek("grid tergambar (17 vertikal + 11 horizontal = 28 garis)", garisGrid === 28, String(garisGrid));
cek("simpul jaringan ≥ 20", simpul >= 20, String(simpul));
cek("ada penghubung antar simpul", netGaris > 10, String(netGaris));
cek("simpul berdenyut ada", denyut >= 4, String(denyut));
cek("3 busur halo", halo === 3, String(halo));
cek("2 jalur kilat utama", kilat === 2, String(kilat));

/* PERFORMA: simpul yang berdenyut harus DI LUAR grup ber-mask, kalau tidak
   <mask> dihitung ulang tiap frame (FPS diam jatuh ~37 → terukur di Chromium).
   Bukti struktural: grup .ccbg-net-denyut tidak berada di dalam grup ber-mask. */
const iMask = svg.indexOf('mask="url(#ccbg-pudar-mask)"');
const iDenyut = svg.indexOf('class="ccbg-net-denyut"');
const akhirGrupMask = svg.indexOf("</g>", svg.indexOf("ccbg-net-simpul"));
cek("grup simpul denyut berada DI LUAR grup ber-mask",
  iDenyut > 0 && iDenyut > akhirGrupMask && iMask > 0, `denyut@${iDenyut} mask@${iMask} tutup-mask@${akhirGrupMask}`);
const jumlahDenyutLuar = (svg.slice(iDenyut).match(/class="ccbg-simpul-denyut/g) || []).length;
cek("semua simpul denyut dikeluarkan dari mask", jumlahDenyutLuar === denyut,
  `${jumlahDenyutLuar} dari ${denyut}`);
const denyutBak = (svg.match(/fill-opacity="[\d.]+"/g) || []).length;
cek("nilai pudar simpul denyut dipanggang (fill-opacity)", denyutBak === denyut,
  `${denyutBak} dari ${denyut}`);

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

/* ==============================================================
   SIMETRI CERMIN terhadap x = 800
   Permintaan pemilik produk: latar harus "di tengah" & tidak berat sebelah,
   jadi simetri diperiksa otomatis di sini (bukan sekadar diklaim).
   ============================================================== */
const TENGAH = 800;
console.log("\n  -- uji simetri cermin (sumbu x = 800) --");

/* 1. Jaringan: tiap simpul WAJIB punya pasangan cermin (x' = 1600 − x) dengan
      y, kelas, dan jeda denyut yang sama persis. */
/* Simpul diam : class, cx, cy, r.
   Simpul denyut: class, cx, cy, r, fill-opacity, style(animation-delay) —
   fill-opacity "dipanggang" oleh bg.js karena simpul ini di LUAR grup ber-mask.
   Keduanya harus diperiksa agar simetri seluruh 28 simpul benar-benar terbukti. */
const simpulRe = /<circle class="(ccbg-simpul[^"]*)" cx="(\d+)" cy="(\d+)" r="([\d.]+)"(?: fill-opacity="([\d.]+)")?(?: style="animation-delay:([\d.]+)s")?\/>/g;
const daftarSimpul = [...svg.matchAll(simpulRe)].map((m) => ({
  kelas: m[1], x: Number(m[2]), y: Number(m[3]), r: Number(m[4]), tunda: m[5] || null,
}));
const kunciSimpul = (s) => `${s.x}|${s.y}|${s.kelas}|${s.r}|${s.tunda}`;
const himpunanSimpul = new Set(daftarSimpul.map(kunciSimpul));
const tanpaCermin = daftarSimpul.filter((s) =>
  !himpunanSimpul.has(kunciSimpul({ ...s, x: 1600 - s.x })));
cek(`semua ${daftarSimpul.length} simpul punya pasangan cermin`, tanpaCermin.length === 0,
  tanpaCermin.length ? `tanpa cermin: ${tanpaCermin.map((s) => s.x + "," + s.y).join(" ")}` : "");

/* Simpul tidak boleh menyentuh garis tengah (nanti tampak "menempel" saat HP
   memotong tengah) maupun keluar kanvas. */
const terlaluDekatTengah = daftarSimpul.filter((s) => Math.abs(s.x - TENGAH) < 40);
cek("tidak ada simpul menempel garis tengah (< 40px)", terlaluDekatTengah.length === 0,
  terlaluDekatTengah.map((s) => s.x).join(","));

/* Sebaran vertikal harus seimbang: rata-rata y mendekati tengah kanvas (500). */
const rataY = daftarSimpul.reduce((a, s) => a + s.y, 0) / daftarSimpul.length;
cek("sebaran simpul seimbang atas-bawah (rata2 y ≈ 500 ± 90)",
  Math.abs(rataY - 500) <= 90, "rata2 y = " + rataY.toFixed(1));

/* Kotak pembatas jaringan harus simetris: minX + maxX tepat 1600. */
const xsSimpul = daftarSimpul.map((s) => s.x);
const minX = Math.min(...xsSimpul), maxX = Math.max(...xsSimpul);
cek("kotak jaringan simetris (minX + maxX = 1600)", minX + maxX === 1600,
  `${minX} + ${maxX} = ${minX + maxX}`);

/* 2. Penghubung jaringan: setiap garis harus punya pasangan cerminnya.
      CATATAN PENTING: garis grid punya atribut class SEBELUM x1, jadi pola
      "<line x1=" hanya menangkap garis jaringan — grid diperiksa terpisah di
      bagian 5 memakai pola ber-class. */
const garisNet = [...svg.matchAll(/<line x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>/g)]
  .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
const kunciGaris = (g) => g.join("|");
const setGarisNet = new Set(garisNet.map(kunciGaris));
// Urutan titik boleh TERBALIK: bila sebuah garis menghubungkan tepat sepasang
// simpul cermin, cerminan garis itu adalah dirinya sendiri dengan ujung
// tertukar (a,b) → (b,a) — itu tetap dianggap simetris.
const punyaCermin = ([a, b, c, d]) =>
  setGarisNet.has(kunciGaris([1600 - a, b, 1600 - c, d])) ||
  setGarisNet.has(kunciGaris([1600 - c, d, 1600 - a, b]));
const garisTanpaCermin = garisNet.filter((g) => !punyaCermin(g));
cek(`semua ${garisNet.length} penghubung jaringan punya pasangan cermin`,
  garisTanpaCermin.length === 0, garisTanpaCermin.length ? garisTanpaCermin.map(kunciGaris).join(" ") : "");

/* 3. Halo: semua busur harus berpusat tepat di garis tengah. */
const haloRe = /<circle class="ccbg-halo-arc ccbg-halo-\d+" cx="(\d+)" cy="(\d+)" r="(\d+)"\/>/g;
const daftarHalo = [...svg.matchAll(haloRe)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }));
cek("semua busur halo berpusat di x = 800",
  daftarHalo.length > 0 && daftarHalo.every((h) => h.cx === TENGAH),
  daftarHalo.map((h) => h.cx).join(","));

/* 4. Kilat: jalur kanan harus cerminan tepat jalur kiri. */
const kilatD = [...svg.matchAll(/class="ccbg-kilat" d="([^"]+)"/g)].map((m) => m[1]);
const titikJalur = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
if (kilatD.length === 2) {
  const kiri = titikJalur(kilatD[0]);
  const kanan = titikJalur(kilatD[1]);
  const cocok = kiri.length === kanan.length &&
    kiri.every(([x, y], i) => Math.abs((1600 - x) - kanan[i][0]) < 0.001 && y === kanan[i][1]);
  cek("kilat kanan = cerminan tepat kilat kiri", cocok,
    cocok ? `${kiri.length} titik per jalur` : "titik tidak cermin");
  // Pasangan kilat harus bersebelahan dengan sumbu? Tidak — kilat di margin tepi,
  // jadi yang diperiksa adalah jaraknya ke tengah harus sama besar (simetris).
  const jarakKiri = TENGAH - Math.min(...kiri.map((p) => p[0]));
  const jarakKanan = Math.max(...kanan.map((p) => p[0])) - TENGAH;
  cek("jarak kilat ke garis tengah seimbang", jarakKiri === jarakKanan,
    `kiri ${jarakKiri} / kanan ${jarakKanan}`);
} else {
  cek("ada 2 jalur kilat untuk diperiksa simetrinya", false, String(kilatD.length));
}

/* 5. Grid: garisnya ber-atribut class, jadi diperiksa memakai pola ber-class.
      Semua garis vertikal (x tetap) harus simetris; garis horizontal otomatis
      simetris karena bentangnya 0..1600 (tepat di tengah sumbu). */
const garisGridSemua = [...svg.matchAll(
  /<line class="ccbg-garis[^"]*" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>/g)]
  .map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
const xsGrid = garisGridSemua.filter((g) => g[0] === g[2]).map((g) => g[0]);
const setXGrid = new Set(xsGrid);
cek("grid vertikal simetris (tiap x punya cermin 1600 − x)",
  xsGrid.length > 0 && xsGrid.every((x) => setXGrid.has(1600 - x)), `${xsGrid.length} garis vertikal`);
const ysGrid = garisGridSemua.filter((g) => g[1] === g[3]).map((g) => g[1]);
cek("grid horizontal membentang penuh 0→1600 (otomatis simetris)",
  ysGrid.length > 0 && garisGridSemua.filter((g) => g[1] === g[3]).every((g) => g[0] === 0 && g[2] === 1600),
  `${ysGrid.length} garis horizontal`);
// Total grid harus cocok dengan jumlah yang dilaporkan di awal.
cek("jumlah garis grid konsisten dengan laporan awal",
  garisGridSemua.length === garisGrid, `${garisGridSemua.length} vs ${garisGrid}`);

// Koordinat harus dalam (atau dekat) kanvas — hindari elemen "nyasar"
const luar = [...svg.matchAll(/(?:x|cx|y|cy|x1|x2|y1|y2)="(-?\d+(?:\.\d+)?)"/g)]
  .map((m) => Number(m[1]))
  .filter((n) => n < -200 || n > 1800);
cek("tidak ada koordinat nyasar (< -200 atau > 1800)", luar.length === 0, luar.join(","));

console.log("\n=== HASIL ===");
console.log(err === 0 ? "bg.js VALID (0 masalah)" : `${err} masalah ditemukan`);
process.exit(err === 0 ? 0 : 1);
