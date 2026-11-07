/**
 * admin.js — Panel admin (vanilla JS, tanpa build step).
 * Satu halaman menangani 2 state: LOGIN dan PANEL (tanpa redirect, anti-loop).
 */
const API = "/portal/admin";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n || 0).toLocaleString("id-ID");

let loggedIn = false;

/** Panggil API. Bila 401 → tampilkan form login (TANPA redirect). */
async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  if (r.status === 401) {
    showLogin();
    throw new Error("unauthorized");
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || "Permintaan gagal");
  return d.data;
}

function showLogin() {
  loggedIn = false;
  $("loading").classList.add("hidden");
  $("panel").classList.add("hidden");
  $("login-section").classList.remove("hidden");
  $("btn-logout").classList.add("hidden");
  $("password").focus();
}

function showPanel() {
  loggedIn = true;
  $("loading").classList.add("hidden");
  $("login-section").classList.add("hidden");
  $("panel").classList.remove("hidden");
  $("btn-logout").classList.remove("hidden");
}

function toast(el, msg, ok = true) {
  el.innerHTML = `<div class="alert ${ok ? "ok" : "err"}">${esc(msg)}</div>`;
  if (ok) setTimeout(() => { el.innerHTML = ""; }, 6000);
}

async function boot() {
  try {
    const r = await fetch(API + "/me", { credentials: "same-origin" });
    if (r.ok) {
      showPanel();
      await loadAll();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

async function loadAll() {
  await Promise.all([
    loadStats().catch(() => {}),
    loadGateway().catch(() => {}),
    loadKeys().catch(() => {}),
  ]);
}

async function loadStats() {
  const s = await api("/usage");
  if (!loggedIn) return;
  $("stats").innerHTML = `
    <div class="stat"><div class="k">Total Member</div><div class="v">${num(s.total_keys)}</div></div>
    <div class="stat"><div class="k">Member Aktif</div><div class="v">${num(s.active_keys)}</div></div>
    <div class="stat"><div class="k">Total Kuota</div><div class="v">${num(s.total_token_limit)}</div></div>
    <div class="stat"><div class="k">Total Terpakai</div><div class="v">${num(s.total_tokens_used)}</div></div>`;
}

async function loadGateway() {
  const h = await fetch("/health").then((r) => r.json()).catch(() => ({}));
  if (!loggedIn) return;
  const running = h.queue?.running;
  $("gw-status").innerHTML = `
    <div class="stat"><div class="k">Status</div><div class="v" style="font-size:18px">${h.status === "ok" ? "✅ Aktif" : "⚠️ Gangguan"}</div></div>
    <div class="stat"><div class="k">Antrean</div><div class="v">${num(h.queue?.queued ?? 0)}</div></div>
    <div class="stat"><div class="k">Berjalan</div><div class="v" style="font-size:16px">${esc(typeof running === "object" ? JSON.stringify(running) : running ?? 0)}</div></div>`;
}

async function loadKeys() {
  const keys = await api("/keys");
  if (!loggedIn) return;
  const wrap = $("keys-wrap");
  if (!keys.length) {
    wrap.innerHTML = `<p class="muted">Belum ada Sub-API Key. Terbitkan yang pertama di atas.</p>`;
    return;
  }
  const rows = keys.map((k) => {
    const pct = k.token_limit > 0 ? Math.round((k.tokens_used / k.token_limit) * 100) : 0;
    return `<tr data-key="${esc(k.api_key)}">
      <td>${k.id}</td>
      <td>${esc(k.user_name)}</td>
      <td class="mono">
        <span class="keyval" data-full="${esc(k.api_key)}">${esc(k.api_key.slice(0, 18))}…</span>
        <button class="btn small" data-act="reveal">👁</button>
        <button class="btn small" data-act="copy">⧉</button>
      </td>
      <td>${num(k.tokens_used)} / ${num(k.token_limit)} <span class="muted">(${pct}%)</span></td>
      <td>${k.is_active ? '<span class="tag ok">AKTIF</span>' : '<span class="tag off">BLOKIR</span>'}</td>
      <td>${esc(k.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-act="topup">Top-up</button>
        <button class="btn small" data-act="toggle">${k.is_active ? "Blokir" : "Aktifkan"}</button>
        <button class="btn small danger" data-act="del">Hapus</button>
      </td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>ID</th><th>Nama</th><th>API Key</th><th>Pemakaian</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ---- Login ----
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-login");
  btn.disabled = true;
  $("login-msg").innerHTML = "";
  try {
    const r = await fetch(API + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password: $("password").value }),
    });
    const d = await r.json();
    if (!r.ok) {
      $("login-msg").innerHTML = `<div class="alert err">${esc(d.error?.message || "Login gagal.")}</div>`;
    } else {
      $("password").value = "";
      showPanel();
      await loadAll();
    }
  } catch {
    $("login-msg").innerHTML = `<div class="alert err">Gagal menghubungi server.</div>`;
  } finally {
    btn.disabled = false;
  }
});

// ---- Tombol aksi di tabel ----
$("keys-wrap").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const tr = btn.closest("tr");
  const apiKey = tr.dataset.key;
  const act = btn.dataset.act;

  try {
    if (act === "reveal") {
      tr.querySelector(".keyval").textContent = apiKey;
    } else if (act === "copy") {
      await navigator.clipboard.writeText(apiKey);
      btn.textContent = "✓";
      setTimeout(() => (btn.textContent = "⧉"), 1200);
    } else if (act === "topup") {
      const amount = prompt("Tambah kuota token sebesar:", "1000000");
      if (amount === null) return;
      const n = Number(amount);
      if (!Number.isInteger(n) || n <= 0) return alert("Masukkan bilangan bulat positif.");
      const keys = await api("/keys");
      const k = keys.find((x) => x.api_key === apiKey);
      await api(`/keys/${encodeURIComponent(apiKey)}`, {
        method: "PATCH",
        body: JSON.stringify({ token_limit: k.token_limit + n }),
      });
      await loadKeys();
    } else if (act === "toggle") {
      const isActive = tr.querySelector("td:nth-child(5) .tag").classList.contains("ok");
      await api(`/keys/${encodeURIComponent(apiKey)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !isActive }),
      });
      await loadKeys();
    } else if (act === "del") {
      if (!confirm(`Hapus permanen key untuk "${tr.querySelector("td:nth-child(2)").textContent}"?`)) return;
      await api(`/keys/${encodeURIComponent(apiKey)}`, { method: "DELETE" });
      await loadKeys();
    }
  } catch (err) {
    if (err.message !== "unauthorized") alert(err.message);
  }
});

