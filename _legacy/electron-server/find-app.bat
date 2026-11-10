@echo off
chcp 65001 >nul 2>&1
title Find Context Hub App

echo ================================================
echo   Finding Your Context Hub Desktop App
echo ================================================
echo.

REM Kill any existing processes first
echo Stopping any running instances...
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
echo Done.
echo.

echo Starting fresh app instance...
echo.

REM Start the app with a visible console that we can close
start "Context Hub" cmd /k "cd /d %CD% && node main.js"

echo.
echo ================================================
echo   NEXT STEPS:
echo ================================================
echo.
echo The Context Hub desktop window should appear NOW.
echo.
echo It will be a separate window titled 'Context Hub'
echo Look for it on your taskbar or press ALT+TAB
echo.
echo If you don't see it after 3 seconds:
echo  - Check Task Manager (Ctrl+Shift+Esc)
echo  - Look for 'Context Hub' or 'node' process
echo  - Switch to it from the Details tab
echo.
echo The window shows:
echo  • Blue sidebar with 'Context Hub' logo
echo  • Dashboard with stats cards
echo  • 'Scan System' button
echo  • Modern clean interface
echo.
pause

echo.
echo Press any key to exit when you've found the window...
