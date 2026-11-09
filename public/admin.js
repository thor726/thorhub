/**
 * admin.js — Panel admin (vanilla JS, tanpa build step).
 * Satu halaman menangani 2 state: LOGIN dan PANEL (tanpa redirect, anti-loop).
 */
const API = "/portal/admin";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n || 0).toLocaleString("id-ID");

let loggedIn = false;
// Batas waktu sesi (epoch ms) dari server; dipakai untuk auto-logout tepat
// saat sesi 2 jam habis.
let SESSION_EXPIRES_AT = 0;
let sessionTimer = null;

/**
 * Jadwalkan auto-logout tepat pada waktu kedaluwarsa sesi (2 jam).
 * Saat tercapai: tampilkan form login tanpa redirect (anti-loop).
 */
function jadwalkanAutoLogout(expiresAt) {
  SESSION_EXPIRES_AT = Number(expiresAt) || 0;
  if (sessionTimer) clearTimeout(sessionTimer);
  if (!SESSION_EXPIRES_AT) return;
  const sisa = SESSION_EXPIRES_AT - Date.now();
  if (sisa <= 0) {
    showLogin();
    return;
  }
  sessionTimer = setTimeout(() => {
    showLogin();
    $("login-msg").innerHTML = '<div class="alert warn">Sesi Anda berakhir setelah 2 jam. Silakan login kembali.</div>';
  }, sisa);
}

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
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
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

/**
 * notif(msg, ok) — notifikasi ringkas melayang di kanan atas.
 * Dipakai sebagai pengganti window.alert(): tampil, lalu hilang sendiri
 * tanpa memblokir alur kerja panel.
 */
function notif(msg, ok = true) {
  let box = document.getElementById("notif-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "notif-box";
    box.className = "notif-box";
    document.body.appendChild(box);
  }
  const item = document.createElement("div");
  item.className = `alert ${ok ? "ok" : "err"}`;
  item.style.margin = "0";
  item.textContent = String(msg);
  box.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    setTimeout(() => item.remove(), 300);
  }, ok ? 4000 : 6000);
}

/**
 * tanya(opts) — dialog konfirmasi / input kustom (pengganti window.confirm & prompt).
 *
 * Mengembalikan Promise:
 *   • false            → pengguna menekan Batal / Esc / klik latar
 *   • true             → pengguna menekan tombol konfirmasi (tanpa input)
 *   • string           → isi field bila opts.input diisi
 *
 * opts: { judul, pesan, ok='Lanjutkan', batal='Batal', input=null|'text'|'number',
 *         nilaiAwal='', placeholder='', bahaya=false }
 */
