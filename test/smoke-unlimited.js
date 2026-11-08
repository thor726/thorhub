#!/usr/bin/env node
/**
 * smoke-unlimited.js — Uji end-to-end: buktikan gateway TANPA rate limit.
 *
 * Skrip ini:
 *   1. Menyalakan mock provider (port MOCK_PORT).
 *   2. Menyalakan instance gateway KEDUA (port GW_PORT) yang mengarah ke mock.
 *   3. Mengirim N request /v1/chat/completions SECARA PARALEL.
 *   4. Menghitung: berapa yang sukses, berapa yang gagal, puncak paralel,
 *      dan total waktu — untuk membuktikan tidak ada throttle/antrean.
 *   5. Membersihkan proses & keluar dengan kode 0 (lulus) / 1 (gagal).
 *
 * Jalankan: node test/smoke-unlimited.js
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// db dipakai untuk membuat API key uji sementara
const db = require("../src/db");

const MOCK_PORT = 9999;
const GW_PORT = 7788;
const N_REQ = 40; // jumlah request paralel
const ROOT = path.join(__dirname, "..");

const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- API key uji sementara (kuota besar) ----
const TEST_KEY = "sk-thor-smoke-" + crypto.randomBytes(12).toString("hex");
db.prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)").run(
  TEST_KEY,
  "SMOKE-TEST",
  1_000_000_000
);

let mockProc, gwProc;
function bunuhSemua() {
  try { mockProc && mockProc.kill("SIGKILL"); } catch {}
  try { gwProc && gwProc.kill("SIGKILL"); } catch {}
}

async function tungguUp(url, maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await wait(200);
  }
  return false;
}

(async () => {
  try {
    // 1) Mock provider
    mockProc = spawn(process.execPath, ["test/mock-provider.js"], {
      cwd: ROOT,
      env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_DELAY_MS: "120" },
      stdio: "ignore",
    });

    // 2) Gateway kedua → arahkan ke mock
    gwProc = spawn(process.execPath, ["src/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        MASTER_API_KEY: "smoke-master",
        PORT: String(GW_PORT),
        TARGET_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        INJECT_STREAM_USAGE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let gwOut = "";
    gwProc.stdout.on("data", (d) => (gwOut += d.toString()));
    gwProc.stderr.on("data", (d) => (gwOut += d.toString()));

    const okMock = await tungguUp(`http://127.0.0.1:${MOCK_PORT}/stats`);
    const okGw = await tungguUp(`http://127.0.0.1:${GW_PORT}/health`);
    if (!okMock || !okGw) {
      log("GAGAL menyalakan proses. mock=" + okMock + " gw=" + okGw);
      log(gwOut);
      bunuhSemua();
      process.exit(1);
    }
    log("Mock provider : up (port " + MOCK_PORT + ")");
    log("Gateway kedua : up (port " + GW_PORT + ")");
    log("Banner gateway:\n" + gwOut.trim());

    // 3) Tembak paralel
    const body = JSON.stringify({
      model: "mock-gpt",
      messages: [{ role: "user", content: "Halo" }],
    });

    const t0 = Date.now();
    const hasil = await Promise.all(
      Array.from({ length: N_REQ }, () =>
        fetch(`http://127.0.0.1:${GW_PORT}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_KEY}` },
          body,
        })
          .then(async (r) => {
            const j = await r.json().catch(() => ({}));
            return r.ok ? "ok" : "err:" + r.status;
          })
          .catch((e) => "catch:" + e.message)
      )
    );
    const durasi = Date.now() - t0;

    const sukses = hasil.filter((h) => h === "ok").length;
    const gagal = hasil.length - sukses;

    // 4) Statistik dari mock
    const stats = await fetch(`http://127.0.0.1:${MOCK_PORT}/stats`).then((r) => r.json());
    const statGw = await fetch(`http://127.0.0.1:${GW_PORT}/health`).then((r) => r.json());

    log("\n================= HASIL =================");
    log(`Request dikirim  : ${N_REQ} (paralel)`);
    log(`Sukses           : ${sukses}`);
    log(`Gagal            : ${gagal}`);
    log(`Durasi total     : ${durasi} ms`);
    log(`Mock total hits  : ${stats.total_hits}`);
    log(`Mock hits/60s    : ${stats.hits_last_60s}`);
    log(`Gateway queue    : ${JSON.stringify(statGw.queue)}`);
    log("=========================================");

    // Kriteria lulus: SEMUA request sukses, tidak ada yang di-throttle.
    const lulus = sukses === N_REQ && gagal === 0;
    log(lulus ? "\nLULUS: tanpa rate limit — semua request lolos." : "\nGAGAL: ada request tertolak.");

    bunuhSemua();
    // Bersihkan baris key uji
    try { db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(TEST_KEY); } catch {}
    process.exit(lulus ? 0 : 1);
  } catch (err) {
    log("ERROR:", err);
    bunuhSemua();
    try { db.prepare("DELETE FROM api_keys WHERE api_key = ?").run(TEST_KEY); } catch {}
    process.exit(1);
  }
})();
