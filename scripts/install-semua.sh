#!/usr/bin/env bash
# Jalankan `npm install` untuk setiap project di apps/ (dependensi tidak di-hoist).
set -euo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$AKAR"

gagal=0
for d in apps/*/; do
  [ -f "${d}package.json" ] || continue
  echo "=== install: ${d%/} ==="
  if ! npm --prefix "${d%/}" install; then
    echo "[GAGAL] install ${d%/}"
    gagal=$((gagal + 1))
  fi
done

[ "$gagal" -eq 0 ] || { echo "$gagal project gagal di-install"; exit 1; }
echo "Semua project selesai di-install."
