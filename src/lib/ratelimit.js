/**
 * ratelimit.js — Pembatas laju sederhana in-memory per (nama:IP).
 *
 * Endpoint toko terbuka untuk publik, jadi perlu dibatasi agar tidak
 * dijadikan tempat write-DoS. Implementasi minimal ala bruteforce.js:
 * Map berjendela waktu; entri lama dibersihkan berkala. Di produksi nginx
 * juga membatasi (limit_req), ini lapisan kedua di level aplikasi.
 */
const bucket = new Map(); // "nama:ip" → { count, windowStart }

// Bersihkan entri kadaluarsa tiap 10 menit agar Map tidak tumbuh tanpa batas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of bucket) {
    if (now - v.windowStart > 30 * 60_000) bucket.delete(k);
  }
}, 10 * 60_000).unref();

/**
 * Catat satu hit; cek apakah melebihi batas.
 * @returns {{limited: boolean, retryAfterSec: number}}
 */
function hit(nama, ip, max, windowMs) {
  const kunci = `${nama}:${ip}`;
  const now = Date.now();
  let r = bucket.get(kunci);
  if (!r || now - r.windowStart > windowMs) {
    r = { count: 0, windowStart: now };
    bucket.set(kunci, r);
  }
  r.count += 1;
  if (r.count > max) {
    return { limited: true, retryAfterSec: Math.ceil((r.windowStart + windowMs - now) / 1000) };
  }
  return { limited: false, retryAfterSec: 0 };
}

module.exports = { hit };