function tanya(opts = {}) {
  const { judul = "Konfirmasi", pesan = "", ok = "Lanjutkan", batal = "Batal",
          input = null, nilaiAwal = "", placeholder = "", bahaya = false } = opts;
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(judul)}">
        <div class="modal-head"><h2>${esc(judul)}</h2></div>
        ${pesan ? `<p style="margin:0 0 var(--s-3);color:var(--text-body);font-size:14px">${esc(pesan)}</p>` : ""}
        ${input ? `<input class="dlg-input" type="${input === "number" ? "number" : "text"}" value="${esc(nilaiAwal)}" placeholder="${esc(placeholder)}" />` : ""}
        <div class="dlg-err"></div>
        <div class="row-actions" style="justify-content:flex-end;margin-top:var(--s-4)">
          <button class="btn small" data-dlg="batal">${esc(batal)}</button>
          <button class="btn small ${bahaya ? "danger" : "primary"}" data-dlg="ok">${esc(ok)}</button>
        </div>
      </div>`;

    const field = back.querySelector(".dlg-input");
    const errBox = back.querySelector(".dlg-err");

    function selesai(nilai) {
      document.removeEventListener("keydown", onKey);
      back.remove();
      resolve(nilai);
    }
    function konfirmasi() {
      if (input === "number") {
        const n = Number(field.value);
        if (!Number.isInteger(n) || n <= 0) {
          errBox.innerHTML = '<div class="alert err">Masukkan bilangan bulat positif.</div>';
          field.focus();
          return;
        }
        return selesai(n);
      }
      selesai(input ? field.value.trim() : true);
    }
    function onKey(e) {
      if (e.key === "Escape") selesai(false);
      if (e.key === "Enter" && input) { e.preventDefault(); konfirmasi(); }
    }

    back.addEventListener("click", (e) => {
      if (e.target === back) return selesai(false);      // klik latar = batal
      const aksi = e.target.closest("[data-dlg]")?.dataset.dlg;
      if (aksi === "ok") konfirmasi();
      if (aksi === "batal") selesai(false);
    });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(back);
    (field || back.querySelector('[data-dlg="ok"]')).focus();
    if (field) field.select();
  });
}

async function boot() {
  try {
    const r = await fetch(API + "/me", { credentials: "same-origin" });
    if (r.ok) {
      const d = (await r.json()).data || {};
      showPanel();
      jadwalkanAutoLogout(d.expires_at);
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
    loadActivity().catch(() => {}),
    loadModels().catch(() => {}),
    loadStore().catch(() => {}),
    loadOrders().catch(() => {}),
  ]);
}

/** Ringkas angka besar: 126200000 → "126,2jt". */
function kek(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(".", ",") + "M";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "jt";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(".", ",") + "rb";
  return num(v);
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
  const t0 = performance.now();
  const h = await fetch("/health").then((r) => r.json()).catch(() => ({}));
  const ms = Math.round(performance.now() - t0);
  if (!loggedIn) return;
  const running = h.queue?.running;
  const jmlBerjalan = typeof running === "object" && running ? Object.keys(running).length : Number(running) || 0;
  const ok = h.status === "ok";

  $("gw-status").innerHTML = `
    <div class="stat"><div class="k">Status</div><div class="v" style="font-size:18px"><span class="dot${ok ? "" : " off"}"></span> ${ok ? "Aktif" : "Gangguan"}</div></div>
    <div class="stat"><div class="k">Antrean</div><div class="v">${num(h.queue?.queued ?? 0)}</div></div>
    <div class="stat"><div class="k">Sedang Berjalan</div><div class="v">${num(jmlBerjalan)}</div></div>
    <div class="stat"><div class="k">Latensi</div><div class="v">${ms} ms</div></div>`;

  const d = $("gw-detail");
  if (d) {
    d.innerHTML = `<div class="kv" style="margin-top:12px">
      <div class="kv-row"><span>Waktu server</span><b>${esc(h.time || "—")}</b></div>
      <div class="kv-row"><span>Mode</span><b>Produksi</b></div>
      <div class="kv-row"><span>Endpoint</span><b>/v1/chat/completions · /v1/messages</b></div>
    </div>`;
  }
}

/** Log aktivitas semua member. */
async function loadActivity() {
  const rows = await api("/activity?limit=50");
  if (!loggedIn) return;
  const tb = $("tbody-activity");
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="7" class="muted">Belum ada aktivitas.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(
      (l) => `<tr>
        <td class="mono muted">${esc(l.created_at)}</td>
        <td>${esc(l.user_name)}</td>
        <td>${esc(l.model)}</td>
        <td class="num">${num(l.prompt_tokens)}</td>
        <td class="num">${num(l.completion_tokens)}</td>
        <td class="num on">${num(l.total_tokens)}</td>
        <td><span class="tag ${l.status === "ok" ? "ok" : "warn"}">${esc(l.status)}</span></td>
      </tr>`
    )
    .join("");
}

/** Katalog model + pemakaian (bisa difilter). */
let MODEL_CACHE = [];
async function loadModels() {
  MODEL_CACHE = await api("/models");
  if (!loggedIn) return;
  gambarModel(MODEL_CACHE);
}

function gambarModel(rows) {
  const tb = $("tbody-models");
  if (!tb) return;
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="7" class="muted">Tidak ada model yang cocok.</td></tr>';
    return;
  }
  // Yang pernah dipakai tampil dulu, lalu urut token terbanyak
  const urut = [...rows].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0));
  tb.innerHTML = urut
    .map(
      (m) => `<tr${m.total_tokens ? "" : ' class="row-off"'}>
        <td><b>${esc(m.id)}</b></td>
        <td>${esc(m.vendor || "—")}</td>
        <td class="num${m.total_tokens ? " on" : ""}">×${m.multiplier ?? 1}</td>
        <td>${m.vision ? '<span class="tag ok">ya</span>' : '<span class="tag plain">—</span>'}</td>
        <td>${m.enabled ? '<span class="tag ok">aktif</span>' : '<span class="tag off">nonaktif</span>'}</td>
        <td class="num">${num(m.requests)}</td>
        <td class="num">${kek(m.total_tokens)}</td>
      </tr>`
    )
    .join("");
}

/** Modal detail pemakaian satu member. */
async function bukaDetail(apiKey, nama) {
  const modal = $("modal");
  $("modal-title").textContent = "Pemakaian — " + nama;
  $("modal-body").innerHTML = '<div class="loading-box"><span class="spinner sm"></span> memuat…</div>';
  modal.classList.remove("hidden");
  try {
    const d = await api(`/keys/${encodeURIComponent(apiKey)}/usage`);
    const k = d.key;
    const pct = k.token_limit > 0 ? Math.round((k.tokens_used / k.token_limit) * 100) : 0;
    const model = (d.by_model || []).length
      ? d.by_model
          .map(
            (m) => `<tr><td>${esc(m.model)}</td><td class="num">${num(m.requests)}</td>
              <td class="num">${kek(m.prompt_tokens)}</td><td class="num">${kek(m.completion_tokens)}</td>
              <td class="num on">${kek(m.total_tokens)}</td></tr>`
          )
          .join("")
      : '<tr><td colspan="5" class="muted">Belum ada pemakaian.</td></tr>';

    $("modal-body").innerHTML = `
      <div class="stat accent" style="margin-bottom:12px">
        <div class="k">Terpakai</div>
        <div class="v">${kek(k.tokens_used)}</div>
        <div class="u2">dari ${kek(k.token_limit)} · ${pct}%</div>
      </div>
      <div class="quota-bar" style="margin-bottom:16px"><div class="quota-fill${pct >= 80 ? " danger" : pct >= 50 ? " warn" : ""}" style="width:${Math.min(100, pct)}%"></div></div>
      <h3 style="margin-bottom:8px">Per Model</h3>
      <div class="table-scroll">
        <table class="models-table">
          <thead><tr><th>Model</th><th class="num">Req</th><th class="num">Prompt</th><th class="num">Completion</th><th class="num">Total</th></tr></thead>
          <tbody>${model}</tbody>
        </table>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:12px">Dibuat: ${esc(k.created_at)} · Sisa: ${num(k.tokens_remaining)} token</p>`;
  } catch (err) {
    if (err.message !== "unauthorized") $("modal-body").innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
}

