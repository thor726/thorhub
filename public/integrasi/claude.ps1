# ================================================================
#  ThorHub - Claude Code Setup (Windows / PowerShell)
#  Satu API key, semua model. Tanpa langganan.
#
#  Pemakaian (satu baris dari dashboard member / tab Integrasi API):
#    $env:BASE_URL="https://llm.thormarket.site/v1"; `
#    $env:API_KEY="sk-thor-..."; `
#    irm https://llm.thormarket.site/integrasi/claude.ps1 | iex
#
#  Skrip ini memasang Claude Code (npm) lalu menulis settings.json agar
#  Claude Code menembak ke ThorHub, bukan ke provider aslinya.
# ================================================================

$ErrorActionPreference = "Stop"

function Info($m)    { Write-Host "-> $m" -ForegroundColor Cyan }
function Success($m) { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m)    { Write-Host "!  $m" -ForegroundColor Yellow }
function Die($m)     { Write-Host "X  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  ThorHub - Claude Code Setup (Windows)" -ForegroundColor White
Write-Host "  Akses semua model AI lewat satu key."
Write-Host ""

# -- Validasi env -------------------------------------------------
$BaseUrl = $env:BASE_URL
$ApiKey  = $env:API_KEY

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { Die "BASE_URL belum diisi. Salin perintah lengkap dari dashboard." }
if ([string]::IsNullOrWhiteSpace($ApiKey))  { Die "API_KEY belum diisi. Salin perintah lengkap dari dashboard." }

# Buang trailing slash lalu akhiran /v1 (Claude Code menambahkan sendiri)
$BaseUrl = $BaseUrl.TrimEnd("/")
$Origin  = $BaseUrl -replace "/v1$", ""

# -- Cek Node.js / npm --------------------------------------------
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Warn "Node.js (npm) tidak ditemukan."
  Write-Host "  Install dulu: https://nodejs.org/  (pilih versi LTS), lalu buka PowerShell baru."
  Die "npm diperlukan untuk memasang Claude Code."
}

# -- Install Claude Code ------------------------------------------
if (Get-Command claude -ErrorAction SilentlyContinue) {
  Success "claude sudah terpasang - melewati instalasi."
} else {
  Info "Memasang Claude Code (npm install -g @anthropic-ai/claude-code)..."
  npm install -g "@anthropic-ai/claude-code"
  if ($LASTEXITCODE -ne 0) { Die "Gagal memasang. Coba manual: npm install -g @anthropic-ai/claude-code" }
  Success "Claude Code berhasil dipasang."
}

# -- Ambil daftar model dari gateway ------------------------------
Info "Mengambil daftar model dari ThorHub..."
$models = @()
try {
  $resp = Invoke-RestMethod -Uri "$Origin/v1/models" -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 20
  if ($resp -and $resp.data) {
    $models = $resp.data | Where-Object {
      $_.id -and ($_.available -ne $false) -and ($_.enabled -ne $false)
    } | ForEach-Object { $_.id }
  }
} catch {
  Warn "Gagal mengambil daftar model - memakai konfigurasi default."
}

$fetched = $models.Count -gt 0
if (-not $fetched) {
  $models = @("deepseek-v4-pro", "deepseek-v4-flash", "claude-sonnet-5", "kimi-k3", "glm-5.2")
}

function Pick([string[]]$cands, [string[]]$list) {
  foreach ($c in $cands) {
    $hit = $list | Where-Object { $_ -like "*$c*" } | Select-Object -First 1
    if ($hit) { return $hit }
  }
  return $null
}

$sonnet = Pick @("deepseek-v4-pro", "sonnet") $models
if (-not $sonnet) { $sonnet = $models[0] }
$opus   = Pick @("claude-opus", "opus", "kimi") $models
if (-not $opus) { $opus = $sonnet }
$haiku  = Pick @("flash", "haiku") $models
if (-not $haiku) { $haiku = $sonnet }

# -- Tulis ~/.claude/settings.json --------------------------------
$configDir  = Join-Path $env:USERPROFILE ".claude"
$configFile = Join-Path $configDir "settings.json"
$modelsFile = Join-Path $configDir "available-models.txt"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

Info "Menulis config ke $configFile..."
$config = @{}
if (Test-Path $configFile) {
  try { $config = Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable } catch { $config = @{} }
}
if (-not $config.env) { $config.env = @{} }
$config.env["ANTHROPIC_BASE_URL"]             = $Origin
$config.env["ANTHROPIC_AUTH_TOKEN"]           = $ApiKey
$config.env["ANTHROPIC_MODEL"]                = $sonnet
$config.env["ANTHROPIC_DEFAULT_HAIKU_MODEL"]  = $haiku
$config.env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = $sonnet
$config.env["ANTHROPIC_DEFAULT_OPUS_MODEL"]   = $opus

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding UTF8

# -- Daftar model untuk slash command /models ---------------------
$fam = @{}
foreach ($m in $models) {
  $key = ($m -split "-")[0].ToUpper()
  if (-not $fam.ContainsKey($key)) { $fam[$key] = New-Object System.Collections.ArrayList }
  [void]$fam[$key].Add($m)
}

$lines = @()
$lines += "ThorHub - Daftar Model Tersedia"
$lines += "Base URL : $Origin"
$lines += "Total    : $($models.Count) model"
$lines += ""
$lines += "CARA PAKAI DI CLAUDE CODE:"
$lines += "  1. Ketik /models  untuk melihat semua model"
$lines += "  2. Ketik /model <nama_model>  untuk berganti model"
$lines += "  3. Saat start: claude --model <nama_model>"
$lines += ""
foreach ($k in ($fam.Keys | Sort-Object)) {
  $lines += "[$k]"
  foreach ($m in $fam[$k]) { $lines += "  - $m" }
  $lines += ""
}
$lines -join "`r`n" | Set-Content -Path $modelsFile -Encoding UTF8

# -- Slash command /models ----------------------------------------
$commandsDir = Join-Path $configDir "commands"
New-Item -ItemType Directory -Force -Path $commandsDir | Out-Null
@'
Tampilkan daftar seluruh model AI yang tersedia dari ThorHub dengan membaca file ~/.claude/available-models.txt.
Format rapi berdasarkan kelompok model (DeepSeek, GLM, Kimi, GPT, Claude, MiniMax, dsb.).
Ingatkan bahwa pengguna dapat berganti model kapan saja dengan /model <nama_model>.
'@ | Set-Content -Path (Join-Path $commandsDir "models.md") -Encoding UTF8

if ($fetched) { Success "Berhasil mengambil $($models.Count) model dari ThorHub." }
Success "Config disimpan ke $configFile"
Success "Daftar model disimpan ke $modelsFile"

Write-Host ""
Write-Host "  Konfigurasi aktif:" -ForegroundColor White
Write-Host "  Base URL : $Origin" -ForegroundColor Cyan
Write-Host "  Default  : $sonnet" -ForegroundColor Green
Write-Host "  Opus  -> : $opus"  -ForegroundColor Green
Write-Host "  Haiku -> : $haiku" -ForegroundColor Green
Write-Host ""
Write-Host "  Total $($models.Count) model tersedia."
Write-Host "  Cara ganti model: ketik /model <nama_model> di dalam Claude Code."
Write-Host ""
Write-Host "  Setup selesai! Jalankan claude di direktori project kamu." -ForegroundColor White
Write-Host ""
