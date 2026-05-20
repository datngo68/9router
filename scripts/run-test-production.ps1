# Build + chạy 9router test ở chế độ production trên port riêng.
# Không đụng prod port 20128, không dùng DATA_DIR prod.
#
# Cách chạy:
#   ./scripts/run-test-production.ps1
#   ./scripts/run-test-production.ps1 -Port 20130 -DataDir "D:\test-data"
#   ./scripts/run-test-production.ps1 -SkipBuild

[CmdletBinding()]
param(
  [int]$Port = 20129,
  [string]$DataDir = "F:\9router-test-data",
  [string]$BindHost = "127.0.0.1",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDirName = ".next-test"
$distDir = Join-Path $repoRoot $distDirName
$buildHomeDir = Join-Path $repoRoot ".build-test-home"
$realAppData = [Environment]::GetFolderPath("ApplicationData")
$prodDir = Join-Path $realAppData "9router"

if (-not (Test-Path $DataDir)) {
  Write-Error "DATA_DIR test không tồn tại: $DataDir`nChạy ./scripts/snapshot-prod-data.ps1 trước."
  exit 1
}

if ($Port -eq 20128) {
  Write-Error "KHÔNG được dùng port 20128 — đây là port prod."
  exit 1
}

$resolvedDataDir = (Resolve-Path $DataDir).Path
$resolvedProdDir = if (Test-Path $prodDir) { (Resolve-Path $prodDir).Path } else { $prodDir }
if ($resolvedDataDir -ieq $resolvedProdDir) {
  Write-Error "DATA_DIR đang trỏ thẳng vào prod ($prodDir). Dừng để bảo vệ DB prod."
  exit 1
}

$inUse = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
if ($inUse) {
  Write-Error "Port $Port đang bị chiếm:`n$inUse`nDừng process cũ rồi chạy lại."
  exit 1
}

Push-Location $repoRoot
try {
  New-Item -ItemType Directory -Force -Path $buildHomeDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $buildHomeDir "AppData\Roaming") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $buildHomeDir "AppData\Local") | Out-Null

  $env:HOME                  = $buildHomeDir
  $env:USERPROFILE           = $buildHomeDir
  $env:APPDATA               = Join-Path $buildHomeDir "AppData\Roaming"
  $env:LOCALAPPDATA          = Join-Path $buildHomeDir "AppData\Local"
  $env:DATA_DIR              = $DataDir
  $env:PORT                  = "$Port"
  $env:HOSTNAME              = $BindHost
  $env:NODE_ENV              = "production"
  $env:BASE_URL              = "http://localhost:$Port"
  $env:NEXT_PUBLIC_BASE_URL  = "http://localhost:$Port"
  $env:CLOUD_URL             = "http://localhost:$Port"
  $env:NEXT_PUBLIC_CLOUD_URL = "http://localhost:$Port"
  $env:AUTH_COOKIE_SECURE    = "false"
  $env:NEXT_DIST_DIR         = $distDirName
  $env:NINE_ROUTER_SKIP_SYSTEM_TAILSCALE_PROBE = "1"

  Write-Host ""
  Write-Host "==== 9router TEST production ====" -ForegroundColor Cyan
  Write-Host "  PORT     : $Port"
  Write-Host "  HOST     : $BindHost"
  Write-Host "  DATA_DIR : $DataDir"
  Write-Host "  DIST_DIR : $distDir"
  Write-Host "  HOME     : $buildHomeDir"
  Write-Host "  BASE_URL : $env:BASE_URL"
  Write-Host ""
  Write-Host "[!] Lưu ý: SMTP/Telegram/OAuth creds vẫn lấy từ DB snapshot." -ForegroundColor Yellow
  Write-Host ""

  if (-not $SkipBuild) {
    Write-Host "[*] Build production vào $distDirName ..." -ForegroundColor Green
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  $standaloneDir = Join-Path $distDir "standalone"
  $standaloneDistDir = Join-Path $standaloneDir $distDirName
  if (Test-Path (Join-Path $distDir "static")) {
    New-Item -ItemType Directory -Force -Path $standaloneDistDir | Out-Null
    robocopy (Join-Path $distDir "static") (Join-Path $standaloneDistDir "static") /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Error "Copy static assets vào standalone thất bại."; exit $LASTEXITCODE }
  }
  if (Test-Path (Join-Path $repoRoot "public")) {
    robocopy (Join-Path $repoRoot "public") (Join-Path $standaloneDir "public") /E /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Error "Copy public assets vào standalone thất bại."; exit $LASTEXITCODE }
  }

  $serverCandidates = @(
    (Join-Path $distDir "standalone\server.js"),
    (Join-Path $distDir "standalone\9router\server.js"),
    (Join-Path $distDir "standalone\app\server.js")
  )
  $serverJs = $serverCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $serverJs) {
    Write-Error "Không tìm thấy standalone server.js trong $distDir\standalone. Build có thể fail hoặc output layout đổi."
    exit 1
  }

  Write-Host "[*] Chạy production server: $serverJs" -ForegroundColor Green
  Write-Host "[*] URL: http://$BindHost`:$Port"
  Write-Host ""

  & node $serverJs
}
finally {
  Pop-Location
}
