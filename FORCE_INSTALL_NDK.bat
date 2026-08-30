@echo off
TITLE Sanatify NDK FORCE INSTALLER
COLOR 0B
CLS

echo =================================================
echo    STEP 1: SETUP ENVIRONMENT
echo =================================================

:: آدرس‌های دقیق لپ‌تاپ شما (User: msi)
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "SDK_ROOT=C:\Users\msi\AppData\Local\Android\Sdk"
set "SDK_MANAGER=%SDK_ROOT%\cmdline-tools\latest\bin\sdkmanager.bat"

:: چک کردن وجود ابزار
if not exist "%SDK_MANAGER%" (
    echo.
    echo [CRITICAL ERROR] sdkmanager.bat not found at:
    echo %SDK_MANAGER%
    echo.
    echo Please go to Android Studio -> SDK Tools
    echo Uncheck 'Android SDK Command-line Tools' -> Apply
    echo Check it again -> Apply (To reinstall it correctly)
    pause
    exit
)

echo Java and SDK Manager found.

echo.
echo =================================================
echo    STEP 2: INSTALLING NDK 27.0.12077973
echo    *** VPN (Boost) MUST BE ON ***
echo =================================================

echo Downloading NDK (~600MB)... This may take time.
echo Please wait until you see 'Done'.

:: دستور نصب مستقیم NDK
:: ما حرف 'y' را میفرستیم تا لایسنس گوگل را قبول کند
(echo y) | "%SDK_MANAGER%" "ndk;27.0.12077973"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation Failed.
    echo 1. Is your VPN connected?
    echo 2. Check internet connection.
    pause
    exit
)

echo.
echo =================================================
echo    SUCCESS! NDK INSTALLED.
echo =================================================

:: چک کردن نهایی
if exist "%SDK_ROOT%\ndk\27.0.12077973" (
    echo Verification: Folder exists!
    echo Now you can go back and run 'RUN_ME.bat'.
) else (
    echo Warning: Installation said success but folder is missing.
)

pause