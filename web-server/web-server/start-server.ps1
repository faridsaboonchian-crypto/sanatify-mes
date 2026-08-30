$here = $PSScriptRoot
$logFile = Join-Path $here "server-console.log"
$errFile = Join-Path $here "server-error.log"

# توقف سرورهای قبلی
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "[OK] Starting Sanatify MES Server in background..." -ForegroundColor Green
Write-Host "Web app: http://localhost:3000" -ForegroundColor Cyan
Write-Host "To see live logs run: Get-Content .\server-console.log -Wait" -ForegroundColor Yellow

Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $here -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden
