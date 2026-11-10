/**
 * check-animasi.js — Penjaga regresi untuk strategi PRA-RENDER "MUNCUL".
 *
 * Latar belakang (terukur): animasi entrance tanpa syarat pada .card, anak
 * .stagger, dan baris .stagger-rows membuat elemen di luar layar beranimasi
 * sejak muat; saat masuk viewport saat gulir, browser menyiapkan layer-nya
 * mendadak → frame berat (di /docs @1440px: 9 frame > 33ms, p95 34.6ms,
 * terburuk 48ms). Perbaikannya: animasi dipindah ke public/muncul.js dengan
 * IntersectionObserver ber-buffer (rootMargin 400px).
 *
 * Uji ini MENCEGAH regresi: memastikan animasi entrance tidak kembali menempel
 * permanen di CSS, modul muncul.js tetap ada & benar, dan terpasang di setiap
 * halaman.
 *
 * Jalankan: node test/check-animasi.js
 */
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");

let error = 0;
const cek = (nama, ok, info) => {
  console.log(`  ${ok ? "✓" : "✗"} ${nama}${info ? " — " + info : ""}`);
  if (!ok) error++;
};

const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, ""); // tanpa komentar

console.log("=== 1. CSS: animasi entrance TIDAK lagi menempel permanen ===");
// "animation: none" (mis. di blok prefers-reduced-motion) tetap SAH — yang
// dilarang adalah animasi entrance yang benar-benar berjalan (memakai keyframe).
const animBerjalan = (blok) => /animation\s*:\s*(?!none)[a-zA-Z]/.test(blok);
cek("blok .card tanpa animation berjalan", !animBerjalan((css.match(/\.card\s*\{[^}]*\}/) || [""])[0]));
cek("blok .stagger > * tanpa animation berjalan", !animBerjalan((css.match(/\.stagger\s*>\s*\*\s*\{[^}]*\}/) || [""])[0]));
cek("baris .stagger-rows tanpa animation berjalan", !animBerjalan((css.match(/\.stagger-rows[^{}]*\{[^}]*\}/) || [""])[0]));

console.log("\n=== 2. CSS: aturan pra-render hadir & benar ===");
cek(".pra-render { opacity: 0 } ada", /\.pra-render\s*\{[^}]*opacity\s*:\s*0\s*;?/.test(css));
cek("@keyframes masukBuffer ada", /@keyframes\s+masukBuffer/.test(css));
cek("kelas .masuk-jalan memakai masukBuffer", /\.masuk-jalan\s*\{[^}]*masukBuffer/.test(css));

console.log("\n=== 3. CSS: TIDAK memakai culling agresif ===");
cek("tidak ada content-visibility", !/content-visibility/.test(css));
cek("tidak ada animation-play-state: paused", !/animation-play-state\s*:\s*paused/.test(css));

console.log("\n=== 4. muncul.js: buffer & pengaman ===");
// Buang komentar agar kalimat penjelasan (mis. menyebut "content-visibility"
// sebagai hal yang DIHINDARI) tidak salah dianggap kode.
const js = read("muncul.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
cek("file muncul.js ada", js.length > 500);
cek("memakai IntersectionObserver", /IntersectionObserver/.test(js));
cek("rootMargin (buffer pra-render) dipakai", /rootMargin/.test(js));
cek("buffer minimal 200px", /rootMargin:\s*[A-Za-z]*\s*\.\.\.|rootMargin:\s*(BUFFER|2\d\d|[3-9]\d\d)/.test(js) || /BUFFER\s*=\s*(2\d\d|[3-9]\d\d)/.test(js));
cek("menyembunyikan lewat class (opacity), bukan display", /classList\.(add|remove)\("pra-render"\)/.test(js));
cek("TIDAK memakai display:none", !/style\.display\s*=\s*["']none/.test(js));
cek("TIDAK memakai content-visibility", !/content-visibility/.test(js));
cek("TIDAK menghapus DOM (removeChild)", !/removeChild/.test(js));
cek("ada pengaman pageshow", /pageshow/.test(js));
cek("ada pengaman timer ungkapSemua", /setTimeout\(ungkapSemua/.test(js));
cek("menangani elemen dinamis (MutationObserver)", /MutationObserver/.test(js));

console.log("\n=== 5. muncul.js terpasang di setiap halaman ===");
for (const f of ["index.html", "docs.html", "portal.html", "admin.html", "login-admin.html", "login-member.html", "404.html"]) {
  const h = read(f);
  // Query cache-busting (?v=…) diizinkan — yang diuji hanya kehadiran modulnya.
  cek(f + " memuat /muncul.js", /<script[^>]+src="\/muncul\.js(\?[^"]*)?"/.test(h));
}

console.log("\n=== HASIL ===");
console.log(error === 0 ? "PRA-RENDER VALID (0 masalah)" : `${error} masalah ditemukan`);
process.exit(error === 0 ? 0 : 1);
