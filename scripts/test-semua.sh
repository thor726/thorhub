#!/usr/bin/env bash
# Jalankan `npm test` untuk setiap project di apps/ dan laporkan ringkasannya.
# Exit code != 0 kalau ada project yang test-nya gagal.
set -uo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$AKAR"

lulus=0
gagal=0
daftar_gagal=""

for d in apps/*/; do
  [ -f "${d}package.json" ] || continue
  punya_test=$(node -e "const p=require('./${d}package.json');process.stdout.write(p.scripts&&p.scripts.test?'1':'0')")
  [ "$punya_test" = "1" ] || { echo "[lewati] ${d%/} (tidak ada script test)"; continue; }

  echo "=== test: ${d%/} ==="
  if npm --prefix "${d%/}" test; then
    lulus=$((lulus + 1))
  else
    gagal=$((gagal + 1))
    daftar_gagal="$daftar_gagal ${d%/}"
  fi
done

echo
echo "RINGKASAN: lulus=$lulus gagal=$gagal"
[ "$gagal" -eq 0 ] || { echo "Gagal:$daftar_gagal"; exit 1; }
