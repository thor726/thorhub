#!/usr/bin/env bash
# ==============================================================
# rahasia.sh — Manajemen rahasia terenkripsi (vault GPG) untuk ThorHub
#
# Tujuan keamanan:
#   Menyimpan kredensial sensitif (ADMIN_PASSWORD, MASTER_API_KEY, dll) dalam
#   bentuk TERENKRIPSI di disk, sehingga tidak bocor lewat:
#     - backup .tgz yang tidak sengaja memuat .env
#     - commit Git yang keliru
#     - snapshot disk
#   Vault dienkripsi simetris dengan GPG (AES256). Frasa sandi TIDAK disimpan
#   di dalam skrip ini.
#
# Lokasi:
#   Vault      : ~/.secrets/thorthub-vault.gpg
#   Metadata   : ~/.secrets/thorthub-vault.meta (daftar nama kunci, TANPA nilai)
#
# Frasa sandi diperoleh dari (urutan prioritas):
#   1. Variabel lingkungan VAULT_PASS
#   2. Berkas ~/.secrets/vault-passphrase.txt (mode 600) bila ada
#   3. Prompt interaktif
#
# Pemakaian:
#   ./rahasia.sh simpan ADMIN_PASSWORD        # tulis/ganti satu kunci
#   ./rahasia.sh ambil  ADMIN_PASSWORD        # tampilkan nilai satu kunci
#   ./rahasia.sh daftar                       # daftar nama kunci
#   ./rahasia.sh import-env .env              # muat semua dari file .env
#   ./rahasia.sh export-env .env.baru         # tulis vault → file .env baru
#   ./rahasia.sh hapus  NAMA_KUNCI
#   ./rahasia.sh uji                          # cek vault bisa dibuka
# ==============================================================
set -euo pipefail

SECRETS_DIR="${HOME}/.secrets"
VAULT="${SECRETS_DIR}/thorthub-vault.gpg"
META="${SECRETS_DIR}/thorthub-vault.meta"
PASSFILE="${SECRETS_DIR}/vault-passphrase.txt"

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

# ---- Ambil frasa sandi vault ----
ambil_pass() {
  if [ -n "${VAULT_PASS:-}" ]; then printf '%s' "$VAULT_PASS"; return; fi
  if [ -f "$PASSFILE" ]; then cat "$PASSFILE"; return; fi
  # prompt interaktif
  if [ -t 0 ]; then
    read -r -s -p "Frasa sandi vault: " p; echo >&2; printf '%s' "$p"
  else
    echo "ERROR: frasa sandi tidak tersedia (set VAULT_PASS atau buat $PASSFILE)." >&2
    exit 1
  fi
}

# ---- Baca isi vault sebagai teks (kosong bila vault belum ada) ----
# Frasa sandi dikirim via fd 3 agar tidak berebut stdin dengan data.
baca_vault() {
  if [ ! -f "$VAULT" ]; then return 0; fi
  gpg --batch --yes --quiet --decrypt \
    --passphrase-fd 3 --cipher-algo AES256 "$VAULT" 3< <(ambil_pass) 2>/dev/null
}

# ---- Tulis ulang vault dari stdin (enkripsi) ----
# stdin = plaintext; frasa sandi lewat fd 3.
tulis_vault() {
  local tmp
  tmp="$(mktemp "${SECRETS_DIR}/.vault.XXXXXX")"
  chmod 600 "$tmp"
  gpg --batch --yes --quiet --symmetric \
    --passphrase-fd 3 --cipher-algo AES256 --output "$tmp" 3< <(ambil_pass) 2>/dev/null
  chmod 600 "$tmp"
  mv -f "$tmp" "$VAULT"
}

# ---- Tulis metadata daftar kunci (tanpa nilai) ----
tulis_meta() {
  local tmp
  tmp="$(mktemp "${SECRETS_DIR}/.meta.XXXXXX")"
  { printf '%s\n' "$@" | sed '/^$/d' | sort -u; } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$META"
}

