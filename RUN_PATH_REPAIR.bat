@echo off
TITLE Sanatify FINAL PATH REPAIR
COLOR 0A
CLS

echo =================================================
echo    STEP 1: DEFINING ABSOLUTE PATHS
echo =================================================

:: آدرس‌های مستقیم
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "SDK_ROOT=C:\Users\msi\AppData\Local\Android\Sdk"
set "NDK_PATH=%SDK_ROOT%\ndk\27.0.12077973"
set "EXPO_CLI=node_modules\expo\bin\cli"

:: آدرس نود برای تزریق به گریدل (فرمت کوتاه بدون فاصله)
set "NODE_DIR_SAFE=C:\Progra~1\nodejs"

echo [OK] Paths Defined.

echo.
echo =================================================
echo    STEP 2: PREPARING PROJECT
echo =================================================

cd /d "%~dp0"

:: اگر نود ماژول نیست، نصب کن
if not exist node_modules (
    echo Installing dependencies...
    call "%NPM_CMD%" install
)

:: پاکسازی بیلد قبلی
if exist android rmdir /s /q android

echo.
echo =================================================
echo    STEP 3: GENERATING ANDROID PROJECT
echo =================================================

echo Running Prebuild...

if not exist expo-template-bare-minimum-*.tgz (
    call "%NPM_CMD%" pack expo-template-bare-minimum@sdk-52
)
for %%f in (expo-template-bare-minimum-*.tgz) do set TEMPLATE_FILE=%%f

:: اجرای بیلد با آدرس مستقیم (بدون نیاز به PATH)
"%NODE_EXE%" "%EXPO_CLI%" prebuild --platform android --clean --template .\%TEMPLATE_FILE%

if not exist android (
    echo [ERROR] Prebuild failed.
    pause
    exit
)

echo [OK] Android project generated.

echo.
echo =================================================
echo    STEP 4: WRITING CONFIGS
echo =================================================

cd android

:: 1. ساخت local.properties
(
echo sdk.dir=%SDK_ROOT:\=\\%
echo ndk.dir=%NDK_PATH:\=\\%
) > local.properties

:: 2. ساخت gradle.properties
:: ما آدرس فایل نود را با اسلش لینوکسی هم میدهیم محض اطمینان
(
echo org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8
echo org.gradle.daemon=false
echo org.gradle.parallel=false
echo android.useAndroidX=true
echo android.enableJetifier=true
echo hermesEnabled=true
echo newArchEnabled=false
echo kotlin.version=1.9.24
echo reactNativeNodeExecutable=C:/Progra~1/nodejs/node.exe
) > gradle.properties

echo [OK] Configs written.

echo.
echo =================================================
echo    STEP 5: COMPILING APK
echo    *** BOOST VPN MUST BE ON ***
echo =================================================

set "JAVA_HOME=%JAVA_HOME%"

:: >>> اصلاح حیاتی: بازگرداندن نود به PATH برای گریدل <<<
:: گریدل برای اجرای اسکریپت‌های داخلی به دستور 'node' نیاز دارد
set "PATH=%NODE_DIR_SAFE%;%JAVA_HOME%\bin;%SDK_ROOT%\platform-tools;C:\Windows\System32;C:\Windows"

echo Testing Node visibility for Gradle...
node -v
if %errorlevel% neq 0 (
    echo [CRITICAL WARNING] Node not found in PATH. Gradle might fail.
    echo Trying fallback path injection...
    set "PATH=C:\Program Files\nodejs;%PATH%"
)

echo.
echo Building APK... (10-15 mins)

:: اجرای بیلد
call gradlew.bat assembleRelease

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build Failed!
    cd ..
    pause
    exit
)

echo.
echo =================================================
echo    VICTORY! APK IS READY.
echo =================================================

cd ..
copy "android\app\build\outputs\apk\release\app-release.apk" "Sanatify-Final.apk"

echo File location: %CD%\Sanatify-Final.apk
pause