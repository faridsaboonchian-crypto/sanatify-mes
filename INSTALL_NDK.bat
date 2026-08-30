@echo off
TITLE Sanatify NDK HUNTER
COLOR 0B
CLS

echo =================================================
echo    STEP 1: SETUP JAVA
echo =================================================

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

"%JAVA_HOME%\bin\java.exe" -version

echo.
echo =================================================
echo    STEP 2: FINDING SDK MANAGER
echo    (Searching your disk... Please wait)
echo =================================================

:: رفتن به پوشه SDK
cd /d "C:\Users\msi\AppData\Local\Android\Sdk"

:: جستجوی فایل sdkmanager.bat در تمام زیرپوشه‌ها
set "SDK_MANAGER="
for /f "delims=" %%F in ('dir /s /b sdkmanager.bat') do set "SDK_MANAGER=%%F"

if "%SDK_MANAGER%"=="" (
    echo.
    echo [CRITICAL ERROR] Could not find 'sdkmanager.bat' anywhere in Android SDK folder!
    echo.
    echo SOLUTION:
    echo 1. Open Android Studio.
    echo 2. Go to SDK Manager -^> SDK Tools.
    echo 3. Uncheck 'Android SDK Command-line Tools'. Apply.
    echo 4. Check it again. Apply. (This repairs the file).
    pause
    exit
)

echo FOUND IT!
echo Target: "%SDK_MANAGER%"

echo.
echo =================================================
echo    STEP 3: INSTALLING NDK 27
echo    *** KEEP VPN ON ***
echo =================================================

echo Installing NDK version 27.0.12077973...

:: اجرای دستور نصب روی فایل پیدا شده
(echo y) | "%SDK_MANAGER%" "ndk;27.0.12077973"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation returned code %errorlevel%.
    echo Check your VPN connection.
    pause
    exit
)

echo.
echo =================================================
echo    SUCCESS! NDK INSTALLED CORRECTLY.
echo =================================================
echo.
echo NOW YOU CAN RUN 'RUN_ME.bat' TO BUILD THE APK!
pause