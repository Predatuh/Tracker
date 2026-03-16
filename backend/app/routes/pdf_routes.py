from flask import Blueprint, request, jsonify, current_app, send_from_directory, Response
from werkzeug.utils import secure_filename
import os
import logging
import threading
from datetime import datetime
from app import db
from app.models import PowerBlock, LBD
from app.utils import PDFProcessor
from app.utils.pdf_lbd_extractor import LBDExtractor

logger = logging.getLogger(__name__)
bp = Blueprint('pdf', __name__, url_prefix='/api/pdf')

ALLOWED_EXTENSIONS = {'pdf'}


def _current_site_map():
    from app.models import SiteMap
    return SiteMap.query.order_by(SiteMap.updated_at.desc(), SiteMap.id.desc()).first()


def _store_map_blob(file_path, filename):
    """Store a map image in the DB as a blob so it survives container redeploys."""
    try:
        from app.models import SiteMap
        import mimetypes
        mime = mimetypes.guess_type(filename)[0] or 'image/png'
        with open(file_path, 'rb') as f:
            data = f.read()
        # Update the current map record if one exists; legacy UI expects a single current map.
        sm = _current_site_map()
        if sm:
            sm.name = filename
            sm.file_path = file_path
            sm.image_data = data
            sm.image_mime = mime
        else:
            sm = SiteMap(name=filename, file_path=file_path, image_data=data, image_mime=mime)
            db.session.add(sm)
        db.session.commit()
        return sm
    except Exception as e:
        logger.error(f"Failed to store map blob: {e}")
        return None


