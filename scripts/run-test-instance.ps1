# Chạy 9router ở chế độ test (next dev) trên port 20129
# Sử dụng DATA_DIR snapshot riêng để KHÔNG đụng prod ở port 20128.
#
# Cách chạy:
#   ./scripts/run-test-instance.ps1
#   ./scripts/run-test-instance.ps1 -Port 20130 -DataDir "D:\test-data"

[CmdletBinding()]
param(
  [int]$Port = 20129,
  [string]$DataDir = "F:\9router-test-data",
  [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DataDir)) {
  Write-Error "DATA_DIR test không tồn tại: $DataDir`nChạy ./scripts/snapshot-prod-data.ps1 trước."
  exit 1
}

# Kiểm tra port trống
$inUse = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
if ($inUse) {
  Write-Error "Port $Port đang bị chiếm:`n$inUse"
  exit 1
}

# Cảnh báo: prod thường ở 20128
if ($Port -eq 20128) {
  Write-Error "KHÔNG được dùng port 20128 — đây là port prod."
  exit 1
}

# Kiểm tra DATA_DIR test, không cho trỏ vào prod
$prodDir = (Join-Path $env:APPDATA "9router")
if ((Resolve-Path $DataDir).Path -ieq (Resolve-Path $prodDir).Path) {
  Write-Error "DATA_DIR đang trỏ thẳng vào prod ($prodDir). Dừng để bảo vệ DB prod."
  exit 1
}

# Đặt env cho process con
$env:DATA_DIR              = $DataDir
$env:PORT                  = "$Port"
$env:NODE_ENV              = "development"
$env:BASE_URL              = "http://localhost:$Port"
$env:NEXT_PUBLIC_BASE_URL  = "http://localhost:$Port"
# Chặn cloud sync ra ngoài: trỏ ngược về chính instance test
$env:CLOUD_URL             = "http://localhost:$Port"
$env:NEXT_PUBLIC_CLOUD_URL = "http://localhost:$Port"
# Cookie không cần secure khi chạy http localhost
$env:AUTH_COOKIE_SECURE    = "false"
# Cảnh báo: scheduler vẫn dùng cấu hình SMTP/Telegram trong DB.
# Nếu bạn không muốn bắn email/telegram thật, vào dashboard test đổi/clear creds
# trước khi để scheduler chạy >1 phút.

Write-Host ""
Write-Host "==== 9router TEST instance ====" -ForegroundColor Cyan
Write-Host "  PORT     : $Port"
Write-Host "  HOST     : $BindHost"
Write-Host "  DATA_DIR : $DataDir"
Write-Host "  BASE_URL : $env:BASE_URL"
Write-Host "  NODE_ENV : $env:NODE_ENV"
Write-Host ""
Write-Host "[!] Lưu ý:" -ForegroundColor Yellow
Write-Host "    - Đây là instance TEST song song, không ảnh hưởng prod ở 20128."
Write-Host "    - Cloudflared tunnel KHÔNG được trỏ thêm hostname vào port này."
Write-Host "    - SMTP / Telegram / OAuth credentials vẫn lấy từ DB snapshot."
Write-Host "      Nếu chạy lâu, cân nhắc tắt scheduler hoặc clear creds trong dashboard test."
Write-Host ""
Write-Host "Khởi động next dev..." -ForegroundColor Green
Write-Host ""

Push-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
try {
  $nextBin = Join-Path (Get-Location) "node_modules\.bin\next.cmd"
  if (-not (Test-Path $nextBin)) {
    Write-Error "Không tìm thấy next.cmd ở $nextBin. Chạy 'npm install' trước."
    exit 1
  }
  & $nextBin dev --webpack --port $Port --hostname $BindHost
}
finally {
  Pop-Location
}
