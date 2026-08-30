# Start Expo Development Server with QR Code
$nodePath = "C:\Program Files\nodejs"
$env:Path = $env:Path + ";$nodePath"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  🚀 Expo Development Server" -ForegroundColor Green  
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "در حال راه‌اندازی سرور..." -ForegroundColor Yellow
Write-Host "لطفاً چند ثانیه صبر کنید تا QR Code نمایش داده شود..." -ForegroundColor Yellow
Write-Host ""
Write-Host "برای توقف سرور: Ctrl+C" -ForegroundColor Cyan
Write-Host ""

# Start Expo
& "$nodePath\npx.cmd" expo start --clear

