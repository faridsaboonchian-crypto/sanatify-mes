# Start Expo with QR code display
$nodePath = "C:\Program Files\nodejs"
$env:Path = $env:Path + ";$nodePath"

Write-Host "Starting Expo development server..." -ForegroundColor Cyan
Write-Host "QR Code will appear below:" -ForegroundColor Yellow
Write-Host ""

# Start Expo with tunnel mode for QR code
& "$nodePath\npx.cmd" expo start --tunnel

