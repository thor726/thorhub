#!/usr/bin/env bash
# Tampilkan daftar project di apps/ beserta ringkasan singkat.
set -euo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$AKAR"

ditemukan=0
printf '%-22s %-24s %-10s %s\n' "FOLDER" "NAMA PAKET" "DEPENDENSI" "SCRIPT"
printf '%-22s %-24s %-10s %s\n' "------" "----------" "----------" "------"

for d in apps/*/; do
  [ -f "${d}package.json" ] || continue
  ditemukan=$((ditemukan + 1))
  nama=$(node -e "process.stdout.write(require('./${d}package.json').name||'-')")
  dep=$(node -e "const p=require('./${d}package.json');process.stdout.write(String(Object.keys(p.dependencies||{}).length))")
  skrip=$(node -e "const p=require('./${d}package.json');process.stdout.write(Object.keys(p.scripts||{}).join(',')||'-')")
  printf '%-22s %-24s %-10s %s\n' "${d%/}" "$nama" "$dep" "$skrip"
done

if [ "$ditemukan" -eq 0 ]; then
  echo "Belum ada project di apps/. Buat dengan: npm run app:baru -- nama-project"
fi
