#!/usr/bin/env node
/**
 * test/check-lacak-member.js — Uji fitur PELACAKAN PESANAN MEMBER
 * (ala e-commerce besar) terhadap server live:
 *
 *   GET  /portal/member/orders          → daftar + stats + filter status/q
 *   GET  /portal/member/orders/:code    → detail + steps + linimasa + QR*
 *   POST /portal/member/orders/:code/cancel → pembatalan mandiri
 *
 * Pesanan uji disuntik langsung ke DB (tanpa menyentuh QRIS asli), lalu
 * DIBERSIHKAN kembali di akhir agar database sandbox tetap bersih.
 *
 * Pemakaian: node test/check-lacak-member.js [BASE_URL]
 * Default: http://127.0.0.1:3000
 */
require("dotenv").config();
const crypto = require("crypto");
const db = require("../src/db");

const BASE = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/+$/, "");

let lolos = 0;
let gagal = 0;
function cek(nama, kondisi, detail = "") {
  if (kondisi) {
    lolos++;
    console.log(`  ✓ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✗ ${nama}${detail ? " — " + detail : ""}`);
  }
}

/** Panggilan HTTP sederhana dengan cookie session member. */
async function panggil(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(KOPI ? { Cookie: KOPI } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* non-JSON */
  }
  return { status: r.status, json, setCookie: r.headers.get("set-cookie") };
}

let KOPI = ""; // cookie sesi member

