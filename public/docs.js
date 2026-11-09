/**
 * docs.js — Halaman dokumentasi (vanilla JS, tanpa build step).
 *
 * - Mengisi semua contoh kode dengan Base URL & model default yang benar.
 * - Mengelola sistem TAB agar halaman tidak berantakan.
 * - Memuat daftar model live dari /portal/models (server menyimpan key provider).
 */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BASE = location.origin;
const V1 = `${BASE}/v1`;
const KEY = "sk-thor-XXXXXXXX";
let MODELS = [];
let DEFAULT_MODEL = "deepseek-v4-pro";

// ==============================================================
// SISTEM TAB
// ==============================================================
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");
  if (!tabs.length) return;

  function activate(name, { scroll = true } = {}) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((p) => {
      p.classList.toggle("active", p.id === `panel-${name}`);
    });
    if (scroll) {
      const el = $(`panel-${name}`);
      if (el) window.scrollTo({ top: el.offsetTop - 90, behavior: "smooth" });
    }
    // Simpan pilihan; juga dukung deep-link ?tab=sdk
    try { history.replaceState(null, "", `?tab=${name}`);
      // Simpan di sessionStorage agar tetap saat refresh
      sessionStorage.setItem("docs-tab", name);
    } catch { /* abaikan (mode privasi) */ }
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => activate(t.dataset.tab));
    // Navigasi keyboard antar tab (panah kiri/kanan)
    t.addEventListener("keydown", (e) => {
      const list = [...tabs];
      const i = list.indexOf(t);
      if (e.key === "ArrowRight") list[(i + 1) % list.length].focus();
      if (e.key === "ArrowLeft") list[(i - 1 + list.length) % list.length].focus();
    });
  });

  // Tentukan tab awal: dari URL → sessionStorage → default "mulai"
  // Catatan: daftar model TIDAK lagi jadi tab (selalu tampil di atas).
  const fromUrl = new URLSearchParams(location.search).get("tab");
  const saved = sessionStorage.getItem("docs-tab");
  const valid = [...tabs].map((t) => t.dataset.tab);
  const start = [fromUrl, saved, "mulai"].find((n) => n && valid.includes(n)) || "mulai";
  activate(start, { scroll: false });
}

// ==============================================================
// CONTOH KODE
// ==============================================================
function renderExamples() {
  const m = DEFAULT_MODEL;
  const m2 = "kimi-k2.7-code"; // contoh model hemat untuk coding

  $("base-url").textContent = V1;
  if ($("base-url-2")) $("base-url-2").textContent = V1;
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  // --- Terminal / cURL ---
  set("ex-curl",
`curl ${V1}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${m}",
    "messages": [{"role": "user", "content": "Halo, apa kabar?"}]
  }'`);

  // --- PowerShell ---
  set("ex-powershell",
`$headers = @{
  "Authorization" = "Bearer ${KEY}"
  "Content-Type"  = "application/json"
}

$body = @{
  model    = "${m}"
  messages = @(@{ role = "user"; content = "Halo, apa kabar?" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "${V1}/chat/completions" \`
  -Method Post -Headers $headers -Body $body`);

  // --- Streaming ---
  set("ex-stream",
`curl -N ${V1}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${m}",
    "messages": [{"role": "user", "content": "Cerita singkat tentang laut"}],
    "stream": true
  }'`);

  // --- Daftar model ---
  set("ex-models",
`curl ${V1}/models \\
  -H "Authorization: Bearer ${KEY}"`);

  // --- Python ---
  set("ex-python",
`from openai import OpenAI

client = OpenAI(
    api_key="${KEY}",
    base_url="${V1}",
)

resp = client.chat.completions.create(
    model="${m}",
    messages=[{"role": "user", "content": "Halo!"}],
)
print(resp.choices[0].message.content)`);

  // --- Node.js ---
  set("ex-node",
`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${KEY}",
  baseURL: "${V1}",
});

const resp = await client.chat.completions.create({
  model: "${m}",
  messages: [{ role: "user", content: "Halo!" }],
});

console.log(resp.choices[0].message.content);`);

  // --- LangChain ---
  set("ex-langchain",
`from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="${m}",
    api_key="${KEY}",
    base_url="${V1}",
)

print(llm.invoke("Halo!").content)`);

  // --- PHP ---
  set("ex-php",
`<?php
$ch = curl_init("${V1}/chat/completions");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${KEY}",
        "Content-Type: application/json",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "model"    => "${m}",
        "messages" => [["role" => "user", "content" => "Halo!"]],
    ]),
]);

$resp = json_decode(curl_exec($ch), true);
echo $resp["choices"][0]["message"]["content"];`);

  // --- Go ---
  set("ex-go",
`package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

func main() {
	body, _ := json.Marshal(map[string]any{
		"model":    "${m}",
		"messages": []map[string]string{{"role": "user", "content": "Halo!"}},
	})
	req, _ := http.NewRequest("POST", "${V1}/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer ${KEY}")
	req.Header.Set("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}`);

  // --- VS Code terminal ---
  set("ex-vscode-term",
`# Buka terminal VS Code: Ctrl + \`
curl ${V1}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${m2}","messages":[{"role":"user","content":"Tulis fungsi fizzbuzz di Python"}]}'`);

  // --- Hermes / agent framework ---
  set("ex-hermes",
`# .env — banyak framework agent membaca ketiga variabel ini otomatis
OPENAI_API_KEY=${KEY}
OPENAI_BASE_URL=${V1}
OPENAI_MODEL=${m}

# Atau di file config JSON (contoh bentuk umum):
# {
#   "provider": "openai-compatible",
#   "baseUrl": "${V1}",
#   "apiKey": "${KEY}",
#   "model": "${m}"
# }`);

  // --- Env Linux/macOS ---
  set("ex-env",
`# Tambahkan ke ~/.bashrc atau ~/.zshrc agar permanen
export OPENAI_API_KEY="${KEY}"
export OPENAI_BASE_URL="${V1}"
export OPENAI_MODEL="${m}"

# Uji:
curl $OPENAI_BASE_URL/models -H "Authorization: Bearer $OPENAI_API_KEY"`);

  // --- Env Windows ---
  set("ex-env-win",
`:: CMD — sekali pakai
set OPENAI_API_KEY=${KEY}
set OPENAI_BASE_URL=${V1}

:: PowerShell — sekali pakai
$env:OPENAI_API_KEY = "${KEY}"
$env:OPENAI_BASE_URL = "${V1}"

:: Permanen (CMD):
setx OPENAI_API_KEY "${KEY}"`);

  // --- Contoh respons ---
  set("ex-resp",
`{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "${m}",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Baik, terima kasih!" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20 }
}`);

  // --- Contoh error ---
  set("ex-err",
`{
  "error": {
    "message": "Kuota token Anda sudah habis (terpakai 1397 dari 1000). Silakan top up.",
    "type": "insufficient_quota",
    "code": "quota_exceeded"
  }
}`);

  // --- Kartu konfigurasi aplikasi ---
  ["cfg-base", "cfg-vscode", "cfg-owui", "cfg-chatbox"].forEach((id) => set(id, V1));
}

