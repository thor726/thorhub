/**
 * portal.js — Dashboard member ThorHub (vanilla JS, tanpa build step).
 *
 * Sumber data:
 *   GET /portal/member/me     → identitas, kuota, ringkasan request
 *   GET /portal/member/usage  → per model, per hari (30 hari), log terakhir
 *
 * Struktur meniru dashboard Re:Link: kartu metrik di atas, lalu tab
 * Integrasi / Top Up / Pemakaian / Model / Log Aktivitas.
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n || 0).toLocaleString("id-ID");
const rupiah = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

/** Ringkas angka besar: 126.200.000 → "126,2M". */
function kek(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(".", ",") + "M";
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "jt";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(".", ",") + "rb";
  return num(v);
}

let DATA_ME = null;
// Timer auto-logout saat sesi 2 jam habis.
let sessionTimer = null;

/** Jadwalkan auto-logout tepat pada waktu kedaluwarsa sesi (2 jam). */
function jadwalkanAutoLogout(expiresAt) {
  if (sessionTimer) clearTimeout(sessionTimer);
  const exp = Number(expiresAt) || 0;
  if (!exp) return;
  const sisa = exp - Date.now();
  if (sisa <= 0) {
    showLogin();
    return;
  }
  sessionTimer = setTimeout(() => {
    showLogin();
    $("login-msg").innerHTML = '<div class="alert warn">Sesi Anda berakhir setelah 2 jam. Silakan login kembali.</div>';
  }, sisa);
}

function showLogin() {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer = null; }
  hentikanTopupPolling();
  hentikanTopupCountdown();
  tutupLacak();
  $("loading").classList.add("hidden");
  $("panel").classList.add("hidden");
  $("login-section").classList.remove("hidden");
  $("btn-logout").classList.add("hidden");
  $("btn-refresh").classList.add("hidden");
  setBreadcrumbSegmen("Masuk");
  const f = $("apikey");
  if (f) f.focus();
}

/* ============ Breadcrumb ala Thor-market (pemisah "/") ============
   Jejak klik di dashboard: Beranda / Portal Member / <tab kini>.
   Segmen terakhir berubah SETIAP kali tab diklik / status login berubah. */
const LABEL_TAB_BC = {
  integrasi: "Integrasi API",
  topup: "Top Up",
  pesanan: "Pesanan Saya",
  pemakaian: "Pemakaian",
  model: "Model",
  log: "Log Aktivitas",
};
function setBreadcrumbSegmen(teks) {
  const el = $("bc-tab");
  if (el) el.textContent = teks;
}
function breadcrumbTabAktif() {
  const aktif = document.querySelector(".tab.active");
  setBreadcrumbSegmen(aktif ? LABEL_TAB_BC[aktif.dataset.tab] || "Dashboard" : "Dashboard");
}

/* ============ URL slug ala Thor-market (tiap aksi punya alamat) ============
   Tab panel punya path slash sendiri: /portal/topup, /portal/pesanan, dst.
   Klik tab → pushState; refresh / tombol Kembali → tab yang sama muncul lagi;
   URL bisa di-bookmark & dibagikan — terasa seperti halaman sungguhan. */
const TAB_PORTAL_DEFAULT = "integrasi";
const pathTab = (nama) => (nama === TAB_PORTAL_DEFAULT ? "/portal" : `/portal/${nama}`);
function slugDariUrl() {
  const m = location.pathname.match(/^\/portal\/([a-z0-9-]+)\/?$/i);
  return m ? m[1].toLowerCase() : "";
}
/** Terapkan tab + (opsional) catat ke address bar. push=false untuk popstate/boot. */
function navigasiTab(nama, { push = true } = {}) {
  aktifkanTab(nama);
  if (!push) return;
  try { history.pushState({ tab: nama }, "", pathTab(nama)); } catch { /* abaikan */ }
}
window.addEventListener("popstate", () => {
  const slug = slugDariUrl();
  aktifkanTab(LABEL_TAB_BC[slug] ? slug : TAB_PORTAL_DEFAULT);
  if (slug === "pesanan") {
    bacaFilterPesananDariUrl();
    muatPesanan();
  }
});

/* Filter pesanan (pill status + pencarian) juga tercermin di URL:
   /portal/pesanan?status=PAID&q=THX- — profesional & bisa dibagikan. */
function sinkronFilterPesananUrl() {
  try {
    const p = new URLSearchParams();
    if (pesananFilter.status) p.set("status", pesananFilter.status);
    if (pesananFilter.q) p.set("q", pesananFilter.q);
    const qs = p.toString();
    history.replaceState(null, "", "/portal/pesanan" + (qs ? "?" + qs : ""));
  } catch { /* abaikan */ }
}
function bacaFilterPesananDariUrl() {
  const p = new URLSearchParams(location.search);
  pesananFilter.status = (p.get("status") || "").toUpperCase();
  pesananFilter.q = p.get("q") || "";
  const cari = $("order-cari");
  if (cari) cari.value = pesananFilter.q;
  document.querySelectorAll("#order-pills .pill").forEach((pp) =>
    pp.classList.toggle("active", (pp.dataset.status || "") === pesananFilter.status)
  );
}

