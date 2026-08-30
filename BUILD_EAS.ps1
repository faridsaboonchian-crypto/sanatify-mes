# =================================================
#    SANATIFY EAS CLOUD BUILD - PowerShell Edition
# =================================================

# Run this in Cursor Terminal (PowerShell)

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "    SANATIFY EAS CLOUD BUILD SYSTEM" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# =================================================
# STEP 0: Fix PATH for PowerShell
# =================================================

Write-Host "`n[STEP 0] Configuring environment..." -ForegroundColor Yellow

# تنظیم PATH در PowerShell
$nodePath = "C:\Program Files\nodejs"
$systemPaths = @(
    "C:\Windows\System32",
    "C:\Windows",
    "C:\Windows\System32\Wbem"
)

# اضافه کردن به PATH
$env:PATH = "$nodePath;$($systemPaths -join ';');$env:PATH"

# تنظیم متغیرهای EAS
$env:EAS_NO_VCS = "1"
$env:EXPO_NO_GIT_STATUS = "1"
$env:CI = "1"

Write-Host "[OK] PATH configured" -ForegroundColor Green

# =================================================
# STEP 1: Validation
# =================================================

Write-Host "`n[STEP 1] Validating environment..." -ForegroundColor Yellow

# بررسی Node
$nodeExe = Join-Path $nodePath "node.exe"
if (-not (Test-Path $nodeExe)) {
    Write-Host "[ERROR] Node.js not found at $nodePath" -ForegroundColor Red
    exit 1
}

# بررسی npm
$npmCmd = Join-Path $nodePath "npm.cmd"
if (-not (Test-Path $npmCmd)) {
    Write-Host "[ERROR] npm not found at $nodePath" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Node.js found: $( & $nodeExe --version )" -ForegroundColor Green
Write-Host "[OK] npm found: $( & $npmCmd --version )" -ForegroundColor Green

# =================================================
# STEP 2: Clean & Install
# =================================================

Write-Host "`n[STEP 2] Preparing project..." -ForegroundColor Yellow

# حذف node_modules
if (Test-Path "node_modules") {
    Write-Host "Removing node_modules..."
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# حذف android
if (Test-Path "android") {
    Write-Host "Removing android folder..."
    Remove-Item -Recurse -Force "android" -ErrorAction SilentlyContinue
}

# نصب dependencies
Write-Host "Running npm install..."
& $npmCmd install --legacy-peer-deps

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed!" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Dependencies installed" -ForegroundColor Green

# =================================================
# STEP 3: Install EAS CLI
# =================================================

Write-Host "`n[STEP 3] Installing EAS CLI..." -ForegroundColor Yellow

# نصب global
& $npmCmd install -g eas-cli@latest

if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARNING] Global install had issues, trying local..." -ForegroundColor Yellow
    & $npmCmd install --save-dev eas-cli@latest
}

Write-Host "[OK] EAS CLI installed" -ForegroundColor Green

# =================================================
# STEP 4: Check Login
# =================================================

Write-Host "`n[STEP 4] Checking EAS login..." -ForegroundColor Yellow

$npxCmd = Join-Path $nodePath "npx.cmd"
& $npxCmd eas whoami 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "[INFO] Not logged in. Please login:" -ForegroundColor Yellow
    & $npxCmd eas login
    
    & $npxCmd eas whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Login failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[OK] Already logged in" -ForegroundColor Green
}

# =================================================
# STEP 5: Build
# =================================================

Write-Host "`n=================================================" -ForegroundColor Cyan
Write-Host "    READY TO BUILD!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "[INFO] Make sure VPN is connected!" -ForegroundColor Yellow
Write-Host "[INFO] Build will run in cloud..." -ForegroundColor Yellow

Start-Sleep -Seconds 3

& $npxCmd eas build --platform android --profile production --no-wait --non-interactive

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Build submission failed!" -ForegroundColor Red
    Write-Host "`n[TROUBLESHOOTING]" -ForegroundColor Yellow
    Write-Host "1. Check VPN connection"
    Write-Host "2. Verify account: npx eas whoami"
    Write-Host "3. Check project: npx eas project:info"
    exit 1
}

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host "    BUILD SUBMITTED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host "`nTrack at: https://expo.dev/builds" -ForegroundColor Cyan

Read-Host "`nPress Enter to exit"