@echo off
chcp 65001 >nul
title Context Hub - Test App

echo ================================================
echo   Testing Context Hub Desktop App
echo ================================================
echo.

REM Kill any existing Electron/Node processes
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting fresh instance...
echo.

start "" node main.js

echo [OK] App started!
echo.
echo Opening test page in your browser to verify functionality...
echo.

REM Wait a moment then open test page
timeout /t 3 /nobreak >nul
start https://code.visualstudio.com

echo.
echo ================================================
echo   VERIFICATION STEPS:
echo ================================================
echo.
echo 1. Look for a window titled "Context Hub" 
echo    (It might be behind other windows)
echo.
echo 2. Open this test page manually:
echo    %CD%\test-app.html
echo.
echo 3. Check that you can see:
echo    - ✓ Running in native Electron desktop app
echo    - ✓ File System Module Available  
echo    - ✓ List of directories on your computer
echo.
echo 4. The main window should show:
echo    - Blue gradient sidebar
echo    - Dashboard with stats cards  
echo    - "Scan System" button
echo    - Clean, modern interface
echo.
pause