/** Muat data akun + pemakaian, lalu render seluruh dashboard. */
async function boot() {
  let d;
  try {
    const r = await fetch("/portal/member/me", { credentials: "same-origin" });
    if (r.status === 401) return showLogin();
    d = (await r.json()).data;
  } catch {
    return showLogin();
  }
  DATA_ME = d;

  $("loading").classList.add("hidden");
  $("login-section").classList.add("hidden");
  $("panel").classList.remove("hidden");
  $("btn-logout").classList.remove("hidden");
  $("btn-refresh").classList.remove("hidden");
  // Pulihkan tab dari URL slug (/portal/pesanan → tab pesanan) tanpa push baru.
  const slugAwal = slugDariUrl();
  aktifkanTab(LABEL_TAB_BC[slugAwal] ? slugAwal : TAB_PORTAL_DEFAULT);
  if (slugAwal === "pesanan") bacaFilterPesananDariUrl();
  breadcrumbTabAktif();

  // Jadwalkan auto-logout saat sesi 2 jam habis (expires_at dari server).
  jadwalkanAutoLogout(d.expires_at);

  // --- Identitas ---
  $("uname").textContent = d.user_name;
  $("uid").textContent = "#" + (d.id ?? "—");
  $("avatar").textContent = String(d.user_name || "?").trim().charAt(0).toUpperCase();
  const badge = $("badge-status");
  badge.textContent = d.is_active ? "aktif" : "nonaktif";
  badge.className = "tag " + (d.is_active ? "ok" : "off");

  const pct = d.token_limit > 0 ? Math.round((d.tokens_used / d.token_limit) * 100) : 0;

  // --- Peringatan + ajakan top-up: kuota habis / masa aktif mepet / kedaluwarsa ---
  const tautanTopup = '<a class="btn small primary" style="margin-left:10px" href="#" onclick="bukaTopup();return false;">Top-up Sekarang</a>';
  const peringatan = [];
  if (!d.is_active) {
    peringatan.push('<div class="alert err">Key Anda sedang dinonaktifkan. Akses chat diblokir. Hubungi admin.</div>');
  } else {
    if (d.key_expired) {
      peringatan.push(
        '<div class="alert err">Masa aktif key Anda berakhir pada <b>' + esc(d.key_masa_aktif_label || "") + '</b>. Akses chat ditolak — top-up untuk menambah kuota + memperpanjang 25 hari, aktif otomatis setelah bayar via QRIS.' + tautanTopup + '</div>'
      );
    } else if (d.tokens_remaining <= 0) {
      peringatan.push('<div class="alert err">Kuota token Anda habis. Top-up agar bisa memakai API kembali — aktif otomatis setelah bayar via QRIS.' + tautanTopup + '</div>');
    } else if (pct >= 80) {
      peringatan.push(`<div class="alert warn">Kuota terpakai <b>${pct}%</b>. Segera top-up sebelum habis — bayar QRIS, aktif otomatis.` + tautanTopup + '</div>');
    }
    if (!d.key_expired && d.key_days_left != null && d.key_days_left <= 5) {
      peringatan.push(
        `<div class="alert warn">Masa aktif key tersisa <b>${num(d.key_days_left)} hari</b> (berakhir ${esc(d.key_masa_aktif_label || "")}). Top-up sekarang untuk memperpanjang 25 hari.` + tautanTopup + '</div>'
      );
    }
  }
  $("status-warn").innerHTML = peringatan.join("");

  // --- Kartu metrik (meniru Re:Link: Quota / Terpakai / Prompt-completion / Request) ---
  $("cards").innerHTML = `
    <div class="stat accent">
      <div class="k"><svg class="ico" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z"/></svg> Sisa Kuota</div>
      <div class="v">${kek(d.tokens_remaining)}</div>
      <div class="u2">token tersisa · ${num(d.tokens_remaining)}</div>
    </div>
    <div class="stat">
      <div class="k"><svg class="ico" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg> Terpakai</div>
      <div class="v">${kek(d.tokens_used)}</div>
      <div class="u2">dari ${kek(d.token_limit)} (${pct}%)</div>
    </div>
    <div class="stat">
      <div class="k"><svg class="ico" viewBox="0 0 24 24"><path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10"/><path d="M7 19h10"/><path d="M12 16v6"/></svg> Prompt / Completion</div>
      <div class="v" style="font-size:17px">${kek(d.prompt_tokens)} / ${kek(d.completion_tokens)}</div>
      <div class="u2">token masukan / keluaran</div>
    </div>
    <div class="stat">
      <div class="k"><svg class="ico" viewBox="0 0 24 24"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg> Request</div>
      <div class="v">${num(d.requests)}</div>
      <div class="u2">total permintaan tercatat</div>
    </div>
    <div class="stat">
      <div class="k"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Masa Aktif</div>
      <div class="v">${d.key_expired ? "Habis" : d.key_days_left != null ? num(d.key_days_left) + " hari" : "—"}</div>
      <div class="u2">${d.key_masa_aktif_label ? "berakhir " + esc(d.key_masa_aktif_label) : "tanpa batas waktu"}</div>
    </div>`;

  // --- Bar kuota ---
  $("quota-text").textContent = `${kek(d.tokens_used)} / ${kek(d.token_limit)} · ${pct}% terpakai`;
  const fill = $("quota-fill");
  fill.style.width = Math.min(100, pct) + "%";
  fill.className = "quota-fill" + (pct >= 80 ? " danger" : pct >= 50 ? " warn" : "");

  // --- Kredensial & panduan integrasi ---
  isiIntegrasi(d);

  // --- Tab Top Up: info masa aktif, katalog, riwayat, lanjutkan pesanan tertunda ---
  renderTopupMasa(d);
  muatPaketTopup();
  muatRiwayatTopup();
  muatPesanan();
  lanjutkanTopupTersimpan();

  await loadUsage();
}

/** Isi seluruh panel Integrasi API dengan Base URL & API Key milik member. */
function isiIntegrasi(d) {
  const base = location.origin;
  const key = d.api_key;

  $("base-url").textContent = base + "/v1";
  $("mykey").textContent = "•".repeat(40);
  $("mykey").dataset.full = key;
  $("vs-base").textContent = base + "/v1";
  $("lain-base").textContent = base + "/v1";
  const curBase = $("cur-base");
  if (curBase) curBase.textContent = base + "/v1";

  // Logo aplikasi: isi tiap kartu + judul seksi (butuh app-logos.js)
  if (window.svgLogoApp) {
    document.querySelectorAll("[data-logo]").forEach((el) => {
      el.innerHTML = window.svgLogoApp(el.dataset.logo, 22);
    });
    const hub = $("hub-logo");
    if (hub) hub.innerHTML = window.svgLogoApp("claude", 26) + window.svgLogoApp("vscode", 26);
  }

  // Pemilih OS hanya relevan untuk Claude Code (tab Integrasi kini tab pertama)
  const osAktif = document.querySelector(".app.active")?.dataset.app || "claude";
  const osPick = $("os-pick");
  if (osPick) osPick.classList.toggle("hidden", osAktif !== "claude");
  terapkanOS();

  // SDK OpenAI — perintah siap pakai
  const sdkPy = $("cmd-sdk-py");
  if (sdkPy) {
    sdkPy.textContent =
`from openai import OpenAI

client = OpenAI(
    api_key="${key}",
    base_url="${base}/v1",
)

resp = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Halo"}],
)
print(resp.choices[0].message.content)`;
  }
  const sdkJs = $("cmd-sdk-js");
  if (sdkJs) {
    sdkJs.textContent =
`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${key}",
  baseURL: "${base}/v1",
});

const resp = await client.chat.completions.create({
  model: "deepseek-v4-pro",
  messages: [{ role: "user", content: "Halo" }],
});
console.log(resp.choices[0].message.content);`;
  }

  // 1) Claude Code — perintah satu baris (Linux/macOS)
  const elClaude = $("cmd-claude");
  elClaude.dataset.unix =
`BASE_URL="${base}/v1" API_KEY="${key}" bash <(curl -fsSL ${base}/integrasi/claude)`;
  // Perintah versi Windows (PowerShell)
  elClaude.dataset.win =
`$env:BASE_URL="${base}/v1"; $env:API_KEY="${key}"; irm ${base}/integrasi/claude.ps1 | iex`;
  terapkanOS();

  // 2) OpenCode
  $("cmd-oc-install").textContent = `npm install -g opencode-ai`;
  $("cmd-oc-config").textContent = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      provider: {
        thorthub: {
          npm: "@ai-sdk/openai-compatible",
          name: "ThorHub",
          options: { baseURL: base + "/v1", apiKey: key },
          models: {
            "deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
            "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
            auto: { name: "Auto (pilih otomatis)" },
          },
        },
      },
    },
    null,
    2
  );

  // 3) curl — OpenAI style
  $("curl-example").textContent =
`curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"Halo"}]}'`;

  // 4) Python — OpenAI SDK
  $("py-example").textContent =
`from openai import OpenAI

client = OpenAI(
    api_key="${key}",
    base_url="${base}/v1",
)

resp = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Halo"}],
)
print(resp.choices[0].message.content)`;

  // 5) Anthropic — /v1/messages
  $("anthropic-example").textContent =
`curl ${base}/v1/messages \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"deepseek-v4-pro","max_tokens":256,"messages":[{"role":"user","content":"Halo"}]}'`;
}

/** Ambil rincian pemakaian (per model, harian, log). */
async function loadUsage() {
  try {
    const r = await fetch("/portal/member/usage", { credentials: "same-origin" });
    if (!r.ok) throw new Error();
    const u = (await r.json()).data;

    renderChart(u.by_day || []);
    renderRingkasan(u);
    renderModel(u.by_model || []);
    renderLog(u.logs || []);
  } catch {
    $("chart-harian").innerHTML = '<div class="alert err">Gagal memuat data pemakaian.</div>';
    $("tbody-model").innerHTML = '<tr><td colspan="6" class="muted">Gagal memuat data.</td></tr>';
    $("tbody-log").innerHTML = '<tr><td colspan="6" class="muted">Gagal memuat data.</td></tr>';
  }
}

