# Quick Start Guide

Get your LBD Tracker up and running in 10 minutes!

## Prerequisites

- Python 3.8+ with pip
- Node.js 14+ with npm
- Poppler installed (for PDF processing)

### Install Poppler

#### Windows
1. Download from: https://github.com/oschwartz10612/poppler-windows/releases/
2. Extract to a folder (e.g., `C:\Program Files\poppler`)
3. Add to PATH:
   - Search "Environment Variables" in Windows
   - Edit System Environment Variables → Environment Variables
   - Add poppler bin folder to PATH

#### macOS
```bash
brew install poppler
```

#### Linux
```bash
apt-get install poppler-utils
```

## Backend Setup (5 minutes)

```bash
# Navigate to backend folder
cd backend

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Run server
python run.py
```

✅ Backend running at: http://localhost:5000/api

## Frontend Setup (5 minutes)

```bash
# In another terminal, navigate to frontend folder
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

✅ Frontend running at: http://localhost:3000

## First Time Usage

1. **Upload a PDF**: Go to "Upload PDF" tab
   - Select your LBD tracking PDF
   - Choose pages to extract
   - Click "Extract Pages"

2. **Create Power Blocks**: Pages are auto-converted to power blocks
   - View in "Power Blocks" tab

3. **Add LBDs**: Click on a power block
   - Click "Add New LBD"
   - Fill in details
   - Click "Add LBD"

4. **Track Status**: Click colored buttons to toggle status
   - 6 status types in different colors
   - Changes are saved automatically

5. **Upload Site Map** (Optional): 
   - Go to "Site Map" tab
   - Upload an SVG or image
   - Link blocks to areas on map

## Common Issues

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` |
| `pdf2image error` | Install Poppler (see above) |
| Port 5000/3000 in use | Change port in run.py or npm start |
| CSS not loading | Clear browser cache (Ctrl+Shift+Delete) |

## Project File Structure

```
backend/
├── app/models/      ← Database schemas
├── app/routes/      ← API endpoints
├── app/utils/       ← PDF & image processing
├── run.py           ← Start here
└── requirements.txt ← Python packages

frontend/
├── src/components/  ← React pages
├── src/api/         ← API client
├── public/          ← Static files
└── package.json     ← NPM packages
```

## Database

SQLite database is created automatically in `backend/` folder:
- `lbd_tracker.db` - Contains all your data

To reset: Delete this file and restart the server.

## Next Steps

1. Read [DETAILED_GUIDE.md](DETAILED_GUIDE.md) for full documentation
2. Customize status colors in `backend/app/models/status.py`
3. Adjust styling in component `.css` files
4. Deploy using the Deployment section in DETAILED_GUIDE.md

---

**Need help?** Check DETAILED_GUIDE.md Troubleshooting section!
