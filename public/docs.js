/**
 * docs.js — Halaman dokumentasi (vanilla JS).
 * Model diambil live dari /portal/models (server yang menyimpan key provider).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BASE = location.origin;
let MODELS = [];
let DEFAULT_MODEL = "deepseek-v4-pro";

function renderExamples() {
  const m = DEFAULT_MODEL;
  const key = "sk-thor-XXXX (Sub-API Key Anda)";
  $("base-url").textContent = `${BASE}/v1`;

  $("ex-curl").textContent =
`curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${m}",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'`;

  $("ex-python").textContent =
`from openai import OpenAI

client = OpenAI(
    api_key="${key}",
    base_url="${BASE}/v1",
)

resp = client.chat.completions.create(
    model="${m}",
    messages=[{"role": "user", "content": "Halo!"}],
)
print(resp.choices[0].message.content)`;

  $("ex-stream").textContent =
`curl ${BASE}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${m}",
    "messages": [{"role": "user", "content": "Cerita singkat"}],
    "stream": true
  }'`;

  $("ex-models").textContent =
`curl ${BASE}/v1/models \\
  -H "Authorization: Bearer ${key}"`;
}

function renderModels(filter = "") {
  const f = filter.trim().toLowerCase();
  const list = MODELS.filter((m) => !f || m.id.toLowerCase().includes(f) || (m.vendor || "").toLowerCase().includes(f));
  if (!list.length) {
    $("models-wrap").innerHTML = `<p class="muted">Tidak ada model yang cocok.</p>`;
    return;
  }
  const rows = list.map((m) => {
    // Kemampuan: hanya badge vision (status dipisah ke kolom sendiri di kanan)
    const caps = m.vision
      ? '<span class="tag ok">👁 Vision</span>'
      : '<span class="muted">teks</span>';
    // Status: kolom paling kanan sebelum tombol aksi
    const status = m.active
      ? '<span class="tag ok">● Aktif</span>'
      : '<span class="tag off">○ Nonaktif</span>';
    return `<tr${m.active ? "" : ' class="row-off"'}>
    <td class="mono">${esc(m.id)}</td>
    <td>${esc(m.vendor || "-")}</td>
    <td>${caps}</td>
    <td class="num">${m.multiplier != null ? esc(m.multiplier) + "×" : "-"}</td>
    <td>${status}</td>
    <td class="col-action"><button class="btn small" data-model="${esc(m.id)}">Pakai</button></td>
  </tr>`;
  }).join("");
  $("models-wrap").innerHTML = `<div class="table-scroll"><table class="models-table">
    <thead><tr>
      <th>Model ID</th>
      <th>Vendor</th>
      <th>Kemampuan</th>
      <th class="num">Multiplier</th>
      <th class="col-status">Status</th>
      <th class="col-action"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function loadModels() {
  $("models-meta").textContent = "Memuat…";
  try {
    const r = await fetch("/portal/models?all=1");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "gagal");
    MODELS = d.data || [];
    if (d.meta && d.meta.default_model) DEFAULT_MODEL = d.meta.default_model;
    const total = d.meta ? d.meta.total : MODELS.length;
    const active = d.meta ? d.meta.active : MODELS.filter((m) => m.active).length;
    const visionCount = MODELS.filter((m) => m.vision && m.active).length;
    $("models-meta").innerHTML = `<b>${active}</b> model aktif dari <b>${total}</b>` +
      (d.cached ? " <span class='muted'>(cache)</span>" : "") +
      (d.stale ? " <span class='muted'>(snapshot lokal)</span>" : "") +
      ` · ${visionCount} aktif dengan vision`;
    renderModels($("search").value);
    renderExamples();
  } catch (e) {
    $("models-meta").innerHTML = `<span style="color:#ff9c9c">Gagal memuat: ${esc(e.message)}</span>`;
    $("models-wrap").innerHTML = "";
  }
}

// Geser ke contoh + isi model yang dipilih
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-model]");
  if (btn) {
    const model = btn.dataset.model;
    ["ex-curl", "ex-python", "ex-stream"].forEach((id) => {
      $(id).textContent = $(id).textContent.replace(/"model": "[^"]*"/, `"model": "${model}"`).replace(/model="[^"]*"/, `model="${model}"`);
    });
    navigator.clipboard.writeText(model);
    btn.textContent = "✓ tersalin";
    setTimeout(() => (btn.textContent = "Pakai"), 1200);
  }
  const cp = e.target.closest("button[data-copy]");
  if (cp) {
    navigator.clipboard.writeText($(cp.dataset.copy).textContent);
    const t = cp.textContent;
    cp.textContent = "✓ Tersalin";
    setTimeout(() => (cp.textContent = t), 1200);
  }
});

$("search").addEventListener("input", (e) => renderModels(e.target.value));
$("btn-refresh").onclick = loadModels;

renderExamples();
loadModels();
