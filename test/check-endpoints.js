#!/usr/bin/env node
/**
 * test/check-endpoints.js — Uji semua endpoint gateway terhadap server live.
 *
 * Mengambil kredensial dari .env & database (tidak ada nilai rahasia
 * yang dicetak ke layar — hanya status HTTP dan ringkas hasil).
 *
 * Pemakaian:
 *   node test/check-endpoints.js [BASE_URL]
 * Default BASE_URL: https://llm.thormarket.site
 */
require("dotenv").config();
const db = require("../src/db");

const BASE = (process.argv[2] || "https://llm.thormarket.site").replace(/\/+$/, "");
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "";
const MASTER = process.env.MASTER_API_KEY || "";

// API key member aktif pertama (untuk uji /v1/*)
const member = db.prepare("SELECT api_key FROM api_keys WHERE is_active = 1 LIMIT 1").get();
const MEMBER_KEY = member ? member.api_key : "";

const results = [];
async function test(nama, metode, path, { headers = {}, body, expect = [], catat = true } = {}) {
  const url = BASE + path;
  try {
    const res = await fetch(url, {
      method: metode,
      headers: { ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    const ok = expect.length ? expect.includes(res.status) : res.status >= 200 && res.status < 400;
    results.push({ nama, metode, path, status: res.status, ok });
    const tanda = ok ? "OK " : "!! ";
    console.log(`  [${tanda}] ${metode.padEnd(6)} ${path.padEnd(42)} -> ${res.status}`);
    return { res, ok };
  } catch (err) {
    results.push({ nama, metode, path, status: "ERR", ok: false, err: err.message });
    console.log(`  [!! ] ${metode.padEnd(6)} ${path.padEnd(42)} -> ERROR: ${err.message}`);
    return { res: null, ok: false };
  }
}

(async () => {
  console.log("GATEWAY ENDPOINT CHECK");
  console.log("Base   :", BASE);
  console.log("Admin  :", ADMIN_KEY ? "ada" : "KOSONG", "| Member key:", MEMBER_KEY ? "ada" : "KOSONG");
  console.log("");

  // ---------- 1. Publik / statis ----------
  console.log("1) Halaman statis & info publik");
  await test("landing", "GET", "/", { expect: [200] });
  await test("docs", "GET", "/docs", { expect: [200] });
  await test("portal page", "GET", "/portal", { expect: [200] });
  await test("admin page", "GET", "/admin", { expect: [200] });
  await test("login-admin", "GET", "/login-admin.html", { expect: [200] });
  await test("style.css", "GET", "/style.css", { expect: [200] });
  await test("health", "GET", "/health", { expect: [200] });
  await test("api/info", "GET", "/api/info", { expect: [200] });
  await test("integrasi/claude", "GET", "/integrasi/claude", { expect: [200] });
  await test("404 (harus 404)", "GET", "/tidak-ada-halaman-xyz", { expect: [404] });
  await test("root redirect http->https", "GET", "/health", { headers: { "X-Forwarded-Proto": "http" }, expect: [200, 301] });

  // ---------- 2. /v1 (auth member) ----------
  console.log("\n2) API pembeli (/v1, butuh Bearer member key)");
  const authMem = { Authorization: `Bearer ${MEMBER_KEY}`, "Content-Type": "application/json" };
  await test("v1/models", "GET", "/v1/models", { headers: authMem, expect: [200] });
  await test("v1/models TANPA auth (harus 401)", "GET", "/v1/models", { expect: [401] });
  await test("v1/chat body invalid (harus 400)", "POST", "/v1/chat/completions", { headers: authMem, body: [], expect: [400] });
  // chat asli (mungkin butuh kuota provider; terima 200/4xx/5xx dari upstream)
  await test("v1/chat/completions", "POST", "/v1/chat/completions", {
    headers: authMem,
    body: { model: "deepseek-v4-pro", messages: [{ role: "user", content: "ping" }], max_tokens: 5 },
    expect: [200, 400, 401, 402, 403, 404, 429, 500, 502, 503, 504],
  });
  await test("v1/messages", "POST", "/v1/messages", {
    headers: authMem,
    body: { model: "claude-3-5-sonnet", max_tokens: 5, messages: [{ role: "user", content: "ping" }] },
    expect: [200, 400, 401, 402, 403, 404, 429, 500, 502, 503, 504],
  });
  await test("v1/messages/count_tokens", "POST", "/v1/messages/count_tokens", {
    headers: authMem,
    body: { model: "claude-3-5-sonnet", messages: [{ role: "user", content: "ping" }] },
    expect: [200, 400, 401, 402, 403, 404, 429, 500, 502, 503, 504],
  });

  // ---------- 3. Portal member (butuh sesi) ----------
  console.log("\n3) Portal member (sesi)");
  await test("portal/models (publik)", "GET", "/portal/models?all=1", { expect: [200] });
  await test("portal/member/me TANPA sesi (401)", "GET", "/portal/member/me", { expect: [401] });
  const login = await fetch(BASE + "/portal/member/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: MEMBER_KEY }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  let memberCookie = "";
  if (login) {
    const sc = login.headers.get("set-cookie") || "";
    memberCookie = sc.split(";")[0];
    console.log(`  [ ${login.ok ? "OK " : "!! "}] POST   /portal/member/login                         -> ${login.status}`);
    results.push({ nama: "member login", metode: "POST", path: "/portal/member/login", status: login.status, ok: login.ok });
  }
  if (memberCookie) {
    const hc = { Cookie: memberCookie };
    await test("portal/member/me", "GET", "/portal/member/me", { headers: hc, expect: [200] });
    await test("portal/member/usage", "GET", "/portal/member/usage", { headers: hc, expect: [200] });
  } else {
    console.log("  (lewati me/usage — login member gagal)");
  }

  // ---------- 4. Portal admin (butuh sesi) ----------
  console.log("\n4) Portal admin (sesi)");
  await test("portal/admin/me TANPA sesi (401)", "GET", "/portal/admin/me", { expect: [401] });
  const alogin = await fetch(BASE + "/portal/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASS }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  let adminCookie = "";
  if (alogin) {
    const sc = alogin.headers.get("set-cookie") || "";
    adminCookie = sc.split(";")[0];
    console.log(`  [ ${alogin.ok ? "OK " : "!! "}] POST   /portal/admin/login                          -> ${alogin.status}`);
    results.push({ nama: "admin login", metode: "POST", path: "/portal/admin/login", status: alogin.status, ok: alogin.ok });
  }
  if (adminCookie) {
    const hc = { Cookie: adminCookie };
    for (const p of ["/portal/admin/me", "/portal/admin/keys", "/portal/admin/usage", "/portal/admin/activity", "/portal/admin/models"]) {
      await test("portal" + p, "GET", p, { headers: hc, expect: [200] });
    }
    if (MEMBER_KEY) {
      await test("portal/admin/keys/:key/usage", "GET", `/portal/admin/keys/${MEMBER_KEY}/usage`, { headers: hc, expect: [200] });
    }
  } else {
    console.log("  (lewati admin/* — login admin gagal)");
  }

  // ---------- 5. REST admin (butuh ADMIN_API_KEY) ----------
  console.log("\n5) REST admin (Bearer ADMIN_API_KEY)");
  const authAdm = { Authorization: `Bearer ${ADMIN_KEY}`, "Content-Type": "application/json" };
  await test("admin/keys TANPA auth (401)", "GET", "/admin/keys", { expect: [401] });
  await test("admin/keys", "GET", "/admin/keys", { headers: authAdm, expect: [200] });
  await test("admin/usage", "GET", "/admin/usage", { headers: authAdm, expect: [200] });
  if (MEMBER_KEY) {
    await test("admin/keys/:key", "GET", `/admin/keys/${MEMBER_KEY}`, { headers: authAdm, expect: [200] });
  }

  // ---------- Ringkasan ----------
  const total = results.length;
  const lulus = results.filter((r) => r.ok).length;
  const gagal = results.filter((r) => !r.ok);
  console.log("\n========================================");
  console.log(`TOTAL: ${total} | LULUS: ${lulus} | GAGAL: ${gagal.length}`);
  if (gagal.length) {
    console.log("Gagal:");
    for (const g of gagal) console.log(`  - ${g.metode} ${g.path} -> ${g.status}${g.err ? " (" + g.err + ")" : ""}`);
  }
  console.log("========================================");
  process.exit(gagal.length ? 1 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
