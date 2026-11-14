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

// butuhServer: uji integrasi yang menembak server HTTP project ini sekaligus
// membaca DB yang sama dengan server tersebut. Kalau server tidak jalan, uji
// ini dilewati (bukan digagalkan) supaya `npm test` di checkout baru tidak
// memberi alarm palsu soal lingkungan.
const UJI = [
  { berkas: "check-security.js" },
  { berkas: "check-identitas.js" },
  { berkas: "check-ui.js" },
  { berkas: "check-css.js" },
  { berkas: "check-bg.js" },
  { berkas: "check-animasi.js" },
  { berkas: "check-multiplier.js" },
  { berkas: "check-lacak-member.js", butuhServer: true },
  { berkas: "check-endpoints.js" },
  { berkas: "verify-docs.js" },
];

const akar = path.join(__dirname, "..");

async function serverHidup() {
  try {
    require("dotenv").config({ path: path.join(akar, ".env") });
  } catch { /* dotenv tak tersedia — pakai default */ }
  const host = process.env.HOST && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "127.0.0.1";
  const port = process.env.PORT || 3000;
  try {
    const r = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

(async () => {
  const hidup = await serverHidup();
  const hasil = [];

  for (const uji of UJI) {
    if (uji.butuhServer && !hidup) {
      process.stdout.write(`\n──────── ${uji.berkas} ────────\n`);
      console.log("  [lewati] server belum jalan — jalankan `npm start` dulu untuk uji ini");
      hasil.push({ berkas: uji.berkas, kode: 0, detik: "0.0", lewat: true });
      continue;
    }

    const mulai = Date.now();
    process.stdout.write(`\n──────── ${uji.berkas} ────────\n`);
    const r = spawnSync(process.execPath, [path.join(__dirname, uji.berkas)], {
      cwd: akar,
      stdio: "inherit",
      env: process.env,
    });
    hasil.push({ berkas: uji.berkas, kode: r.status ?? 1, detik: ((Date.now() - mulai) / 1000).toFixed(1) });
  }

  const gagal = hasil.filter((h) => h.kode !== 0);
  const dilewati = hasil.filter((h) => h.lewat);

  console.log("\n════════ RINGKASAN UJI ════════");
  for (const h of hasil) {
    const tanda = h.lewat ? "LEWAT" : h.kode === 0 ? "LULUS" : "GAGAL";
    console.log(`  [${tanda}] ${h.berkas.padEnd(26)} ${h.detik}s`);
  }
  console.log(`  total: ${hasil.length - gagal.length - dilewati.length} lulus, ${gagal.length} gagal, ${dilewati.length} dilewati`);

  if (gagal.length) {
    console.log(`  gagal: ${gagal.map((g) => g.berkas).join(", ")}`);
    process.exit(1);
  }
})();
