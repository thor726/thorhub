/**
 * bruteforce.js — Proteksi brute-force login (PERSISTEN di SQLite).
 *
 * Mengapa perlu:
 *   Endpoint /portal/admin/login hanya dijaga satu password. Tanpa pembatas,
 *   penyerang dapat mencoba ribuan kombinasi sampai tembus, lalu menerbitkan
 *   API key miliknya sendiri lewat panel admin.
 *
 * Mengapa PERSISTEN:
 *   Versi awal menyimpan penghitung di memori (Map), sehingga hilang setiap
 *   kali proses di-restart — penyerang cukup memicu restart (atau menunggu
 *   deploy) untuk mengulang jatah percobaan. Kini status disimpan di tabel
 *   `login_attempts` (SQLite), sehingga blokir tetap berlaku lintas restart
 *   dan lintas proses.
 *
 * Kebijakan per-IP (kunci = "label:ip", mis. "admin:1.2.3.4"):
 *   - Maksimal MAX_FAIL percobaan GAGAL dalam jendela WINDOW_MS.
 *   - Bila terlampaui → diblokir (HTTP 429) selama BLOCK_MS.
 *   - Login sukses → penghitung direset.
 *   - Setiap percobaan gagal diberi jeda FAIL_DELAY_MS (memperlambat otomatis).
 *
 * Bila modul DB tidak dapat dimuat, otomatis jatuh ke penyimpanan in-memory
 * (fungsional, tetapi tidak persisten) agar server tetap aman & berjalan.
 */

const MAX_FAIL = 8;                 // percobaan gagal maksimum...
const WINDOW_MS = 15 * 60 * 1000;   // ...dalam jendela 15 menit
const BLOCK_MS = 15 * 60 * 1000;    // durasi blokir setelah terlampaui
const FAIL_DELAY_MS = 400;          // jeda tiap respons gagal (memperlambat)

const identitasMod = require("./identitas");

// ---- Coba muat DB (persisten); jika gagal pakai memori ----
let db = null;
let stmtGet = null, stmtUpsert = null, stmtDel = null, stmtBersih = null;
let memori = new Map();
let mode = "memori";

try {
  db = require("../db");
  stmtGet = db.prepare("SELECT * FROM login_attempts WHERE kunci = ?");
  stmtUpsert = db.prepare(
    `INSERT INTO login_attempts (kunci, count_gagal, first_at, blocked_until, last_at)
     VALUES (@kunci, @count_gagal, @first_at, @blocked_until, @last_at)
     ON CONFLICT(kunci) DO UPDATE SET
       count_gagal   = @count_gagal,
       first_at      = @first_at,
       blocked_until = @blocked_until,
       last_at       = @last_at`
  );
  stmtDel = db.prepare("DELETE FROM login_attempts WHERE kunci = ?");
  stmtBersih = db.prepare("DELETE FROM login_attempts WHERE blocked_until < ? AND last_at < ?");
  mode = "sqlite";
} catch {
  db = null;
}

// Bersihkan entri basi berkala (mencegah tabel tumbuh tanpa batas).
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  try {
    if (mode === "sqlite") {
      stmtBersih.run(now, now - WINDOW_MS); // hapus yang tak diblokir & sudah basi
    } else {
      for (const [k, v] of memori) {
        if (v.blocked_until < now && now - v.first_at > WINDOW_MS) memori.delete(k);
      }
    }
  } catch {
    /* biarkan — pembersihan gagal tidak fatal */
  }
}, 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

/**
 * Kunci pembatas: gabung label (admin/member) + identitas pengunjung.
 *
 * Identitas = IP + jejak ringkas User-Agent (lihat src/lib/identitas.js).
 * Ini WAJIB karena router memakai masquerade: semua pengunjung dari
 * internet terlihat sebagai 10.10.0.1, sehingga tanpa jejak tambahan
 * mereka semua berbagi satu keranjang percobaan (satu penyerang bisa
 * mengunci admin). Contoh kunci: "admin:10.10.0.1:a1b2c3d4e5f6"
 */
function kunci(req, label) {
  return `${label}:${identitasMod.identitas(req)}`;
}

/** Ambil baris status (objek dengan field first_at, count_gagal, blocked_until). */
function ambil(k) {
  if (mode === "sqlite") return stmtGet.get(k) || null;
  return memori.get(k) || null;
}

/** Simpan status. */
function simpan(row) {
  if (mode === "sqlite") {
    stmtUpsert.run({
      kunci: row.kunci,
      count_gagal: row.count_gagal,
      first_at: row.first_at,
      blocked_until: row.blocked_until,
      last_at: row.last_at,
    });
  } else {
    memori.set(row.kunci, row);
  }
}

/** Hapus status. */
function buang(k) {
  if (mode === "sqlite") stmtDel.run(k);
  else memori.delete(k);
}

/**
 * Middleware Express: tolak lebih dulu bila IP sedang diblokir.
 * Dipasang SEBELUM handler login.
 */
function guard(label) {
  return function (req, res, next) {
    const k = kunci(req, label);
    const rec = ambil(k);
    const now = Date.now();
    if (rec && rec.blocked_until > now) {
      const sisaDetik = Math.ceil((rec.blocked_until - now) / 1000);
      res.setHeader("Retry-After", String(sisaDetik));
      return res.status(429).json({
        error: {
          message: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${sisaDetik} detik.`,
          code: "too_many_attempts",
        },
      });
    }
    next();
  };
}

/** Catat percobaan GAGAL. Kembalikan true bila IP kini diblokir. */
function catatGagal(req, label) {
  const k = kunci(req, label);
  const now = Date.now();
  let rec = ambil(k);
  // Reset jendela bila sudah lewat WINDOW_MS (dan tak sedang diblokir)
  if (!rec || now - rec.first_at > WINDOW_MS) {
    rec = { kunci: k, count_gagal: 0, first_at: now, blocked_until: 0, last_at: now };
  }
  rec.count_gagal += 1;
  rec.last_at = now;
  if (rec.count_gagal >= MAX_FAIL) {
    rec.blocked_until = now + BLOCK_MS;
  }
  simpan(rec);
  return rec.blocked_until > now;
}

/** Reset penghitung setelah login SUKSES (admin sah tidak terhukum). */
function catatSukses(req, label) {
  buang(kunci(req, label));
}

/** Utilitas diagnostik/uji: jumlah entri & berapa yang sedang diblokir. */
function status() {
  const now = Date.now();
  if (mode === "sqlite") {
    const row = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN blocked_until > ? THEN 1 ELSE 0 END) AS diblokir FROM login_attempts").get(now);
    return { mode, entri: row.total || 0, diblokir: row.diblokir || 0 };
  }
  let diblokir = 0;
  for (const v of memori.values()) if (v.blocked_until > now) diblokir++;
  return { mode, entri: memori.size, diblokir };
}

/** Reset penuh (dipakai pengujian). */
function resetSemua() {
  if (mode === "sqlite") db.prepare("DELETE FROM login_attempts").run();
  else memori.clear();
}

module.exports = {
  guard, catatGagal, catatSukses, status, resetSemua,
  MAX_FAIL, WINDOW_MS, BLOCK_MS, FAIL_DELAY_MS,
  get mode() { return mode; },
};