cmd_simpan() {
  local kunci="${1:?Nama kunci wajib.}"
  local nilai="${2:-}"
  if [ -z "$nilai" ]; then
    if [ -t 0 ]; then read -r -s -p "Nilai untuk ${kunci}: " nilai; echo >&2;
    else echo "ERROR: nilai kosong & tidak interaktif." >&2; exit 1; fi
  fi
  # Ganti baris kunci bila sudah ada; tambah bila baru
  local isi baru
  isi="$(baca_vault || true)"
  baru="$(printf '%s\n' "$isi" | grep -v "^${kunci}=" || true)"
  baru="$(printf '%s\n%s=%s' "$baru" "$kunci" "$nilai" | sed '/^$/d')"
  printf '%s' "$baru" | tulis_vault
  # update meta
  local list
  list="$( { printf '%s\n' "$kunci"; if [ -f "$META" ]; then cat "$META"; fi; } | sed '/^$/d' || true)"
  tulis_meta "$list"
  echo "Tersimpan (terenkripsi): $kunci"
}

cmd_ambil() {
  local kunci="${1:?Nama kunci wajib.}"
  baca_vault | grep "^${kunci}=" | head -1 | cut -d= -f2-
}

cmd_daftar() {
  if [ -f "$META" ]; then cat "$META"; else echo "(vault kosong)"; fi
}

cmd_import_env() {
  local f="${1:-.env}"
  [ -f "$f" ] || { echo "Berkas tidak ada: $f" >&2; exit 1; }
  local gabung baru kunci v list="" n=0
  gabung="$(baca_vault || true)"
  while IFS= read -r baris; do
    case "$baris" in \#*|'') continue;; esac
    kunci="${baris%%=*}"; v="${baris#*=}"
    [ -z "$kunci" ] && continue
    gabung="$(printf '%s\n' "$gabung" | grep -v "^${kunci}=" || true)"
    gabung="$(printf '%s\n%s=%s' "$gabung" "$kunci" "$v")"
    list="${list}${kunci}"$'\n'
    n=$((n+1))
  done < "$f"
  printf '%s' "$(printf '%s\n' "$gabung" | sed '/^$/d')" | tulis_vault
  tulis_meta "$list"
  echo "Diimpor $n kunci dari $f (terenkripsi)."
}

cmd_export_env() {
  local f="${1:?Nama berkas tujuan wajib.}"
  umask 077
  baca_vault > "$f"
  chmod 600 "$f"
  echo "Ditulis ke $f (mode 600)."
}

cmd_hapus() {
  local kunci="${1:?Nama kunci wajib.}"
  local baru list
  baru="$(baca_vault | grep -v "^${kunci}=" || true)"
  printf '%s' "$baru" | tulis_vault
  list="$( { if [ -f "$META" ]; then cat "$META"; fi; } | grep -v "^${kunci}$" || true)"
  tulis_meta "$list"
  echo "Dihapus: $kunci"
}

cmd_uji() {
  if [ ! -f "$VAULT" ]; then echo "Vault belum ada."; exit 1; fi
  if baca_vault >/dev/null 2>&1; then echo "OK: vault terbuka & terdekripsi."; else echo "GAGAL: frasa sandi salah atau vault rusak."; exit 1; fi
}

case "${1:-}" in
  simpan)      shift; cmd_simpan "$@";;
  ambil)       shift; cmd_ambil "$@";;
  daftar)      cmd_daftar;;
  import-env)  shift; cmd_import_env "$@";;
  export-env)  shift; cmd_export_env "$@";;
  hapus)       shift; cmd_hapus "$@";;
  uji)         cmd_uji;;
  *) echo "Pakai: $0 {simpan|ambil|daftar|import-env|export-env|hapus|uji} [arg]"; exit 1;;
esac
