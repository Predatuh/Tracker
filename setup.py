#!/usr/bin/env python3
"""
Simple setup script to fetch and install all dependencies
Run once before building: python setup.py
"""

import subprocess
import sys
import os

def run_command(cmd, description):
    """Run a command and report status"""
    print(f"\n{'='*50}")
    print(f"Installing: {description}")
    print(f"{'='*50}")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        print(f"❌ Failed: {description}")
        return False
    print(f"✅ Success: {description}")
    return True

def main():
    print("\n" + "="*50)
    print("LBD Tracker - Setup Script")
    print("="*50)
    
    # Backend dependencies
    if not run_command("pip install -r backend/requirements.txt", "Backend dependencies"):
        return 1
    
    # Desktop dependencies
    if not run_command("pip install -r desktop_requirements.txt", "Desktop dependencies"):
        return 1
    
    # PyInstaller
    if not run_command("pip install pyinstaller", "PyInstaller"):
        return 1
    
    # Frontend dependencies
    print(f"\n{'='*50}")
    print("Installing: Frontend dependencies")
    print(f"{'='*50}")
    os.chdir("frontend")
    if not run_command("npm install", "Node packages"):
        return 1
    os.chdir("..")
    
    print("\n" + "="*50)
    print("✅ Setup Complete!")
    print("="*50)
    print("\nNext steps:")
    print("1. Windows: Run 'build.bat' to create EXE")
    print("2. macOS/Linux: Run './build.sh' to create app")
    print("3. Or run 'run_dev.bat' for development mode")
    print("\n" + "="*50)
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
