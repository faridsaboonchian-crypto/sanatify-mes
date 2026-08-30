@echo off
TITLE Sanatify CORE BUILDER

:: 1. پاکسازی محیط
taskkill /F /IM java.exe >nul 2>&1

:: 2. تنظیم آدرس‌ها (بدون پیچیدگی)
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.10.7-hotspot"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "EXPO_CLI_JS=node_modules\expo\bin\cli"

:: 3. تنظیم مسیر ویندوز
set "PATH=%JAVA_HOME%\bin;C:\Program Files\nodejs;C:\Windows\System32;C:\Windows"

echo [STEP 1] Environment Configured.

:: 4. نصب وابستگی‌ها
cd /d "%~dp0"
if not exist node_modules call "%NPM_CMD%" install

:: 5. پاکسازی اندروید
if exist android rmdir /s /q android

echo [STEP 2] Generating Android Project...

:: دانلود قالب به روش امن
if not exist expo-template-bare-minimum-*.tgz call "%NPM_CMD%" pack expo-template-bare-minimum@sdk-52
for %%f in (expo-template-bare-minimum-*.tgz) do set TEMPLATE_FILE=%%f

:: اجرای Prebuild
"%NODE_EXE%" "%EXPO_CLI_JS%" prebuild --platform android --clean --template .\%TEMPLATE_FILE%

if not exist android (
    echo [FATAL ERROR] Android folder missing.
    exit /b 1
)

echo [STEP 3] Configuring Gradle...

cd android
cd gradle
cd wrapper

:: نوشتن فایل تنظیمات گرادل (خط به خط برای جلوگیری از کرش)
echo distributionBase=GRADLE_USER_HOME> gradle-wrapper.properties
echo distributionPath=wrapper/dists>> gradle-wrapper.properties
echo distributionUrl=https\://services.gradle.org/distributions/gradle-8.13-bin.zip>> gradle-wrapper.properties
echo zipStoreBase=GRADLE_USER_HOME>> gradle-wrapper.properties
echo zipStorePath=wrapper/dists>> gradle-wrapper.properties

cd ..
cd ..

:: نوشتن فایل local.properties
echo sdk.dir=%LOCALAPPDATA:\=\\%\\Android\\Sdk> local.properties

:: نوشتن فایل init.gradle برای پروکسی
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

echo [STEP 4] Starting Compilation (Active VPN Required)...

:: اجرای بیلد (بدون sub-shell برای دیدن لاگ مستقیم)
call gradlew.bat assembleRelease --init-script init.gradle

if %errorlevel% neq 0 (
    echo [FATAL ERROR] Gradle crashed.
    exit /b 1
)

echo [SUCCESS] APK Generated!
cd ..
copy "android\app\build\outputs\apk\release\app-release.apk" "Sanatify-Final.apk"