/** Grafik batang harian (SVG kecil, tanpa dependensi). */
function renderChart(byDay) {
  const box = $("chart-harian");
  if (!byDay.length) {
    box.innerHTML = '<p class="muted">Belum ada pemakaian tercatat.</p>';
    return;
  }
  const max = Math.max(1, ...byDay.map((d) => d.total_tokens));
  const W = 100, H = 34; // viewBox unit (persen)
  const step = W / byDay.length;
  const barW = step * 0.62;

  const bars = byDay
    .map((d, i) => {
      const h = (d.total_tokens / max) * H;
      const x = i * step + (step - barW) / 2;
      const y = H - h;
      const tgl = new Date(d.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}"
        class="bar${d.total_tokens > 0 ? "" : " empty"}" rx="0.6"
        style="animation-delay:${(i * 12)}ms"><title>${tgl}: ${num(d.total_tokens)} token · ${d.requests} request</title></rect>`;
    })
    .join("");

  const labels = [0, Math.floor(byDay.length / 2), byDay.length - 1]
    .map((i) => {
      const d = byDay[i];
      const tgl = new Date(d.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" });
      return `<span>${tgl}</span>`;
    })
    .join("");

  box.innerHTML = `
    <div class="chart-legend">
      <span><i class="sw lime"></i> token terpakai</span>
      <span class="muted">puncak: ${num(max)} token/hari</span>
    </div>
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Grafik pemakaian 30 hari">${bars}</svg>
    <div class="chart-x">${labels}</div>`;
}

/** Ringkasan angka kunci. */
function renderRingkasan(u) {
  const s = u.summary || {};
  const hariAktif = (u.by_day || []).filter((d) => d.total_tokens > 0).length;
  const totalToken = (u.by_day || []).reduce((a, d) => a + d.total_tokens, 0);
  const rata = hariAktif > 0 ? Math.round(totalToken / hariAktif) : 0;
  const modelFavorit = (u.by_model || [])[0];
  const request = (u.by_model || []).reduce((a, m) => a + m.requests, 0);

  $("ringkasan").innerHTML = `
    <div class="kv-row"><span>Model terfavorit</span><b>${esc(modelFavorit ? modelFavorit.model : "—")}</b></div>
    <div class="kv-row"><span>Total request</span><b>${num(request)}</b></div>
    <div class="kv-row"><span>Hari aktif</span><b>${num(hariAktif)} hari</b></div>
    <div class="kv-row"><span>Rata-rata per hari aktif</span><b>${num(rata)} token</b></div>
    <div class="kv-row"><span>Sisa kuota</span><b class="${s.tokens_remaining > 0 ? "ok" : "bad"}">${kek(s.tokens_remaining)} token</b></div>`;
}

/** Tabel pemakaian per model. */
function renderModel(rows) {
  const tb = $("tbody-model");
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Belum ada pemakaian tercatat.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(
      (m) => `<tr>
        <td><b>${esc(m.model)}</b></td>
        <td class="num">${num(m.requests)}</td>
        <td class="num">${kek(m.prompt_tokens)}</td>
        <td class="num">${kek(m.completion_tokens)}</td>
        <td class="num on">${kek(m.total_tokens)}</td>
        <td class="num"><span class="tag plain">×${m.multiplier}</span></td>
      </tr>`
    )
    .join("");
}

/** Tabel log aktivitas terakhir. */
function renderLog(rows) {
  const tb = $("tbody-log");
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Belum ada aktivitas.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map((l) => {
      const ok = l.status === "ok";
      return `<tr>
        <td class="mono muted">${esc(l.created_at)}</td>
        <td>${esc(l.model)}</td>
        <td class="num">${num(l.prompt_tokens)}</td>
        <td class="num">${num(l.completion_tokens)}</td>
        <td class="num on">${num(l.total_tokens)}</td>
        <td><span class="tag ${ok ? "ok" : "warn"}">${esc(l.status)}</span></td>
      </tr>`;
    })
    .join("");
}

// ---------------- Panel Integrasi API ----------------

/** Tampilkan perintah sesuai OS terpilih (kedua varian selalu ada di dataset). */
function terapkanOS() {
  const os = document.querySelector(".seg-btn.active")?.dataset.os || "unix";
  const el = $("cmd-claude");
  if (!el) return;
  el.textContent = os === "win" ? el.dataset.win || "" : el.dataset.unix || "";
  el.dataset.cur = os === "win" ? "win" : "unix";
  const note = $("claude-term-note");
  if (note) {
    note.textContent =
      os === "win"
        ? 'Buka PowerShell (cari "PowerShell" di menu Start), tempel perintahnya, lalu tekan Enter.'
        : "Buka Terminal (Ctrl+Alt+T di Linux), tempel perintahnya, lalu tekan Enter.";
  }
}

// Pemilih aplikasi
document.querySelectorAll(".app").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".app").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".app-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = $("app-" + btn.dataset.app);
    if (panel) panel.classList.add("active");
    // Pemilih OS hanya relevan untuk Claude Code
    const osPick = $("os-pick");
    if (osPick) osPick.classList.toggle("hidden", btn.dataset.app !== "claude");
  });
});

// Pemilih sistem operasi
document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    terapkanOS();
  });
});

// Tombol "Salin" generik: data-copy="#id" menyalin isi elemen target
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.querySelector(btn.dataset.copy);
    if (!target) return;
    const teks = target.dataset.cur === "win" ? target.dataset.win : target.textContent;
    try {
      await navigator.clipboard.writeText(teks);
      const asli = btn.textContent;
      btn.textContent = "✓ Tersalin";
      setTimeout(() => (btn.textContent = asli), 1200);
    } catch {
      btn.textContent = "Gagal";
    }
  });
});

// ---------------- Interaksi ----------------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    // navigasiTab: tampilkan tab + pushState URL slug (/portal/<tab>)
    navigasiTab(btn.dataset.tab);
    // Buka tab Pesanan Saya → daftar selalu segar saat dilihat
    if (btn.dataset.tab === "pesanan") muatPesanan();
  });
});

$("btn-refresh").onclick = (e) => {
  e.preventDefault();
  boot();
};

$("btn-reveal").onclick = () => {
  const el = $("mykey");
  el.textContent = el.dataset.full;
};

$("btn-copy").onclick = async () => {
  if (!DATA_ME) return;
  await navigator.clipboard.writeText(DATA_ME.api_key);
  $("btn-copy").textContent = "✓ Tersalin";
  setTimeout(() => ($("btn-copy").textContent = "Salin Key"), 1200);
};

$("btn-copy-base").onclick = async () => {
  await navigator.clipboard.writeText(location.origin + "/v1");
  $("btn-copy-base").textContent = "✓ Tersalin";
  setTimeout(() => ($("btn-copy-base").textContent = "Salin Base URL"), 1200);
};

$("btn-logout").onclick = async (e) => {
  e.preventDefault();
  await fetch("/portal/member/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  const f = $("apikey");
  if (f) f.value = "";
  showLogin();
};



// ---- Login member ----
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-login");
  btn.disabled = true;
  btn.classList.add("loading");
  $("login-msg").innerHTML = "";
  try {
    const r = await fetch("/portal/member/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ api_key: $("apikey").value.trim() }),
    });
    const d = await r.json();
    if (!r.ok) {
      $("login-msg").innerHTML = `<div class="alert err">${esc(d.error?.message || "Login gagal.")}</div>`;
    } else {
      $("apikey").value = "";
      boot();
    }
  } catch {
    $("login-msg").innerHTML = '<div class="alert err">Gagal menghubungi server.</div>';
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

// ============================================================
// TAB TOP UP — beli kuota langsung dari dashboard member
// Alur sama dengan halaman /beli (QRIS DANA otomatis): pilih paket →
// POST /store/orders (mode 'topup', key milik sendiri) → tampil QR →
// polling 5 dtk → COMPLETED → kuota & masa aktif otomatis ditambah.
// ============================================================
let PAKET_TOPUP = [];
let paketTopupDipilih = null;
let topupPesanan = null; // { kode, token, expires_at, amount, base_amount, unique_code, label, qr }
let topupPollTimer = null;
let topupCountdownTimer = null;
let topupPolling = false;
// Pesanan top-up yang sedang berjalan disimpan agar reload halaman tidak
// membuat pembeli kehilangan QR pembayarannya (pola yang sama dengan /beli).
const KUNCI_TOPUP = "thorhub_topup_portal";

function aktifkanTab(nama) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === nama));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + nama));
  // Breadcrumb ikut (setiap klik — termasuk klik tombol 'Lihat Kredensial' dkk.)
  setBreadcrumbSegmen(LABEL_TAB_BC[nama] || "Dashboard");
}

/** Buka tab Top Up dari tombol mana pun (kartu kuota / banner peringatan).
 *  Lewat navigasiTab agar URL ikut berubah ke /portal/topup. */
function bukaTopup() {
  navigasiTab("topup");
  muatPaketTopup();
  muatRiwayatTopup();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("btn-buka-topup").onclick = bukaTopup;

/** Kartu info masa aktif di atas form top-up. */
function renderTopupMasa(d) {
  if (!d) return;
  const cls = d.key_expired ? "bad" : d.key_days_left != null && d.key_days_left <= 5 ? "warn" : "ok";
  const sisa = d.key_expired ? "KEDALUWARSA" : d.key_days_left != null ? `${num(d.key_days_left)} hari lagi` : "—";
  $("topup-masa").innerHTML = `
    <div class="kv" style="margin-bottom:16px">
      <div class="kv-row"><span>API Key Anda</span><b class="mono">${esc(d.api_key.slice(0, 18))}…</b></div>
      <div class="kv-row"><span>Masa aktif berakhir</span><b>${esc(d.key_masa_aktif_label || "—")}</b></div>
      <div class="kv-row"><span>Sisa masa aktif</span><b class="${cls}">${esc(sisa)}</b></div>
    </div>`;
}

/* ---------- Katalog paket ---------- */
async function muatPaketTopup() {
  try {
    const r = await fetch("/store/packages");
    const data = ((await r.json()).data || {});
    PAKET_TOPUP = data.packages || [];
    if (!data.store_ready) {
      $("topup-toko-status").innerHTML =
        '<div class="alert warn">Toko sedang <b>ditutup</b> — pembayaran QRIS belum diaktifkan admin. Silakan hubungi admin.</div>';
      $("btn-topup").disabled = true;
    } else {
      $("topup-toko-status").innerHTML = "";
      $("btn-topup").disabled = false;
    }
    gambarPaketTopup();
  } catch {
    $("topup-toko-status").innerHTML = '<div class="alert err">Gagal memuat katalog paket. Klik Segarkan untuk mencoba lagi.</div>';
  }
}

function gambarPaketTopup() {
  const wrap = $("topup-pkg");
  if (!PAKET_TOPUP.length) {
    wrap.innerHTML = '<p class="muted">Katalog tidak tersedia.</p>';
    return;
  }
  wrap.innerHTML = PAKET_TOPUP.map(
    (p, i) => `
    <button type="button" class="pkg${paketTopupDipilih?.id === p.id ? " active" : ""}" data-id="${esc(p.id)}" style="--i:${i}">
      <span class="pkg-tok">${esc(p.label)}</span>
      <span class="pkg-unit">token</span>
      <span class="pkg-harga mono">${rupiah(p.price)}</span>
    </button>`
  ).join("");
}

$("topup-pkg").addEventListener("click", (e) => {
  const btn = e.target.closest(".pkg");
  if (!btn) return;
  paketTopupDipilih = PAKET_TOPUP.find((p) => p.id === btn.dataset.id) || null;
  gambarPaketTopup();
});

/* ---------- Buat pesanan top-up ---------- */
$("form-topup").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!paketTopupDipilih) {
    $("topup-msg").innerHTML = '<div class="alert err">Pilih salah satu paket di atas dulu.</div>';
    return;
  }
  const btn = $("btn-topup");
  btn.disabled = true;
  btn.classList.add("loading");
  $("topup-msg").innerHTML = "";
  try {
    const body = {
      mode: "topup",
      package_id: paketTopupDipilih.id,
      user_name: DATA_ME.user_name,
      api_key: DATA_ME.api_key,
      email: $("t-email").value.trim(),
      whatsapp: $("t-wa").value.trim(),
    };
    const r = await fetch("/store/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "Gagal membuat pesanan.");

    const pay = d.data.payment;
    topupPesanan = {
      kode: pay.order_code,
      token: pay.access_token,
      expires_at: pay.expires_at,
      amount: pay.amount_to_pay,
      base_amount: pay.base_amount,
      unique_code: pay.unique_code,
      label: paketTopupDipilih.label,
      qr: pay.qr_image,
    };
    simpanTopupLokal();
    tampilTopupBayar(pay.qr_image);
  } catch (err) {
    $("topup-msg").innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
});

/* ---------- Tampilan pembayaran ---------- */
function tampilTopupBayar(qrImage) {
  $("topup-card-form").classList.add("hidden");
  $("topup-selesai").classList.add("hidden");
  $("topup-bayar").classList.remove("hidden");
  $("topup-bayar-msg").innerHTML = "";

  $("topup-kode").textContent = topupPesanan.kode;
  $("topup-amount").textContent = rupiah(topupPesanan.amount);
  $("topup-harga").textContent = rupiah(topupPesanan.base_amount);
  $("topup-kode-unik").textContent = "+" + num(topupPesanan.unique_code);
  $("topup-paket").textContent = (topupPesanan.label || "") + " token";
  $("topup-badge").textContent = "menunggu pembayaran";
  $("topup-badge").className = "tag warn";
  if (qrImage) {
    $("topup-qr").src = qrImage;
  }
  mulaiTopupCountdown();
  mulaiTopupPolling();
}

function mulaiTopupCountdown() {
  hentikanTopupCountdown();
  const perbarui = () => {
    if (!topupPesanan) return;
    const sisa = Math.max(0, topupPesanan.expires_at - Date.now());
    const m = Math.floor(sisa / 60000);
    const s = Math.floor((sisa % 60000) / 1000);
    $("topup-expired").textContent = `${m}mnt ${String(s).padStart(2, "0")}dtk`;
    if (sisa <= 0) {
      hentikanTopupCountdown();
      hentikanTopupPolling();
      $("topup-badge").textContent = "kedaluwarsa";
      $("topup-badge").className = "tag off";
      $("topup-bayar-msg").innerHTML =
        '<div class="alert warn">Tagihan kedaluwarsa. Silakan buat pesanan top-up baru bila masih ingin membeli.</div>' +
        '<div class="row-actions"><button class="btn primary" id="btn-topup-ulang" type="button">Buat Pesanan Baru</button></div>';
      const ulang = $("btn-topup-ulang");
      if (ulang) ulang.onclick = kembaliKeFormTopup;
      hapusTopupLokal();
    }
  };
  perbarui();
  topupCountdownTimer = setInterval(perbarui, 1000);
}

function hentikanTopupCountdown() {
  if (topupCountdownTimer) clearInterval(topupCountdownTimer);
  topupCountdownTimer = null;
}

function mulaiTopupPolling() {
  hentikanTopupPolling();
  topupPollTimer = setInterval(cekTopupStatus, 5000);
  cekTopupStatus();
}

function hentikanTopupPolling() {
  if (topupPollTimer) clearInterval(topupPollTimer);
  topupPollTimer = null;
}

async function cekTopupStatus() {
  if (topupPolling || !topupPesanan) return;
  topupPolling = true;
  try {
    const r = await fetch(`/store/order/${encodeURIComponent(topupPesanan.kode)}?t=${encodeURIComponent(topupPesanan.token)}`);
    const d = await r.json();
    const o = d.data || {};
    if (o.status === "PENDING" && o.qr_image && !$("topup-qr").src) $("topup-qr").src = o.qr_image;
    if (o.status === "PAID") {
      $("topup-badge").textContent = "dibayar — menambahkan kuota…";
      $("topup-badge").className = "tag ok";
    }
    if (o.status === "CANCELLED") {
      hentikanTopupPolling();
      hentikanTopupCountdown();
      $("topup-badge").textContent = "dibatalkan";
      $("topup-badge").className = "tag off";
      $("topup-bayar-msg").innerHTML =
        '<div class="alert warn">Pesanan dibatalkan / kedaluwarsa.</div>' +
        '<div class="row-actions"><button class="btn primary" id="btn-topup-ulang2" type="button">Buat Pesanan Baru</button></div>';
      const ulang = $("btn-topup-ulang2");
      if (ulang) ulang.onclick = kembaliKeFormTopup;
      hapusTopupLokal();
    }
    if (o.status === "COMPLETED") {
      hentikanTopupPolling();
      hentikanTopupCountdown();
      hapusTopupLokal();
      tampilTopupSelesai(o);
      boot(); // segarkan kuota, masa aktif & peringatan di dashboard
      muatRiwayatTopup();
      muatPesanan();
    }
  } catch {
    /* jaringan gagal sesaat → coba lagi di tick berikutnya */
  } finally {
    topupPolling = false;
  }
}

function kembaliKeFormTopup() {
  topupPesanan = null;
  $("topup-bayar").classList.add("hidden");
  $("topup-selesai").classList.add("hidden");
  $("topup-card-form").classList.remove("hidden");
  $("topup-msg").innerHTML = "";
}

function tampilTopupSelesai(o) {
  $("topup-bayar").classList.add("hidden");
  $("topup-card-form").classList.add("hidden");
  $("topup-selesai").classList.remove("hidden");
  $("topup-selesai").innerHTML = `
    <h1>
      <svg class="ico" style="width:30px;height:30px;color:var(--lime)" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
      <span>Top-up <span class="grad">Berhasil!</span></span>
    </h1>
    <span class="eyebrow">pesanan ${esc(o.order_code)} · +${num(o.quota_tokens)} token</span>
    <p class="sub">Kuota sudah ditambahkan ke key Anda dan masa aktif diperpanjang 25 hari. Dashboard ini sudah diperbarui otomatis.</p>
    <div class="kv">
      <div class="kv-row"><span>Masa aktif berakhir</span><b>${esc(o.masa_aktif_sampai || "—")}</b></div>
      <div class="kv-row"><span>Base URL</span><b class="mono">${esc(location.origin)}/v1</b></div>
      <div class="kv-row"><span>Struk</span><b>dikirim ke email/WA bila diisi</b></div>
    </div>
    <div class="row-actions">
      <a class="btn primary" href="#" onclick="navigasiTab('integrasi');return false;">Lihat Kredensial</a>
      <button class="btn" id="btn-topup-lagi" type="button">Top Up Lagi</button>
    </div>`;
  const lagi = $("btn-topup-lagi");
  if (lagi) lagi.onclick = kembaliKeFormTopup;
}

/* ---------- Batalkan pesanan ---------- */
$("btn-topup-batal").onclick = async () => {
  if (!topupPesanan) return;
  try {
    const r = await fetch(`/store/order/${encodeURIComponent(topupPesanan.kode)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ access_token: topupPesanan.token }),
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error?.message || "Gagal membatalkan pesanan.");
    }
    hentikanTopupPolling();
    hentikanTopupCountdown();
    hapusTopupLokal();
    kembaliKeFormTopup();
    $("topup-msg").innerHTML = '<div class="alert warn">Pesanan top-up dibatalkan.</div>';
  } catch (err) {
    $("topup-bayar-msg").innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
};

