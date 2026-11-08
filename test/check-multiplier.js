#!/usr/bin/env node
/**
 * check-multiplier.js — Uji regresi: kuota WAJIB dipotong
 * (prompt_tokens + completion_tokens) × multiplier model.
 *
 * Latar belakang:
 *   Dokumentasi & halaman Model menjanjikan rumus di atas, tetapi versi lama
 *   proxy.js tidak pernah menerapkan multiplier — model 42× (gpt-6-astra)
 *   memotong kuota sama seperti model 1×. Skrip ini menjaga agar bug itu
 *   tidak kembali.
 *
 * Cara kerja:
 *   1. Nyalakan mock provider (tanpa memakai kredit provider asli).
 *   2. Nyalakan instance gateway KEDUA yang menembak ke mock.
 *   3. Untuk beberapa model (multiplier berbeda), kirim request nyata
 *      (JSON & streaming) lalu bandingkan token yang dipotong dengan hasil rumus.
 *   4. Gagal (exit 1) bila ada yang tidak cocok.
 *
 * Jalankan: node test/check-multiplier.js
 */
require("dotenv").config();
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const db = require("../src/db");
const models = require("../src/lib/models");

const MOCK_PORT = 9988;
const GW_PORT = 7798;
const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [model, streaming?]
const KASUS = [
  ["deepseek-v4-pro", 1.15, false],
  ["gpt-6-astra", 42, false],
  ["glm-5.2", 1.25, false],
  ["kimi-k2.7-code", 1, false],
  ["gpt-6-astra", 42, true],
  ["deepseek-v4-pro", 1.15, true],
];

let gagal = 0;

(async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, "mock-provider.js")], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_DELAY_MS: "30" },
    stdio: "ignore",
  });
  const gw = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
    env: {
      ...process.env,
      PORT: String(GW_PORT),
      HOST: "127.0.0.1",
      TARGET_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    },
    stdio: "ignore",
  });
  await sleep(2500);

  const key = `sk-thor-uji${crypto.randomBytes(6).toString("hex")}`;
  const info = db
    .prepare("INSERT INTO api_keys (api_key, user_name, token_limit) VALUES (?, ?, ?)")
    .run(key, "uji-multiplier", 100_000_000);

  console.log("=== UJI PERHITUNGAN TOKEN × MULTIPLIER ===");
  console.log(`mock : ${MOCK_PORT} | gateway : ${GW_PORT}\n`);

  try {
    for (const [model, mult, stream] of KASUS) {
      const sebelum = db.prepare("SELECT tokens_used FROM api_keys WHERE id = ?").get(info.lastInsertRowid).tokens_used;

      const res = await fetch(`http://127.0.0.1:${GW_PORT}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "halo" }] }),
      });

      let mentah = 0;
      if (stream) {
        const teks = await res.text();
        const m = teks.match(/"total_tokens":(\d+)/);
        mentah = m ? Number(m[1]) : 0;
      } else {
        const j = await res.json();
        mentah = j.usage?.total_tokens || 0;
      }

      await sleep(1200); // beri waktu penulisan DB selesai
      const sesudah = db.prepare("SELECT tokens_used FROM api_keys WHERE id = ?").get(info.lastInsertRowid).tokens_used;
      const dipotong = sesudah - sebelum;
      const diharapkan = Math.round(mentah * mult);
      const ok = dipotong === diharapkan;
      if (!ok) gagal++;

      console.log(
        `  ${ok ? "[OK ]" : "[!!]" } ${model.padEnd(16)} ${(stream ? "stream" : "json").padEnd(6)} ` +
          `mentah=${String(mentah).padStart(3)} × ${String(mult).padStart(5)} = ` +
          `${String(diharapkan).padStart(5)} | dipotong=${String(dipotong).padStart(5)}`
      );
    }
  } finally {
    db.prepare("DELETE FROM usage_logs WHERE api_key_id = ?").run(info.lastInsertRowid);
    db.prepare("DELETE FROM api_keys WHERE id = ?").run(info.lastInsertRowid);
    mock.kill();
    gw.kill();
  }

  console.log("\n=== HASIL ===");
  console.log(gagal === 0 ? "LULUS: semua pemotongan kuota sesuai rumus × multiplier." : `${gagal} kasus TIDAK sesuai!`);
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
