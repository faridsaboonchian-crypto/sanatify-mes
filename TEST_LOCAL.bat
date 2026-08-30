@echo off
cd /d "%~dp0"
TITLE Sanatify Local Test
CLS

echo =================================================
echo        SANATIFY LOCAL TEST (EXPO GO)
echo =================================================

:: 1. GLOBAL PATH FIX (Likely needed for npx)
set "PATH=C:\Program Files\nodejs;%PATH%"
set "PATHEXT=.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;%PATHEXT%"

echo [INFO] Starting Metro Bundler...
echo [INFO] 1. Open 'Expo Go' on your Android via VPN.
echo [INFO] 2. Scan the QR Code below.
echo [INFO] 3. If it fails, press 's' to switch to update mode.
echo.

:: Run expo start with cache clear
call npx expo start --clear

pause
