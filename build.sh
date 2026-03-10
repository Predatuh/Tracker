#!/bin/bash
# Build script for LBD Tracker application
# Run after installing: pip install -r desktop_requirements.txt pyinstaller

echo ""
echo "========================================"
echo "LBD Tracker - Building Application"
echo "========================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found. Please install Python first."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Warning: Node.js not found. Skipping frontend build."
    echo "Make sure frontend is built manually: cd frontend && npm run build"
    read -p "Press Enter to continue..."
else
    echo "Building frontend..."
    cd frontend
    npm run build
    if [ $? -ne 0 ]; then
        echo "Error: Frontend build failed"
        exit 1
    fi
    cd ..
    echo "Frontend build complete."
    echo ""
fi

# Install dependencies
echo "Installing dependencies..."
pip3 install -r backend/requirements.txt
pip3 install -r desktop_requirements.txt
pip3 install pyinstaller

if [ $? -ne 0 ]; then
    echo "Error: Failed to install dependencies"
    exit 1
fi

# Build the application
echo ""
echo "Building application with PyInstaller..."
pyinstaller LBDTracker.spec

if [ $? -ne 0 ]; then
    echo "Error: Build failed"
    exit 1
fi

echo ""
echo "========================================"
echo "Build complete!"
echo "Application created in: dist/"
echo "========================================"
echo ""