$("btn-topup-salin").onclick = async () => {
  if (!topupPesanan) return;
  await navigator.clipboard.writeText(String(topupPesanan.amount));
  $("btn-topup-salin").textContent = "✓ Tersalin";
  setTimeout(() => ($("btn-topup-salin").textContent = "Salin Nominal"), 1200);
};

/* ---------- Riwayat transaksi member ---------- */
async function muatRiwayatTopup() {
  if (!DATA_ME) return;
  const tb = $("topup-riwayat");
  try {
    const r = await fetch("/portal/member/orders", { credentials: "same-origin" });
    if (!r.ok) throw new Error();
    const rows = (await r.json()).data.orders || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="6" class="muted">Belum ada transaksi tercatat.</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map((o) => {
        const cls = o.status === "COMPLETED" ? "ok" : o.status === "PENDING" ? "warn" : o.status === "PAID" ? "info" : "off";
        const jenis = o.mode === "key_baru" ? "Key baru" : "Top-up";
        return `<tr class="row-lacak" data-code="${esc(o.order_code)}" title="Klik untuk melacak pesanan ini">
          <td class="mono muted">${esc(o.order_code)}</td>
          <td>${jenis}</td>
          <td>${num(o.quota_tokens)} token</td>
          <td class="num">${rupiah(o.amount_to_pay)}</td>
          <td><span class="tag ${cls}">${esc(o.status_label || o.status)}</span></td>
          <td class="mono muted">${esc(o.created_at)}</td>
        </tr>`;
      })
      .join("");
  } catch {
    tb.innerHTML = '<tr><td colspan="6" class="muted">Gagal memuat riwayat transaksi.</td></tr>';
  }
}

