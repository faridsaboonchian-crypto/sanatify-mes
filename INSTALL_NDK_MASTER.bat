@echo off
TITLE Sanatify NDK MASTER INSTALLER
COLOR 0A
CLS

echo =================================================
echo    STEP 1: CONFIGURING ENVIRONMENT
echo =================================================

:: 1. آدرس دقیق جاوا
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"

:: 2. آدرس دقیق SDK Manager (که در لاگ قبلی پیدا شد)
set "SDK_MANAGER=C:\Users\msi\AppData\Local\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat"

:: 3. >>> اصلاح حیاتی <<<
:: اضافه کردن System32 تا دستور findstr کار کند + حفظ مسیرهای قبلی
set "PATH=C:\Windows\System32;C:\Windows;%JAVA_HOME%\bin;%PATH%"

:: 4. خاموش کردن ارور الکی نسخه جاوا
set SKIP_JDK_VERSION_CHECK=true

echo Environment Configured.
echo SDK Manager: %SDK_MANAGER%

echo.
echo =================================================
echo    STEP 2: INSTALLING NDK 27
echo    *** VPN MUST BE ON ***
echo =================================================

echo Downloading NDK... (This will take time)

:: اجرای دستور نصب
(echo y) | call "%SDK_MANAGER%" "ndk;27.0.12077973"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation Command Failed.
    echo Check VPN.
    pause
    exit
)

echo.
echo =================================================
echo    STEP 3: VERIFICATION
echo =================================================

if exist "C:\Users\msi\AppData\Local\Android\Sdk\ndk\27.0.12077973" (
    echo.
    echo [SUCCESS] NDK FOLDER FOUND!
    echo ==========================================
    echo NOW YOU CAN BUILD THE APK.
    echo Please go back and run 'GENERATE_ANDROID.bat'
    echo ==========================================
) else (
    echo.
    echo [FAILURE] The command finished but the folder is empty.
    echo This usually happens if VPN is weak or Disk is full.
)

pause