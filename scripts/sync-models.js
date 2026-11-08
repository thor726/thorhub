#!/usr/bin/env node
/**
 * sync-models.js — Bandingkan snapshot model LOKAL dengan /v1/models provider.
 *
 * Snapshot di src/lib/models.js dipakai sebagai FALLBACK saat provider tidak bisa
 * dihubungi. Karena status aktif/nonaktif model bisa berubah kapan saja di sisi
 * provider, snapshot harus diperiksa agar tidak menyimpang diam-diam.
 *
 * Pemakaian:
 *   node scripts/sync-models.js            # periksa saja (exit 1 bila ada beda)
 *   node scripts/sync-models.js --tulis    # tulis ulang flag `active` di models.js
 *
 * Field yang dibandingkan: keberadaan id + status aktif. (Vision & multiplier
 * tidak dikirim provider, jadi tetap dipertahankan dari snapshot.)
 *
 * Catatan: skrip ini HANYA membaca /v1/models (tidak menghasilkan token/biaya),
 * cukup Master API Key yang sudah ada di .env.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "src", "lib", "models.js");
const TULIS = process.argv.includes("--tulis");

async function ambilProvider() {
  const base = (process.env.TARGET_API_BASE_URL || "").replace(/\/+$/, "");
  const key = process.env.MASTER_API_KEY || "";
  if (!base || !key) throw new Error("TARGET_API_BASE_URL / MASTER_API_KEY belum diisi di .env");
  const r = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Provider membalas HTTP ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.data;
  if (!Array.isArray(list)) throw new Error("Bentuk respons provider tidak dikenal (butuh array di .data)");
  return new Map(
    list
      .filter((m) => m && typeof m.id === "string")
      .map((m) => [m.id, m.enabled !== false && m.available !== false])
  );
}

function bacaSnapshot() {
  const teks = fs.readFileSync(FILE, "utf8");
  const peta = new Map();
  for (const m of teks.matchAll(/\{\s*id:\s*"([^"]+)"[^}]*?active:\s*(true|false)[^}]*\}/g)) {
    peta.set(m[1], m[2] === "true");
  }
  return { teks, peta };
}

(async () => {
  const prov = await ambilProvider();
  const { teks, peta } = bacaSnapshot();

  const hanyaSnapshot = [...peta.keys()].filter((id) => !prov.has(id));
  const hanyaProvider = [...prov.keys()].filter((id) => !peta.has(id));
  const bedaAktif = [];
  for (const [id, lokal] of peta) {
    if (prov.has(id) && prov.get(id) !== lokal) bedaAktif.push({ id, lokal, prov: prov.get(id) });
  }

  const aktifLokal = [...peta.values()].filter(Boolean).length;
  const aktifProv = [...prov.values()].filter(Boolean).length;

  console.log("=== SINKRONISASI SNAPSHOT MODEL vs PROVIDER ===");
  console.log(`snapshot : ${peta.size} model (${aktifLokal} aktif)`);
  console.log(`provider : ${prov.size} model (${aktifProv} aktif)`);
  console.log("");
  console.log(`id hanya di snapshot : ${hanyaSnapshot.length ? hanyaSnapshot.join(", ") : "(tidak ada)"}`);
  console.log(`id hanya di provider : ${hanyaProvider.length ? hanyaProvider.join(", ") : "(tidak ada)"}`);
  console.log(`beda status aktif    : ${bedaAktif.length}`);
  for (const b of bedaAktif) {
    console.log(`   ${b.id.padEnd(28)} snapshot=${b.lokal ? "AKTIF" : "non"}  provider=${b.prov ? "AKTIF" : "non"}`);
  }

  const adaBeda = hanyaSnapshot.length || hanyaProvider.length || bedaAktif.length;

  if (!adaBeda) {
    console.log("\nHASIL: SINKRON ✓ (snapshot sama persis dengan provider)");
    process.exit(0);
  }

  if (TULIS) {
    let baru = teks;
    let n = 0;
    for (const b of bedaAktif) {
      // Ganti flag active pada baris yang memuat id ini.
      const re = new RegExp(`(\\{\\s*id:\\s*"${b.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?active:\\s*)(true|false)`);
      if (re.test(baru)) {
        baru = baru.replace(re, `$1${b.prov}`);
        n++;
      }
    }
    // Perbarui juga catatan jumlah di komentar header.
    baru = baru.replace(/Total 42 model, \d+ aktif/, `Total 42 model, ${ [...baru.matchAll(/active:\s*true/g)].length } aktif`);
    if (n) {
      fs.writeFileSync(FILE, baru);
      console.log(`\nHASIL: ${n} flag 'active' diperbarui di ${path.relative(process.cwd(), FILE)}.`);
      console.log("(id yang hanya ada di provider tidak ditambahkan otomatis — tambahkan manual bila perlu.)");
      process.exit(0);
    }
    console.log("\nTidak ada flag 'active' yang bisa diperbarui otomatis.");
  }

  console.log("\nHASIL: TIDAK SINKRON — jalankan `node scripts/sync-models.js --tulis` untuk memperbaiki.");
  process.exit(1);
})().catch((e) => {
  console.error("GAGAL:", e.message);
  process.exit(2);
});
