#!/bin/bash
# Development launcher - runs both backend and frontend

echo ""
echo "========================================"
echo "LBD Tracker - Development Mode"
echo "========================================"
echo ""
echo "Starting backend and frontend..."
echo ""

# Open new terminal windows for backend and frontend
open -a Terminal backend/run.py &
sleep 3
open -a Terminal "cd frontend && npm start" &

echo ""
echo "========================================"
echo "Application will open in browser"
echo "Backend: http://localhost:5000"
echo "Frontend: http://localhost:3000"  
echo "========================================"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Keep script running
wait
