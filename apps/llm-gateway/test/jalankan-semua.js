#!/usr/bin/env node
// Penjalan semua uji non-browser. Dipakai oleh `npm test`.
//
// Kenapa ada berkas ini: rantai `a && b && c` di package.json berhenti di uji
// pertama yang gagal, sehingga uji berikutnya tidak pernah dijalankan dan
// kesehatan project tidak terlihat utuh. Runner ini menjalankan SEMUA uji,
// lalu melaporkan ringkasannya di akhir.
//
// Uji yang butuh browser (playwright) TIDAK ikut di sini — lihat `npm run test:browser`.

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const UJI = [
  "check-security.js",
  "check-identitas.js",
  "check-ui.js",
  "check-css.js",
  "check-bg.js",
  "check-animasi.js",
  "check-multiplier.js",
  "check-lacak-member.js",
  "check-endpoints.js",
  "verify-docs.js",
];

const akar = path.join(__dirname, "..");
const hasil = [];

for (const berkas of UJI) {
  const mulai = Date.now();
  process.stdout.write(`\n──────── ${berkas} ────────\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, berkas)], {
    cwd: akar,
    stdio: "inherit",
    env: process.env,
  });
  hasil.push({ berkas, kode: r.status ?? 1, detik: ((Date.now() - mulai) / 1000).toFixed(1) });
}

const gagal = hasil.filter((h) => h.kode !== 0);

console.log("\n════════ RINGKASAN UJI ════════");
for (const h of hasil) {
  console.log(`  [${h.kode === 0 ? "LULUS" : "GAGAL"}] ${h.berkas.padEnd(26)} ${h.detik}s`);
}
console.log(`  total: ${hasil.length - gagal.length} lulus, ${gagal.length} gagal`);

if (gagal.length) {
  console.log(`  gagal: ${gagal.map((g) => g.berkas).join(", ")}`);
  process.exit(1);
}
