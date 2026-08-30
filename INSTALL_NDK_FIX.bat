@echo off
TITLE Sanatify NDK FIXER
COLOR 0B
CLS

echo =================================================
echo    STEP 1: SETUP JAVA (User: msi)
echo =================================================

:: تنظیم دقیق JAVA_HOME (بدون bin)
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"

:: تنظیم PATH به صورتی که فقط همین جاوا را ببیند
set "PATH=%JAVA_HOME%\bin;C:\Windows\System32;C:\Windows"

:: تست جاوا
"%JAVA_EXE%" -version
if %errorlevel% neq 0 (
    echo [FATAL] Java not working.
    pause
    exit
)

echo.
echo =================================================
echo    STEP 2: LOCATING SDK MANAGER
echo =================================================

:: آدرس پایه SDK شما
set "SDK_ROOT=C:\Users\msi\AppData\Local\Android\Sdk"
cd /d "%SDK_ROOT%"

:: جستجوی فایل اجرایی (فقط در پوشه cmdline-tools)
set "TARGET_TOOL="
for /f "delims=" %%F in ('dir /s /b sdkmanager.bat') do set "TARGET_TOOL=%%F"

if "%TARGET_TOOL%"=="" (
    echo [ERROR] sdkmanager.bat not found in SDK folder!
    pause
    exit
)

echo Found tool at:
echo "%TARGET_TOOL%"

echo.
echo =================================================
echo    STEP 3: TESTING TOOL
echo =================================================

echo Testing sdkmanager health...
call "%TARGET_TOOL%" --version

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] sdkmanager crashed! 
    echo It likely doesn't like Java 17.
    echo.
    echo PLEASE INSTALL NDK MANUALLY VIA ANDROID STUDIO.
    pause
    exit
)

echo Tool is healthy. Proceeding...

echo.
echo =================================================
echo    STEP 4: INSTALLING NDK
echo    *** KEEP VPN (BOOST) ON ***
echo =================================================

echo Downloading NDK 27... This may take time...

:: اجرای دستور نصب با استفاده از call (جلوگیری از بسته شدن)
(echo y) | call "%TARGET_TOOL%" "ndk;27.0.12077973"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Installation failed.
    pause
    exit
)

echo.
echo =================================================
echo    SUCCESS! NDK INSTALLED.
echo =================================================

if exist "%SDK_ROOT%\ndk\27.0.12077973" (
    echo Folder verification passed.
    echo You can now run the build script!
) else (
    echo Warning: Folder not found, but command finished.
)

pause