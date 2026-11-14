#!/usr/bin/env node
/**
 * manage-keys.js — CLI manajemen Sub-API Key (bonus di atas generate-key.js).
 *
 * Perintah yang tersedia:
 *   node manage-keys.js list                     → daftar semua key
 *   node manage-keys.js show <api_key>           → detail satu key
 *   node manage-keys.js enable <api_key>         → aktifkan kembali key
 *   node manage-keys.js disable <api_key>        → blokir key (pembeli tetap punya key tapi ditolak 403)
 *   node manage-keys.js topup <api_key> <token>  → tambah kuota token
 *   node manage-keys.js delete <api_key>         → hapus key permanen
 */
const db = require("./src/db");

const [, , command, apiKey, amountArg] = process.argv;

function findByKey(key) {
  const row = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(key);
  if (!row) {
    console.error(`Error: key "${key}" tidak ditemukan.`);
    process.exit(1);
  }
  return row;
}

function printRow(row) {
  console.log("-------------------------------------------------");
  console.log(`ID             : ${row.id}`);
  console.log(`API Key        : ${row.api_key}`);
  console.log(`Nama user      : ${row.user_name}`);
  console.log(`Token limit    : ${row.token_limit.toLocaleString("id-ID")}`);
  console.log(`Token terpakai : ${row.tokens_used.toLocaleString("id-ID")} (${Math.round((row.tokens_used / row.token_limit) * 100)}%)`);
  console.log(`Sisa kuota     : ${Math.max(0, row.token_limit - row.tokens_used).toLocaleString("id-ID")}`);
  console.log(`Status         : ${row.is_active ? "AKTIF" : "NONAKTIF"}`);
  console.log(`Dibuat         : ${row.created_at}`);
  console.log("-------------------------------------------------");
}

const stmtList = db.prepare("SELECT * FROM api_keys ORDER BY id DESC");
const stmtSetActive = db.prepare("UPDATE api_keys SET is_active = ? WHERE id = ?");
const stmtAddLimit = db.prepare("UPDATE api_keys SET token_limit = token_limit + ? WHERE id = ?");
const stmtDelete = db.prepare("DELETE FROM api_keys WHERE api_key = ?");

switch (command) {
  case "list": {
    const rows = stmtList.all();
    if (rows.length === 0) return console.log("Belum ada Sub-API Key terdaftar.");
    console.log(`Total ${rows.length} Sub-API Key:`);
    rows.forEach(printRow);
    break;
  }

  case "show": {
    if (!apiKey) return console.error("Cara pakai: node manage-keys.js show <api_key>");
    printRow(findByKey(apiKey));
    break;
  }

  case "enable": {
    if (!apiKey) return console.error("Cara pakai: node manage-keys.js enable <api_key>");
    const row = findByKey(apiKey);
    stmtSetActive.run(1, row.id);
    console.log(`✅ Key ${apiKey} sekarang AKTIF.`);
    break;
  }

  case "disable": {
    if (!apiKey) return console.error("Cara pakai: node manage-keys.js disable <api_key>");
    const row = findByKey(apiKey);
    stmtSetActive.run(0, row.id);
    console.log(`⛔ Key ${apiKey} sekarang NONAKTIF (request pembeli akan ditolak 403).`);
    break;
  }

  case "topup": {
    if (!apiKey || !amountArg) return console.error("Cara pakai: node manage-keys.js topup <api_key> <jumlah_token>");
    const amount = Number(amountArg);
    if (!Number.isInteger(amount) || amount <= 0) {
      return console.error("Error: <jumlah_token> harus bilangan bulat positif.");
    }
    const row = findByKey(apiKey);
    stmtAddLimit.run(amount, row.id);
    const updated = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(row.id);
    console.log(`✅ Top-up ${amount.toLocaleString("id-ID")} token berhasil untuk ${apiKey}.`);
    printRow(updated);
    break;
  }

  case "delete": {
    if (!apiKey) return console.error("Cara pakai: node manage-keys.js delete <api_key>");
    findByKey(apiKey); // validasi dulu agar pesan error jelas
    stmtDelete.run(apiKey);
    console.log(`🗑️  Key ${apiKey} telah dihapus permanen.`);
    break;
  }

  default:
    console.log("Cara pakai: node manage-keys.js <perintah> <api_key> [nilai]");
    console.log("");
    console.log("Perintah:");
    console.log("  list                          Daftar semua key");
    console.log("  show <api_key>                Detail satu key");
    console.log("  enable <api_key>              Aktifkan key");
    console.log("  disable <api_key>             Nonaktifkan key");
    console.log("  topup <api_key> <jml_token>   Tambah kuota token");
    console.log("  delete <api_key>              Hapus key permanen");
}
