@echo off
setlocal

REM Use direct command paths (independent from PATH)
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "NPX_CMD=C:\Program Files\nodejs\npx.cmd"

if not exist "%NPM_CMD%" (
    set "NPM_CMD=C:\Program Files (x86)\nodejs\npm.cmd"
    set "NPX_CMD=C:\Program Files (x86)\nodejs\npx.cmd"
)

if not exist "%NPM_CMD%" (
    echo ERROR: npm.cmd was not found.
    echo Checked:
    echo   C:\Program Files\nodejs\npm.cmd
    echo   C:\Program Files (x86)\nodejs\npm.cmd
    pause
    exit /b 1
)

echo ========================================
echo Housekeeping: removing old build scripts...
echo ========================================

if exist "BUILD_FINAL_APK.ps1" del /f /q "BUILD_FINAL_APK.ps1"
if exist "START_BUILD.bat" del /f /q "START_BUILD.bat"
if exist "BUILD_EAS.bat" del /f /q "BUILD_EAS.bat"
if exist "BUILD_COMPLETE.ps1" del /f /q "BUILD_COMPLETE.ps1"
if exist "BUILD_FIXED.bat" del /f /q "BUILD_FIXED.bat"
if exist "BUILD_LOCAL.bat" del /f /q "BUILD_LOCAL.bat"
if exist "BUILD_LOCAL.ps1" del /f /q "BUILD_LOCAL.ps1"
if exist "PREPARE_FOR_STUDIO.bat" del /f /q "PREPARE_FOR_STUDIO.bat"

echo.
echo ========================================
echo Removing old Android folder (if exists)...
echo ========================================
if exist "android" rmdir /s /q "android"

echo.
echo Installing dependencies...
call "%NPM_CMD%" install
if errorlevel 1 (
    echo.
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo Generating Android native code...
call "%NPX_CMD%" expo prebuild --platform android
if errorlevel 1 (
    echo.
    echo ERROR: Expo prebuild failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo DONE! Now open the 'MyFactoryApp\android' folder in Android Studio (NOT the root folder).
echo ========================================
pause
endlocal