function tutupModal() {
  $("modal").classList.add("hidden");
}

async function loadKeys() {
  const keys = await api("/keys");
  if (!loggedIn) return;
  const wrap = $("keys-wrap");
  if (!keys.length) {
    wrap.innerHTML = `<p class="muted">Belum ada API Key. Terbitkan yang pertama di atas.</p>`;
    return;
  }
  // (baris tabel dirender dengan kelas "stagger-rows" agar muncul berurutan)
  const rows = keys.map((k) => {
    const pct = k.token_limit > 0 ? Math.round((k.tokens_used / k.token_limit) * 100) : 0;
    return `<tr data-key="${esc(k.api_key)}">
      <td>${k.id}</td>
      <td>${esc(k.user_name)}</td>
      <td class="mono">
        <span class="keyval" data-full="${esc(k.api_key)}">${esc(k.api_key.slice(0, 18))}…</span>
        <button class="btn small" data-act="reveal" title="Tampilkan" aria-label="Tampilkan key">
          <svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="btn small" data-act="copy" title="Salin" aria-label="Salin key">
          <svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </td>
      <td>${num(k.tokens_used)} / ${num(k.token_limit)} <span class="muted">(${pct}%)</span></td>
      <td>${k.is_active ? '<span class="tag ok">AKTIF</span>' : '<span class="tag off">BLOKIR</span>'}</td>
      <td>${esc(k.created_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-act="detail">Detail</button>
        <button class="btn small" data-act="topup">Top-up</button>
        <button class="btn small" data-act="toggle">${k.is_active ? "Blokir" : "Aktifkan"}</button>
        <button class="btn small" data-act="reset">Reset</button>
        <button class="btn small danger" data-act="del">Hapus</button>
      </td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `<div class="table-scroll"><table class="stagger-rows">
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
      // Ambil waktu kedaluwarsa sesi untuk menjadwalkan auto-logout 2 jam.
      await boot();
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
      const asli = btn.innerHTML;
      btn.innerHTML = "✓";
      setTimeout(() => (btn.innerHTML = asli), 1200);
    } else if (act === "topup") {
      const n = await tanya({
        judul: "Top-up Kuota",
        pesan: "Tambahkan kuota token untuk key ini:",
        input: "number",
        nilaiAwal: "1000000",
        ok: "Tambah",
      });
      if (!n) return;
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
    } else if (act === "detail") {
      await bukaDetail(apiKey, tr.querySelector("td:nth-child(2)").textContent);
    } else if (act === "reset") {
      const nama = tr.querySelector("td:nth-child(2)").textContent;
      const ya = await tanya({
        judul: "Reset Pemakaian",
        pesan: `Nol-kan pemakaian token untuk "${nama}"? Log aktivitas TETAP disimpan.`,
        ok: "Reset",
      });
      if (!ya) return;
      await api(`/keys/${encodeURIComponent(apiKey)}/reset`, { method: "POST", body: JSON.stringify({}) });
      await loadAll();
    } else if (act === "del") {
      const nama = tr.querySelector("td:nth-child(2)").textContent;
      const ya = await tanya({
        judul: "Hapus API Key",
        pesan: `Hapus permanen key untuk "${nama}"? Log pemakaiannya juga akan dihapus. Tindakan ini tidak bisa dibatalkan.`,
        ok: "Hapus",
        bahaya: true,
      });
      if (!ya) return;
      await api(`/keys/${encodeURIComponent(apiKey)}`, { method: "DELETE" });
      await loadAll();
    }
  } catch (err) {
    if (err.message !== "unauthorized") notif(err.message, false);
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
        Key diterbitkan untuk <b>${esc(k.user_name)}</b>. Simpan sekarang (tidak ditampilkan lagi):
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

$("btn-refresh").onclick = () => loadAll().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); });
$("btn-logout").onclick = async (e) => {
  e.preventDefault();
  await fetch(API + "/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  $("password").value = "";
  showLogin();
};

// ---- Tab panel admin ----
document.querySelectorAll("[data-atab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-atab]").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = $("atab-" + btn.dataset.atab);
    if (panel) panel.classList.add("active");
  });
});

