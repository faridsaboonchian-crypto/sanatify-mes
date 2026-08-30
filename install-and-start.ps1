# اسکریپت کامل نصب و راه‌اندازی Expo
$ErrorActionPreference = "Stop"
$nodePath = "C:\Program Files\nodejs"
$env:Path = $env:Path + ";$nodePath"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  نصب و راه‌اندازی Expo App" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# بررسی Node.js
Write-Host "بررسی Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = & "$nodePath\node.exe" -v
    Write-Host "✓ Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js پیدا نشد!" -ForegroundColor Red
    exit 1
}

# بررسی npm
Write-Host "بررسی npm..." -ForegroundColor Yellow
try {
    $npmVer = & "$nodePath\npm.cmd" -v
    Write-Host "✓ npm: $npmVer" -ForegroundColor Green
} catch {
    Write-Host "✗ npm پیدا نشد!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "نصب وابستگی‌ها..." -ForegroundColor Yellow
Write-Host "این کار ممکن است چند دقیقه طول بکشد..." -ForegroundColor Yellow
Write-Host ""

# نصب وابستگی‌ها
try {
    & "$nodePath\npm.cmd" install
    Write-Host ""
    Write-Host "✓ وابستگی‌ها نصب شدند" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "✗ خطا در نصب وابستگی‌ها" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  راه‌اندازی Expo Server" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "QR Code در ترمینال نمایش داده می‌شود..." -ForegroundColor Yellow
Write-Host "برای توقف سرور: Ctrl+C" -ForegroundColor Cyan
Write-Host ""

# راه‌اندازی Expo
& "$nodePath\npx.cmd" expo start --clear

