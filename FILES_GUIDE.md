# 📋 LBD Tracker - File Guide

Quick reference for all files in the project.

## 🎯 START HERE

### For Users (Just Want to Use It)
1. **Run** → Double-click `LBDTracker.exe` (pre-built version)
2. **Done!** No setup needed

### For Developers (Want to Build/Customize)
1. **Read** → [EXE_BUILD_READY.md](EXE_BUILD_READY.md) (this guide!)
2. **Setup** → Run `python setup.py`
3. **Build** → Run `build.bat` (Windows) or `./build.sh` (macOS/Linux)
4. **Find** → Look in `dist/` folder for your EXE

### For Quick Testing
1. **Run** → `run_dev.bat` (Windows) or `./run_dev.sh` (macOS/Linux)
2. **Browser** → Opens at `http://localhost:3000`
3. **Changes** → Save and auto-reload

---

## 📁 Project Files Explained

### Root Directory

| File | Purpose |
|------|---------|
| **main.py** | PyQt5 desktop app wrapper - bridges backend & frontend |
| **setup.py** | One-command setup installer |
| **build.bat** | Windows script to build EXE |
| **build.sh** | macOS/Linux script to build application |
| **run_dev.bat** | Windows developer launcher |
| **run_dev.sh** | macOS/Linux developer launcher |
| **LBDTracker.spec** | PyInstaller configuration for EXE building |
| **README.md** | Main documentation (START HERE!) |
| **BUILD_EXE.md** | Detailed EXE building instructions |
| **QUICKSTART.md** | Quick setup guide |
| **DETAILED_GUIDE.md** | Complete technical documentation |
| **EXE_BUILD_READY.md** | This file - summary & instructions |
| **icon_converter.py** | Utility to convert PNG to ICO for custom app icon |

### Backend Folder (`backend/`)

| File | Purpose |
|------|---------|
| **run.py** | Flask server entry point |
| **requirements.txt** | Python package dependencies |
| **.env.example** | Environment variables template |
| **app/__init__.py** | Flask app initialization & database setup |
| **app/models/** | Database schemas (PowerBlock, LBD, Status, etc.) |
| **app/routes/** | API endpoints (pdf, tracker, map, lbd) |
| **app/utils/** | Utilities (PDF processor, image processor) |
| **uploads/** | Folder for user-uploaded PDFs and images |

### Frontend Folder (`frontend/`)

| File | Purpose |
|------|---------|
| **package.json** | Node.js dependencies |
| **public/index.html** | HTML entry point |
| **src/index.js** | React app entry |
| **src/App.js** | Main React component |
| **src/App.css** | Global styles |
| **src/api/apiClient.js** | API communication layer |
| **src/components/** | React pages & components |
| **build/** | Built frontend (created by `npm run build`) |

---

## 🔄 Build Process Explained

### Step 1: Setup (`python setup.py`)
```
Installs:
  └─ Python packages (Flask, SQLAlchemy, etc.)
  └─ Desktop packages (PyQt5, PyQtWebEngine)
  └─ Node.js packages (React, etc.)
  └─ PyInstaller (tool to create EXE)
```

### Step 2: Build (`build.bat` or `build.sh`)
```
Processes:
  ├─ Builds React frontend → optimized static files
  ├─ Creates Python .pyz → compressed Python bytecode
  ├─ Embeds backend & frontend into binary
  ├─ Includes all dependencies
  └─ Outputs → dist/LBDTracker.exe
```

### Step 3: Run (`dist/LBDTracker.exe`)
```
On startup:
  ├─ PyQt5 creates window
  ├─ Starts Flask backend silently (port 5000)
  ├─ Loads React frontend in embedded browser
  └─ User sees fully working app
```

---

## 💡 Key Concepts

### What is main.py?
- **PyQt5 Desktop Wrapper** - Creates a native Windows/Mac/Linux window
- Starts Flask backend in background
- Embeds React frontend in Qt web view
- Handles window lifecycle

### What is PyInstaller?
- **Executable Builder** - Packages Python into standalone EXE
- Includes Python runtime (300+ MB)
- Includes all dependencies
- Makes standalone executable

### What is the EXE Size?
- **200-400 MB** - This is normal!
- Contains: Python (100MB) + Libraries (100MB) + App (50MB) + Data (50MB)
- One-time download, can run from anywhere

---

## 🚀 Quick Commands

```bash
# First time (one-time setup)
python setup.py

# Development (with live reload)
run_dev.bat

# Build EXE
build.bat

# Find your EXE
dist/LBDTracker.exe

# Clean build artifacts
rmdir /s build dist
```

---

## 📦 Distribution

### To Share Your Application
1. Build EXE with `build.bat`
2. Find `dist/LBDTracker.exe` 
3. Share the EXE file (200-400 MB)
4. Users just double-click it - no setup!

### Create Installer (Optional)
Use [NSIS](http://nsis.sourceforge.net/) or [Inno Setup](http://www.jrsoftware.org/isinfo.php) to wrap EXE in installer.

---

## 🎨 Customization Checklist

- [ ] Change app name in `LBDTracker.spec`
- [ ] Add custom icon (`icon.png` → `icon.ico`)
- [ ] Modify status colors in `backend/app/models/status.py`
- [ ] Update company name in installer
- [ ] Test with `run_dev.bat` first
- [ ] Build final EXE with `build.bat`

---

## ⚠️ Common Issues & Solutions

| Issue | File to Check |
|-------|---------------|
| "PDF won't upload" | backend/app/utils/pdf_processor.py |
| "Styles look wrong" | frontend/src/App.css |
| "API not responding" | backend/run.py, app/__init__.py |
| "EXE won't start" | LBDTracker.spec, main.py |
| "Missing dependencies" | desktop_requirements.txt, requirements.txt |

---

## 📖 Documentation Map

```
📚 Documentation
├─ README.md              ← Start here for overview
├─ EXE_BUILD_READY.md     ← This file
├─ BUILD_EXE.md           ← Detailed build instructions
├─ QUICKSTART.md          ← 5-minute quick start
├─ DETAILED_GUIDE.md      ← Complete technical docs
└─ This file (FILES_GUIDE.md)
```

---

## ✅ Checklist Before Building

- [ ] Python 3.8+ installed
- [ ] Node.js 14+ installed
- [ ] Poppler installed (for PDF processing)
- [ ] All dependencies installed (`python setup.py`)
- [ ] Backend runs: `python backend/run.py`
- [ ] Frontend runs: `npm start` (from frontend folder)
- [ ] Tested with `run_dev.bat`
- [ ] Ready to build!

---

## 🎉 You're Ready!

Everything is set up. Just run:

```bash
build.bat
```

Your EXE will be in `dist/LBDTracker.exe` in a few minutes!

---

**Questions?** Check README.md or DETAILED_GUIDE.md 📚
