Write-Host "[STOP] Stopping Sanatify MES Server..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "[OK] Server stopped." -ForegroundColor Green