// ---- Filter katalog model ----
$("filter-model").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) return gambarModel(MODEL_CACHE);
  gambarModel(
    MODEL_CACHE.filter(
      (m) => String(m.id).toLowerCase().includes(q) || String(m.vendor || "").toLowerCase().includes(q)
    )
  );
});

// ================================================================
// TAB TOKO & PESANAN (QRIS DANA otomatis)
// ================================================================
const rupiahIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
let STORE_CFG = null; // konfigurasi toko terakhir dari server

/** Muat & render konfigurasi toko (QRIS + notifikasi + webhook). */
async function loadStore() {
  const d = await api("/store");
  STORE_CFG = d;
  $("toko-qris").value = d.qris.static || "";
  $("toko-enabled").checked = !!d.qris.enabled;
  $("toko-secret").textContent = d.qris.secret || "(belum ada — klik Buat Secret Baru)";
  $("toko-webhook-url").textContent = location.origin + d.webhook_path;
  $("toko-macrodroid").textContent =
    '{"secret_token":"' + (d.qris.secret || "…") + '","text":"[notif_text]"}';
  // Info merchant dari string QRIS terakhir (server tak menyimpan namanya;
  // validasi ulang lokal hanya bila ada isi).
  $("toko-qris-merchant").textContent = d.qris.static
    ? "QRIS tersimpan (" + d.qris.static.length + " karakter)."
    : "Belum ada QRIS — toko belum bisa menerima pembayaran.";
  $("nt-fonnte").value = d.notify.fonnteToken || "";
  $("nt-adminwa").value = d.notify.adminWa || "";
  $("nt-resend").value = d.notify.resendKey || "";
  $("nt-emailfrom").value = d.notify.emailFrom || "";
  $("nt-wa-pembeli").checked = d.notify.waKePembeli !== false;
  $("nt-email-pembeli").checked = d.notify.emailKePembeli !== false;
}

/** Simpan pengaturan QRIS (string + aktif/nonaktif). */
$("btn-toko-qris").addEventListener("click", async () => {
  const box = $("toko-qris-msg");
  box.innerHTML = "";
  try {
    const r = await api("/store/qris", {
      method: "POST",
      body: JSON.stringify({ static: $("toko-qris").value.trim(), enabled: $("toko-enabled").checked }),
    });
    box.innerHTML = `<div class="alert ok">${esc(r.message)}${r.merchant ? " Merchant: <b>" + esc(r.merchant.name || "—") + "</b>" : ""}</div>`;
    setTimeout(() => (box.innerHTML = ""), 8000);
    await loadStore();
  } catch (err) {
    if (err.message !== "unauthorized") box.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
});

/** (Re)generate secret webhook. */
$("btn-toko-secret").addEventListener("click", async () => {
  const ya = await tanya({
    judul: "Buat Secret Baru",
    pesan: "Secret lama TIDAK berlaku lagi — MacroDroid di HP Anda harus diperbarui dengan body baru. Lanjutkan?",
    ok: "Ya, Buat Baru",
  });
  if (!ya) return;
  try {
    const r = await api("/store/secret", { method: "POST", body: JSON.stringify({}) });
    await loadStore();
    notif(r.message);
  } catch (err) {
    if (err.message !== "unauthorized") notif(err.message, false);
  }
});

/** Uji webhook (server-side self-test, tidak melunaskan pesanan). */
$("btn-toko-test").addEventListener("click", async () => {
  const box = $("toko-secret-msg");
  box.innerHTML = '<div class="loading-box"><span class="spinner sm"></span> menguji webhook…</div>';
  try {
    const r = await api("/store/test", { method: "POST", body: JSON.stringify({}) });
    box.innerHTML = `<div class="alert ${r.ok ? "ok" : "warn"}">${esc(r.hasil?.message || "Selesai.")}</div>`;
  } catch (err) {
    if (err.message !== "unauthorized") box.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
});

/** Salin body MacroDroid. */
$("btn-copy-macrodroid").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("toko-macrodroid").textContent);
  const b = $("btn-copy-macrodroid");
  b.textContent = "✓ Tersalin";
  setTimeout(() => (b.textContent = "Salin Body MacroDroid"), 1500);
});

