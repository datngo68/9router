# Snapshot DATA_DIR prod sang folder test (an toàn cho instance song song)
# Mặc định:
#   Source : Windows Roaming AppData\9router  (DATA_DIR prod, không phụ thuộc $env:APPDATA hiện tại)
#   Target : F:\9router-test-data
# Cách chạy (PowerShell):
#   ./scripts/snapshot-prod-data.ps1
#   ./scripts/snapshot-prod-data.ps1 -Target "D:\test-data" -Force

[CmdletBinding()]
param(
  [string]$Source = "",
  [string]$Target = "F:\9router-test-data",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Source) {
  $realAppData = [Environment]::GetFolderPath("ApplicationData")
  $Source = Join-Path $realAppData "9router"
}

if (-not (Test-Path $Source)) {
  Write-Error "Source DATA_DIR không tồn tại: $Source"
  exit 1
}

# Cảnh báo nếu prod đang chạy (không chặn, chỉ nhắc)
$prodPids = (netstat -ano | Select-String "LISTENING" | Select-String ":20128\s") -replace ".*\s+(\d+)$", '$1'
if ($prodPids) {
  Write-Host "[!] Phát hiện prod đang LISTEN trên :20128 (PID $prodPids)." -ForegroundColor Yellow
  Write-Host "    Snapshot sẽ copy DB đang mở. SQLite WAL có thể chứa giao dịch chưa flush." -ForegroundColor Yellow
  Write-Host "    Khuyến nghị: dừng prod 5 giây rồi chạy lại để có snapshot sạch hơn." -ForegroundColor Yellow
}

if (Test-Path $Target) {
  if (-not $Force) {
    Write-Host "Target đã tồn tại: $Target" -ForegroundColor Yellow
    $ans = Read-Host "Xoá và tạo mới? (y/N)"
    if ($ans -ne "y" -and $ans -ne "Y") {
      Write-Host "Huỷ."
      exit 0
    }
  }
  Write-Host "[*] Xoá target cũ..."
  Remove-Item -Recurse -Force -LiteralPath $Target
}

Write-Host "[*] Snapshot $Source -> $Target"

# Loại trừ những thứ không nên copy:
#   tunnel\         : credentials cloudflared của prod
#   bin\            : binary cloudflared
#   logs\           : log prod (không cần)
#   update\         : cache update
$excludeDirs = @("tunnel", "bin", "logs", "update")

# robocopy giữ ACL/sym link tốt hơn copy-item, lại nhanh
$xdArgs = @()
foreach ($d in $excludeDirs) {
  $xdArgs += "/XD"
  $xdArgs += (Join-Path $Source $d)
}

# /E copy subdir kể cả rỗng, /COPY:DAT data+attr+timestamp, /R:1 retry 1, /W:1 wait 1s, /NFL/NDL gọn log
$rcArgs = @($Source, $Target, "/E", "/COPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS") + $xdArgs
& robocopy @rcArgs | Out-Null
$rc = $LASTEXITCODE
# robocopy: 0-7 = success (8+ là lỗi)
if ($rc -ge 8) {
  Write-Error "robocopy thất bại (exit=$rc)"
  exit $rc
}

# Đánh dấu rõ đây là test snapshot
Set-Content -LiteralPath (Join-Path $Target "TEST_INSTANCE.txt") -Value @"
This DATA_DIR is a TEST SNAPSHOT.
Snapshot at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Source     : $Source
Do NOT point production at this folder.
"@

Write-Host "[OK] Snapshot xong: $Target" -ForegroundColor Green
Write-Host ""
Write-Host "Bước tiếp theo:" -ForegroundColor Cyan
Write-Host "  1. Mở terminal MỚI, cd vào F:\Tool\9router"
Write-Host "  2. Chạy: ./scripts/run-test-instance.ps1"
Write-Host ""
