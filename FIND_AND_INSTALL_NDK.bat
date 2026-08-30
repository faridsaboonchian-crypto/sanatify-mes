@echo off
TITLE Sanatify NDK HUNTER (DIRECT JAVA)
COLOR 0B
CLS

echo =================================================
echo    STEP 1: SETUP JAVA (DIRECT PATH METHOD)
echo =================================================

:: استفاده از آدرس مستقیم که قبلاً جواب داده است
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"

:: تست جاوا با فراخوانی مستقیم فایل
if exist "%JAVA_EXE%" (
    echo [OK] Java found at: %JAVA_EXE%
    "%JAVA_EXE%" -version
) else (
    echo [FATAL ERROR] Java file not found.
    pause
    exit
)

echo.
echo =================================================
echo    STEP 2: FINDING SDK MANAGER
echo    (Searching disk... This takes 10-20 seconds)
echo =================================================

:: رفتن به پوشه SDK کاربر msi
cd /d "C:\Users\msi\AppData\Local\Android\Sdk"

set "MY_SDK_MANAGER="
:: جستجوی فایل اجرایی در زیرپوشه‌ها
for /f "delims=" %%F in ('dir /s /b sdkmanager.bat') do set "MY_SDK_MANAGER=%%F"

if "%MY_SDK_MANAGER%"=="" (
    echo.
    echo [CRITICAL ERROR] sdkmanager.bat not found.
    echo Please reinstall 'Android SDK Command-line Tools' in Android Studio.
    pause
    exit
)

echo FOUND: "%MY_SDK_MANAGER%"

echo.
echo =================================================
echo    STEP 3: INSTALLING NDK 27
echo    *** VPN (Boost) MUST BE ON ***
echo =================================================

echo Installing NDK version 27.0.12077973...

:: تنظیم متغیر محیطی برای اینکه خودِ sdkmanager جاوا را گم نکند
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

:: اجرای دستور نصب
(echo y) | "%MY_SDK_MANAGER%" "ndk;27.0.12077973"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation failed.
    echo 1. Check VPN (Boost).
    echo 2. Check Disk Space.
    pause
    exit
)

echo.
echo =================================================
echo    SUCCESS! NDK INSTALLED.
echo =================================================

if exist "C:\Users\msi\AppData\Local\Android\Sdk\ndk\27.0.12077973" (
    echo Verification Passed.
    echo.
    echo NOW RUN 'RUN_ME.bat' (or GENERATE_ANDROID.bat) AGAIN!
) else (
    echo Warning: NDK installed but folder check failed. Try building anyway.
)

pause