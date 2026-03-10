@echo off
REM Build script for LBD Tracker EXE
REM Run this after installing: pip install -r desktop_requirements.txt pyinstaller

echo.
echo ========================================
echo LBD Tracker - Building EXE
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python not found. Please install Python first.
    exit /b 1
)

REM Check if Node.js is installed for frontend build
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Warning: Node.js not found. Skipping frontend build.
    echo Make sure frontend is built manually by running: cd frontend ^&^& npm run build
    echo.
    pause
) else (
    echo Building frontend...
    cd frontend
    call npm run build
    if %errorlevel% neq 0 (
        echo Error: Frontend build failed
        exit /b 1
    )
    cd ..
    echo Frontend build complete.
    echo.
)

REM Build backend requirements for PyInstaller
echo Installing dependencies...
pip install -r backend\requirements.txt
pip install -r desktop_requirements.txt
pip install pyinstaller

if %errorlevel% neq 0 (
    echo Error: Failed to install dependencies
    exit /b 1
)

REM Build the EXE
echo.
echo Building EXE with PyInstaller...
pyinstaller build.spec

if %errorlevel% neq 0 (
    echo Error: PyInstaller build failed
    exit /b 1
)

echo.
echo ========================================
echo Build complete!
echo EXE file created in: dist\LBDTracker.exe
echo ========================================
echo.
pause
