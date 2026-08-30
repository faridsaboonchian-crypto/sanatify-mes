@echo off
TITLE Sanatify FINAL LINEAR BUILD
COLOR 0A
CLS

echo =================================================
echo    STEP 1: DETECTING PATHS (SHORT NAME MODE)
echo =================================================

set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "NODE_LONG=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "SDK_ROOT=C:\Users\msi\AppData\Local\Android\Sdk"
set "NDK_PATH=%SDK_ROOT%\ndk\27.0.12077973"

:: تبدیل آدرس نود به نام کوتاه (8.3) برای گریدل
for %%I in ("%NODE_LONG%") do set "NODE_SHORT=%%~sI"
set "NODE_GRADLE=%NODE_SHORT:\=/%"

echo [INFO] Safe Node Path: %NODE_GRADLE%

:: تنظیم PATH برای اسکریپت
set "PATH=%NODE_SHORT%\..;%JAVA_HOME%\bin;%SDK_ROOT%\platform-tools;C:\Windows\System32;C:\Windows"

echo [OK] Environment Ready.

echo.
echo =================================================
echo    STEP 2: GENERATING ANDROID PROJECT
echo =================================================

cd /d "%~dp0"
set "EXPO_CLI=%~dp0node_modules\expo\bin\cli"

if exist android rmdir /s /q android

echo Running Prebuild...

if not exist expo-template-bare-minimum-*.tgz (
    call "%NPM_CMD%" pack expo-template-bare-minimum@sdk-52
)
for %%f in (expo-template-bare-minimum-*.tgz) do set TEMPLATE_FILE=%%f

"%NODE_LONG%" "%EXPO_CLI%" prebuild --platform android --clean --template .\%TEMPLATE_FILE%

if not exist android (
    echo [ERROR] Prebuild failed.
    pause
    exit
)

echo [OK] Android project generated.

echo.
echo =================================================
echo    STEP 3: WRITING CONFIGS (LINEAR SAFE MODE)
echo    (Writing line-by-line to avoid syntax errors)
echo =================================================

cd android

:: 1. ساخت local.properties
echo sdk.dir=%SDK_ROOT:\=\\%> local.properties
echo ndk.dir=%NDK_PATH:\=\\%>> local.properties

:: 2. ساخت gradle.properties (با آدرس امن نود + تنظیمات رم)
echo org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8> gradle.properties
echo org.gradle.daemon=false>> gradle.properties
echo org.gradle.parallel=false>> gradle.properties
echo android.useAndroidX=true>> gradle.properties
echo android.enableJetifier=true>> gradle.properties
echo hermesEnabled=true>> gradle.properties
echo newArchEnabled=false>> gradle.properties
echo kotlin.version=1.9.24>> gradle.properties
:: این خط طلایی است که قبلاً کار کرد:
echo reactNativeNodeExecutable=%NODE_GRADLE%>> gradle.properties

:: 3. ساخت init.gradle (روش خطی - بدون پرانتز گروهی)
echo allprojects { > init.gradle
echo     buildscript { >> init.gradle
echo         repositories { >> init.gradle
echo             maven { url 'https://maven.aliyun.com/repository/google' } >> init.gradle
echo             maven { url 'https://maven.aliyun.com/repository/public' } >> init.gradle
echo             google() >> init.gradle
echo             mavenCentral() >> init.gradle
echo         } >> init.gradle
echo     } >> init.gradle
echo     repositories { >> init.gradle
echo         maven { url 'https://maven.aliyun.com/repository/google' } >> init.gradle
echo         maven { url 'https://maven.aliyun.com/repository/public' } >> init.gradle
echo         google() >> init.gradle
echo         mavenCentral() >> init.gradle
echo     } >> init.gradle
echo } >> init.gradle

echo [OK] All Configs Written Successfully.

echo.
echo =================================================
echo    STEP 4: COMPILING APK
echo    *** BOOST VPN MUST BE ON ***
echo =================================================

set "JAVA_HOME=%JAVA_HOME%"

echo Building APK...
echo Please wait...

:: اجرای بیلد با init script سالم
call gradlew.bat assembleRelease --init-script init.gradle

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