# Global progress tracking for scanning
scan_progress = {
    'status': 'idle',  # idle, scanning, complete, error
    'current_page': 0,
    'total_pages': 0,
    'pages_scanned': 0,
    'power_blocks_found': 0,
    'lbds_found': 0,
    'percentage': 0,
    'message': '',
    'db_status': '',
    'save_percentage': 0,
    'save_current': 0,
    'save_total': 0
}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@bp.route('/upload', methods=['POST'])
def upload_pdf():
    """Upload and process PDF file"""
    try:
        import logging
        logger = logging.getLogger(__name__)
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': 'Only PDF files allowed'}), 400
        
        logger.info(f"Uploading file: {file.filename}")
        
        # Save uploaded file
        filename = secure_filename(file.filename)
        pdf_path = os.path.join(current_app.config['UPLOAD_FOLDER'], filename)
        file.save(pdf_path)
        logger.info(f"File saved to {pdf_path}")
        
        # Process PDF - with timeout logging
        logger.info(f"Starting PDF processing...")
        processor = PDFProcessor(pdf_path, os.path.join(current_app.config['UPLOAD_FOLDER'], 'pages'))
        page_count = processor.get_page_count()
        logger.info(f"PDF processed successfully: {page_count} pages")
        
        return jsonify({
            'success': True,
            'filename': filename,
            'pdf_path': pdf_path,
            'page_count': page_count
        }), 200
    
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"PDF upload error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/upload-map', methods=['POST'])
def upload_map():
    """Upload map image for power block visualization"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file type
        allowed_extensions = {'jpg', 'jpeg', 'png', 'gif'}
        if '.' not in file.filename or file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
            return jsonify({'error': 'Only image files allowed'}), 400
        
        logger.info(f"Uploading map: {file.filename}")
        
        # Save map file
        filename = secure_filename(file.filename)
        map_filename = f"map_{filename}"
        map_path = os.path.join(current_app.config['UPLOAD_FOLDER'], map_filename)
        os.makedirs(os.path.dirname(map_path), exist_ok=True)
        file.save(map_path)
        logger.info(f"Map saved to {map_path}")
        
        # Also store in DB as blob so it survives container redeploys
        site_map = _store_map_blob(map_path, map_filename)
        
        map_url = f'/api/pdf/serve-map/{map_filename}'
        if site_map:
            map_url = f'/api/map/sitemap/{site_map.id}/image'
        
        return jsonify({
            'success': True,
            'filename': filename,
            'map_url': map_url
        }), 200
    
    except Exception as e:
        logger.error(f"Map upload error: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/serve-map/<filename>', methods=['GET'])
def serve_map(filename):
    """Serve uploaded map images - checks file system first, then DB blob"""
    upload_folder = current_app.config['UPLOAD_FOLDER']
    maps_folder = os.path.join(upload_folder, 'maps')
    try:
        if os.path.exists(os.path.join(maps_folder, filename)):
            return send_from_directory(maps_folder, filename)
        if os.path.exists(os.path.join(upload_folder, filename)):
            return send_from_directory(upload_folder, filename)
    except Exception:
        pass
    # Fall back to DB blob
    try:
        from app.models import SiteMap
        site_map = SiteMap.query.filter(SiteMap.image_data.isnot(None)).order_by(SiteMap.updated_at.desc(), SiteMap.id.desc()).first()
        if site_map and site_map.image_data:
            # Also restore to disk for future requests
            os.makedirs(maps_folder, exist_ok=True)
            restore_path = os.path.join(maps_folder, site_map.name)
            with open(restore_path, 'wb') as f:
                f.write(site_map.image_data)
            return Response(site_map.image_data, mimetype=site_map.image_mime or 'image/png')
    except Exception as e:
        logger.error(f"Error serving map blob: {e}")
    return jsonify({'error': 'Map not found'}), 404

@bp.route('/get-map', methods=['GET'])
def get_map():
    """Get the current map URL if one exists"""
    try:
        site_map = _current_site_map()
        if site_map:
            return jsonify({
                'success': True,
                'map_url': f'/api/map/sitemap/{site_map.id}/image'
            }), 200

        upload_folder = current_app.config['UPLOAD_FOLDER']
        maps_folder = os.path.join(upload_folder, 'maps')
        # Check maps/ subfolder first, then root
        for search_dir in [maps_folder, upload_folder]:
            if not os.path.isdir(search_dir):
                continue
            for fname in os.listdir(search_dir):
                if fname.startswith('map_') and fname.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                    return jsonify({
                        'success': True,
                        'map_url': f'/api/pdf/serve-map/{fname}'
                    }), 200

        return jsonify({'success': False, 'map_url': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@bp.route('/extract-pages', methods=['POST'])
def extract_pages():
    """Extract selected pages from PDF"""
    try:
        data = request.get_json()
        pdf_path = data.get('pdf_path')
        page_numbers = data.get('page_numbers', [])
        
        logger.info(f"Extract pages request: pdf_path={pdf_path}, pages={page_numbers}")
        
        if not pdf_path:
            logger.error("No PDF path provided")
            return jsonify({'error': 'PDF path is required'}), 400
        
        if not os.path.exists(pdf_path):
            logger.error(f"PDF not found: {pdf_path}")
            return jsonify({'error': f'PDF not found: {pdf_path}'}), 404
        
        pages_folder = os.path.join(current_app.config['UPLOAD_FOLDER'], 'pages')
        logger.info(f"Creating output folder: {pages_folder}")
        
        processor = PDFProcessor(pdf_path, pages_folder)
        logger.info(f"PDFProcessor created, extracting {len(page_numbers)} pages...")
        
        extracted = processor.extract_pages(page_numbers if page_numbers else None)
        logger.info(f"Extraction complete: {len(extracted)} pages extracted")
        
        result = {
            'success': True,
            'extracted_pages': [
                {
                    'page_number': page_num,
                    'image_path': f'/api/pdf/serve/{os.path.basename(img_path)}'
                }
                for page_num, img_path in extracted
            ]
        }
        
        logger.info(f"Returning success response with {len(result['extracted_pages'])} pages")
        return jsonify(result), 200
    
    except Exception as e:
        logger.error(f"Error extracting pages: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': f'Failed to extract pages: {str(e)}'}), 500

@bp.route('/serve/<filename>', methods=['GET'])
def serve_file(filename):
    """Serve uploaded files"""
    try:
        pages_folder = os.path.join(current_app.config['UPLOAD_FOLDER'], 'pages')
        return send_from_directory(pages_folder, filename)
    except Exception as e:
        logger.error(f"Error serving file {filename}: {str(e)}")
        return jsonify({'error': 'File not found'}), 404

@bp.route('/scan-lbds', methods=['POST'])
def scan_lbds():
    """Scan PDF and extract power blocks and LBDs (background processing)"""
    try:
        data = request.get_json()
        pdf_path = data.get('pdf_path')
        
        if not pdf_path or not os.path.exists(pdf_path):
            return jsonify({'error': 'PDF file not found'}), 404
        
        logger.info(f"Scanning PDF for LBDs: {pdf_path}")
        
        # Capture app object before thread (current_app proxy won't work inside thread)
        _app = current_app._get_current_object()

        # Return immediately while processing in background
        def background_scan():
          with _app.app_context():
            try:
                global scan_progress
                
                def progress_callback(current_page, total_pages, power_blocks_found, lbds_found):
                    """Update global progress tracking"""
                    scan_progress['current_page'] = current_page
                    scan_progress['total_pages'] = total_pages
                    scan_progress['power_blocks_found'] = power_blocks_found
                    scan_progress['lbds_found'] = lbds_found
                    scan_progress['pages_scanned'] = current_page
                    if total_pages > 0:
                        scan_progress['percentage'] = int((current_page / total_pages) * 100)
                    scan_progress['message'] = f"Scanned page {current_page}/{total_pages} - Found {power_blocks_found} PBs, {lbds_found} LBDs"
                    logger.info(scan_progress['message'])
                
                scan_progress['status'] = 'scanning'
                scan_progress['percentage'] = 0
                
                # Extract LBD data from PDF with progress tracking
                extractor = LBDExtractor(pdf_path, progress_callback=progress_callback)
                extraction_result = extractor.extract_data()
                
                if not extraction_result['success']:
                    scan_progress['status'] = 'error'
                    scan_progress['message'] = f"Extraction failed: {extraction_result['error']}"
                    logger.error(scan_progress['message'])
                    return
                
                logger.info("Clearing existing data via raw SQL...")
                scan_progress['db_status'] = 'Clearing old data...'
                scan_progress['save_percentage'] = 0
                scan_progress['save_current'] = 0
                scan_progress['save_total'] = 0
                # Use raw SQL DELETE to bypass SQLAlchemy cascade (much faster)
                try:
                    db.session.execute(db.text('DELETE FROM lbd_statuses'))
                except Exception:
                    pass  # table may be empty or not yet created
                try:
                    db.session.execute(db.text('DELETE FROM lbds'))
                except Exception:
                    pass
                try:
                    db.session.execute(db.text('DELETE FROM power_blocks'))
                except Exception:
                    pass
                db.session.commit()
                logger.info("Old data cleared.")
                
                created_power_blocks = []
                
                # Create power blocks via ORM (small count, fine as-is)
                power_block_map = {}
                for pb_data in extraction_result['power_blocks']:
                    power_block = PowerBlock(
                        name=pb_data['name'],
                        power_block_number=pb_data['name'].split('-')[1] if '-' in pb_data['name'] else '',
                        page_number=pb_data['page_number'],
                        description=f"Power Block {pb_data['name']} with {pb_data['lbd_count']} LBDs"
                    )
                    db.session.add(power_block)
                    power_block_map[pb_data['name']] = power_block
                    created_power_blocks.append(power_block)
                
                db.session.flush()   # send INSERTs to DB within transaction
                db.session.commit()  # COMMIT power blocks so they persist even if no LBDs
                logger.info(f"Created {len(created_power_blocks)} power block records")
                
                # Build id map
                pb_id_map = {pb.name: pb.id for pb in created_power_blocks}
                
                # Save ALL LBDs with a single raw SQL executemany (fastest possible)
                all_lbd_data = extraction_result['lbds']
                total_lbds = len(all_lbd_data)
                scan_progress['save_total'] = total_lbds
                scan_progress['save_current'] = 0
                scan_progress['save_percentage'] = 0
                scan_progress['db_status'] = f'Saving {total_lbds} LBDs to database...'
                
                now_str = datetime.utcnow().isoformat()
                rows = []
                for lbd_data in all_lbd_data:
                    pb_id = pb_id_map.get(lbd_data['power_block'])
                    if pb_id:
                        rows.append({
                            'name': lbd_data['identifier'],
                            'identifier': lbd_data['identifier'],
                            'inventory_number': lbd_data['inventory_number'],
                            'power_block_id': pb_id,
                            'notes': f"Capacity: {lbd_data['capacity']}, Page: {lbd_data['page_number']}",
                            'created_at': now_str,
                            'updated_at': now_str
                        })
                
                if rows:
                    # Use raw SQL for maximum reliability on SQLite
                    CHUNK = 200
                    for start in range(0, len(rows), CHUNK):
                        chunk = rows[start:start + CHUNK]
                        for r in chunk:
                            db.session.execute(
                                db.text(
                                    'INSERT INTO lbds '
                                    '(name, identifier, inventory_number, power_block_id, notes, created_at, updated_at) '
                                    'VALUES (:name, :identifier, :inventory_number, :power_block_id, :notes, :created_at, :updated_at)'
                                ),
                                r
                            )
                        db.session.commit()
                        saved = min(start + CHUNK, len(rows))
                        scan_progress['save_current'] = saved
                        scan_progress['save_percentage'] = int(saved / len(rows) * 100)
                        scan_progress['db_status'] = f'Saving LBDs: {saved}/{len(rows)} ({scan_progress["save_percentage"]}%)'
                        logger.info(scan_progress['db_status'])

                created_lbds = rows
                logger.info(f'Saved {len(created_lbds)} LBD records')
                
                scan_progress['status'] = 'complete'
                scan_progress['percentage'] = 100
                scan_progress['save_percentage'] = 100
                scan_progress['power_blocks_found'] = len(created_power_blocks)
                scan_progress['lbds_found'] = len(created_lbds)
                scan_progress['db_status'] = ''
                scan_progress['message'] = f"✓ Complete! Found {len(created_power_blocks)} power blocks and {len(created_lbds)} LBDs"
                logger.info(scan_progress['message'])
                
            except Exception as e:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                scan_progress['status'] = 'error'
                scan_progress['message'] = f"Error: {str(e)}"
                logger.error(f"Background scan error: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
        
        # Start background thread
        scan_thread = threading.Thread(target=background_scan, daemon=True)
        scan_thread.start()
        
        # Return success immediately
        return jsonify({
            'success': True,
            'message': 'PDF scan started in background',
            'status': 'processing'
        }), 202
    
    except Exception as e:
        logger.error(f"Error starting PDF scan: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@bp.route('/scan-status', methods=['GET'])
def get_scan_status():
    """Get current scan progress"""
    global scan_progress
    return jsonify(scan_progress), 200

@bp.route('/create-power-blocks', methods=['POST'])
def create_power_blocks():
    """Create power block records from extracted pages"""
    try:
        data = request.get_json()
        pages = data.get('pages', [])  # List of {page_number, image_path, block_name}
        
        created_blocks = []
        
        for page_data in pages:
            power_block = PowerBlock(
                name=page_data.get('block_name', f"Block {page_data.get('page_number')}"),
                page_number=page_data.get('page_number'),
                image_path=page_data.get('image_path'),
                description=page_data.get('description', '')
            )
            db.session.add(power_block)
            created_blocks.append(power_block)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'blocks': [b.to_dict() for b in created_blocks]
        }), 201
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