/* ---------- Pesanan top-up tertunda (localStorage) ---------- */
function simpanTopupLokal() {
  try {
    localStorage.setItem(KUNCI_TOPUP, JSON.stringify(topupPesanan));
  } catch { /* localStorage nonaktif */ }
}

function bacaTopupLokal() {
  try {
    const raw = localStorage.getItem(KUNCI_TOPUP);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hapusTopupLokal() {
  try {
    localStorage.removeItem(KUNCI_TOPUP);
  } catch { /* abaikan */ }
}

/** Ada pesanan top-up yang belum selesai saat halaman dimuat? Lanjutkan. */
function lanjutkanTopupTersimpan() {
  const lama = bacaTopupLokal();
  if (!lama || !lama.kode || !lama.token) return;
  if (!lama.expires_at || lama.expires_at <= Date.now()) {
    hapusTopupLokal();
    return;
  }
  topupPesanan = lama;
  tampilTopupBayar(lama.qr || "");
}

// ============================================================
// TAB PESANAN SAYA — pelacakan pesanan ala marketplace besar
// Daftar kartu pesanan + chip statistik + filter status + pencarian
// kode, dan modal detail: stepper 4 langkah, info pesanan/pembayaran,
// linimasa, QR lanjutan bayar, dan pembatalan mandiri.
// ============================================================
let pesananFilter = { status: "", q: "" };
let cariTimer = null;
let lacakKode = null; // kode pesanan yang sedang dibuka di modal
let lacakDetail = null; // detail terakhir (untuk countdown)
let lacakPollTimer = null;
let lacakPolling = false;
let lacakCountdownTimer = null;
let lacakTampilQr = false; // area QR sudah dibuka?

/** Konversi waktu SQLite UTC → "3 Des, 14.05" (WIB). */
function formatWaktu(sql) {
  if (!sql) return "";
  const ms = Date.parse(String(sql).replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return String(sql);
  return new Date(ms).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/** Kelas warna badge per status pesanan. */
function kelasBadge(status) {
  return status === "COMPLETED" ? "ok" : status === "PENDING" ? "warn" : status === "PAID" ? "info" : "off";
}

/* ---------- Daftar pesanan (tab Pesanan Saya) ---------- */
async function muatPesanan() {
  if (!DATA_ME) return;
  const list = $("order-list");
  if (!list) return;
  const params = new URLSearchParams();
  if (pesananFilter.status) params.set("status", pesananFilter.status);
  if (pesananFilter.q) params.set("q", pesananFilter.q);
  try {
    const r = await fetch("/portal/member/orders?" + params.toString(), { credentials: "same-origin" });
    if (r.status === 401) return showLogin();
    if (!r.ok) throw new Error();
    const d = (await r.json()).data;
    renderStatsPesanan(d.stats);
    renderDaftarPesanan(d.orders || []);
  } catch {
    list.innerHTML = '<div class="alert err">Gagal memuat daftar pesanan. Klik Segarkan untuk mencoba lagi.</div>';
  }
}

function renderStatsPesanan(s) {
  const box = $("order-stats");
  if (!box) return;
  if (!s) { box.innerHTML = ""; return; }
  const chip = (label, n, cls) =>
    `<div class="ostat ${cls || ""}"><b>${num(n)}</b><span>${label}</span></div>`;
  box.innerHTML =
    chip("Semua", s.total) +
    chip("Menunggu Bayar", s.pending, "warn") +
    chip("Diproses", s.paid, "info") +
    chip("Selesai", s.completed, "ok") +
    chip("Batal", s.cancelled, "off");
}

function renderDaftarPesanan(rows) {
  const list = $("order-list");
  if (!rows.length) {
    list.innerHTML = `
      <div class="order-empty">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>
        <b>Tidak ada pesanan${pesananFilter.status || pesananFilter.q ? " pada filter ini" : " tercatat"}</b>
        <p>Pembelian key &amp; top-up Anda akan muncul di sini beserta status pelacakannya.</p>
        <button class="btn primary small" id="btn-pesanan-topup" type="button">Top Up Sekarang</button>
      </div>`;
    const b = $("btn-pesanan-topup");
    if (b) b.onclick = bukaTopup;
    return;
  }
  list.innerHTML = rows
    .map((o) => {
      const aksi = o.can_pay
        ? `<button class="btn small primary" data-bayar="${esc(o.order_code)}" type="button">Bayar Sekarang</button>`
        : "";
      const keterangan =
        o.status === "PENDING" && o.can_pay
          ? "menunggu pembayaran QRIS"
          : o.status === "PAID"
            ? "dibayar — sedang diproses otomatis"
            : o.status === "COMPLETED"
              ? `selesai${o.completed_at ? " " + formatWaktu(o.completed_at) : ""}`
              : o.note || "dibatalkan";
      return `<article class="order-card" data-code="${esc(o.order_code)}">
        <div class="oc-head">
          <span class="oc-kode mono">${esc(o.order_code)}</span>
          <span class="tag ${kelasBadge(o.status)}">${esc(o.status_label)}</span>
        </div>
        <div class="oc-body">
          <div class="oc-prod">
            <b>${esc(o.mode_label)} · ${esc(o.package_label)} token</b>
            <small class="muted">${num(o.quota_tokens)} token · ${esc(keterangan)}</small>
          </div>
          <div class="oc-amount mono">${rupiah(o.amount_to_pay)}</div>
        </div>
        <div class="oc-foot">
          <span class="oc-hint">klik kartu untuk melacak →</span>
          <div class="oc-aksi"><button class="btn small" data-lacak="${esc(o.order_code)}" type="button">Lacak</button>${aksi}</div>
        </div>
      </article>`;
    })
    .join("");
}

// Klik kartu / tombol "Lacak" → buka modal pelacakan; tombol "Bayar Sekarang" → langsung tampil QR.
// Kartu sendiri TIDAK diberi role/aria-label palsu (axe: nested-interactive &
// label-content-name-mismatch) — keyboard memakai tombol "Lacak" yang nyata.
$("order-list").addEventListener("click", (e) => {
  const card = e.target.closest(".order-card");
  if (!card) return;
  const bayar = e.target.closest("[data-bayar]");
  bukaLacak(card.dataset.code, { langsungBayar: !!bayar });
});

// Filter status (pill) + pencarian kode
$("order-pills").addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#order-pills .pill").forEach((p) => p.classList.toggle("active", p === pill));
  pesananFilter.status = pill.dataset.status || "";
  sinkronFilterPesananUrl(); // URL ikut: /portal/pesanan?status=PAID
  muatPesanan();
});
$("order-cari").addEventListener("input", () => {
  clearTimeout(cariTimer);
  cariTimer = setTimeout(() => {
    pesananFilter.q = $("order-cari").value.trim();
    sinkronFilterPesananUrl(); // URL ikut: /portal/pesanan?q=THX-
    muatPesanan();
  }, 300);
});

// Baris riwayat transaksi (tab Top Up) juga bisa diklik → modal pelacakan
$("topup-riwayat").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-code]");
  if (!tr) return;
  bukaLacak(tr.dataset.code);
});

