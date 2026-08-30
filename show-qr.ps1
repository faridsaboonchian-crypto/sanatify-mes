# Script to start Expo and show QR code
$nodePath = "C:\Program Files\nodejs"
$env:Path = $env:Path + ";$nodePath"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Expo Development Server" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Starting server... Please wait for QR code to appear below:" -ForegroundColor Yellow
Write-Host ""

# Start Expo - QR code will appear in terminal
& "$nodePath\npx.cmd" expo start

