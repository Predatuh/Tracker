@echo off
REM Development launcher - runs both backend and frontend

echo.
echo ========================================
echo LBD Tracker - Development Mode
echo ========================================
echo.
echo Starting backend and frontend...
echo.

REM Start backend in new window
start "LBD Tracker Backend" cmd /k "cd backend && python run.py"

REM Wait a bit for backend to start
timeout /t 3

REM Start frontend in new window
start "LBD Tracker Frontend" cmd /k "cd frontend && npm start"

echo.
echo ========================================
echo Application will open in browser
echo Backend: http://localhost:5000
echo Frontend: http://localhost:3000
echo ========================================
echo.
echo Close these windows to stop the application
echo.
