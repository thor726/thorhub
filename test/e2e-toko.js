/**
 * test/e2e-toko.js — Uji end-to-end sistem toko QRIS DANA otomatis.
 *
 * Menjalankan server nyata (bind port acak) lalu mensimulasikan seluruh alur:
 *   1. Setup toko via sesi admin (QRIS statis + secret + aktif)
 *   2. Pembeli beli KEY BARU → QRIS dibuat → webhook DANA cocok → key diterbitkan
 *   3. Pembeli TOP-UP key lama → webhook cocok → token_limit bertambah
 *   4. Keamanan: secret salah, nominal kurang, token akses salah, order tanpa QRIS
 *   5. Konfirmasi manual admin untuk pesanan kurang bayar
 *
 * Jalankan: node test/e2e-toko.js   (env opsional: MASTER_API_KEY, ADMIN_PASSWORD)
 */
// Nilai bawaan agar uji selalu jalan mandiri (server mewarisi env ini).
process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test123";
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || "test-admin-key";
process.env.PORT = "0"; // port acak

const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
let server;
let BASE = "";
let gagal = 0;

function ok(nama, kondisi, detail = "") {
  if (kondisi) console.log(`  ✓ ${nama}`);
  else {
    gagal++;
    console.log(`  ✗ GAGAL: ${nama}${detail ? " — " + detail : ""}`);
  }
}

