/**
 * scripts/demo-pesanan.js — Suntik pesanan demo untuk verifikasi UI pelacakan.
 * Pemakaian: node scripts/demo-pesanan.js [hapus]
 *   tanpa argumen  → buat 2 pesanan demo (PENDING + COMPLETED) milik key aktif
 *   arg "hapus"    → hapus semua pesanan demo (order_code LIKE 'THX-DEMO%')
 */
const crypto = require("crypto");
const db = require("../src/db");

if (process.argv[2] === "hapus") {
  const rows = db.prepare("SELECT id, order_code FROM orders WHERE order_code LIKE 'THX-DEMO%'").all();
  for (const r of rows) {
    db.prepare("DELETE FROM order_events WHERE order_id = ?").run(r.id);
    db.prepare("DELETE FROM orders WHERE id = ?").run(r.id);
  }
  console.log(`Dihapus ${rows.length} pesanan demo.`);
  process.exit(0);
}

const mk =
  (process.env.KEY && db.prepare("SELECT api_key, user_name FROM api_keys WHERE api_key = ?").get(process.env.KEY)) ||
  db.prepare("SELECT api_key, user_name FROM api_keys WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
const ins = db.prepare(
  "INSERT INTO orders (order_code, access_token, mode, package_id, quota_tokens, user_name, email, whatsapp, target_api_key, api_key_issued, base_amount, unique_code, amount_to_pay, payment_method, status, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
);
const exp = Date.now() + 20 * 3600e3;
const p1 = "THX-DEMO" + crypto.randomBytes(3).toString("hex").toUpperCase();
const p2 = "THX-DEMO" + crypto.randomBytes(3).toString("hex").toUpperCase();
const i1 = ins.run(p1, "tok-demo", "topup", "20m", 20000000, mk.user_name, "", "", mk.api_key, "", 16000, 123, 16123, "QRIS DANA", "PENDING", exp);
const i2 = ins.run(p2, "tok-demo", "key_baru", "50m", 50000000, mk.user_name, mk.user_name + "@demo.id", "", "", mk.api_key, 36000, 456, 36456, "QRIS DANA", "COMPLETED", exp);
db.prepare("UPDATE orders SET paid_at = datetime('now','-1 hour'), completed_at = datetime('now','-59 minutes') WHERE id = ?").run(i2.lastInsertRowid);
const pl = require("../src/lib/pesanan");
pl.catatEvent(i1.lastInsertRowid, "dibuat", "pembeli", "Pesanan dibuat — 20 Juta (20.000.000 token), tagihan Rp 16.123 (kode unik +123), berlaku 24 jam.");
pl.catatEvent(i2.lastInsertRowid, "dibuat", "pembeli", "Pesanan dibuat — 50 Juta (50.000.000 token), tagihan Rp 36.456 (kode unik +456), berlaku 24 jam.");
pl.catatEvent(i2.lastInsertRowid, "webhook", "webhook", "Notifikasi DANA masuk: nominal Rp 36.456 cocok dengan tagihan — diproses otomatis.");
pl.catatEvent(i2.lastInsertRowid, "lunas", "webhook", "Pembayaran Rp 36.456 diterima otomatis via notifikasi DANA.");
pl.catatEvent(i2.lastInsertRowid, "fulfillment", "sistem", `API Key baru diterbitkan: ${mk.api_key.slice(0, 14)}… (50.000.000 token, masa aktif 25 hari).`);
pl.catatEvent(i2.lastInsertRowid, "notifikasi", "sistem", "WA pembeli terkirim ✓ · Email struk terkirim ✓ · WA admin terkirim ✓");
console.log("DEMO:", p1, p2);
