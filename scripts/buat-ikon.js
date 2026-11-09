/**
 * buat-ikon.js — Menghasilkan icon-192.png & icon-512.png untuk PWA
 * langsung dari public/logo.svg (sumber kebenaran identitas), sehingga
 * ikon PWA selalu konsisten dengan logo apa pun yang sedang dipakai.
 *
 * Rasterisasi memakai cairosvg (Python) dengan output anti-alias.
 * Pasang dulu bila belum ada:  pip install cairosvg
 *
 * Jalankan: node scripts/buat-ikon.js
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const sumber = path.join(__dirname, "..", "public", "logo.svg");
const keluar = path.join(__dirname, "..", "public");

if (!fs.existsSync(sumber)) {
  console.error("public/logo.svg tidak ditemukan — pasang logo terlebih dahulu.");
  process.exit(1);
}

// Pastikan cairosvg tersedia sebelum mulai, agar pesan galatnya jelas.
try {
  execFileSync("python3", ["-c", "import cairosvg"], { stdio: "ignore" });
} catch {
  console.error("Modul cairosvg (Python) belum terpasang. Jalankan: pip install cairosvg");
  process.exit(1);
}

const render = (src, dst, ukuran) =>
  execFileSync("python3", [
    "-c",
    "import sys, cairosvg; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], " +
      "output_width=int(sys.argv[3]), output_height=int(sys.argv[3]))",
    src,
    dst,
    String(ukuran),
  ]);

for (const ukuran of [192, 512]) {
  const tujuan = path.join(keluar, `icon-${ukuran}.png`);
  render(sumber, tujuan, ukuran);
  const kb = (fs.statSync(tujuan).size / 1024).toFixed(1);
  console.log(`✓ ${path.basename(tujuan)} — ${ukuran}x${ukuran}, ${kb} KB`);
}
