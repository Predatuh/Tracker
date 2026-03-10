# Building LBD Tracker EXE

Two options: **Quick Development** mode or **Full Production** EXE.

## Option 1: Quick Development Mode (Easiest)

Run both backend and frontend with a single batch file:

### Windows
```bash
run_dev.bat
```

This opens the application in your default browser with auto-reload.

### macOS/Linux
```bash
chmod +x run_dev.sh
./run_dev.sh
```

---

## Option 2: Build Production EXE (Standalone Executable)

Create a single `LBDTracker.exe` file that includes everything.

### Prerequisites
- Python 3.8+ installed
- Node.js 14+ installed
- Poppler installed (for PDF processing)

### Step 1: Prepare Environment

```bash
# Install all dependencies
pip install -r backend/requirements.txt
pip install -r desktop_requirements.txt
pip install pyinstaller
```

### Step 2: Build Frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

This creates optimized files in `frontend/build/`

### Step 3: Build EXE

#### On Windows:
```bash
build.bat
```

#### On macOS/Linux:
```bash
chmod +x build.sh
./build.sh
```

This will:
1. Build the React frontend
2. Install all Python dependencies
3. Create the PyInstaller app
4. Generate `LBDTracker.exe` in the `dist/` folder

### Step 4: Run the EXE

Simply double-click `dist/LBDTracker.exe` 

The application will:
- Start the Flask backend automatically
- Open the React frontend in an embedded browser
- Work completely standalone (no additional setup needed)

---

## Troubleshooting Build Issues

### Issue: "Python not found"
- Install Python from python.org
- Add Python to PATH during installation

### Issue: "Node.js not found"  
- Install Node.js from nodejs.org
- Or skip with enter (requires manual `npm run build`)

### Issue: Poppler error when building
- This is okay - install poppler after building EXE
- Or include in the final EXE by modifying LBDTracker.spec

### Issue: Build fails with module not found
```bash
# Clear and rebuild
rm -rf build dist
pip install --upgrade -r backend/requirements.txt
pyinstaller LBDTracker.spec --clean
```

### Issue: EXE is very large (500MB+)
- This is normal - it includes Python, all libraries, and frontend
- Consider using upx compression in spec file for smaller size

---

## File Sizes & Details

| Component | Size | Notes |
|-----------|------|-------|
| EXE | ~200-400 MB | Includes Python + all dependencies |
| Backend | ~50 MB | Flask + PDF processing |
| Frontend | ~20 MB | React app |
| Database | Created on first run | SQLite |

---

## Distribution

To share the EXE:
- Copy `dist/LBDTracker.exe` to users
- No installation or setup required
- Works on any Windows machine with similar specs

---

## Customization

### Change Application Icon
1. Create a 256x256 PNG image named `icon.png`
2. Convert to ICO: `pip install pillow && python -c "from PIL import Image; img=Image.open('icon.png'); img.save('icon.ico')"`
3. Icon will be included in next build

### Change Application Name
Edit `LBDTracker.spec`:
- `name='LBDTracker'` → `name='MyAppName'`

### Include Additional Files
Edit `LBDTracker.spec` `datas` section:
```python
datas=[
    ('backend', 'backend'),
    ('frontend/build', 'frontend/build'),
    ('my_folder', 'my_folder'),  # Add this
],
```

---

## Notes

- The EXE includes a complete Python runtime (~300MB)
- Database is created in user's temp directory on first run
- All settings are stored locally (no cloud sync)
- Uploaded files stored in the app's data folder
