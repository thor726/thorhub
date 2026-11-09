#!/usr/bin/env node
/**
 * generate-key.js — CLI untuk menerbitkan Sub-API Key baru untuk pembeli.
 *
 * Cara pakai:
 *   node generate-key.js <nama_user> <limit_token>
 * Contoh:
 *   node generate-key.js "Budi Santoso" 1000000
 */
const crypto = require("crypto");
const db = require("./src/db");
const masaAktif = require("./src/lib/masa-aktif");

const [, , userName, limitArg] = process.argv;

if (!userName || !limitArg) {
  console.log("Cara pakai  : node generate-key.js <nama_user> <limit_token>");
  console.log('Contoh      : node generate-key.js "Budi Santoso" 1000000');
  process.exit(1);
}

const tokenLimit = Number(limitArg);
if (!Number.isInteger(tokenLimit) || tokenLimit <= 0) {
  console.error("Error: <limit_token> harus berupa bilangan bulat positif. Contoh: 1000000");
  process.exit(1);
}

// Format key: sk-thor-<48 karakter hex acak> — masa aktif 25 hari
const apiKey = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
const expiresAt = masaAktif.masaAktifBaru();

const info = db
  .prepare("INSERT INTO api_keys (api_key, user_name, token_limit, expires_at) VALUES (?, ?, ?, ?)")
  .run(apiKey, userName, tokenLimit, expiresAt);

console.log("\n✅ Sub-API Key berhasil diterbitkan!");
console.log("=================================================");
console.log(`ID           : ${info.lastInsertRowid}`);
console.log(`Nama user    : ${userName}`);
console.log(`API Key      : ${apiKey}`);
console.log(`Token limit  : ${tokenLimit.toLocaleString("id-ID")}`);
console.log(`Token terpakai: 0`);
console.log(`Status       : aktif`);
console.log(`Masa aktif   : ${masaAktif.MASA_AKTIF_HARI} hari — s.d. ${masaAktif.formatWaktuIndo(expiresAt)}`);
console.log("=================================================");
console.log("⚠️  Simpan key ini dengan aman — key TIDAK ditampilkan lagi setelah ini.");
console.log("   Pembeli memakainya dengan header: Authorization: Bearer <API_KEY>\n");
