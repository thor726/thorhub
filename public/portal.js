/**
 * portal.js — Dashboard member (vanilla JS, tanpa build step).
 * Sumber data: GET /portal/member/me (cookie sesi).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n || 0).toLocaleString("id-ID");
const esc2 = (s) => String(s ?? "");

function showLogin() {
  $("loading").classList.add("hidden");
  $("panel").classList.add("hidden");
  $("login-section").classList.remove("hidden");
  $("btn-logout").classList.add("hidden");
  const f = $("apikey");
  if (f) f.focus();
}

async function boot() {
  let d;
  try {
    const r = await fetch("/portal/member/me", { credentials: "same-origin" });
    if (r.status === 401) return showLogin();
    d = (await r.json()).data;
  } catch {
    return showLogin();
  }

  $("loading").classList.add("hidden");
  $("login-section").classList.add("hidden");
  $("panel").classList.remove("hidden");
  $("btn-logout").classList.remove("hidden");
  $("uname").textContent = d.user_name;

  const pct = d.token_limit > 0 ? Math.round((d.tokens_used / d.token_limit) * 100) : 0;

  // Peringatan status
  if (!d.is_active) {
    $("status-warn").innerHTML = `<div class="alert err">⛔ Key Anda sedang dinonaktifkan. Akses chat diblokir. Hubungi admin.</div>`;
  } else if (d.tokens_remaining <= 0) {
    $("status-warn").innerHTML = `<div class="alert err">⚠️ Kuota token Anda habis. Silakan top-up agar bisa memakai API kembali.</div>`;
  } else if (pct >= 80) {
    $("status-warn").innerHTML = `<div class="alert err">⚠️ Kuota terpakai ${pct}%. Segera top-up sebelum habis.</div>`;
  }

  $("cards").innerHTML = `
    <div class="stat"><div class="k">Sisa Kuota</div><div class="v">${num(d.tokens_remaining)}</div></div>
    <div class="stat"><div class="k">Terpakai</div><div class="v">${num(d.tokens_used)}</div></div>
    <div class="stat"><div class="k">Total Limit</div><div class="v">${num(d.token_limit)}</div></div>
    <div class="stat"><div class="k">Pemakaian</div><div class="v">${pct}%</div></div>
    <div class="stat"><div class="k">Status</div><div class="v" style="font-size:18px">${d.is_active ? "✅ Aktif" : "⛔ Nonaktif"}</div></div>
    <div class="stat"><div class="k">Terdaftar</div><div class="v" style="font-size:15px">${esc(d.created_at)}</div></div>`;

  // Key + contoh
  const base = location.origin;
  $("mykey").textContent = "•".repeat(40);
  $("mykey").dataset.full = d.api_key;
  $("curl-example").textContent =
`curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer ${d.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Halo"}]}'`;
  $("py-example").textContent =
`from openai import OpenAI

client = OpenAI(
    api_key="${d.api_key}",
    base_url="${base}/v1",
)

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Halo"}],
)
print(resp.choices[0].message.content)`;

  $("btn-reveal").onclick = () => {
    const el = $("mykey");
    el.textContent = el.dataset.full;
  };
  $("btn-copy").onclick = async () => {
    await navigator.clipboard.writeText(d.api_key);
    $("btn-copy").textContent = "✓ Tersalin";
    setTimeout(() => ($("btn-copy").textContent = "Salin"), 1200);
  };
}

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
    $("login-msg").innerHTML = `<div class="alert err">Gagal menghubungi server.</div>`;
  } finally {
    btn.disabled = false;
  }
});

boot();
