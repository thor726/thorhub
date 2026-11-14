#!/usr/bin/env bash
# Buat project baru di apps/<nama> dengan struktur standar workspace.
# Pakai: npm run app:baru -- nama-project   (atau: bash scripts/app-baru.sh nama-project)
set -euo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMA="${1:-}"

if [ -z "$NAMA" ]; then
  echo "Pakai: npm run app:baru -- nama-project" >&2
  exit 1
fi

if ! printf '%s' "$NAMA" | grep -Eq '^[a-z][a-z0-9-]*$'; then
  echo "Nama tidak valid: '$NAMA'. Pakai huruf kecil, angka, dan tanda hubung (contoh: api-billing)." >&2
  exit 1
fi

TUJUAN="$AKAR/apps/$NAMA"
if [ -e "$TUJUAN" ]; then
  echo "Folder sudah ada: apps/$NAMA — tidak menimpa apa pun." >&2
  exit 1
fi

mkdir -p "$TUJUAN"/{src,test,public,data}

# ---------- package.json ----------
cat > "$TUJUAN/package.json" <<JSON
{
  "name": "$NAMA",
  "version": "0.1.0",
  "private": true,
  "description": "Project $NAMA",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node test/index.test.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "license": "MIT"
}
JSON

# ---------- src/index.js (server stdlib, langsung jalan tanpa dependensi) ----------
cat > "$TUJUAN/src/index.js" <<'JS'
const http = require("node:http");

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", app: process.env.npm_package_name || "app" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[app] siap di http://${HOST}:${PORT} (health: /health)`);
});
JS

# ---------- test/index.test.js ----------
cat > "$TUJUAN/test/index.test.js" <<'JS'
// Uji asap: server hidup di PORT acak dan /health menjawab 200.
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert");

const PORT = 3400 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});

const tunggu = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.status === 200) return r;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server tidak siap dalam 4 detik");
};

(async () => {
  try {
    const r = await tunggu();
    const body = await r.json();
    assert.strictEqual(body.status, "ok");
    console.log("[OK] /health menjawab 200");
  } finally {
    srv.kill();
  }
})().catch((e) => {
  console.error("[GAGAL]", e.message);
  process.exitCode = 1;
});
JS

# ---------- README.md ----------
cat > "$TUJUAN/README.md" <<MD
# $NAMA

Project mandiri di dalam workspace \`apps/\`.

## Install

    npm install

## Jalan

    npm start        # tanpa watch
    npm run dev      # watch mode

Konfigurasi lewat \`.env\` (salin dari \`.env.example\`). Port default: 3100.

## Test

    npm test

## Struktur

    src/      kode aplikasi
    test/     uji otomatis
    public/   berkas statis (kalau ada)
    data/     data runtime — tidak di-commit
MD

# ---------- .gitignore ----------
cat > "$TUJUAN/.gitignore" <<'GI'
node_modules/
.env
.env.*
!.env.example
data/*
!data/.gitkeep
*.log
npm-debug.log*
*.swp
GI

# ---------- .env.example ----------
cat > "$TUJUAN/.env.example" <<'ENV'
# Salin jadi .env lalu isi nilainya. Jangan commit .env.
PORT=3100
HOST=127.0.0.1
ENV

touch "$TUJUAN/data/.gitkeep"

# ---------- daftarkan ke katalog apps/README.md ----------
KATALOG="$AKAR/apps/README.md"
if [ -f "$KATALOG" ] && grep -q '<!-- app-baru:baris-katalog -->' "$KATALOG"; then
  BARIS="| \`apps/$NAMA/\` | $NAMA | Node.js | \`npm --prefix apps/$NAMA start\` |"
  awk -v baris="$BARIS" '
    /<!-- app-baru:baris-katalog -->/ { print baris }
    { print }
  ' "$KATALOG" > "$KATALOG.tmp" && mv "$KATALOG.tmp" "$KATALOG"
  echo "[katalog] apps/README.md diperbarui"
fi

echo "[ok] project dibuat: apps/$NAMA"
echo "     lanjut: cd apps/$NAMA && npm install && npm test"
