/**
 * docs.js — Halaman dokumentasi (vanilla JS).
 * Model diambil live dari /portal/models (server yang menyimpan key provider).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BASE = location.origin;
let MODELS = [];

function renderExamples() {
  const m = "auto";
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
  const list = MODELS.filter((m) => !f || m.id.toLowerCase().includes(f));
  if (!list.length) {
    $("models-wrap").innerHTML = `<p class="muted">Tidak ada model yang cocok.</p>`;
    return;
  }
  const rows = list.map((m) => `<tr>
    <td class="mono">${esc(m.id)}</td>
    <td>${m.vision ? '<span class="tag ok">👁 Vision</span>' : '<span class="muted">teks</span>'}</td>
    <td><button class="btn small" data-model="${esc(m.id)}">Pakai</button></td>
  </tr>`).join("");
  $("models-wrap").innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Model ID</th><th>Kemampuan</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function loadModels() {
  $("models-meta").textContent = "Memuat…";
  try {
    const r = await fetch("/portal/models");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "gagal");
    MODELS = d.data || [];
    const visionCount = MODELS.filter((m) => m.vision).length;
    $("models-meta").innerHTML = `<b>${MODELS.length}</b> model tersedia` +
      (d.cached ? " <span class='muted'>(cache)</span>" : "") +
      ` · ${visionCount} dengan vision`;
    renderModels($("search").value);
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
