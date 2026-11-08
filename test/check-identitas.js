/**
 * check-identitas.js — Uji identitas pengunjung (src/lib/identitas.js).
 * Jalankan: node test/check-identitas.js
 *
 * Membuktikan bahwa di belakang NAT (semua IP = 10.10.0.1), dua pengunjung
 * berbeda TIDAK lagi berbagi satu keranjang percobaan.
 */
const assert = require("assert");
const id = require("../src/lib/identitas");

let lulus = 0, gagal = 0;
function uji(nama, fn) {
  try { fn(); lulus++; console.log(`  [OK ] ${nama}`); }
  catch (e) { gagal++; console.log(`  [X  ] ${nama}\n        ${e.message}`); }
}

// Objek permintaan tiruan
function req({ ip = "10.10.0.1", ua = "Mozilla/5.0 (Android)", al = "id-ID", xff } = {}) {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: {
      "user-agent": ua,
      "accept-language": al,
      ...(xff ? { "x-forwarded-for": xff } : {}),
    },
  };
}

console.log("UJI identitas pengunjung");

uji("IP sama + UA sama  -> kunci SAMA (satu pengunjung)", () => {
  const a = id.identitas(req());
  const b = id.identitas(req());
  assert.strictEqual(a, b);
});

uji("IP sama (NAT) + UA BEDA -> kunci BEDA (inti perbaikan)", () => {
  const hp = id.identitas(req({ ua: "Mozilla/5.0 (Android; Mobile)" }));
  const pc = id.identitas(req({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64)" }));
  assert.notStrictEqual(hp, pc, "keranjang harus terpisah");
});

uji("IP sama + UA sama + bahasa BEDA -> kunci BEDA", () => {
  const a = id.identitas(req({ al: "id-ID" }));
  const b = id.identitas(req({ al: "en-US" }));
  assert.notStrictEqual(a, b);
});

uji("jejak 12 karakter hex", () => {
  assert.match(id.jejak(req()), /^[0-9a-f]{12}$/);
});

uji("IP BEDA -> kunci BEDA", () => {
  const a = id.identitas(req({ ip: "10.10.0.2" }));
  const b = id.identitas(req({ ip: "10.10.0.3" }));
  assert.notStrictEqual(a, b);
});

uji("awalan ::ffff: dibuang", () => {
  assert.strictEqual(id.ipKlien(req({ ip: "::ffff:10.10.0.9" })), "10.10.0.9");
});

uji("tanpa UA tetap menghasilkan jejak", () => {
  const r = { ip: "10.10.0.1", socket: {}, headers: {} };
  assert.match(id.jejak(r), /^[0-9a-f]{12}$/);
});

uji("tanpa IP -> 'unknown', tidak crash", () => {
  const r = { ip: undefined, socket: {}, headers: {} };
  assert.ok(id.ipKlien(r).length > 0);
});

uji("bawaan: XFF DIABAIKAN (router masih masquerade)", () => {
  delete process.env.TRUST_FORWARDED_IP;
  const r = req({ ip: "10.10.0.1", xff: "203.0.113.7" });
  assert.strictEqual(id.ipKlien(r), "10.10.0.1", "XFF palsu tidak boleh dipercaya");
});

uji("TRUST_FORWARDED_IP=1: XFF DIPAKAI", () => {
  process.env.TRUST_FORWARDED_IP = "1";
  try {
    const r = req({ ip: "10.10.0.1", xff: "203.0.113.7, 10.10.0.1" });
    assert.strictEqual(id.ipKlien(r), "203.0.113.7");
  } finally { delete process.env.TRUST_FORWARDED_IP; }
});

// ---- Uji terpadu: pakai guard bruteforce sungguhan -----------------
uji("guard bruteforce: keranjang terpisah setelah perbaikan", () => {
  const bf = require("../src/lib/bruteforce");
  bf.resetSemua();
  const A = req({ ua: "UA-penyerang" });
  const B = req({ ua: "UA-admin-asli" });
  for (let i = 0; i < 8; i++) bf.catatGagal(A, "admin");   // penyerang habiskan kuota
  const blokA = bf.catatGagal(A, "admin");
  const blokB = bf.catatGagal(B, "admin");
  assert.strictEqual(blokA, true, "penyerang harus diblokir");
  assert.strictEqual(blokB, false, "admin asli TIDAK boleh ikut diblokir");
  bf.resetSemua();
});

console.log(`\nHasil: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
