/**
 * identitas.js — Menentukan identitas pengunjung untuk kunci brute-force.
 *
 * MASALAH YANG DISELESAIKAN
 * -------------------------
 * Server ini berada di belakang router yang melakukan masquerade (NAT).
 * Akibatnya nginx SELALU melihat IP asal = 10.10.0.1 untuk SEMUA pengunjung
 * dari internet, sehingga kunci pembatas menjadi satu keranjang global:
 *
 *     admin:10.10.0.1     <-- dipakai bersama semua orang di dunia
 *
 * Efeknya: satu penyerang bisa menghabiskan kuota percobaan dan mengunci
 * admin (DoS), dan log tidak bisa membedakan penyerang dari pengunjung sah.
 *
 * SOLUSI
 * ------
 * Kunci tidak lagi hanya "label:ip", tetapi "label:ip:jejak" di mana
 * "jejak" = sidik ringkas (hash) dari User-Agent + Accept-Language.
 * Dengan begitu, pengunjung berbeda di belakang NAT yang sama punya
 * keranjang percobaan masing-masing.
 *
 * BATASAN (jujur, jangan diabaikan)
 * ---------------------------------
 * Jejak ini BUKAN pengaman kuat — penyerang bisa mengganti User-Agent.
 * Ia hanya memisahkan keranjang. Pembatas kuat tetap butuh IP asli,
 * yang hanya bisa dipulihkan dari sisi router (matikan masquerade /
 * DNAT tanpa SNAT) atau lewat Cloudflare Tunnel.
 *
 * Bila kelak IP asli sudah tersedia di header X-Forwarded-For,
 * jalankan proses dengan TRUST_FORWARDED_IP=1 agar IP asli dipakai.
 * Jangan dinyalakan selama router masih memakai masquerade — pada kondisi
 * itu X-Forwarded-For tidak berisi IP asli dan bisa dipalsukan klien.
 */

const crypto = require("crypto");

/** Buang awalan ::ffff:, port, dan tanda kurung IPv6. */
function bersihkanAlamat(nilai) {
  let v = String(nilai || "").trim();
  v = v.replace(/^::ffff:/i, "");
  v = v.replace(/^\[|\]$/g, "");
  // "1.2.3.4:5678" -> "1.2.3.4" (hanya untuk bentuk IPv4:port)
  const m = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (m) v = m[1];
  return v;
}

/** IP pengunjung menurut permintaan. */
function ipKlien(req) {
  if (process.env.TRUST_FORWARDED_IP === "1") {
    const xff = String(req.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    const xr = String(req.headers?.["x-real-ip"] || "").trim();
    const dariHeader = bersihkanAlamat(xff) || bersihkanAlamat(xr);
    if (dariHeader) return dariHeader;
  }
  const dariSocket =
    bersihkanAlamat(req.ip) || bersihkanAlamat(req.socket?.remoteAddress);
  return dariSocket || "unknown";
}

/**
 * Jejak ringkas pengunjung (12 hex). Stabil untuk satu perangkat/browser,
 * berbeda antar perangkat yang berbeda di belakang NAT yang sama.
 */
function jejak(req) {
  const bahan = [
    String(req.headers?.["user-agent"] || "tanpa-ua"),
    String(req.headers?.["accept-language"] || ""),
    String(req.headers?.["accept-encoding"] || ""),
  ].join("|");
  return crypto.createHash("sha256").update(bahan).digest("hex").slice(0, 12);
}

/** Titik masuk tunggal: "ip:jejak" siap dipakai sebagai bagian kunci. */
function identitas(req) {
  return `${ipKlien(req)}:${jejak(req)}`;
}

module.exports = { ipKlien, jejak, identitas };