// ---- Terbitkan key baru ----
$("form-create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-create");
  btn.disabled = true;
  try {
    const k = await api("/keys", {
      method: "POST",
      body: JSON.stringify({
        user_name: $("new-name").value.trim(),
        token_limit: Number($("new-limit").value),
      }),
    });
    $("create-result").innerHTML = `
      <div class="alert ok">
        ✅ Key diterbitkan untuk <b>${esc(k.user_name)}</b>. Simpan sekarang (tidak ditampilkan lagi):
        <div class="mono" style="margin-top:8px;word-break:break-all;user-select:all">${esc(k.api_key)}</div>
        <button class="btn small" id="copy-new" style="margin-top:8px">Salin</button>
      </div>`;
    $("copy-new").onclick = () => navigator.clipboard.writeText(k.api_key);
    $("form-create").reset();
    await loadAll();
  } catch (err) {
    if (err.message !== "unauthorized") toast($("create-result"), err.message, false);
  } finally {
    btn.disabled = false;
  }
});

$("btn-refresh").onclick = () => loadAll().catch((e) => { if (e.message !== "unauthorized") alert(e.message); });
$("btn-logout").onclick = async (e) => {
  e.preventDefault();
  await fetch(API + "/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  $("password").value = "";
  showLogin();
};

boot();
