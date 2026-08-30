@echo off
TITLE Sanatify MISSION IMPOSSIBLE BUILD
COLOR 0A
CLS

echo =================================================
echo    STEP 1: DEFINING ABSOLUTE PATHS
echo =================================================

:: 1. آدرس‌های ویندوزی (برای اجرای دستورات در CMD)
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"

:: 2. آدرس‌های اندروید
set "SDK_ROOT=C:\Users\msi\AppData\Local\Android\Sdk"
set "NDK_PATH=%SDK_ROOT%\ndk\27.0.12077973"

:: 3. آدرس اسکریپت اکسپو (بدون پسوند)
set "EXPO_CLI=node_modules\expo\bin\cli"

:: 4. آدرس‌های مخصوص گریدل (با اسلش / و نام کوتاه برای جلوگیری از باگ فاصله)
:: این متغیرها داخل فایل gradle.properties نوشته میشوند
set "SDK_GRADLE=C:/Users/msi/AppData/Local/Android/Sdk"
set "NDK_GRADLE=C:/Users/msi/AppData/Local/Android/Sdk/ndk/27.0.12077973"
set "NODE_GRADLE=C:/Progra~1/nodejs/node.exe"

:: 5. تنظیم PATH فقط برای فایل‌های سیستمی ویندوز (بدون دستکاری نود و جاوا)
set "PATH=C:\Windows\System32;C:\Windows;%SDK_ROOT%\platform-tools"

echo [OK] All paths defined explicitly.

echo.
echo =================================================
echo    STEP 2: PREPARING PROJECT
echo =================================================

cd /d "%~dp0"

:: تست نود با آدرس مستقیم
"%NODE_EXE%" -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [CRITICAL ERROR] Node.exe not found at: "%NODE_EXE%"
    pause
    exit
)

:: نصب پکیج‌ها
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

:: چک کردن قالب
if not exist expo-template-bare-minimum-*.tgz (
    call "%NPM_CMD%" pack expo-template-bare-minimum@sdk-52
)
for %%f in (expo-template-bare-minimum-*.tgz) do set TEMPLATE_FILE=%%f

:: >>> اجرای مستقیم فایل node.exe روی فایل expo cli <<<
"%NODE_EXE%" "%EXPO_CLI%" prebuild --platform android --clean --template .\%TEMPLATE_FILE%

if not exist android (
    echo [ERROR] Prebuild failed.
    pause
    exit
)

echo [OK] Android project generated.

echo.
echo =================================================
echo    STEP 4: WRITING CONFIGS (SLASH FIXED)
echo =================================================

cd android

:: 1. ساخت local.properties
(
echo sdk.dir=%SDK_GRADLE%
echo ndk.dir=%NDK_GRADLE%
) > local.properties

:: 2. ساخت gradle.properties
:: نکته: ما آدرس NODE_GRADLE را که اسلش / دارد اینجا مینویسیم
(
echo org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8
echo org.gradle.daemon=false
echo org.gradle.parallel=false
echo android.useAndroidX=true
echo android.enableJetifier=true
echo hermesEnabled=true
echo newArchEnabled=false
echo kotlin.version=1.9.24
echo reactNativeNodeExecutable=%NODE_GRADLE%
) > gradle.properties

echo [OK] Configs written successfully.

echo.
echo =================================================
echo    STEP 5: COMPILING APK
echo    *** BOOST VPN MUST BE ON ***
echo =================================================

:: ست کردن جاوا هوم برای این جلسه
set "JAVA_HOME=%JAVA_HOME%"
set "PATH=%JAVA_HOME%\bin;%PATH%"

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