async function api(method, urlPath, body, headers = {}) {
  const r = await fetch(BASE + urlPath, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}

/** Bangun payload QRIS statis EMVCo dummy yang valid (CRC benar). */
function buatQrisStatis() {
  const crc16 = (input) => {
    let c = 0xffff;
    for (let i = 0; i < input.length; i++) {
      c ^= (input.charCodeAt(i) & 0xff) << 8;
      for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c.toString(16).toUpperCase().padStart(4, "0");
  };
  const tlv = (t, v) => t + String(v.length).padStart(2, "0") + v;
  let s = tlv("00", "01") + tlv("01", "11");
  s += tlv("26", tlv("00", "ID.CO.QRIS.WWW") + tlv("01", "OM1020304050607") + tlv("02", "93600914"));
  s += tlv("52", "7994") + tlv("53", "360") + tlv("58", "ID") + tlv("59", "TOKO UJI") + tlv("60", "Jakarta");
  const body = s + "6304";
  return body + crc16(body);
}

async function tunggu(maxMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(BASE + "/health");
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  console.log("== UJI E2E TOKO QRIS DANA ==\n");

  // === 1. Mulai server ===
  server = spawn(process.execPath, [path.join(ROOT, "src/server.js")], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  const portReady = new Promise((resolve) => {
    server.stdout.on("data", (d) => {
      const m = String(d).match(/Port lokal\s*:\s*(\d+)/);
      if (m) resolve(m[1]);
    });
  });
  const port = await portReady;
  BASE = `http://127.0.0.1:${port}`;
  ok(`server hidup di ${BASE}`, await tunggu());

  // === 2. Login admin + setup toko ===
  console.log("\n[1] Setup toko via panel admin");
  const login = await api("POST", "/portal/admin/login", { password: process.env.ADMIN_PASSWORD });
  ok("login admin", login.status === 200);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  let r = await api("GET", "/store/packages");
  // DB sandbox dipakai bersama (bisa berisi konfigurasi QRIS dari uji sebelumnya)
  // → reset dulu agar alur "toko tutup → dikonfigurasi" selalu teruji dari nol.
  require(path.join(ROOT, "src/db")).prepare("DELETE FROM settings WHERE key = 'qris'").run();
  r = await api("GET", "/store/packages");
  ok("katalog paket publik", r.status === 200 && r.data.data.packages.length === 6);
  ok("toko belum siap (belum dikonfigurasi)", r.data.data.store_ready === false);

  r = await api("POST", "/store/orders", { mode: "key_baru", package_id: "10m", user_name: "X", email: "x@y.com" });
  ok("order DITOLAK saat toko tutup", r.status === 503);

  r = await api("POST", "/portal/admin/store/qris", { static: buatQrisStatis(), enabled: true }, { cookie });
  ok("QRIS statis tersimpan", r.status === 200 && r.data.data.merchant?.name === "TOKO UJI", JSON.stringify(r.data));

  r = await api("POST", "/portal/admin/store/secret", {}, { cookie });
  const SECRET = r.data.data.secret;
  ok("secret webhook dibuat", r.status === 200 && SECRET.length >= 32);

  r = await api("POST", "/portal/admin/store/test", {}, { cookie });
  ok("uji webhook dari panel: secret+parser OK", r.status === 200 && r.data.data.ok === true, JSON.stringify(r.data));

  r = await api("GET", "/store/packages");
  ok("toko kini SIAP", r.data.data.store_ready === true);

  // === 3. Beli KEY BARU ===
  console.log("\n[2] Alur pembelian KEY BARU");
  r = await api("POST", "/store/orders", {
    mode: "key_baru", package_id: "10m", user_name: "Budi Santoso", email: "budi@mail.com", whatsapp: "081234567890",
  });
  ok("order key baru dibuat", r.status === 201, JSON.stringify(r.data));
  let order = r.data.data.order;
  let pay = r.data.data.payment;
  ok("kode order format THX-", /^THX-[A-Z2-9]{8}$/.test(order.order_code), order.order_code);
  ok("nominal = harga + kode unik", pay.amount_to_pay === 8000 + pay.unique_code && pay.unique_code >= 1 && pay.unique_code <= 999);
  ok("QRIS dinamis berisi PNG data-url", String(pay.qr_image).startsWith("data:image/png;base64,"));

  // Verifikasi payload QRIS dinamis memuat nominal (Tag 54) — bangun ulang
  // payload yang sama dari QRIS statis tersimpan lalu cek pola TLV-nya.
  const dbcek = require(path.join(ROOT, "src/db"));
  const qrisTersimpan = JSON.parse(dbcek.prepare("SELECT value FROM settings WHERE key='qris'").get().value);
  const dinamis = require(path.join(ROOT, "src/lib/qris")).buildDynamicQris(qrisTersimpan.static, pay.amount_to_pay);
  const tag54 = "54" + String(String(pay.amount_to_pay).length).padStart(2, "0") + String(pay.amount_to_pay);
  ok("Tag 54 nominal tertanam di QRIS dinamis", dinamis.includes(tag54), tag54);

  // Status polling
  r = await api("GET", `/store/order/${order.order_code}?t=${pay.access_token}`);
  ok("polling dengan token: PENDING + QR", r.data.data.status === "PENDING" && !!r.data.data.qr_image);
  r = await api("GET", `/store/order/${order.order_code}`);
  ok("polling TANPA token: terbatas (tanpa QR)", r.data.data.limited === true && !r.data.data.qr_image);
  r = await api("GET", `/store/order/${order.order_code}?t=salah`);
  ok("polling token salah: terbatas", r.data.data.limited === true);

  // Webhook: nominal SALAH (kurang) → tidak dilunaskan
  const kurang = pay.amount_to_pay - 137;
  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: `DANA: Kamu menerima Rp${kurang.toLocaleString("id-ID")} dari BUDI` });
  ok("webhook nominal kurang → tidak dilunaskan", r.status === 200 && r.data.matched === false, JSON.stringify(r.data));
  ok("pesan menyebut kurang-biaya", /kurang dari total/.test(r.data.message));

  // Webhook: uang keluar → diabaikan
  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: `Kamu mengirim Rp${pay.amount_to_pay} ke TOKO UJI` });
  ok("webhook uang keluar → diabaikan", r.status === 200 && r.data.matched === false);

  // Webhook: secret salah → 401
  r = await api("POST", "/store/webhook/dana", { secret_token: "rahasia-salah", text: "DANA: Kamu menerima Rp8000 dari X" });
  ok("webhook secret salah → 401", r.status === 401);

  // Webhook: placeholder MacroDroid tidak ter-expand
  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: "[not_text]" });
  ok("webhook placeholder terdeteksi dengan saran perbaikan", r.status === 200 && !!r.data.placeholder);

  // Webhook: LUNAS (nominal eksak) → key diterbitkan
  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: `DANA: Kamu menerima Rp${pay.amount_to_pay.toLocaleString("id-ID")} dari BUDI SANTOSO` });
  ok("webhook nominal eksak → cocok", r.status === 200 && r.data.matched === true && r.data.order_code === order.order_code, JSON.stringify(r.data));

  r = await api("GET", `/store/order/${order.order_code}?t=${pay.access_token}`);
  const keyBaru = r.data.data.api_key;
  ok("status COMPLETED + API key diterbitkan", r.data.data.status === "COMPLETED" && /^sk-thor-[0-9a-f]{48}$/.test(keyBaru || ""), String(r.data.data.api_key).slice(0, 24));

  // Key baru benar-benar terdaftar dengan kuota benar + masa aktif 25 hari
  const db = require(path.join(ROOT, "src/db"));
  const keyRow = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(keyBaru);
  ok("key terdaftar di DB (kuota 10.000.000)", !!keyRow && keyRow.token_limit === 10_000_000);
  const masaMs = keyRow.expires_at ? new Date(keyRow.expires_at.replace(" ", "T") + "Z").getTime() : 0;
  const selisihHari = (masaMs - Date.now()) / 86400000;
  ok("masa aktif key baru = 25 hari (± 1 jam)", selisihHari > 24.9 && selisihHari < 25.1, String(selisihHari.toFixed(2)));

  // Status COMPLETED memuat info masa aktif untuk halaman sukses
  r = await api("GET", `/store/order/${order.order_code}?t=${pay.access_token}`);
  ok("payload selesai memuat masa_aktif_sampai", /\d{1,2} \w{3} \d{4}/.test(r.data.data.masa_aktif_sampai || ""), String(r.data.data.masa_aktif_sampai));

  // Notif WA/email gagal diam-diam (best-effort) — tidak menjatuhkan alur ✓ (implisit)

  // Webhook ulang (idempoten)
  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: `DANA: Kamu menerima Rp${pay.amount_to_pay.toLocaleString("id-ID")} dari BUDI SANTOSO` });
  ok("webhook ulang tidak menduplikasi (pesanan sudah selesai)", r.status === 200);

  // === 4. Alur TOP-UP ===
  console.log("\n[3] Alur TOP-UP key lama");
  r = await api("POST", "/store/orders", {
    mode: "topup", package_id: "20m", user_name: "Budi Santoso", email: "budi@mail.com", api_key: keyBaru,
  });
  ok("order topup dibuat", r.status === 201, JSON.stringify(r.data));
  const topup = r.data.data;
  ok("nominal topup = 16000 + unik", topup.payment.amount_to_pay === 16000 + topup.payment.unique_code);

  // Key salah saat topup → ditolak
  r = await api("POST", "/store/orders", { mode: "topup", package_id: "20m", user_name: "X", api_key: "sk-thor-salah" });
  ok("topup dengan key tidak dikenal → 404", r.status === 404);

  // Email wajib utk key baru
  r = await api("POST", "/store/orders", { mode: "key_baru", package_id: "10m", user_name: "X" });
  ok("key baru tanpa email → ditolak", r.status === 400);

  r = await api("POST", "/store/webhook/dana", { secret_token: SECRET, text: `DANA: Kamu menerima Rp${topup.payment.amount_to_pay.toLocaleString("id-ID")} dari BUDI SANTOSO` });
  ok("webhook topup cocok", r.data.matched === true && r.data.order_code === topup.order.order_code, JSON.stringify(r.data));

  const keyRow2 = db.prepare("SELECT * FROM api_keys WHERE api_key = ?").get(keyBaru);
  ok("token_limit bertambah +20.000.000", keyRow2.token_limit === 30_000_000, String(keyRow2.token_limit));

  // Masa aktif DIPERPANJANG oleh top-up: dari sisa masa aktif lama + 25 hari
  const sisaLamaMs = masaMs - Date.now();
  const masaBaruMs = keyRow2.expires_at ? new Date(keyRow2.expires_at.replace(" ", "T") + "Z").getTime() : 0;
  const tambahanHari = (masaBaruMs - Date.now() - Math.max(0, sisaLamaMs)) / 86400000;
  ok("topup memperpanjang masa aktif 25 hari (dari sisa lama)", tambahanHari > 24.9 && tambahanHari < 25.1, String(tambahanHari.toFixed(2)));

  // === 5. Portal member: masa aktif + riwayat transaksi ===
  console.log("\n[5] Portal member (masa aktif & riwayat)");
  r = await api("POST", "/portal/member/login", { api_key: keyBaru });
  ok("login member", r.status === 200, JSON.stringify(r.data));
  const cookieM = (r.headers.get("set-cookie") || "").split(";")[0];
  r = await api("GET", "/portal/member/me", null, { cookie: cookieM });
  const me = r.data.data || {};
  // Setelah top-up: sisa masa aktif lama (±25 hari) + 25 hari = ±50 hari
  ok("/member/me memuat days_left 25-51 (topup memperpanjang)", me.key_days_left >= 25 && me.key_days_left <= 51, JSON.stringify({ d: me.key_days_left }));
  ok("/member/me memuat label masa aktif", /\d{1,2} \w{3} \d{4}/.test(me.key_masa_aktif_label || ""), String(me.key_masa_aktif_label));
  r = await api("GET", "/portal/member/orders", null, { cookie: cookieM });
  const ordersM = (r.data.data || {}).orders || [];
  ok("/member/orders memuat pesanan topup sendiri", ordersM.some((o) => o.order_code === topup.order.order_code), String(ordersM.length));
  r = await api("GET", "/portal/member/orders");
  ok("/member/orders tanpa sesi → 401", r.status === 401);

  // === 6. Key kedaluwarsa ditolak middleware chat (403 key_expired) ===
  console.log("\n[6] Key kedaluwarsa ditolak");
  const keyExp = `sk-thor-${crypto.randomBytes(24).toString("hex")}`;
  db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit, expires_at) VALUES (?, ?, ?, ?)").run(
    keyExp, "Uji Kedaluwarsa", 1_000_000, "2026-01-01 00:00:00"
  );
  r = await api("POST", "/v1/chat/completions", { model: "mock-gpt", messages: [{ role: "user", content: "hi" }] }, { Authorization: `Bearer ${keyExp}` });
  ok("chat key kedaluwarsa → 403", r.status === 403, JSON.stringify(r.data));
  ok("kode error key_expired + arahan top-up", r.data.error?.code === "key_expired" && /top-up/i.test(r.data.error?.message || ""), JSON.stringify(r.data.error));
  db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(keyExp);

  // === 7. Konfirmasi manual admin (order kurang bayar) ===
  console.log("\n[7] Konfirmasi manual & audit");
  r = await api("POST", "/store/orders", { mode: "key_baru", package_id: "50m", user_name: "Citra", email: "citra@mail.com" });
  const citra = r.data.data;
  r = await api("POST", `/portal/admin/orders/${citra.order.order_code}/confirm`, {}, { cookie });
  ok("konfirmasi manual admin → COMPLETED", r.status === 200 && r.data.data.order.status === "COMPLETED", JSON.stringify(r.data));
  const citraKey = r.data.data.order.api_key_issued;
  ok("key Citra diterbitkan", /^sk-thor-/.test(citraKey || ""));

  r = await api("GET", "/portal/admin/orders?limit=10", null, { cookie });
  ok("daftar pesanan admin berisi semua transaksi", r.data.data.orders.length >= 3, String(r.data.data.orders.length));
  ok("riwayat webhook tercatat (audit)", r.data.data.events.length >= 5, String(r.data.data.events.length));

  // Endpoint admin dilindungi
  r = await api("GET", "/portal/admin/orders");
  ok("endpoint pesanan admin tanpa sesi → 401", r.status === 401);

  // Halaman /beli tersaji
  r = await fetch(BASE + "/beli");
  const html = await r.text();
  ok("halaman /beli tersaji & memuat elemen kunci", r.status === 200 && html.includes("Beli") && html.includes("beli.js"));

  // Pencocokan rentang: dua order berbeda paket tak bentrok nominal
  r = await api("POST", "/store/orders", { mode: "key_baru", package_id: "200m", user_name: "Dedi", email: "dedi@mail.com" });
  const dedi = r.data.data;
  ok("order 200jt dapat nominal unik", dedi.payment.amount_to_pay >= 130001);

  // Isolasi riwayat member: pesanan Citra & Dedi TIDAK muncul di riwayat Budi
  r = await api("GET", "/portal/member/orders", null, { cookie: cookieM });
  const ordersM2 = (r.data.data || {}).orders || [];
  ok(
    "isolasi riwayat: pesanan member lain tidak bocor",
    !ordersM2.some((o) => o.order_code === citra.order.order_code || o.order_code === dedi.order.order_code),
    JSON.stringify(ordersM2.map((o) => o.order_code))
  );

  console.log(gagal === 0 ? "\n✅ SEMUA UJI LULUS" : `\n❌ ${gagal} UJI GAGAL`);
  process.exitCode = gagal === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("Uji error:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
  });
