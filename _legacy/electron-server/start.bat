@echo off
echo Starting AI Context Transfer Dashboard...
echo.

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

echo ✓ Node.js found
echo.

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting server on http://localhost:3000...
start http://localhost:3000
node server.js
pause
