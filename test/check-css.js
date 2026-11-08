/**
 * check-css.js — Validasi dasar file CSS.
 * Memeriksa: keseimbangan kurung, keyframes terdefinisi, karakter mencurigakan,
 * dan properti CSS yang tidak valid (typo umum).
 *
 * Jalankan: node test/check-css.js
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "public", "style.css");
const css = fs.readFileSync(file, "utf8");

let error = 0;

// 1. Keseimbangan kurung kurawal
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
console.log("kurung { :", open, "| } :", close);
if (open !== close) { console.log("  ✗ TIDAK SEIMBANG"); error++; }
else console.log("  ✓ seimbang");

// 2. Setiap `animation:` yang memakai nama harus punya @keyframes-nya
//
// CATATAN: pemindaian dilakukan pada SALINAN TANPA KOMENTAR. Sebelumnya
// komentar ikut dipindai sehingga kalimat penjelasan seperti
// "…alih-alih animation:none…" salah dianggap deklarasi animasi, lalu pola
// [^;]+ menelan teks jauh sampai titik-koma berikutnya dan menghasilkan nama
// animasi palsu ("dan", "html.ber-gulir"). Bukan bug CSS, melainkan bug alat uji.
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");

const keyframes = new Set([...cssTanpaKomentar.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
console.log("\nkeyframes terdefinisi (" + keyframes.size + "):", [...keyframes].join(", "));

const animNames = new Set();
for (const m of cssTanpaKomentar.matchAll(/animation:\s*([^;]+);/g)) {
  // Ambil token pertama (nama animasi) bila bukan angka/durasi
  const parts = m[1].split(",");
  for (const p of parts) {
    const first = p.trim().split(/\s+/)[0];
    if (first && !/^[0-9.]/.test(first) && first !== "none" && !/^\$/.test(first)) animNames.add(first);
  }
}
const undefined = [...animNames].filter((n) => !keyframes.has(n));
console.log("nama animasi dipakai:", [...animNames].join(", "));
if (undefined.length) { console.log("  ✗ keyframes tidak ada untuk:", undefined.join(", ")); error++; }
else console.log("  ✓ semua animasi punya keyframes");

// 3. Karakter non-ASCII di luar komentar (berpotensi rusak encoding)
// Buang seluruh blok komentar (termasuk multi-baris) lebih dulu.
const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const lines = tanpaKomentar.split("\n");
let badChars = 0;
lines.forEach((line, i) => {
  if (/[^\x00-\x7F]/.test(line)) {
    console.log(`  ✗ baris ${i + 1} punya karakter non-ASCII: ${line.trim().slice(0, 60)}`);
    badChars++; error++;
  }
});
console.log("\nkarakter non-ASCII di luar komentar:", badChars === 0 ? "0 ✓" : badChars);

// 4. Cek properti CSS yang sering salah tulis
const typo = [
  { re: /tabular-nums\s*:/, msg: "tabular-nums bukan properti CSS (pakai font-variant-numeric)" },
  { re: /^\s*margin:\s*auto\s+auto\s*;/m, msg: "margin: auto auto berlebihan (cukup margin:auto)" },
  { re: /;{2,}/, msg: "ada titik-koma ganda" },
];
console.log("");
for (const t of typo) {
  if (t.re.test(cssTanpaKomentar)) { console.log("  ✗ " + t.msg); error++; }
  else console.log("  ✓ " + t.msg.slice(0, 40) + "…: aman");
}

console.log("\n=== HASIL ===");
console.log(error === 0 ? "CSS VALID (0 masalah)" : `${error} masalah ditemukan`);
process.exit(error === 0 ? 0 : 1);