// ==============================================================
// DAFTAR MODEL
// ==============================================================
function renderModels(filter = "") {
  const f = filter.trim().toLowerCase();
  const list = MODELS.filter((m) =>
    !f || m.id.toLowerCase().includes(f) || (m.vendor || "").toLowerCase().includes(f)
  );
  if (!list.length) {
    $("models-wrap").innerHTML = `<p class="muted">Tidak ada model yang cocok.</p>`;
    return;
  }
  const rows = list.map((m) => {
    // Kemampuan: hanya badge vision (status dipisah ke kolom sendiri di kanan)
    const caps = m.vision
      ? '<span class="tag ok">vision</span>'
      : '<span class="tag plain">teks</span>';
    // Status: kolom di kanan sebelum tombol aksi
    const status = m.active
      ? '<span class="tag ok">aktif</span>'
      : '<span class="tag off">nonaktif</span>';
    return `<tr${m.active ? "" : ' class="row-off"'}>
    <td class="mono">${esc(m.id)}</td>
    <td>${esc(m.vendor || "-")}</td>
    <td>${caps}</td>
    <td class="num${m.active ? " on" : ""}">${m.multiplier != null ? esc(m.multiplier) + "×" : "-"}</td>
    <td>${status}</td>
    <td class="col-action"><button class="btn small" data-model="${esc(m.id)}">Pakai</button></td>
  </tr>`;
  }).join("");
  $("models-wrap").innerHTML = `<div class="table-scroll"><table class="models-table stagger-rows">
    <thead><tr>
      <th>Model ID</th>
      <th>Vendor</th>
      <th>Kemampuan</th>
      <th class="num">Multiplier</th>
      <th class="col-status">Status</th>
      <th class="col-action"><span class="sr-only">Aksi</span></th>
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
    if (d.meta && d.meta.default_model) {
      DEFAULT_MODEL = d.meta.default_model;
      renderExamples(); // pakai model default resmi
    }
    const total = d.meta ? d.meta.total : MODELS.length;
    const active = d.meta ? d.meta.active : MODELS.filter((m) => m.active).length;
    const visionCount = MODELS.filter((m) => m.vision && m.active).length;
    $("models-meta").innerHTML = `<b>${active}</b> model aktif dari <b>${total}</b>` +
      (d.cached ? " <span class='muted'>(cache)</span>" : "") +
      (d.stale ? " <span class='muted'>(snapshot)</span>" : "") +
      ` · ${visionCount} aktif dengan vision`;
    renderModels($("search").value);
  } catch (e) {
    $("models-meta").innerHTML = `<span style="color:#ff9c9c">Gagal memuat: ${esc(e.message)}</span>`;
    $("models-wrap").innerHTML = "";
  }
}

// ==============================================================
// EVENT GLOBAL (klik tombol salin & tombol "Pakai")
// ==============================================================
document.addEventListener("click", (e) => {
  // Tombol "Pakai" pada tabel model → isi semua contoh & salin ID
  const btn = e.target.closest("button[data-model]");
  if (btn) {
    const model = btn.dataset.model;
    document.querySelectorAll("pre").forEach((pre) => {
      pre.textContent = pre.textContent
        .replace(/"model":\s*"[^"]*"/g, `"model": "${model}"`)
        .replace(/model="[^"]*"/g, `model="${model}"`)
        .replace(/model\s*=\s*"[^"]*"/g, `model="${model}"`);
    });
    navigator.clipboard?.writeText(model).catch(() => {});
    btn.textContent = "✓ tersalin";
    setTimeout(() => (btn.textContent = "Pakai"), 1200);
  }

  // Tombol salin blok kode
  const cp = e.target.closest("button[data-copy]");
  if (cp) {
    const el = $(cp.dataset.copy);
    if (!el) return;
    navigator.clipboard?.writeText(el.textContent).catch(() => {});
    const t = cp.textContent;
    cp.textContent = "✓ Tersalin";
    setTimeout(() => (cp.textContent = t), 1200);
  }
});

// ==============================================================
// INISIALISASI
// ==============================================================
const search = $("search");
if (search) search.addEventListener("input", (e) => renderModels(e.target.value));
const refresh = $("btn-refresh");
if (refresh) refresh.onclick = loadModels;

initTabs();
renderExamples();
loadModels();
