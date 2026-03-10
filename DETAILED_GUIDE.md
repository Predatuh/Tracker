# LBD Tracker - Load Break Device Tracking System

An intelligent application that transforms PDF documents into an interactive tracking system for Load Break Devices (LBDs), integrated with site maps.

## 📋 Features

### Core Functionality
- **PDF Processing**: Upload PDFs and extract selected pages as power block images
- **Power Block Management**: Create and manage power block records that correspond to PDF pages
- **LBD Tracking**: Add Load Break Devices to each power block and track their status
- **6-Status System**: Track 6 different completion statuses for each LBD with color coding
- **Interactive Site Maps**: Upload SVG or image-based site maps
- **Status Visualization**: Click power block areas on the map to view detailed LBD status

### Status Types
- 🔴 **Stuff** - Red (#FF6B6B)
- 🟦 **Term** - Teal (#4ECDC4)
- 🟨 **Stickers** - Yellow (#FFE66D)
- 🟩 **Ground/Brackets** - Mint (#95E1D3)
- 🟩 **Quality Check** - Light Green (#A8E6CF)
- 🟢 **Quality Docs** - Dark Green (#56AB91)

## 🏗️ Architecture

```
LBD TRACKER/
├── backend/                  # Flask API Server
│   ├── app/
│   │   ├── models/          # Database models (PowerBlock, LBD, Status, etc.)
│   │   ├── routes/          # API endpoints
│   │   │   ├── pdf_routes.py      # PDF upload & processing
│   │   │   ├── tracker_routes.py  # LBD tracking
│   │   │   ├── map_routes.py      # Site map management
│   │   │   └── lbd_routes.py      # LBD info & status
│   │   └── utils/           # Utilities (PDF processor, Image processor)
│   ├── uploads/             # Uploaded files directory
│   ├── run.py              # Flask server entry point
│   └── requirements.txt      # Python dependencies
│
├── frontend/                # React Web Application
│   ├── public/
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── Dashboard.js         # Overview & stats
│   │   │   ├── PDFUpload.js         # PDF upload/extract
│   │   │   ├── PowerBlockList.js    # Block listing
│   │   │   ├── PowerBlockDetail.js  # LBD management
│   │   │   └── SiteMapView.js       # Interactive map
│   │   ├── api/
│   │   │   └── apiClient.js         # API calls
│   │   └── index.js
│   ├── package.json
│   └── .env.example
│
├── README.md                # This file
└── .gitignore
```

## 🚀 Setup & Installation

### Backend Setup

#### Prerequisites
- Python 3.8+
- pip package manager
- Poppler (for PDF to image conversion)
  - **Windows**: Download from [poppler-windows releases](https://github.com/oschwartz10612/poppler-windows/releases/) and add to PATH
  - **macOS**: `brew install poppler`
  - **Linux**: `apt-get install poppler-utils`

#### Installation Steps

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (optional)
cp .env.example .env

# Run the Flask server
python run.py
```

The API will be available at `http://localhost:5000`

### Frontend Setup

#### Prerequisites
- Node.js 14+
- npm or yarn

#### Installation Steps

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Create .env file (optional)
cp .env.example .env

# Start development server
npm start
```

The application will open at `http://localhost:3000`

## 📖 Usage Workflow

### 1. Upload PDF
1. Go to **Upload PDF** page
2. Select your tracking PDF file
3. Choose which pages to extract (usually one per power block)
4. Extract pages as images

### 2. Create Power Blocks
1. Navigate to **Power Blocks**
2. Review extracted pages
3. Each page becomes a power block with the extracted image

### 3. Add LBDs to Blocks
1. Click on a power block
2. Click **Add New LBD** button
3. Enter LBD details:
   - Name (e.g., "LBD-A")
   - Identifier (optional)
   - X/Y position on the image (for visual highlighting)
   - Notes
4. System automatically creates 6 status records for each LBD

### 4. Track Status Changes
1. View power block details
2. Click status buttons to toggle completion
3. Available statuses appear as colored buttons:
   - Red (Stuff), Teal (Term), Yellow (Stickers), etc.
4. Filled color = completed, light = not completed

### 5. Upload Site Map
1. Go to **Site Map** page
2. Upload an SVG or image file
3. Map areas on the site map to power blocks
4. This links your physical layout to your tracking system

### 6. Interactive Viewing
1. Select a site map
2. View power block completion status as colors on the map
3. Green = fully completed, Yellow/Orange/Red = in progress
4. Click areas to see detailed LBD status

## 🔌 API Reference

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
- `PUT /lbds/<id>/status/<type>` - Update LBD status

### Charts & Maps (`/api/map`)
- `POST /upload` - Upload site map
- `GET /sitemap/<id>` - Get site map
- `GET /sitemaps` - List all site maps
- `POST /area` - Create site area
- `PUT /area/<id>` - Update site area
- `GET /map-status/<id>` - Get map completion status

### LBD Info (`/api/lbd`)
- `GET /power-block/<id>/lbds` - Get power block's LBDs
- `GET /status-colors` - Get status color mapping

## 📊 Database Models

### PowerBlock
- `id`: Unique identifier
- `name`: Block name
- `page_number`: Original PDF page
- `image_path`: Extracted image file path
- `is_completed`: Completion status
- Relationships: `lbds` (one-to-many)

### LBD
- `id`: Unique identifier
- `power_block_id`: Parent block
- `name`: LBD name
- `identifier`: LBD code (e.g., "LBD-001")
- `x_position`, `y_position`: Position on image
- `notes`: Additional notes
- Relationships: `statuses` (one-to-many)

### LBDStatus
- `id`: Unique identifier
- `lbd_id`: Parent LBD
- `status_type`: One of 6 types
- `is_completed`: Status toggle
- `completed_at`: Timestamp
- `color`: Hex color for status type

### SiteMap
- `id`: Unique identifier
- `name`: Map name
- `file_path`: Upload path
- `svg_content`: SVG content (if SVG file)
- Relationships: `areas` (one-to-many)

### SiteArea
- `id`: Unique identifier
- `site_map_id`: Parent map
- `power_block_id`: Linked power block
- `name`: Area name
- `svg_element_id`: HTML/SVG element ID

## 🎨 Customization

### Status Colors
Edit status colors in [backend/app/models/status.py](backend/app/models/status.py):
```python
STATUS_COLORS = {
    'stuff': '#FF6B6B',
    'term': '#4ECDC4',
    # ... etc
}
```

### Database
The app uses SQLite by default. To change:
1. Edit `SQLALCHEMY_DATABASE_URI` in [backend/app/__init__.py](backend/app/__init__.py)
2. Install required database driver

### API Port
To change Flask API port:
1. Edit [backend/run.py](backend/run.py) - change `port=5000`
2. Update frontend proxy in [frontend/package.json](frontend/package.json)

## 🐛 Troubleshooting

### PDF Processing Issues
- Ensure Poppler is installed and in PATH
- Make sure PDF file is valid
- Check file permissions on uploads folder

### Database Errors
- Delete `backend/lbd_tracker.db` to reset database
- Ensure `backend/uploads/` folder exists

### CORS Errors
- Verify both backend and frontend are running
- Check backend/app/__init__.py has `CORS(app)` enabled

### Port Already in Use
- Change Flask port in run.py (default: 5000)
- Change React development port: `PORT=3001 npm start`

## 📝 Project Structure Notes

- **Backend** uses Flask with SQLAlchemy ORM
- **Frontend** uses React with React Router for navigation
- **Database** defaults to SQLite (easily swappable)
- **PDF Processing** uses pdf2image and Pillow
- **Image Highlighting** allows marking LBD locations on power block images

## 🚀 Deployment

### Backend Deployment
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Frontend Deployment
```bash
npm run build
# Deploy the ./build folder to a web server
```

## 📄 License

MIT License - feel free to use for your project

## 🤝 Contributing

Feel free to fork, improve, and submit pull requests!

## 📞 Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review API documentation
3. Check component CSS files for styling customization

---

**Happy tracking! 🎯**
