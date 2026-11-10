@echo off
echo ================================================
echo AI Context Transfer Dashboard - Initial Setup
echo ================================================
echo.

REM Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js and npm are not installed.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo ✓ Node.js found
echo.

echo Step 1: Installing dashboard dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install dashboard dependencies
    pause
    exit /b 1
)
echo ✓ Dependencies installed
echo.

echo Step 2: Checking for ai-context-bridge (ctx)...
call where ctx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✓ ai-context-bridge already installed
) else (
    echo ⚠ ai-context-bridge not found
    echo Installing globally...
    call npm install -g ai-context-bridge
    if %ERRORLEVEL% EQU 0 (
        echo ✓ ai-context-bridge installed successfully
    ) else (
        echo WARNING: Could not install ai-context-bridge
        echo You can still use the dashboard with manual transfer instructions
    )
)
echo.

echo ================================================
echo Setup Complete!
echo ================================================
echo.
echo To start the dashboard, run:
echo   start.bat
echo.
echo Or manually:
echo   node server.js
echo   Then open http://localhost:3000 in your browser
echo.
pause
