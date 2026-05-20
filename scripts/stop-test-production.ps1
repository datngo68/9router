# Tắt 9router test production đang chạy trên port riêng.
# Cách dùng:
#   ./scripts/stop-test-production.ps1
#   ./scripts/stop-test-production.ps1 -Port 20130

[CmdletBinding()]
param(
  [int]$Port = 20129
)

$ErrorActionPreference = "Stop"

if ($Port -eq 20128) {
  Write-Error "Không tự động kill port 20128 vì đây là port prod."
  exit 1
}

$lines = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
if (-not $lines) {
  Write-Host "Port $Port đang trống. Không có gì để tắt." -ForegroundColor Green
  exit 0
}

$targetPids = $lines | ForEach-Object { ($_ -replace ".*\s+(\d+)$", '$1').Trim() } | Sort-Object -Unique
foreach ($procId in $targetPids) {
  Write-Host "Stopping PID $procId on port $Port..."
  Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1
$stillRunning = netstat -ano | Select-String "LISTENING" | Select-String ":$Port\s"
if ($stillRunning) {
  Write-Error "Vẫn còn process listen port ${Port}:`n$stillRunning"
  exit 1
}

Write-Host "Đã tắt test server trên port $Port." -ForegroundColor Green