/** Simpan konfigurasi notifikasi. */
$("btn-nt-simpan").addEventListener("click", async () => {
  const box = $("nt-msg");
  box.innerHTML = "";
  try {
    const r = await api("/store/notify", {
      method: "POST",
      body: JSON.stringify({
        fonnteToken: $("nt-fonnte").value.trim(),
        adminWa: $("nt-adminwa").value.trim(),
        resendKey: $("nt-resend").value.trim(),
        emailFrom: $("nt-emailfrom").value.trim(),
        waKePembeli: $("nt-wa-pembeli").checked,
        emailKePembeli: $("nt-email-pembeli").checked,
      }),
    });
    box.innerHTML = `<div class="alert ok">${esc(r.message)}</div>`;
    setTimeout(() => (box.innerHTML = ""), 6000);
  } catch (err) {
    if (err.message !== "unauthorized") box.innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
});

// ================================================================
// PELACAKAN PESANAN (ala toko online): filter status, pencarian,
// paginasi, statistik, modal detail + linimasa + aksi admin.
// ================================================================
const LABEL_STATUS = { PENDING: "Menunggu Bayar", PAID: "Dibayar", COMPLETED: "Selesai", CANCELLED: "Batal" };
const TAG_STATUS = { PENDING: "warn", PAID: "info", COMPLETED: "ok", CANCELLED: "plain" };
const ORDERS = { status: "", q: "", offset: 0, limit: 25, total: 0 };

const tagStatus = (s) =>
  `<span class="tag ${TAG_STATUS[s] || "plain"}">${LABEL_STATUS[s] || esc(s)}</span>`;

/** Muat & render daftar pesanan + statistik + riwayat webhook. */
async function loadOrders() {
  const p = new URLSearchParams();
  if (ORDERS.status) p.set("status", ORDERS.status);
  if (ORDERS.q) p.set("q", ORDERS.q);
  p.set("limit", String(ORDERS.limit));
  p.set("offset", String(ORDERS.offset));
  const d = await api("/orders?" + p.toString());
  if (!loggedIn) return;
  ORDERS.total = d.paging?.total ?? (d.orders || []).length;

  // Statistik toko ala dashboard
  const st = d.stats || {};
  const statsEl = $("toko-stats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><div class="k">Pesanan Hari Ini</div><div class="v">${num(st.pesanan_hari_ini || 0)}</div></div>
      <div class="stat"><div class="k">Menunggu Bayar</div><div class="v">${num(st.menunggu_bayar || 0)}</div></div>
      <div class="stat"><div class="k">Omzet Hari Ini</div><div class="v" style="font-size:17px">${rupiahIDR(st.omzet_hari_ini || 0)}</div></div>
      <div class="stat"><div class="k">Total Omzet Lunas</div><div class="v" style="font-size:17px">${rupiahIDR(st.omzet_lunas || 0)}</div></div>`;
  }

  const rows = d.orders || [];
  const tb = $("tbody-orders");
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="8" class="muted">Tidak ada pesanan yang cocok.</td></tr>';
  } else {
    tb.innerHTML = rows
      .map((o) => {
        const lewat = o.expires_at && o.expires_at < Date.now();
        return `<tr>
          <td class="mono"><b>${esc(o.order_code)}</b></td>
          <td>${esc(o.user_name)}<div class="muted" style="font-size:11.5px">${esc(o.email || "")}${o.whatsapp ? " · " + esc(o.whatsapp) : ""}</div></td>
          <td>${kek(o.quota_tokens)} token</td>
          <td class="num on">${rupiahIDR(o.amount_to_pay)}<div class="muted" style="font-size:11.5px">unik +${o.unique_code}${lewat && o.status === "PENDING" ? " · <span style='color:var(--red)'>tagihan lewat</span>" : ""}</div></td>
          <td>${o.mode === "key_baru" ? "Key baru" : "Top-up"}</td>
          <td>${tagStatus(o.status)}</td>
          <td class="mono muted">${esc(o.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn small" data-ord="${esc(o.order_code)}" data-act="detail">Detail</button>
            ${o.status === "PENDING" || o.status === "CANCELLED" ? `<button class="btn small primary" data-ord="${esc(o.order_code)}" data-act="konfirmasi">Lunas?</button>` : ""}
            ${o.status === "PENDING" ? `<button class="btn small" data-ord="${esc(o.order_code)}" data-act="batal">Batal</button>` : ""}
            ${o.status === "COMPLETED" ? `<button class="btn small" data-ord="${esc(o.order_code)}" data-act="kirim-ulang">Kirim Ulang</button>` : ""}
          </td>
        </tr>`;
      })
      .join("");
  }

  // Info halaman + pager
  const dari = ORDERS.total === 0 ? 0 : ORDERS.offset + 1;
  const sampai = Math.min(ORDERS.offset + ORDERS.limit, ORDERS.total);
  $("orders-pageinfo").textContent = `Menampilkan ${dari}–${sampai} dari ${ORDERS.total} pesanan${ORDERS.q ? ` (pencarian: "${ORDERS.q}")` : ""}`;
  $("btn-orders-prev").disabled = ORDERS.offset <= 0;
  $("btn-orders-next").disabled = sampai >= ORDERS.total;

  // Riwayat notifikasi DANA
  const ev = d.events || [];
  const te = $("tbody-events");
  if (!ev.length) {
    te.innerHTML = '<tr><td colspan="6" class="muted">Belum ada notifikasi DANA masuk.</td></tr>';
  } else {
    te.innerHTML = ev
      .map(
        (e) => `<tr>
          <td class="mono muted">${esc(e.created_at)}</td>
          <td class="num">${e.amount ? rupiahIDR(e.amount) : "—"}</td>
          <td class="mono">${e.order_code ? esc(e.order_code) : "—"}</td>
          <td>${e.matched ? '<span class="tag ok">ya</span>' : '<span class="tag off">tidak</span>'}</td>
          <td class="mono muted" style="font-size:11.5px">${esc(e.ip || "—")}</td>
          <td class="muted" style="font-size:12px;word-break:break-word">${esc(e.note || "")}</td>
        </tr>`
      )
      .join("");
  }
}

/* ---------- Modal detail pesanan: info + linimasa + log DANA + aksi ---------- */
const TL_LABEL = {
  dibuat: "Pesanan dibuat",
  webhook: "Notifikasi DANA",
  lunas: "Pembayaran diterima",
  fulfillment: "Eksekusi pesanan",
  notifikasi: "Pengiriman key & struk",
  admin: "Aksi admin",
  batal: "Dibatalkan",
  info: "Catatan",
};

function renderTimeline(items) {
  if (!items || !items.length) {
    return '<p class="muted" style="margin:8px 0 0">Belum ada linimasa.</p>';
  }
  return `<div class="timeline">${items
    .map(
      (e) => `<div class="tl-item">
        <span class="tl-dot ${esc(e.type)}"></span>
        <div class="tl-head">
          <b>${TL_LABEL[e.type] || esc(e.type)}</b>
          <span class="tag plain">${esc(e.actor)}</span>
          <span class="mono muted" style="font-size:11px;margin-left:auto">${esc(e.created_at)}</span>
        </div>
        <div class="tl-detail">${esc(e.detail)}</div>
      </div>`
    )
    .join("")}</div>`;
}

async function bukaDetailOrder(kode) {
  const modal = $("modal");
  $("modal-title").textContent = "Pesanan " + kode;
  $("modal-body").innerHTML = '<div class="loading-box"><span class="spinner sm"></span> memuat detail…</div>';
  modal.classList.remove("hidden");
  try {
    const d = await api(`/orders/${encodeURIComponent(kode)}`);
    const o = d.order;
    const lewat = o.expires_at && o.expires_at < Date.now();

    const info = `
      <div class="kv">
        <div class="kv-row"><span>Pembeli</span><b>${esc(o.user_name)}</b></div>
        <div class="kv-row"><span>Kontak</span><b>${esc(o.whatsapp || "—")}${o.email ? " · " + esc(o.email) : ""}</b></div>
        <div class="kv-row"><span>Paket</span><b>${num(o.quota_tokens)} token · ${o.mode === "key_baru" ? "Key baru" : "Top-up"}</b></div>
        <div class="kv-row"><span>Tagihan</span><b>${rupiahIDR(o.base_amount)} + unik ${o.unique_code} = <span class="ok">${rupiahIDR(o.amount_to_pay)}</span></b></div>
        <div class="kv-row"><span>Metode</span><b>${esc(o.payment_method)}</b></div>
        <div class="kv-row"><span>Status</span><b>${tagStatus(o.status)}</b></div>
        ${o.mode === "key_baru" && o.api_key_issued ? `<div class="kv-row"><span>Key Terbit</span><b class="ok" style="word-break:break-all">${esc(o.api_key_issued)}</b></div>` : ""}
        ${o.mode === "topup" ? `<div class="kv-row"><span>Key Target</span><b style="word-break:break-all">${esc(o.target_api_key)}</b></div>` : ""}
        <div class="kv-row"><span>Dibuat</span><b>${esc(o.created_at)}</b></div>
        ${o.paid_at ? `<div class="kv-row"><span>Dibayar</span><b>${esc(o.paid_at)}</b></div>` : ""}
        ${o.completed_at ? `<div class="kv-row"><span>Selesai</span><b>${esc(o.completed_at)}</b></div>` : ""}
        <div class="kv-row"><span>Tagihan Berlaku</span><b>${new Date(o.expires_at).toLocaleString("id-ID")}${lewat && o.status === "PENDING" ? ' <span class="tag off">lewat</span>' : ""}</b></div>
        ${o.note ? `<div class="kv-row"><span>Catatan</span><b>${esc(o.note)}</b></div>` : ""}
      </div>`;

    const logDana = (d.events || [])
      .map(
        (e) => `<tr>
          <td class="mono muted" style="font-size:11.5px">${esc(e.created_at)}</td>
          <td class="num">${e.amount ? rupiahIDR(e.amount) : "—"}</td>
          <td>${e.matched ? '<span class="tag ok">ya</span>' : '<span class="tag off">tidak</span>'}</td>
          <td class="muted" style="font-size:12px;word-break:break-word">${esc(e.note || e.raw_text || "")}</td>
        </tr>`
      )
      .join("");

    $("modal-body").innerHTML = `
      ${info}
      <h3 style="margin:18px 0 4px;font-size:14px">Linimasa Pesanan</h3>
      ${renderTimeline(d.timeline)}
      <h3 style="margin:18px 0 4px;font-size:14px">Notifikasi DANA Terkait</h3>
      <div class="table-scroll">
        <table class="models-table">
          <thead><tr><th>Waktu</th><th class="num">Nominal</th><th>Cocok</th><th>Catatan</th></tr></thead>
          <tbody>${logDana || '<tr><td colspan="4" class="muted">Belum ada notifikasi DANA untuk pesanan ini.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="row-actions" style="margin-top:16px;flex-wrap:wrap">
        ${o.status === "PENDING" || o.status === "CANCELLED" ? `<button class="btn small primary" data-mact="konfirmasi" data-kode="${esc(o.order_code)}">Tandai Lunas</button>` : ""}
        ${o.status === "PENDING" ? `<button class="btn small" data-mact="batal" data-kode="${esc(o.order_code)}">Batalkan</button>` : ""}
        ${o.status === "COMPLETED" ? `<button class="btn small" data-mact="kirim-ulang" data-kode="${esc(o.order_code)}">Kirim Ulang Notifikasi</button>` : ""}
        ${o.api_key_issued ? `<button class="btn small" data-mact="salin-key" data-kode="${esc(o.order_code)}">Salin Key</button>` : ""}
      </div>
      <div id="modal-order-msg"></div>`;
  } catch (err) {
    if (err.message !== "unauthorized") $("modal-body").innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
}

/** Aksi di dalam modal detail (tanda lunas / batal / kirim ulang / salin key). */
$("modal-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-mact]");
  if (!btn) return;
  const kode = btn.dataset.kode;
  const box = $("modal-order-msg");
  try {
    if (btn.dataset.mact === "salin-key") {
      const d = await api(`/orders/${encodeURIComponent(kode)}`);
      await navigator.clipboard.writeText(d.order.api_key_issued || "");
      btn.textContent = "✓ Tersalin";
      setTimeout(() => (btn.textContent = "Salin Key"), 1500);
      return;
    }
    if (btn.dataset.mact === "konfirmasi") {
      const alasan = await tanya({
        judul: "Tandai Lunas (Manual)",
        pesan: `Konfirmasi pesanan ${kode} sebagai LUNAS — key/kuota langsung dieksekusi & notifikasi dikirim. Lakukan hanya bila dana BENAR-BENAR masuk.`,
        ok: "Ya, Lunas",
        input: "text",
        nilaiAwal: "",
        placeholderText: "Alasan (mis. cek manual DANA: uang masuk)",
      });
      if (alasan === false) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/confirm`, { method: "POST", body: JSON.stringify({ alasan }) });
      notif(r.message || "Pesanan diproses.", r.ok !== false);
    } else if (btn.dataset.mact === "batal") {
      const alasan = await tanya({
        judul: "Batalkan Pesanan",
        pesan: `Batalkan pesanan ${kode}? Kode unik dilepas dan tagihan QRIS tidak berlaku lagi.`,
        ok: "Ya, Batal",
        input: "text",
        nilaiAwal: "",
        placeholderText: "Alasan (mis. pembeli minta batal)",
      });
      if (alasan === false) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/cancel`, { method: "POST", body: JSON.stringify({ alasan }) });
      notif(r.message || "Pesanan dibatalkan.", true);
    } else if (btn.dataset.mact === "kirim-ulang") {
      const ya = await tanya({
        judul: "Kirim Ulang Notifikasi",
        pesan: `Kirim ulang key & struk pesanan ${kode} ke pembeli (WA + email, plus notifikasi admin)?`,
        ok: "Ya, Kirim Ulang",
      });
      if (!ya) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/resend`, { method: "POST", body: JSON.stringify({}) });
      notif(r.message || "Pengiriman ulang diproses.", true);
    }
    await bukaDetailOrder(kode);
    await loadOrders();
  } catch (err) {
    if (err.message !== "unauthorized") {
      if (box) box.innerHTML = `<div class="alert err" style="margin-top:10px">${esc(err.message)}</div>`;
      else notif(err.message, false);
    }
  }
});