/* ---------- Modal pelacakan ---------- */
async function bukaLacak(code, opts = {}) {
  lacakKode = String(code || "").toUpperCase();
  lacakTampilQr = false;
  lacakDetail = null;
  $("trk-judul").textContent = "Lacak Pesanan " + lacakKode;
  $("trk-msg").innerHTML = "";
  $("trk-isi").innerHTML = '<div class="loading-box"><span class="spinner sm"></span> memuat detail pesanan…</div>';
  $("modal-lacak").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  hentikanLacakPolling();
  hentikanLacakCountdown();
  await segarkanLacak(opts);
}

function tutupLacak() {
  lacakKode = null;
  lacakDetail = null;
  lacakTampilQr = false;
  hentikanLacakPolling();
  hentikanLacakCountdown();
  const modal = $("modal-lacak");
  if (modal) {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
}

$("trk-tutup").onclick = tutupLacak;
$("modal-lacak").addEventListener("click", (e) => {
  if (e.target === $("modal-lacak")) tutupLacak();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modal-lacak").classList.contains("hidden")) tutupLacak();
});

/** Ambil detail terbaru dari server lalu render ulang modal. */
async function segarkanLacak(opts = {}) {
  if (!lacakKode) return;
  try {
    const r = await fetch("/portal/member/orders/" + encodeURIComponent(lacakKode), { credentials: "same-origin" });
    if (r.status === 401) return showLogin();
    if (!r.ok) throw new Error();
    const d = (await r.json()).data;
    lacakDetail = d;
    renderLacak(d);
    if (opts.langsungBayar && d.can_pay) tampilQrLacak();
  } catch {
    $("trk-isi").innerHTML = '<div class="alert err">Gagal memuat detail pesanan. Tutup modal lalu buka lagi.</div>';
  }
}

function renderLacak(d) {
  const o = d.order;

  // Stepper 4 langkah ala marketplace
  const langkah = d.steps
    .map((s, i) => {
      const ikon = s.state === "done" ? "✓" : s.state === "failed" ? "✕" : String(i + 1);
      const waktu = s.at ? formatWaktu(s.at) : "";
      return `<div class="trk-step ${s.state}">
        <span class="trk-dot">${ikon}</span>
        <b>${esc(s.label)}</b>
        <small>${waktu ? esc(waktu) : "&nbsp;"}</small>
      </div>`;
    })
    .join("");

  const kvPesanan = `
    <div class="kv">
      <div class="kv-row"><span>Kode Pesanan</span><b class="mono">${esc(o.order_code)}</b></div>
      <div class="kv-row"><span>Jenis</span><b>${esc(o.mode_label)}</b></div>
      <div class="kv-row"><span>Paket</span><b>${esc(o.package_label)} · ${num(o.quota_tokens)} token</b></div>
      <div class="kv-row"><span>Dibuat</span><b>${esc(formatWaktu(o.created_at))}</b></div>
      ${o.api_key_terkait ? `<div class="kv-row"><span>Key terkait</span><b class="mono">${esc(o.api_key_terkait.slice(0, 18))}…</b></div>` : ""}
    </div>`;

  const barisBayar = [
    `<div class="kv-row"><span>Metode</span><b>${esc(o.payment_method)}</b></div>`,
    `<div class="kv-row"><span>Harga paket</span><b>${rupiah(o.base_amount)}</b></div>`,
    `<div class="kv-row"><span>Kode unik pesanan</span><b>+${num(o.unique_code)}</b></div>`,
    `<div class="kv-row"><span>Total tagihan</span><b class="ok">${rupiah(o.amount_to_pay)}</b></div>`,
  ];
  if (o.paid_at) barisBayar.push(`<div class="kv-row"><span>Dibayar pada</span><b>${esc(formatWaktu(o.paid_at))}</b></div>`);
  if (o.completed_at) barisBayar.push(`<div class="kv-row"><span>Selesai pada</span><b>${esc(formatWaktu(o.completed_at))}</b></div>`);
  if (o.status === "PENDING") barisBayar.push(`<div class="kv-row"><span>Bayar sebelum</span><b id="trk-countdown">—</b></div>`);
  const kvBayar = `<div class="kv">${barisBayar.join("")}</div>`;

  // Kartu sukses ala marketplace (bila pesanan selesai)
  const sukses =
    o.status === "COMPLETED"
      ? `<div class="box-info">
          ${o.mode === "topup"
            ? `Kuota <b>+${num(o.quota_tokens)} token</b> sudah masuk ke key Anda${d.masa_aktif_sampai ? ` — masa aktif diperpanjang s.d. <b>${esc(d.masa_aktif_sampai)}</b>` : ""}.`
            : `API Key baru sudah diterbitkan &amp; aktif${d.masa_aktif_sampai ? ` — masa aktif s.d. <b>${esc(d.masa_aktif_sampai)}</b>` : ""}.`}
        </div>`
      : "";

  // Area QR lanjutan bayar (muncul bila tombol "Bayar Sekarang" ditekan)
  const qrArea = d.can_pay
    ? `<div id="trk-qr-wrap" class="${lacakTampilQr ? "" : "hidden"}" style="margin-bottom:6px">
        ${d.qr_image
          ? `<div class="qr-frame"><img src="${d.qr_image}" alt="QRIS pembayaran" /></div>
             <p class="qr-caption">Scan dengan <b>DANA</b>, GoPay, OVO, ShopeePay, atau m-banking apa pun — nominal harus <b>PERSIS ${rupiah(o.amount_to_pay)}</b></p>`
          : `<div class="alert warn">QR tidak dapat ditampilkan saat ini (QRIS toko belum aktif). Hubungi admin atau bayar manual dengan kode unik +${num(o.unique_code)}.</div>`}
      </div>`
    : "";

  const timeline = d.timeline.length
    ? `<h3 class="trk-sub">Linimasa Pesanan</h3>
       <div class="timeline">${d.timeline
         .map(
           (ev) => `
        <div class="tl-item">
          <span class="tl-dot ${esc(ev.type)}"></span>
          <div class="tl-head"><b>${esc(ev.label)}</b><span class="tag plain">${esc(ev.actor)}</span><span class="muted mono" style="font-size:11px">${esc(formatWaktu(ev.created_at))}</span></div>
          ${ev.detail ? `<div class="tl-detail">${esc(ev.detail)}</div>` : ""}
        </div>`
         )
         .join("")}</div>`
    : "";

  // Aksi sesuai status
  const aksi = [];
  if (d.can_pay && !lacakTampilQr) aksi.push(`<button class="btn primary" id="trk-bayar" type="button">Bayar Sekarang</button>`);
  if (d.can_cancel) aksi.push(`<button class="btn danger" id="trk-batal" type="button">Batalkan Pesanan</button>`);
  if (o.status === "COMPLETED") aksi.push(`<button class="btn" id="trk-refresh" type="button">Segarkan Dashboard</button>`);
  if (o.status === "CANCELLED") aksi.push(`<button class="btn primary" id="trk-ulang" type="button">Buat Pesanan Baru</button>`);

  $("trk-isi").innerHTML = `
    <div class="trk-status">
      <span class="tag ${kelasBadge(o.status)}" style="font-size:12px">${esc(o.status_label)}</span>
      ${o.note && o.status === "CANCELLED" ? `<span class="muted" style="font-size:12.5px">${esc(o.note)}</span>` : ""}
    </div>
    <div class="trk-steps">${langkah}</div>
    ${sukses}
    ${qrArea}
    <h3 class="trk-sub">Info Pesanan</h3>
    ${kvPesanan}
    <h3 class="trk-sub">Pembayaran</h3>
    ${kvBayar}
    ${timeline}
    ${aksi.length ? `<div class="row-actions">${aksi.join("")}</div>` : ""}`;

  const bayar = $("trk-bayar");
  if (bayar) bayar.onclick = tampilQrLacak;
  const batal = $("trk-batal");
  if (batal) batal.onclick = batalkanLacak;
  const segar = $("trk-refresh");
  if (segar) segar.onclick = async () => { await boot(); tutupLacak(); };
  const ulang = $("trk-ulang");
  if (ulang) ulang.onclick = () => { tutupLacak(); bukaTopup(); };

  if (o.status === "PENDING") {
    mulaiLacakCountdown();
    mulaiLacakPolling();
  } else {
    hentikanLacakCountdown();
    hentikanLacakPolling();
  }
}

/** Tampilkan area QR di modal (pesanan masih bisa dibayar). */
function tampilQrLacak() {
  lacakTampilQr = true;
  const wrap = $("trk-qr-wrap");
  if (wrap) wrap.classList.remove("hidden");
  const bayar = $("trk-bayar");
  if (bayar) bayar.remove(); // tombol tak perlu lagi
}

/* ---------- Countdown & polling status di modal ---------- */
function mulaiLacakCountdown() {
  hentikanLacakCountdown();
  const perbarui = () => {
    const el = $("trk-countdown");
    if (!el || !lacakDetail) return;
    const sisa = Math.max(0, lacakDetail.order.expires_at - Date.now());
    const m = Math.floor(sisa / 60000);
    const s = Math.floor((sisa % 60000) / 1000);
    el.textContent = `${m}mnt ${String(s).padStart(2, "0")}dtk`;
    if (sisa <= 0) {
      hentikanLacakCountdown();
      hentikanLacakPolling();
      segarkanLacak(); // kedaluwarsa → server menandai CANCELLED, modal ikut terbarui
    }
  };
  perbarui();
  lacakCountdownTimer = setInterval(perbarui, 1000);
}

function hentikanLacakCountdown() {
  if (lacakCountdownTimer) { clearInterval(lacakCountdownTimer); lacakCountdownTimer = null; }
}

function mulaiLacakPolling() {
  hentikanLacakPolling();
  lacakPollTimer = setInterval(async () => {
    if (lacakPolling || !lacakKode) return;
    lacakPolling = true;
    try {
      const r = await fetch("/portal/member/orders/" + encodeURIComponent(lacakKode), { credentials: "same-origin" });
      if (!r.ok) return;
      const d = (await r.json()).data;
      const sebelum = lacakDetail ? lacakDetail.order.status : null;
      lacakDetail = d;
      if (d.order.status !== sebelum) {
        renderLacak(d);
        muatPesanan();
        muatRiwayatTopup();
        if (d.order.status === "COMPLETED") {
          boot(); // kuota & masa aktif baru langsung tampil di dashboard
          $("trk-msg").innerHTML = '<div class="alert ok">Pembayaran diterima — pesanan selesai! Dashboard sudah diperbarui otomatis.</div>';
        }
      }
    } catch {
      /* jaringan gagal sesaat → coba lagi di tick berikutnya */
    } finally {
      lacakPolling = false;
    }
  }, 5000);
}

function hentikanLacakPolling() {
  if (lacakPollTimer) { clearInterval(lacakPollTimer); lacakPollTimer = null; }
}

/** Batalkan pesanan milik sendiri dari modal (hanya Menunggu Bayar). */
async function batalkanLacak() {
  if (!lacakKode) return;
  try {
    const r = await fetch(`/portal/member/orders/${encodeURIComponent(lacakKode)}/cancel`, {
      method: "POST",
      credentials: "same-origin",
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "Gagal membatalkan pesanan.");
    hentikanLacakPolling();
    hentikanLacakCountdown();
    $("trk-msg").innerHTML = '<div class="alert warn">Pesanan dibatalkan. Kode unik dilepas & bisa dipakai pesanan baru.</div>';
    await segarkanLacak();
    muatPesanan();
    muatRiwayatTopup();
  } catch (err) {
    $("trk-msg").innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
  }
}

// Tangkap error boot() agar tidak menjadi "unhandled promise rejection".
boot().catch(() => showLogin());
