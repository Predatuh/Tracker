# LBD Tracker - Load Break Device Tracking System

An intelligent application that transforms PDF documents into an interactive tracking system for Load Break Devices (LBDs), integrated with site maps.

## ⚡ Quick Start

### Option 1: Run EXE (Easiest - Recommended!)
```
Download or build LBDTracker.exe and double-click it. Done!
```
See [BUILD_EXE.md](BUILD_EXE.md) for building your own EXE.

### Option 2: Development Mode
**Windows:**
```bash
run_dev.bat
```

**macOS/Linux:**
```bash
chmod +x run_dev.sh && ./run_dev.sh
```

Opens at: `http://localhost:3000`

---

## 📋 Features

### Core Functionality
- **PDF Processing**: Upload PDFs and extract selected pages as power block images
- **Power Block Management**: Create and manage power block records that correspond to PDF pages
- **LBD Tracking**: Add Load Break Devices to each power block and track their status
- **6-Status System**: Track 6 different completion statuses for each LBD with color coding
- **Interactive Site Maps**: Upload SVG or image-based site maps
- **Status Visualization**: Click power block areas on the map to view detailed LBD status

### Status Types & Colors
- 🔴 **Stuff** - Red (#FF6B6B)
- 🟦 **Term** - Teal (#4ECDC4)
- 🟨 **Stickers** - Yellow (#FFE66D)
- 🟩 **Ground/Brackets** - Mint (#95E1D3)
- 🟩 **Quality Check** - Light Green (#A8E6CF)
- 🟢 **Quality Docs** - Dark Green (#56AB91)

---

## 🏗️ Architecture

```
Backend: Flask REST API + SQLAlchemy ORM
Frontend: React with React Router
Database: SQLite (default, easily changeable)
Desktop: PyQt5 wrapper for standalone desktop app
```

### Project Structure
```
LBD TRACKER/
├── main.py                  # Desktop app launcher
├── LBDTracker.spec         # PyInstaller config
├── build.bat/build.sh      # Build scripts for EXE
├── run_dev.bat/run_dev.sh  # Development launcher
│
├── backend/                 # Flask API
│   ├── app/
│   │   ├── models/         # Database schemas
│   │   ├── routes/         # API endpoints
│   │   └── utils/          # PDF & image processing
│   ├── run.py
│   └── requirements.txt
│
└── frontend/                # React UI
    ├── src/components/     # Pages & components
    ├── public/
    └── package.json
```

---

## 🚀 Installation & Setup

### Prerequisites (For Building EXE or Development)
- Python 3.8+
- Node.js 14+  
- Poppler (for PDF processing)

#### Install Poppler

**Windows:**
1. Download: https://github.com/oschwartz10612/poppler-windows/releases/
2. Extract to `C:\Program Files\poppler`
3. Add `C:\Program Files\poppler\Library\bin` to Windows PATH
4. Restart terminal/IDE

**macOS:**
```bash
brew install poppler
```

**Linux:**
```bash
apt-get install poppler-utils
```

---

### Option 1: Use Pre-Built EXE
Simply download and run `LBDTracker.exe` - no setup required!

### Option 2: Build Your Own EXE

```bash
# Install build dependencies
pip install -r desktop_requirements.txt pyinstaller

# Build frontend (generates optimized files)
cd frontend
npm install
npm run build
cd ..

# Create EXE
pyinstaller LBDTracker.spec
```

**Result:** `dist/LBDTracker.exe` (200-400 MB)

Alternatively, use the build script:
- **Windows:** `build.bat`
- **macOS/Linux:** `chmod +x build.sh && ./build.sh`

See [BUILD_EXE.md](BUILD_EXE.md) for detailed instructions.

### Option 3: Development Setup

#### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
source venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
python run.py
```
API available at: `http://localhost:5000`

#### Frontend (in another terminal)
```bash
cd frontend
npm install
npm start
```
UI available at: `http://localhost:3000`

---

## 📖 Usage Workflow

### 1. Upload PDF
1. Click **Upload PDF** 
2. Select your tracking PDF
3. Choose pages to extract (one per power block)
4. Click **Extract Pages**

### 2. Create Power Blocks
1. Go to **Power Blocks**
2. Each extracted page becomes a power block automatically

### 3. Add LBDs
1. Click a power block
2. Fill in LBD details (name, identifier, position)
3. Click **Add LBD**
4. 6 status records are created automatically

### 4. Track Progress
1. Click colored status buttons to toggle completion
2. Color fills when status is complete
3. Changes save instantly

### 5. Upload Site Map
1. Go to **Site Map**
2. Upload SVG or image file
3. Link blocks to areas on map
4. View completion status on map (green = complete)

---

## 🔌 API Endpoints

### PDF Management (`/api/pdf`)
- `POST /upload` - Upload PDF file
- `POST /extract-pages` - Extract selected pages
- `POST /create-power-blocks` - Create power blocks from pages

### Tracker (`/api/tracker`)
- `GET /power-blocks` - List all power blocks
- `GET /power-blocks/<id>` - Get specific block
- `PUT /power-blocks/<id>` - Update block
- `POST /lbds` - Create LBD
- `GET /lbds/<id>` - Get LBD details
- `PUT /lbds/<id>` - Update LBD
- `PUT /lbds/<id>/status/<type>` - Update status

### Site Maps (`/api/map`)
- `POST /upload` - Upload site map
- `GET /sitemap/<id>` - Get site map
- `GET /sitemaps` - List all maps
- `POST /area` - Create site area
- `PUT /area/<id>` - Update site area
- `GET /map-status/<id>` - Get completion status

### LBD Info (`/api/lbd`)
- `GET /power-block/<id>/lbds` - Get power block's LBDs
- `GET /status-colors` - Get color mapping

---

## 🗄️ Database Models

### PowerBlock
- `id`, `name`, `page_number`
- `image_path` - Extracted PDF page
- `is_completed` - Block status
- `lbds` - One-to-many relationship

### LBD
- `id`, `name`, `identifier`
- `x_position`, `y_position` - Location on image
- `power_block_id` - Parent block
- `statuses` - One-to-many relationship (6 statuses)

### LBDStatus
- `lbd_id` - Parent LBD
- `status_type` - One of 6 types
- `is_completed` - Toggle
- `color` - Hex color code

### SiteMap
- `id`, `name`, `file_path`
- `svg_content` - SVG content (if SVG file)
- `areas` - One-to-many relationship

### SiteArea
- `site_map_id` - Parent map
- `power_block_id` - Linked power block
- `name`, `svg_element_id`

---

## 🎨 Customization

### Change Status Colors
Edit [backend/app/models/status.py](backend/app/models/status.py):
```python
STATUS_COLORS = {
    'stuff': '#FF6B6B',
    'term': '#4ECDC4',
    # ... edit colors here
}
```

### Change API Port
Edit [backend/run.py](backend/run.py):
```python
app.run(port=5000)  # Change this
```

### Change Database
Edit [backend/app/__init__.py](backend/app/__init__.py):
```python
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///lbd_tracker.db'
# Change to PostgreSQL, MySQL, etc.
```

### Include Custom Files in EXE
Edit [LBDTracker.spec](LBDTracker.spec):
```python
datas=[
    ('backend', 'backend'),
    ('frontend/build', 'frontend/build'),
    ('my_folder', 'my_folder'),  # Add this
],
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Poppler not found** | Install poppler and add to PATH, restart terminal |
| **PDF processing errors** | Ensure Poppler is installed and works: `pdfimages -list test.pdf` |
| **Port 5000/3000 in use** | Change port in run.py or frontend package.json |
| **Module not found** | Run `pip install -r requirements.txt` again |
| **Database locked** | Delete `backend/lbd_tracker.db` and restart |
| **CSS not applied** | Clear browser cache (Ctrl+Shift+Delete) |
| **EXE won't start** | Check installer has admin rights, check temp folder permissions |

---

## 📊 Technical Details

### Stack
- **Backend:** Flask 2.3, SQLAlchemy 2.0
- **Frontend:** React 18, React Router 6, Axios
- **Database:** SQLite3
- **Desktop:** PyQt5 5.15, PyQtWebEngine 5.15
- **PDF:** pdf2image, Pillow
- **Packaging:** PyInstaller

### File Sizes
- EXE: 200-400 MB (includes Python runtime)
- Backend: ~50 MB
- Frontend: ~20 MB
- Database: Created on first run

### Performance
- Supports 1000+ LBDs per project
- Fast PDF extraction and image processing
- Real-time status updates

---

## 🚀 Deployment

### Standalone EXE
Build with [BUILD_EXE.md](BUILD_EXE.md) and share `LBDTracker.exe`

### Web Deployment
```bash
# Backend
pip install gunicorn
gunicorn -w 4 app:app

# Frontend
npm run build
# Deploy ./build to web server
```

### Docker (Optional)
See [DETAILED_GUIDE.md](DETAILED_GUIDE.md) for Docker setup.

---

## 📞 Support

Check these files for more help:
- [QUICKSTART.md](QUICKSTART.md) - Quick setup guide
- [BUILD_EXE.md](BUILD_EXE.md) - EXE building instructions
- [DETAILED_GUIDE.md](DETAILED_GUIDE.md) - Complete documentation

---

**Made for simple, effective LBD tracking. Enjoy! 🎯**