/** Aksi pada tabel pesanan (detail / konfirmasi / batal / kirim ulang). */
$("tbody-orders").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const kode = btn.dataset.ord;
  try {
    if (btn.dataset.act === "detail") {
      await bukaDetailOrder(kode);
    } else if (btn.dataset.act === "konfirmasi") {
      const ya = await tanya({
        judul: "Konfirmasi Manual",
        pesan: `Tandai pesanan ${kode} sebagai LUNAS dan eksekusi otomatis (terbitkan key / tambah kuota + kirim notifikasi)? Tekan ini hanya bila dana BENAR-BENAR sudah masuk.`,
        ok: "Ya, Lunas",
      });
      if (!ya) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/confirm`, { method: "POST", body: JSON.stringify({}) });
      notif(r.message || "Pesanan diproses.", r.ok !== false);
      await loadOrders();
    } else if (btn.dataset.act === "batal") {
      const ya = await tanya({
        judul: "Batalkan Pesanan",
        pesan: `Batalkan pesanan ${kode}? Tagihan QRIS tidak berlaku lagi dan kode unik dilepas.`,
        ok: "Ya, Batal",
      });
      if (!ya) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/cancel`, { method: "POST", body: JSON.stringify({}) });
      notif(r.message || "Pesanan dibatalkan.", true);
      await loadOrders();
    } else if (btn.dataset.act === "kirim-ulang") {
      const ya = await tanya({
        judul: "Kirim Ulang Notifikasi",
        pesan: `Kirim ulang key & struk pesanan ${kode} ke pembeli (WA + email)?`,
        ok: "Ya, Kirim Ulang",
      });
      if (!ya) return;
      const r = await api(`/orders/${encodeURIComponent(kode)}/resend`, { method: "POST", body: JSON.stringify({}) });
      notif(r.message || "Pengiriman ulang diproses.", true);
      await loadOrders();
    }
  } catch (err) {
    if (err.message !== "unauthorized") notif(err.message, false);
  }
});

