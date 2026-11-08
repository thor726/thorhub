/**
 * buat-ikon.js — Menghasilkan icon-192.png & icon-512.png untuk PWA.
 *
 * Ditulis murni dengan Node (tanpa dependensi) agar server tetap bersih:
 * rasterisasi manual + supersampling 4x supaya tepi logo halus (anti-alias).
 *
 * Jalankan: node scripts/buat-ikon.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- Geometri logo (mengikuti public/logo.svg, viewBox 0 0 64 64) ----
const VB = 64;
const BG = [0x14, 0x14, 0x14, 255]; // #141414
const BORDER = [0x2a, 0x2a, 0x2a, 255]; // #2a2a2a
const LIME = [0xa3, 0xe6, 0x35, 255]; // #a3e635
const RADIUS = 12;
const BORDER_W = 2;

// Petir Thor (polygon dari logo.svg)
const PETIR = [
  [35, 11],
  [20, 35],
  [30, 35],
  [26, 53],
  [45, 27],
  [34, 27],
];

/** Titik di dalam poligon (ray casting). */
function diPoligon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const potong = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (potong) inside = !inside;
  }
  return inside;
}

/** Titik di dalam rounded-rect. */
function diRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Warna pada satu titik (koordinat ruang viewBox). */
function warna(px, py) {
  // Badan kotak
  if (!diRoundedRect(px, py, 2, 2, 60, 60, RADIUS)) return [0, 0, 0, 0];
  // Petir
  if (diPoligon(px, py, PETIR)) return LIME;
  // Tepi kotak
  if (
    !diRoundedRect(px, py, 2 + BORDER_W, 2 + BORDER_W, 60 - 2 * BORDER_W, 60 - 2 * BORDER_W, RADIUS - BORDER_W)
  ) {
    return BORDER;
  }
  return BG;
}

/** Rasterisasi ke buffer RGBA dengan supersampling. */
function render(ukuran) {
  const SS = 4; // faktor supersample
  const skala = VB / ukuran;
  const buf = Buffer.alloc(ukuran * ukuran * 4);

  for (let y = 0; y < ukuran; y++) {
    for (let x = 0; x < ukuran; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * skala;
          const py = (y + (sy + 0.5) / SS) * skala;
          const c = warna(px, py);
          r += c[0] * (c[3] / 255);
          g += c[1] * (c[3] / 255);
          b += c[2] * (c[3] / 255);
          a += c[3];
        }
      }
      const n = SS * SS;
      const alfa = a / n;
      const i = (y * ukuran + x) * 4;
      if (alfa > 0) {
        // rata-rata warna tertimbang alfa
        const wa = Math.max(1e-6, a / 255);
        buf[i] = Math.round(r / wa);
        buf[i + 1] = Math.round(g / wa);
        buf[i + 2] = Math.round(b / wa);
      }
      buf[i + 3] = Math.round(alfa);
    }
  }
  return buf;
}

/** Bungkus buffer RGBA jadi berkas PNG (IHDR + IDAT + IEND). */
function tulisPNG(namaBerkas, ukuran, rgba) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (tipe, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(tipe, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ukuran, 0);
  ihdr.writeUInt32BE(ukuran, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Filter byte 0 di awal setiap baris
  const baris = [];
  for (let y = 0; y < ukuran; y++) {
    baris.push(Buffer.from([0]));
    baris.push(rgba.slice(y * ukuran * 4, (y + 1) * ukuran * 4));
  }
  const idat = zlib.deflateSync(Buffer.concat(baris), { level: 9 });

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  fs.writeFileSync(namaBerkas, png);
  return png.length;
}

const keluar = path.join(__dirname, "..", "public");
for (const ukuran of [192, 512]) {
  const rgba = render(ukuran);
  const nama = path.join(keluar, `icon-${ukuran}.png`);
  const n = tulisPNG(nama, ukuran, rgba);
  console.log(`✓ ${path.basename(nama)} — ${ukuran}x${ukuran}, ${(n / 1024).toFixed(1)} KB`);
}
