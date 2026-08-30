@echo off
color 0B
title Sanatify Build

echo ===========================================
echo    SANATIFY APK BUILD
echo ===========================================

cd /d "%~dp0"

echo [1] Cleaning...
if exist node_modules rmdir /s /q node_modules 2>nul
if exist android rmdir /s /q android 2>nul

echo [2] Installing packages...
call "C:\Program Files\nodejs\npm.cmd" install
if errorlevel 1 (
    echo [ERROR] npm install failed!
    pause
    exit
)

echo [3] Installing EAS...
call "C:\Program Files\nodejs\npm.cmd" install eas-cli
if errorlevel 1 (
    echo [ERROR] EAS install failed!
    pause
    exit
)

echo [4] Building APK...
set EAS_NO_VCS=1
set PATH=C:\Program Files\nodejs;%PATH%

:retry
echo.
echo [INFO] Starting build (VPN must be ON!)...
call "C:\Program Files\nodejs\node.exe" "node_modules\eas-cli\bin\run" build --platform android --profile production --no-wait

if errorlevel 1 (
    echo.
    echo [WARNING] Build failed! Retrying in 10 seconds...
    echo [INFO] Check your VPN connection!
    timeout /t 10 /nobreak >nul
    goto retry
)

echo.
echo ===========================================
echo    SUCCESS! Check: https://expo.dev/builds
echo ===========================================
pause