/* ---------- Filter, pencarian & paginasi ---------- */
document.querySelectorAll("[data-ostat]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-ostat]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    ORDERS.status = chip.dataset.ostat;
    ORDERS.offset = 0;
    loadOrders().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); });
  });
});

function jalankanCari() {
  ORDERS.q = $("orders-cari").value.trim();
  ORDERS.offset = 0;
  loadOrders().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); });
}
$("btn-orders-cari").addEventListener("click", jalankanCari);
$("orders-cari").addEventListener("keydown", (e) => { if (e.key === "Enter") jalankanCari(); });

$("btn-orders-prev").addEventListener("click", () => {
  ORDERS.offset = Math.max(0, ORDERS.offset - ORDERS.limit);
  loadOrders().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); });
});
$("btn-orders-next").addEventListener("click", () => {
  ORDERS.offset = ORDERS.offset + ORDERS.limit;
  loadOrders().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); });
});

$("btn-orders-refresh").addEventListener("click", () =>
  loadOrders().catch((e) => { if (e.message !== "unauthorized") notif(e.message, false); })
);

// Auto-refresh ringan (15 detik) hanya saat: login, tab toko aktif, halaman
// terlihat, dan tidak ada modal terbuka — agar pelacakan pembayaran "hidup"
// tanpa mengganggu aksi admin yang sedang berlangsung.
let ordersTimer = null;
function jadwalkanRefreshPesanan() {
  if (ordersTimer) clearInterval(ordersTimer);
  ordersTimer = setInterval(() => {
    if (!loggedIn || document.hidden) return;
    const tab = document.getElementById("atab-toko");
    if (!tab || !tab.classList.contains("active")) return;
    if (!$("modal").classList.contains("hidden")) return;
    loadOrders().catch(() => {});
  }, 15000);
}
jadwalkanRefreshPesanan();

// ---- Modal ----
$("modal-close").onclick = tutupModal;
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") tutupModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") tutupModal(); });

// Jalankan boot dengan penangkap error: bila ada promise yang gagal, tampilkan
// form login alih-alih membiarkan "unhandled promise rejection" mematikan alur.
boot().catch(() => showLogin());