async function main() {
  console.log(`\n=== UJI PELACAKAN PESANAN MEMBER — ${BASE} ===\n`);

  // ---------- Persiapan: key member & pesanan uji ----------
  const memberKey = db.prepare("SELECT api_key, user_name FROM api_keys WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
  if (!memberKey) {
    console.log("✗ Tidak ada api_keys aktif di DB — jalankan server dulu.");
    process.exit(1);
  }
  const keyLain = "sk-thor-" + crypto.randomBytes(24).toString("hex"); // member "lain" (tak perlu ada di api_keys)

  const masuk = db.prepare("INSERT INTO orders (order_code, access_token, mode, package_id, quota_tokens, user_name, email, whatsapp, target_api_key, api_key_issued, base_amount, unique_code, amount_to_pay, payment_method, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const expBsk = Date.now() + 20 * 3600_000;

  const kodePending = "THX-TESTP" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const kodeSelesai = "THX-TESTS" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const kodeOrangLain = "THX-TESTX" + crypto.randomBytes(3).toString("hex").toUpperCase();
  // Untuk uji linkage keluarga key (bagian [9]):
  const keyRoot = "sk-thor-" + crypto.randomBytes(24).toString("hex");
  const keyAnak = "sk-thor-" + crypto.randomBytes(24).toString("hex");
  const kodeAnak = "THX-TESTK" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const kodeRootTopup = "THX-TESTU" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const info1 = masuk.run(kodePending, "tok-uji", "topup", "20m", 20_000_000, memberKey.user_name, "", "", memberKey.api_key, "", 16_000, 123, 16_123, "QRIS DANA", "PENDING", expBsk);
  const info2 = masuk.run(kodeSelesai, "tok-uji", "key_baru", "50m", 50_000_000, memberKey.user_name, memberKey.user_name + "@uji.test", "", "", memberKey.api_key, 36_000, 456, 36_456, "QRIS DANA", "COMPLETED", expBsk);
  const info3 = masuk.run(kodeOrangLain, "tok-uji", "topup", "10m", 10_000_000, "pembeli-lain", "", "", keyLain, "", 8_000, 789, 8_789, "QRIS DANA", "PENDING", expBsk);
  // Untuk bagian [9] (diisi di dalam try, dipakai juga oleh finally):
  let infoAnak = null;
  let infoRootTopup = null;

  const pesananLib = require("../src/lib/pesanan");
  // Pesanan COMPLETED selalu punya paid_at/completed_at (diisi prosesPesananLunas).
  db.prepare("UPDATE orders SET paid_at = datetime('now','localtime','-1 hour'), completed_at = datetime('now','localtime','-59 minutes') WHERE order_code = ?").run(kodeSelesai);
  pesananLib.catatEvent(info1.lastInsertRowid, "dibuat", "pembeli", "Pesanan uji dibuat — 20 Juta token, tagihan Rp 16.123 (kode unik +123).");
  pesananLib.catatEvent(info2.lastInsertRowid, "dibuat", "pembeli", "Pesanan uji dibuat — 50 Juta token, tagihan Rp 36.456 (kode unik +456).");
  pesananLib.catatEvent(info2.lastInsertRowid, "webhook", "webhook", "Notifikasi DANA masuk: nominal Rp 36.456 cocok dengan tagihan.");
  pesananLib.catatEvent(info2.lastInsertRowid, "lunas", "webhook", "Pembayaran Rp 36.456 diterima otomatis via notifikasi DANA.");
  pesananLib.catatEvent(info2.lastInsertRowid, "fulfillment", "sistem", "API Key baru diterbitkan (50.000.000 token, masa aktif 25 hari).");
  pesananLib.catatEvent(info2.lastInsertRowid, "notifikasi", "sistem", "WA pembeli terkirim ✓ · Email struk terkirim ✓ · WA admin terkirim ✓");

  try {
    // ---------- Login member ----------
    console.log("[1] Login member");
    const login = await panggil("POST", "/portal/member/login", { api_key: memberKey.api_key });
    cek("login member 200", login.status === 200);
    const sc = login.setCookie || "";
    KOPI = sc.split(";")[0];
    cek("cookie sesi member diterima", KOPI.includes("="));

    // ---------- Daftar pesanan ----------
    console.log("[2] GET /portal/member/orders");
    const daftar = await panggil("GET", "/portal/member/orders");
    cek("status 200", daftar.status === 200);
    const d = daftar.json.data || {};
    cek("pesanan milik sendiri muncul", (d.orders || []).some((o) => o.order_code === kodePending));
    cek("pesanan milik member lain TIDAK muncul", !(d.orders || []).some((o) => o.order_code === kodeOrangLain));
    cek("stats.chip lengkap", d.stats && ["total", "pending", "paid", "completed", "cancelled"].every((k) => typeof d.stats[k] === "number"));
    const oPend = (d.orders || []).find((o) => o.order_code === kodePending) || {};
    cek("can_pay=true untuk PENDING", oPend.can_pay === true);
    cek("label paket ramah", oPend.package_label === "20 Juta");
    cek("mode_label", oPend.mode_label === "Top-up Kuota");

    // ---------- Filter & pencarian ----------
    console.log("[3] Filter status & pencarian kode");
    const fSlesai = await panggil("GET", "/portal/member/orders?status=COMPLETED");
    cek("filter COMPLETED hanya selesai", (fSlesai.json.data.orders || []).every((o) => o.status === "COMPLETED") && (fSlesai.json.data.orders || []).some((o) => o.order_code === kodeSelesai));
    const fCari = await panggil("GET", "/portal/member/orders?q=" + kodePending);
    cek("pencarian kode", (fCari.json.data.orders || []).some((o) => o.order_code === kodePending) && fCari.json.data.orders.length >= 1);

    // ---------- Detail + stepper + linimasa ----------
    console.log("[4] GET /portal/member/orders/:code (PENDING)");
    const det = await panggil("GET", "/portal/member/orders/" + kodePending);
    cek("status 200", det.status === 200);
    const dd = det.json.data || {};
    cek("order.status PENDING", dd.order && dd.order.status === "PENDING");
    cek("steps 4 langkah", Array.isArray(dd.steps) && dd.steps.length === 4);
    cek("langkah-2 current (menunggu bayar)", dd.steps && dd.steps[1].state === "current" && dd.steps[1].state !== "done");
    cek("linimasa berisi event dibuat", (dd.timeline || []).some((e) => e.type === "dibuat" && e.label === "Pesanan dibuat"));
    cek("actor pembeli → 'Anda'", (dd.timeline || []).some((e) => e.actor === "Anda"));
    cek("can_pay & can_cancel true", dd.can_pay === true && dd.can_cancel === true);
    cek("qr_image berupa string (kosong atau data URL)", typeof dd.qr_image === "string" && (dd.qr_image === "" || dd.qr_image.startsWith("data:image")));

    console.log("[5] Detail pesanan COMPLETED");
    const det2 = await panggil("GET", "/portal/member/orders/" + kodeSelesai);
    const d2 = det2.json.data || {};
    cek("status 200", det2.status === 200);
    cek("langkah selesai semua done", d2.steps && d2.steps.every((s) => s.state === "done"));
    cek("linimasa lunas+fulfillment", (d2.timeline || []).some((e) => e.type === "lunas") && (d2.timeline || []).some((e) => e.type === "fulfillment"));
    cek("detail notifikasi TANPA klausa 'WA admin' (disanitasi)", !(d2.timeline || []).some((e) => e.type === "notifikasi" && /wa admin/i.test(e.detail)));
    cek("mode key_baru: api_key_terkait = key member", d2.order && d2.order.api_key_terkait === memberKey.api_key);

    // ---------- Keamanan: pesanan member lain ----------
    console.log("[6] Isolasi antar member");
    const detX = await panggil("GET", "/portal/member/orders/" + kodeOrangLain);
    cek("detail pesanan orang lain → 404", detX.status === 404);
    const canX = await panggil("POST", "/portal/member/orders/" + kodeOrangLain + "/cancel");
    cek("batalkan pesanan orang lain → 404", canX.status === 404);
    const noAuth = await fetch(BASE + "/portal/member/orders", { method: "GET" });
    cek("tanpa sesi → 401", noAuth.status === 401);

    // ---------- Pembatalan mandiri ----------
    console.log("[7] POST cancel (pembeli batalkan sendiri)");
    const bat = await panggil("POST", "/portal/member/orders/" + kodePending + "/cancel");
    cek("batal 200", bat.status === 200);
    cek("respons cancelled=true", bat.json.data && bat.json.data.cancelled === true);
    const det3 = await panggil("GET", "/portal/member/orders/" + kodePending);
    cek("status jadi CANCELLED", det3.json.data.order.status === "CANCELLED");
    cek("can_pay jadi false", det3.json.data.can_pay === false);
    cek("linimasa ada event batal actor Anda", (det3.json.data.timeline || []).some((e) => e.type === "batal" && e.actor === "Anda"));
    const bat2 = await panggil("POST", "/portal/member/orders/" + kodePending + "/cancel");
    cek("batal ulang → 409 (idempoten ditolak)", bat2.status === 409);
    const batS = await panggil("POST", "/portal/member/orders/" + kodeSelesai + "/cancel");
    cek("batal pesanan COMPLETED → 409", batS.status === 409);

    // ---------- Regresi UI ----------
    console.log("[8] Halaman portal memuat tab & modal");
    const html = await fetch(BASE + "/portal").then((r) => r.text());
    cek("tab Pesanan Saya ada", html.includes('data-tab="pesanan"'));
    cek("modal-lacak ada", html.includes('id="modal-lacak"'));
    cek("stepper & list container ada", html.includes('id="order-list"') && html.includes('id="order-pills"'));
    const js = await fetch(BASE + "/portal.js").then((r) => r.text());
    cek("portal.js memuat muatPesanan/bukaLacak", js.includes("async function muatPesanan") && js.includes("async function bukaLacak"));
    const css = await fetch(BASE + "/style.css").then((r) => r.text());
    cek("CSS stepper & order-card ada", css.includes(".trk-step") && css.includes(".order-card"));

    // ---------- Regresi: linkage keluarga key (pesanan key baru) ----------
    // Simulasi keluhan "baru beli key, lacak pesanan belum ada":
    // member login dengan key A membeli KEY BARU → pesanan di-stamp
    // owner_api_key = A → harus langsung terlihat di pelacakan A (PENDING),
    // dan setelah lunas juga terlihat dari key B penerbitnya (keluarga).
    console.log("[9] Linkage keluarga key (order key_baru dari sesi member)");
    db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)").run(keyRoot, "uji-keluarga", 1000);
    infoAnak = masuk.run(kodeAnak, "tok-uji", "key_baru", "10m", 10_000_000, "uji-keluarga", "uji-keluarga@uji.test", "", "", "", 8_000, 111, 8_111, "QRIS DANA", "PENDING", expBsk);
    infoRootTopup = masuk.run(kodeRootTopup, "tok-uji", "topup", "10m", 10_000_000, "uji-keluarga", "uji-keluarga@uji.test", "", keyRoot, "", 8_000, 222, 8_222, "QRIS DANA", "PENDING", expBsk);
    // Stamp owner (ala POST /store/orders saat sesi portal aktif):
    db.prepare("UPDATE orders SET owner_api_key = ? WHERE order_code IN (?, ?)").run(keyRoot, kodeAnak, kodeRootTopup);
    pesananLib.catatEvent(infoAnak.lastInsertRowid, "dibuat", "pembeli", "Pesanan uji keluarga dibuat.");

    // Login sebagai KEY ROOT — pesanan PENDING-nya sendiri harus terlihat.
    const loginRoot = await panggil("POST", "/portal/member/login", { api_key: keyRoot });
    cek("login key root 200", loginRoot.status === 200);
    const kopiAwal = KOPI;
    KOPI = (loginRoot.setCookie || "").split(";")[0];
    const daftarRoot = await panggil("GET", "/portal/member/orders");
    cek("PENDING key_baru terlihat dari key root (owner linkage)", (daftarRoot.json.data.orders || []).some((o) => o.order_code === kodeAnak));
    cek("topup key root terlihat dari key root", (daftarRoot.json.data.orders || []).some((o) => o.order_code === kodeRootTopup));

    // Lunaskan order key_baru → terbitkan key anak (ala prosesPesananLunas).
    db.prepare("UPDATE orders SET status = 'COMPLETED', paid_at = datetime('now','localtime'), completed_at = datetime('now','localtime'), api_key_issued = ? WHERE order_code = ?").run(keyAnak, kodeAnak);
    db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)").run(keyAnak, "uji-keluarga", 10_000_000);

    // Login dengan KEY ANAK → keluarga key: melihat pesanan penerbitnya +
    // pesanan keluarga (owner key root ikut lewat lineage/identitas).
    const loginAnak = await panggil("POST", "/portal/member/login", { api_key: keyAnak });
    cek("login dengan key anak 200", loginAnak.status === 200);
    KOPI = (loginAnak.setCookie || "").split(";")[0];
    const daftarAnak = await panggil("GET", "/portal/member/orders");
    cek("key anak melihat pesanan penerbitnya", (daftarAnak.json.data.orders || []).some((o) => o.order_code === kodeAnak));
    cek("key anak melihat pesanan key root (keluarga)", (daftarAnak.json.data.orders || []).some((o) => o.order_code === kodeRootTopup));
    const detAnak = await panggil("GET", "/portal/member/orders/" + kodeAnak);
    cek("detail dari key anak 200", detAnak.status === 200);

    // Kembali ke KEY ROOT — tetap melihat pesanan yang sudah lunas.
    const loginRoot2 = await panggil("POST", "/portal/member/login", { api_key: keyRoot });
    KOPI = (loginRoot2.setCookie || "").split(";")[0];
    const daftarRoot2 = await panggil("GET", "/portal/member/orders");
    cek("key root tetap melihat setelah lunas", (daftarRoot2.json.data.orders || []).some((o) => o.order_code === kodeAnak));
    KOPI = kopiAwal;

    console.log(`\n=== HASIL: ${lolos} lolos, ${gagal} gagal ===\n`);
  } finally {
    // ---------- Bersih-bersih data uji ----------
    const ids = [info1.lastInsertRowid, info2.lastInsertRowid, info3.lastInsertRowid];
    if (infoAnak) ids.push(infoAnak.lastInsertRowid);
    if (infoRootTopup) ids.push(infoRootTopup.lastInsertRowid);
    for (const id of ids) db.prepare("DELETE FROM order_events WHERE order_id = ?").run(id);
    for (const kode of [kodePending, kodeSelesai, kodeOrangLain, kodeAnak, kodeRootTopup]) db.prepare("DELETE FROM orders WHERE order_code = ?").run(kode);
    for (const k of [keyRoot, keyAnak]) {
      db.prepare("DELETE FROM sessions WHERE api_key = ?").run(k);
      db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(k);
    }
  }

  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ Error fatal:", e.message);
  process.exit(1);
});
