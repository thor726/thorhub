#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║              ThorHub — Claude Code Setup                         ║
# ║      Satu API key, semua model. Tanpa langganan.                 ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# Pemakaian (satu baris dari dashboard member):
#   BASE_URL="https://llm.thormarket.site/v1" \
#   API_KEY="sk-thor-..." \
#   bash <(curl -fsSL https://llm.thormarket.site/integrasi/claude)
#
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}→${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
die()     { echo -e "${RED}✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "${BOLD}  ThorHub${RESET} — Claude Code Setup"
echo -e "  Akses semua model AI lewat satu key."
echo ""

# ── Validasi env ──────────────────────────────────────────────────
BASE_URL="${BASE_URL:-}"
API_KEY="${API_KEY:-}"
[[ -z "$BASE_URL" ]] && die "BASE_URL belum diisi. Salin perintah lengkap dari dashboard."
[[ -z "$API_KEY"  ]] && die "API_KEY belum diisi. Salin perintah lengkap dari dashboard."

# Strip trailing slash lalu /v1 — Claude Code menambahkan sendiri
BASE_URL="${BASE_URL%/}"
ORIGIN="${BASE_URL%/v1}"

# ── Cek dependensi ────────────────────────────────────────────────
for cmd in curl python3; do
  command -v "$cmd" &>/dev/null || die "'$cmd' tidak ditemukan. Install dulu lalu coba lagi."
done

if ! command -v npm &>/dev/null; then
  warn "npm / Node.js tidak ditemukan di sistem."
  echo -e "  Ubuntu/Debian : ${CYAN}curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs${RESET}"
  die "Node.js (npm) diperlukan untuk menginstall Claude Code."
fi

# ── Install Claude Code ───────────────────────────────────────────
if command -v claude &>/dev/null; then
  success "claude sudah terinstall — melewati instalasi."
else
  info "Menginstall Claude Code..."
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || echo "/usr/local")"
  if [[ -w "$NPM_PREFIX/lib" ]] 2>/dev/null; then
    npm install -g @anthropic-ai/claude-code
  else
    warn "Direktori npm global (${NPM_PREFIX}) memerlukan izin root."
    sudo npm install -g @anthropic-ai/claude-code
  fi
  command -v claude &>/dev/null || die "Gagal install. Coba manual: sudo npm install -g @anthropic-ai/claude-code"
  success "Claude Code berhasil diinstall."
fi

# ── Ambil daftar model dari gateway ──────────────────────────────
info "Mengambil daftar model dari ThorHub..."
MODELS_RAW=$(curl -fsSL -H "Authorization: Bearer ${API_KEY}" "${ORIGIN}/v1/models" 2>/dev/null || echo "")

CONFIG_DIR="$HOME/.claude"
CONFIG_FILE="$CONFIG_DIR/settings.json"
MODELS_FILE="$CONFIG_DIR/available-models.txt"
mkdir -p "$CONFIG_DIR"

info "Menulis config ke ${CONFIG_FILE}..."

SUMMARY_JSON=$(ORIGIN="$ORIGIN" API_KEY="$API_KEY" CONFIG_FILE="$CONFIG_FILE" MODELS_FILE="$MODELS_FILE" MODELS_RAW="$MODELS_RAW" \
python3 -c "
import json, os

origin      = os.environ['ORIGIN']
api_key     = os.environ['API_KEY']
config_file = os.environ['CONFIG_FILE']
models_file = os.environ['MODELS_FILE']
models_raw  = os.environ.get('MODELS_RAW', '')

data = []
if models_raw:
    try:
        parsed = json.loads(models_raw)
        if isinstance(parsed, dict) and isinstance(parsed.get('data'), list):
            data = parsed['data']
    except Exception:
        pass

models = [m['id'].strip() for m in data
          if isinstance(m, dict) and m.get('id')
          and m.get('available', True) is not False
          and m.get('enabled', True) is not False]

fetched = True
if not models:
    fetched = False
    models = ['deepseek-v4-pro', 'deepseek-v4-flash', 'claude-sonnet-5', 'kimi-k3', 'glm-5.2']

def pick(*cands):
    for c in cands:
        for m in models:
            if c in m:
                return m
    return None

sonnet = pick('deepseek-v4-pro') or pick('sonnet') or models[0]
opus   = pick('claude-opus') or pick('opus') or pick('kimi') or sonnet
haiku  = pick('flash') or pick('haiku') or sonnet

try:
    with open(config_file) as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}

env = config.get('env', {})
env.update({
    'ANTHROPIC_BASE_URL':             origin,
    'ANTHROPIC_AUTH_TOKEN':           api_key,
    'ANTHROPIC_MODEL':                sonnet,
    'ANTHROPIC_DEFAULT_HAIKU_MODEL':  haiku,
    'ANTHROPIC_DEFAULT_SONNET_MODEL': sonnet,
    'ANTHROPIC_DEFAULT_OPUS_MODEL':   opus,
})
config['env'] = env

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')

fam = {}
for m in models:
    fam.setdefault(m.split('-')[0].upper(), []).append(m)

with open(models_file, 'w') as f:
    f.write('ThorHub — Daftar Model Tersedia\n')
    f.write(f'Base URL : {origin}\n')
    f.write(f'Total    : {len(models)} model\n\n')
    f.write('CARA PAKAI DI CLAUDE CODE:\n')
    f.write('  1. Ketik /models  untuk melihat semua model\n')
    f.write('  2. Ketik /model <nama_model>  untuk berganti model\n')
    f.write('  3. Saat start: claude --model <nama_model>\n\n')
    for k in sorted(fam):
        f.write(f'[{k}]\n')
        for m in fam[k]:
            f.write(f'  - {m}\n')
        f.write('\n')

print(json.dumps({'fetched': fetched, 'count': len(models),
                  'sonnet': sonnet, 'opus': opus, 'haiku': haiku}))
")

FETCHED=$(echo "$SUMMARY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['fetched'])")
COUNT=$(echo "$SUMMARY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['count'])")
SONNET=$(echo "$SUMMARY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['sonnet'])")
OPUS=$(echo "$SUMMARY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['opus'])")
HAIKU=$(echo "$SUMMARY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['haiku'])")

if [[ "$FETCHED" == "True" ]]; then
  success "Berhasil mengambil ${COUNT} model dari ThorHub."
else
  warn "Gagal mengambil daftar model — memakai konfigurasi default."
fi

success "Config disimpan ke ${CONFIG_FILE}"
success "Daftar model disimpan ke ${MODELS_FILE}"

# ── Slash command /models ─────────────────────────────────────────
COMMANDS_DIR="$CONFIG_DIR/commands"
mkdir -p "$COMMANDS_DIR"
cat << 'EOF' > "$COMMANDS_DIR/models.md"
Tampilkan daftar seluruh model AI yang tersedia dari ThorHub dengan membaca file `~/.claude/available-models.txt`.
Format rapi berdasarkan kelompok model (DeepSeek, GLM, Kimi, GPT, Claude, MiniMax, dsb.).
Ingatkan bahwa pengguna dapat berganti model kapan saja dengan `/model <nama_model>`.
EOF

echo ""
echo -e "  ${BOLD}Konfigurasi aktif:${RESET}"
echo -e "  Base URL : ${CYAN}${ORIGIN}${RESET}"
echo -e "  Default  : ${GREEN}${SONNET}${RESET}"
echo -e "  Opus  →  : ${GREEN}${OPUS}${RESET}"
echo -e "  Haiku →  : ${GREEN}${HAIKU}${RESET}"
echo ""
echo -e "  ${BOLD}Total ${COUNT} model tersedia.${RESET}"
echo -e "  Cara ganti model: ketik ${CYAN}/model <nama_model>${RESET} di dalam Claude Code."
echo ""
echo -e "${BOLD}  Setup selesai!${RESET} Jalankan ${CYAN}claude${RESET} di direktori project kamu."
echo ""
