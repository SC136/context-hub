@echo off
chcp 65001 >nul 2>&1
title Context Hub - AI Session Manager

echo ================================================
echo   Context Hub - Native Desktop App
echo   Scans your device for AI coding sessions
echo ================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js found
echo.

REM Check if app dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies already installed
)

echo.
echo Starting Context Hub...
echo.
echo The application window will open shortly.
echo If it doesn't appear, check Task Manager.
echo.
echo Closing this window will quit the application.
echo.

REM Start the Electron app
start "" node main.js

echo App started successfully!
pause
