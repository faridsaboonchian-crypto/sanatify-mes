@echo off
TITLE Sanatify CLOUD BUILD (NEW IDENTITY)
COLOR 0B
CLS

echo =================================================
echo    STEP 1: CONFIGURING TOOLS
echo =================================================

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"

if not exist "%NODE_EXE%" (
    echo [CRITICAL ERROR] Node.js not found.
    pause
    exit
)

echo [OK] Tools found.

echo.
echo =================================================
echo    STEP 2: CLEANING OLD IDENTITY
echo    (Removing old Project ID from config)
echo =================================================

cd /d "%~dp0"

:: 1. حذف پوشه‌های تنظیمات قدیمی
if exist .eas rmdir /s /q .eas
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json

:: 2. >>> جراحی اصلی: بازنویسی فایل app.json <<<
:: ما فایل را از نو میسازیم تا ID قدیمی پاک شود و slug جدید شود
echo Creating clean app.json...

(
echo {
echo   "expo": {
echo     "name": "Sanatify App",
echo     "slug": "sanatify-production-v30",
echo     "version": "1.0.0",
echo     "orientation": "portrait",
echo     "icon": "./assets/icon.png",
echo     "userInterfaceStyle": "light",
echo     "splash": {
echo       "image": "./assets/icon.png",
echo       "resizeMode": "contain",
echo       "backgroundColor": "#ffffff"
echo     },
echo     "assetBundlePatterns": [
echo       "**/*"
echo     ],
echo     "ios": {
echo       "supportsTablet": true
echo     },
echo     "android": {
echo       "package": "com.vahid.sanatify",
echo       "adaptiveIcon": {
echo         "foregroundImage": "./assets/icon.png",
echo         "backgroundColor": "#ffffff"
echo       }
echo     },
echo     "web": {
echo       "favicon": "./assets/favicon.png"
echo     },
echo     "plugins": [
echo       [
echo         "expo-build-properties",
echo         {
echo           "android": {
echo             "usesCleartextTraffic": true,
echo             "kotlinVersion": "1.9.23"
echo           }
echo         }
echo       ],
echo       "expo-notifications"
echo     ]
echo   }
echo }
) > app.json

echo [OK] Project Identity Reset (New Slug: sanatify-production-v30).

echo.
echo =================================================
echo    STEP 3: INSTALLING EAS CLI
echo =================================================

echo Installing EAS locally...
call "%NPM_CMD%" install eas-cli expo

set "EAS_SCRIPT=%~dp0node_modules\eas-cli\bin\run"

echo.
echo =================================================
echo    STEP 4: LOGIN TO EXPO (NEW ACCOUNT)
echo    *** BOOST VPN MUST BE ON ***
echo =================================================

echo.
echo Please login with your NEW account if asked.
echo.

:: لاگین
"%NODE_EXE%" "%EAS_SCRIPT%" login

echo.
echo =================================================
echo    STEP 5: SENDING BUILD
echo =================================================

echo Uploading as a BRAND NEW Project...
echo.
echo IMPORTANT:
echo 1. Answer 'yes' to "Create a new project on Expo?"
echo 2. Answer 'yes' to "Generate new Keystore?"
echo.

:: غیرفعال کردن گیت
set "EAS_NO_VCS=1"

:: دستور بیلد
"%NODE_EXE%" "%EAS_SCRIPT%" build --platform android --profile production --no-wait

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build submission failed.
    echo Check VPN.
    pause
    exit
)

echo.
echo =================================================
echo    SUCCESS! BUILD SUBMITTED.
echo =================================================
echo.
echo Go to: https://expo.dev
echo Check your dashboard for the new project.
echo.
pause