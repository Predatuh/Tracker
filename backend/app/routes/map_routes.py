from flask import Blueprint, request, jsonify, current_app, send_file
from werkzeug.utils import secure_filename
import os, shutil, json
from io import BytesIO
from sqlalchemy import func
from app import db
from app.models import SiteMap, SiteArea, PowerBlock

bp = Blueprint('map', __name__, url_prefix='/api/map')

ALLOWED_EXTENSIONS = {'svg', 'png', 'jpg', 'jpeg'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _current_site_map_query():
    return SiteMap.query.order_by(SiteMap.updated_at.desc(), SiteMap.id.desc())


@bp.route('/register-existing', methods=['POST'])
def register_existing_map():
    """
    Find the map that was uploaded via /api/pdf/upload-map and register
    it as a SiteMap DB record so the scan endpoint can use it.
    Also accepts an optional local_path to import from the filesystem.
    """
    try:
        data = request.get_json(silent=True) or {}
        local_path = data.get('local_path')

        upload_folder = current_app.config['UPLOAD_FOLDER']
        maps_folder = os.path.join(upload_folder, 'maps')
        os.makedirs(maps_folder, exist_ok=True)

        # Prefer explicit local_path, else find existing map_* file
        if local_path and os.path.exists(local_path):
            fname = os.path.basename(local_path)
            dest = os.path.join(maps_folder, fname)
            if not os.path.exists(dest):
                shutil.copy2(local_path, dest)
            file_path = dest
            name = fname
        else:
            # Look for map_* files in upload folder (from pdf_routes)
            # Sort by modification time newest-first so the most recently uploaded map wins
            candidates = []
            for fname in os.listdir(upload_folder):
                if fname.startswith('map_') and fname.lower().endswith(('.png', '.jpg', '.jpeg', '.gif')):
                    fp = os.path.join(upload_folder, fname)
                    candidates.append((os.path.getmtime(fp), fname, fp))
            if not candidates:
                return jsonify({'error': 'No map file found in uploads. Upload a map first.'}), 404
            candidates.sort(reverse=True)  # newest first
            _, name, src = candidates[0]
            dest = os.path.join(maps_folder, name)
            if not os.path.exists(dest):
                shutil.copy2(src, dest)
            file_path = dest

        # Update existing record if present, otherwise create new
        existing = _current_site_map_query().first()
        if existing:
            existing.name = name
            existing.file_path = file_path
            db.session.commit()
            return jsonify({'success': True, 'data': existing.to_dict(), 'message': 'updated'}), 200

        site_map = SiteMap(name=name, file_path=file_path)
        db.session.add(site_map)
        db.session.commit()

        return jsonify({'success': True, 'data': site_map.to_dict()}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/upload', methods=['POST'])
def upload_sitemap():
    """Upload site map file"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Only SVG, PNG, JPG files allowed'}), 400
        
        # Save file
        filename = secure_filename(file.filename)
        map_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'maps', filename)
        os.makedirs(os.path.dirname(map_path), exist_ok=True)
        file.save(map_path)
        
        # Read SVG content if it's an SVG file
        svg_content = None
        if filename.lower().endswith('.svg'):
            with open(map_path, 'r') as f:
                svg_content = f.read()
        
        # Read image data for blob storage
        import mimetypes
        mime = mimetypes.guess_type(filename)[0] or 'image/png'
        with open(map_path, 'rb') as f:
            image_data = f.read()
        
        # Create SiteMap record
        site_map = SiteMap(
            name=request.form.get('name', filename),
            file_path=map_path,
            svg_content=svg_content,
            image_data=image_data,
            image_mime=mime
        )
        db.session.add(site_map)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': site_map.to_dict()
        }), 201
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/sitemap/<int:map_id>', methods=['GET'])
def get_sitemap(map_id):
    """Get site map"""
    try:
        site_map = SiteMap.query.get_or_404(map_id)
        return jsonify({
            'success': True,
            'data': site_map.to_dict()
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/sitemap/<int:map_id>/image', methods=['GET'])
def get_sitemap_image(map_id):
    """Serve a site map image from DB blob storage or filesystem."""
    try:
        site_map = SiteMap.query.get_or_404(map_id)

        if site_map.image_data:
            return send_file(
                BytesIO(site_map.image_data),
                mimetype=site_map.image_mime or 'image/png',
                download_name=site_map.name,
                max_age=0,
            )

        if site_map.svg_content:
            return current_app.response_class(site_map.svg_content, mimetype='image/svg+xml')

        if site_map.file_path and os.path.exists(site_map.file_path):
            return send_file(site_map.file_path, max_age=0)

        return jsonify({'error': 'Map image not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/sitemaps', methods=['GET'])
def get_all_sitemaps():
    """Get all site maps with eager-loaded areas"""
    try:
        from sqlalchemy.orm import subqueryload
        maps = _current_site_map_query().options(subqueryload(SiteMap.areas)).all()
        return jsonify({
            'success': True,
            'data': [m.to_dict() for m in maps]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/area', methods=['POST'])
def create_site_area():
    """Create/define an area on the site map linked to a power block"""
    try:
        data = request.get_json()
        
        area = SiteArea(
            site_map_id=data.get('site_map_id'),
            power_block_id=data.get('power_block_id'),
            name=data.get('name'),
            svg_element_id=data.get('svg_element_id'),
            bbox_x=data.get('bbox_x'),
            bbox_y=data.get('bbox_y'),
            bbox_w=data.get('bbox_w'),
            bbox_h=data.get('bbox_h'),
            label_font_size=data.get('label_font_size'),
        )
        if data.get('polygon'):
            area.set_polygon(data['polygon'])
        db.session.add(area)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': area.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/area/<int:area_id>', methods=['PUT'])
def update_site_area(area_id):
    """Update site area"""
    try:
        area = SiteArea.query.get_or_404(area_id)
        data = request.get_json()
        
        if 'power_block_id' in data:
            area.power_block_id = data['power_block_id']
        if 'name' in data:
            area.name = data['name']
        if 'bbox_x' in data:
            area.bbox_x = data['bbox_x']
        if 'bbox_y' in data:
            area.bbox_y = data['bbox_y']
        if 'bbox_w' in data:
            area.bbox_w = data['bbox_w']
        if 'bbox_h' in data:
            area.bbox_h = data['bbox_h']
        if 'label_font_size' in data:
            area.label_font_size = data['label_font_size']
        if 'label_color' in data:
            area.label_color = data['label_color'] or None
        if 'zone' in data:
            area.zone = data['zone'] or None
        if 'polygon' in data:
            area.set_polygon(data['polygon'])
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': area.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/snap-outline/<int:map_id>', methods=['POST'])
def snap_outline(map_id):
    """
    Given a click position (x_pct, y_pct) on the map image, detect the
    black-outlined contour that encloses that point.  Returns the contour
    as a polygon (list of {x_pct, y_pct} points) plus a bounding box.
    """
    try:
        site_map = SiteMap.query.get_or_404(map_id)
        file_path = site_map.file_path
        if not os.path.exists(file_path):
            return jsonify({'error': f'Map file not found: {file_path}'}), 404

        data = request.get_json()
        click_x_pct = float(data['x_pct'])
        click_y_pct = float(data['y_pct'])

        import cv2
        import numpy as np

        img = cv2.imread(file_path)
        if img is None:
            return jsonify({'error': 'Could not read map image'}), 500

        h_img, w_img = img.shape[:2]
        click_x = int(click_x_pct / 100 * w_img)
        click_y = int(click_y_pct / 100 * h_img)

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # ── Multi-pass: try several threshold approaches ──
        # Only detect genuinely dark/black lines (not gray).
        # Gray lines are typically pixel value 100-200; black lines are 0-80.
        candidate_contours = []
        # Minimum area: scales with image size to skip tiny gray-bounded cells
        min_area = max(500, w_img * h_img // 4000)

        def _find_enclosing(binary):
            contours, hierarchy = cv2.findContours(
                binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE
            )
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < min_area:  # skip noise and tiny gray-bounded cells
                    continue
                if cv2.pointPolygonTest(cnt, (click_x, click_y), False) >= 0:
                    candidate_contours.append(cnt)

        # Pass 1: Adaptive threshold — high C to skip near-gray lines
        for block in [11, 15, 21, 31]:
            for C in [6, 10, 14]:
                binary = cv2.adaptiveThreshold(
                    gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY_INV, block, C
                )
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
                binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
                _find_enclosing(binary)

        # Pass 2: Simple threshold — only for truly dark (black) pixels
        # Gray lines at value ~150 are excluded; black lines at 0-80 are detected
        for thresh in [60, 80]:
            _, binary = cv2.threshold(gray, thresh, 255, cv2.THRESH_BINARY_INV)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
            _find_enclosing(binary)

        # Pass 3: Canny — higher thresholds favour strong (black) edges over weak (gray)
        for lo, hi in [(50, 150), (80, 200)]:
            edges = cv2.Canny(gray, lo, hi)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=3)
            _find_enclosing(closed)

        if not candidate_contours:
            return jsonify({
                'success': False,
                'error': 'No outline found at that position. Try clicking inside a black-outlined area.'
            }), 404

        # Pick the smallest enclosing contour (tightest fit)
        best = min(candidate_contours, key=cv2.contourArea)

        # Simplify the contour to reduce points
        peri = cv2.arcLength(best, True)
        epsilon = 0.005 * peri   # tight simplification
        approx = cv2.approxPolyDP(best, epsilon, True)

        # Convert to percentage coordinates
        polygon = []
        for pt in approx:
            polygon.append({
                'x_pct': round(float(pt[0][0]) / w_img * 100, 3),
                'y_pct': round(float(pt[0][1]) / h_img * 100, 3),
            })

        # Also compute bounding box in %
        x, y, w, h = cv2.boundingRect(approx)
        bbox = {
            'x_pct': round(x / w_img * 100, 3),
            'y_pct': round(y / h_img * 100, 3),
            'w_pct': round(w / w_img * 100, 3),
            'h_pct': round(h / h_img * 100, 3),
        }

        return jsonify({
            'success': True,
            'polygon': polygon,
            'bbox': bbox,
            'point_count': len(polygon),
        }), 200

    except ImportError:
        return jsonify({'error': 'opencv-python required. pip install opencv-python'}), 422
    except KeyError as e:
        return jsonify({'error': f'Missing field: {e}'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/sync-positions', methods=['POST'])
def sync_positions():
    """Bulk-update area bboxes from client-side positions (keyed by power_block_id)."""
    try:
        data = request.get_json()
        bboxes = data.get('bboxes', {})
        map_id = data.get('map_id')

        if not bboxes or not map_id:
            return jsonify({'error': 'bboxes and map_id required'}), 400

        # Load all areas for this map
        areas = SiteArea.query.filter_by(site_map_id=map_id).all()
        area_by_pb = {a.power_block_id: a for a in areas if a.power_block_id}

        updated = 0
        for pb_id_str, bbox in bboxes.items():
            pb_id = int(pb_id_str)
            area = area_by_pb.get(pb_id)
            if area:
                area.bbox_x = bbox.get('x', area.bbox_x)
                area.bbox_y = bbox.get('y', area.bbox_y)
                area.bbox_w = bbox.get('w', area.bbox_w)
                area.bbox_h = bbox.get('h', area.bbox_h)
                updated += 1

        db.session.commit()
        return jsonify({'success': True, 'updated': updated}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/map-status/<int:map_id>', methods=['GET'])
def get_map_status(map_id):
    """Get completion status for all areas on the map (bulk queries)."""
    try:
        from app.models import LBD, LBDStatus
        from app.models.admin_settings import AdminSettings

        site_map = SiteMap.query.get_or_404(map_id)
        areas = SiteArea.query.filter_by(site_map_id=map_id).all()

        # Get all power blocks in one query
        pb_ids = [a.power_block_id for a in areas if a.power_block_id]
        blocks_map = {}
        if pb_ids:
            blocks = PowerBlock.query.filter(PowerBlock.id.in_(pb_ids)).all()
            blocks_map = {b.id: b for b in blocks}

        # Bulk: LBD count and completed status counts per pb
        all_cols = AdminSettings.all_column_keys()
        completed_counts = {}
        lbd_counts = {}
        if pb_ids:
            lbd_q = db.session.query(
                LBD.power_block_id, func.count(LBD.id)
            ).filter(LBD.power_block_id.in_(pb_ids)).group_by(LBD.power_block_id).all()
            lbd_counts = {row[0]: row[1] for row in lbd_q}

            status_q = db.session.query(
                LBD.power_block_id, LBDStatus.status_type, func.count(LBDStatus.id)
            ).join(LBD, LBDStatus.lbd_id == LBD.id) \
             .filter(LBD.power_block_id.in_(pb_ids), LBDStatus.is_completed == True) \
             .group_by(LBD.power_block_id, LBDStatus.status_type).all()
            for pb_id, st, cnt in status_q:
                completed_counts.setdefault(pb_id, {})[st] = cnt

        status_data = []
        for area in areas:
            if area.power_block_id and area.power_block_id in blocks_map:
                block = blocks_map[area.power_block_id]
                total = lbd_counts.get(block.id, 0)
                summary = {'total': total}
                pb_completed = completed_counts.get(block.id, {})
                for col in all_cols:
                    summary[col] = pb_completed.get(col, 0)
                status_data.append({
                    'area_id': area.id,
                    'area_name': area.name,
                    'svg_element_id': area.svg_element_id,
                    'power_block_id': block.id,
                    'block_name': block.name,
                    'is_completed': block.is_completed,
                    'completion_color': '#2ecc71' if block.is_completed else '#95a5a6',
                    'lbd_summary': summary,
                })

        return jsonify({'success': True, 'data': status_data}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/scan/<int:map_id>', methods=['POST'])
def scan_map(map_id):
    """
    Scan a site-map image for rectangular power-block regions.
    Uses OpenCV when available; falls back to a manual grid estimate.
    Returns detected bounding boxes as percentage coordinates.

    Optional query params:
      expected_count – how many PB regions to aim for (default 119)
    """
    try:
        site_map = SiteMap.query.get_or_404(map_id)
        file_path = site_map.file_path

        if not os.path.exists(file_path):
            return jsonify({'error': f'Map file not found: {file_path}'}), 404

        expected_count = request.args.get('expected_count', 119, type=int)
        ext = file_path.lower().rsplit('.', 1)[-1]

        # ---- Check for pre-computed OCR positions ----
        ocr_json = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'pb_positions.json')
        if os.path.exists(ocr_json):
            try:
                with open(ocr_json, 'r') as _f:
                    ocr_data = json.load(_f)
                if len(ocr_data) >= expected_count * 0.5:
                    ocr_regions = []
                    for pb_num_str, pos in ocr_data.items():
                        ocr_regions.append({
                            'x_pct': pos['x_pct'],
                            'y_pct': pos['y_pct'],
                            'w_pct': pos['w_pct'],
                            'h_pct': pos['h_pct'],
                            'pb_number': int(pb_num_str),
                        })
                    ocr_regions.sort(key=lambda r: r['pb_number'])
                    return jsonify({
                        'success': True,
                        'data': ocr_regions,
                        'count': len(ocr_regions),
                        'source': 'ocr_cached',
                    }), 200
            except Exception:
                pass  # Fall through to normal detection

        # ---- SVG path ----
        if ext == 'svg':
            import re
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                svg_text = f.read()

            # Extract viewBox or width/height for normalisation
            vb = re.search(r'viewBox=["\']([\d.\s,]+)["\']', svg_text)
            if vb:
                parts = re.split(r'[,\s]+', vb.group(1).strip())
                vb_w = float(parts[2]) if len(parts) >= 4 else 1000
                vb_h = float(parts[3]) if len(parts) >= 4 else 1000
            else:
                sw = re.search(r'width=["\']([\d.]+)', svg_text)
                sh = re.search(r'height=["\']([\d.]+)', svg_text)
                vb_w = float(sw.group(1)) if sw else 1000
                vb_h = float(sh.group(1)) if sh else 1000

            rects = re.findall(
                r'<rect[^>]*?x=["\']([\d.]+)["\'][^>]*?y=["\']([\d.]+)["\']'
                r'[^>]*?width=["\']([\d.]+)["\'][^>]*?height=["\']([\d.]+)["\']',
                svg_text
            )
            # Also match rects with attributes in different order
            if not rects:
                def _attr(tag, name):
                    m = re.search(rf'{name}=["\']([\d.]+)["\']', tag)
                    return float(m.group(1)) if m else None

                all_rect_tags = re.findall(r'<rect[^>]+>', svg_text)
                rects_parsed = []
                for tag in all_rect_tags:
                    x = _attr(tag, 'x')
                    y = _attr(tag, 'y')
                    w = _attr(tag, 'width')
                    h = _attr(tag, 'height')
                    if None not in (x, y, w, h):
                        rects_parsed.append((x, y, w, h))
            else:
                rects_parsed = [(float(a), float(b), float(c), float(d)) for a, b, c, d in rects]

            detected = []
            for x, y, w, h in rects_parsed:
                detected.append({
                    'x_pct': round(x / vb_w * 100, 2),
                    'y_pct': round(y / vb_h * 100, 2),
                    'w_pct': round(w / vb_w * 100, 2),
                    'h_pct': round(h / vb_h * 100, 2),
                })

            return jsonify({'success': True, 'data': detected, 'source': 'svg_parse'}), 200

        # ---- Raster (PNG/JPG) path ----
        try:
            import cv2
            import numpy as np
            from collections import Counter

            img = cv2.imread(file_path)
            if img is None:
                raise ValueError('Could not read image')

            h_img, w_img = img.shape[:2]

            # ---------- Enhanced multi-pass contour detection ----------
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

            # For very large images, work on a downscaled copy for speed
            MAX_DIM = 5400
            scale = 1.0
            if max(w_img, h_img) > MAX_DIM:
                scale = MAX_DIM / max(w_img, h_img)
                work = cv2.resize(gray, (int(w_img * scale), int(h_img * scale)))
            else:
                work = gray
            wH, wW = work.shape[:2]

            k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            min_area = (wW * wH) * 0.00005
            max_area = (wW * wH) * 0.05

            all_detected = []

            def _extract(binary):
                contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
                for cnt in contours:
                    area = cv2.contourArea(cnt)
                    if area < min_area or area > max_area:
                        continue
                    peri = cv2.arcLength(cnt, True)
                    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
                    if len(approx) >= 4:
                        x, y, w, h = cv2.boundingRect(approx)
                        wp = w / wW * 100
                        hp = h / wH * 100
                        if 0.3 < wp < 20 and 0.3 < hp < 20:
                            all_detected.append({
                                'x_pct': round(x / wW * 100, 2),
                                'y_pct': round(y / wH * 100, 2),
                                'w_pct': round(wp, 2),
                                'h_pct': round(hp, 2),
                            })

            # Multiple blur levels x multiple edge/threshold methods
            for blur_sz in [3, 5, 7]:
                bl = cv2.GaussianBlur(work, (blur_sz, blur_sz), 0)
                # Canny variants
                for lo, hi in [(20, 80), (30, 120), (50, 150)]:
                    _extract(cv2.dilate(cv2.Canny(bl, lo, hi), k3, iterations=2))
                    _extract(cv2.dilate(cv2.Canny(bl, lo, hi), k5, iterations=1))
                # Adaptive threshold variants
                for block_sz in [11, 15, 21]:
                    for C_val in [2, 4, 6]:
                        _extract(cv2.adaptiveThreshold(
                            bl, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                            cv2.THRESH_BINARY_INV, block_sz, C_val))
                # Otsu + morphological close
                _, otsu = cv2.threshold(bl, 0, 255,
                                        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
                _extract(otsu)
                for ks in [3, 5, 7]:
                    _extract(cv2.morphologyEx(
                        otsu, cv2.MORPH_CLOSE,
                        cv2.getStructuringElement(cv2.MORPH_RECT, (ks, ks))))

            # Bilateral filter preserves edges
            bil = cv2.bilateralFilter(work, 9, 75, 75)
            for lo, hi in [(30, 100), (50, 150)]:
                _extract(cv2.dilate(cv2.Canny(bil, lo, hi), k3, iterations=2))

            # ---------- Deduplicate (IoU > 0.3) ----------
            all_detected.sort(key=lambda r: r['w_pct'] * r['h_pct'], reverse=True)
            unique = []
            for r in all_detected:
                overlap = False
                for u in unique:
                    ix = max(0, min(r['x_pct'] + r['w_pct'], u['x_pct'] + u['w_pct']) - max(r['x_pct'], u['x_pct']))
                    iy = max(0, min(r['y_pct'] + r['h_pct'], u['y_pct'] + u['h_pct']) - max(r['y_pct'], u['y_pct']))
                    inter = ix * iy
                    a_r = r['w_pct'] * r['h_pct']
                    a_u = u['w_pct'] * u['h_pct']
                    union = a_r + a_u - inter
                    if union > 0 and inter / union > 0.3:
                        overlap = True
                        break
                if not overlap:
                    unique.append(r)

            if len(unique) < 2:
                return jsonify({'success': True, 'data': unique, 'count': len(unique), 'source': 'opencv'}), 200

            # ---------- Dimension-based PB cell filtering ----------
            target = expected_count if expected_count > 0 else 119

            # Stage 1: Use aspect-ratio prefilter to find PB-shaped rects
            # PB cells are tall/narrow (h > w).  Filter to aspect > 1.5
            # to avoid small square noise dominating the histogram.
            tall_rects_idx = [i for i, r in enumerate(unique) if r['h_pct'] / max(r['w_pct'], 0.01) > 1.5]
            if len(tall_rects_idx) < 10:
                tall_rects_idx = list(range(len(unique)))  # fallback

            w_arr = np.array([unique[i]['w_pct'] for i in tall_rects_idx])
            h_arr = np.array([unique[i]['h_pct'] for i in tall_rects_idx])
            w_bins = np.round(w_arr * 5) / 5   # 0.2 % bins
            h_bins = np.round(h_arr * 2) / 2   # 0.5 % bins

            dim_pairs = list(zip(w_bins.tolist(), h_bins.tolist()))
            pair_counts = Counter(dim_pairs)
            peak_w, peak_h = pair_counts.most_common(1)[0][0]

            # Build initial cluster with generous tolerance
            cluster_rects = [unique[tall_rects_idx[i]]
                             for i in range(len(tall_rects_idx))
                             if abs(w_bins[i] - peak_w) <= 0.4
                             and abs(h_bins[i] - peak_h) <= 1.5]

            # Stage 2: Compute median, then score ALL unique rects
            if len(cluster_rects) >= 5:
                med_w = float(np.median([r['w_pct'] for r in cluster_rects]))
                med_h = float(np.median([r['h_pct'] for r in cluster_rects]))
            else:
                med_w = float(peak_w)
                med_h = float(peak_h)

            for r in unique:
                dw = (r['w_pct'] - med_w) / med_w
                dh = (r['h_pct'] - med_h) / med_h
                r['_score'] = dw * dw + dh * dh

            # Collect candidates within ±50 % of median dims
            candidates = [r for r in unique
                          if abs(r['w_pct'] - med_w) < med_w * 0.50
                          and abs(r['h_pct'] - med_h) < med_h * 0.50]

            # Sort by score (closest to median first) and take the best
            candidates.sort(key=lambda r: r['_score'])
            result = candidates[:target]

            # Clean internal fields
            for r in result:
                r.pop('_score', None)

            return jsonify({
                'success': True,
                'data': result,
                'count': len(result),
                'source': 'opencv',
                'median_w': round(med_w, 2),
                'median_h': round(med_h, 2),
            }), 200

        except ImportError:
            return jsonify({
                'success': False,
                'error': 'opencv-python not installed. Run: pip install opencv-python'
            }), 422

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/area/<int:area_id>', methods=['DELETE'])
def delete_site_area(area_id):
    """Delete a site area"""
    try:
        area = SiteArea.query.get_or_404(area_id)
        db.session.delete(area)
        db.session.commit()
        return jsonify({'success': True}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/areas/<int:map_id>', methods=['DELETE'])
def delete_all_areas(map_id):
    """Delete ALL site areas for a given site map."""
    try:
        deleted = SiteArea.query.filter_by(site_map_id=map_id).delete()
        db.session.commit()
        return jsonify({'success': True, 'deleted': deleted}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/sitemap/<int:map_id>', methods=['DELETE'])
def delete_sitemap(map_id):
    """Delete a site map record (and its areas via cascade)."""
    try:
        site_map = SiteMap.query.get_or_404(map_id)
        db.session.delete(site_map)
        db.session.commit()
        return jsonify({'success': True}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500