#!/usr/bin/env bash
# ============================================================
#  ThorHub — LLM Gateway  |  Skrip Deploy Satu Perintah
#  Pemakaian:
#     ./deploy.sh              -> deploy penuh (tarik kode + install + restart + cek)
#     ./deploy.sh --check      -> cek kondisi saja, TIDAK mengubah apa pun
#     ./deploy.sh --status     -> lihat status service + port
#     ./deploy.sh --logs       -> ikuti log realtime (Ctrl+C untuk keluar)
#     ./deploy.sh --restart    -> restart cepat (kalau cuma ganti kode lokal)
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVC="llm-gateway"
PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/"

biru()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
hijau() { printf '\033[1;32m%s\033[0m\n' "$*"; }
merah() { printf '\033[1;31m%s\033[0m\n' "$*"; }
kuning(){ printf '\033[1;33m%s\033[0m\n' "$*"; }

# ---------- HEALTH CHECK ----------
cek_sehat() {
  local kode
  kode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || echo "000")"
  if [ "$kode" = "200" ]; then
    hijau "  Health : OK (HTTP $kode) <- $HEALTH_URL"
    return 0
  else
    merah "  Health : GAGAL (HTTP $kode) <- $HEALTH_URL"
    return 1
  fi
}

# ---------- STATUS ----------
mode_status() {
  biru "== Status service =="
  systemctl status "$SVC" --no-pager -l | head -12 || true
  echo
  biru "== Port yang didengarkan =="
  ss -tlnp 2>/dev/null | awk 'NR==1 || /LISTEN/' | grep -E ":(80|443|${PORT})\b" || echo "  (tidak found)"
  echo
  biru "== Health =="
  cek_sehat || true
}

# ---------- CHECK (read-only) ----------
mode_check() {
  biru "== Pemeriksaan (tanpa perubahan) =="
  echo "  Folder      : $DIR"
  echo "  Branch      : $(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')"
  echo "  Commit      : $(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo '-')"
  if [ -n "$(git -C "$DIR" status --porcelain 2>/dev/null)" ]; then
    kuning "  Working tree: ADA PERUBAHAN BELUM DI-COMMIT"
  else
    hijau "  Working tree: bersih"
  fi
  echo "  Unit        : $(systemctl is-active "$SVC" 2>/dev/null) / $(systemctl is-enabled "$SVC" 2>/dev/null)"
  echo "  Runtime     : node $(node -v 2>/dev/null || echo '?')"
  echo
  cek_sehat || true
}

# ---------- DEPLOY PENUH ----------
mode_deploy() {
  cd "$DIR"
  biru "== 1/5 Tarik kode terbaru =="
  if git rev-parse --git-dir >/dev/null 2>&1; then
    git pull --ff-only || kuning "  (pull dilewati — tidak ada remote / ada perubahan lokal)"
  else
    kuning "  (bukan repo git, dilewati)"
  fi

  biru "== 2/5 Install dependensi =="
  if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

  biru "== 3/5 Cek .env =="
  if [ -f .env ]; then
    hijau "  .env ada"
    # Perketat izin: kredensial tak boleh world-readable.
    if [ "$(stat -c '%a' .env)" != "600" ]; then
      chmod 600 .env && kuning "  izin .env diperketat → 600"
    fi
  else
    merah "  .env TIDAK ADA — service bisa gagal start"
    # Coba pulihkan dari vault terenkripsi (saran keamanan: .env tak di-backup plaintext).
    if [ -x ./rahasia.sh ] && [ -f "$HOME/.secrets/thorthub-vault.gpg" ]; then
      kuning "  Mencoba pulihkan .env dari vault (~/.secrets/thorthub-vault.gpg)…"
      if ./rahasia.sh export-env .env; then hijau "  .env dipulihkan dari vault (mode 600)"; fi
    fi
  fi

  biru "== 4/5 Restart service =="
  systemctl restart "$SVC"
  sleep 3

  biru "== 5/5 Verifikasi =="
  if cek_sehat; then
    hijau "DEPLOY SUKSES."
  else
    merah "DEPLOY GAGAL — 30 baris log terakhir:"
    journalctl -u "$SVC" -n 30 --no-pager
    exit 1
  fi
}

case "${1:-}" in
  --check)   mode_check ;;
  --status)  mode_status ;;
  --logs)    journalctl -u "$SVC" -f ;;
  --restart) systemctl restart "$SVC"; sleep 3; mode_status ;;
  --help|-h)
     sed -n '3,11p' "$0"
     ;;
  "")        mode_deploy ;;
  *)         merah "Opsi tidak dikenal: $1"; sed -n '3,11p' "$0"; exit 1 ;;
esac
