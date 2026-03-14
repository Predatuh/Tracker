"""
Workers & Daily Reports API
  GET/POST   /api/workers                     – list / create workers
  PUT/DELETE /api/workers/<id>                – update / deactivate
  POST       /api/work-entries                – log work for a day
  DELETE     /api/work-entries/<id>           – remove a single entry
  GET        /api/work-entries?date=YYYY-MM-DD – entries for a date
  POST       /api/reports/generate            – generate (or regenerate) report for a date
  GET        /api/reports                     – list all report summaries
  GET        /api/reports/<id>                – full report by id
  GET        /api/reports/date/<YYYY-MM-DD>   – report for a specific date
  GET        /api/reports/range               – reports in a date range (weekly / monthly)
"""

from flask import Blueprint, request, jsonify, session, current_app, send_from_directory
from app import db
from app.models.worker import Worker, WorkEntry
from app.models.daily_report import DailyReport
from app.models.admin_settings import AdminSettings
from app.models.tracker import Tracker
from app.models.power_block import PowerBlock
from app.models.lbd import LBD
from collections import defaultdict
from datetime import date, datetime, timedelta
from sqlalchemy.orm import subqueryload
import pytz
import base64
import os
import re
import json
import shutil
import subprocess
import tempfile
import uuid

bp = Blueprint('reports', __name__, url_prefix='/api')

CST = pytz.timezone('America/Chicago')
CLAIM_SCAN_FORM_ROWS = 22
CLAIM_SCAN_LABEL_COLUMN_RATIO = 0.19
CLAIM_SCAN_PAGE_WIDTH = 1400
CLAIM_SCAN_PAGE_HEIGHT = 1980


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _cst_today():
    return datetime.now(CST).date()


def _current_user_name():
    uid = session.get('user_id')
    if not uid:
        return 'Guest'
    try:
        from app.models.user import User
        u = User.query.get(uid)
        return u.name if u else 'Guest'
    except Exception:
        return 'Guest'


def _resolve_tracker_id():
    """Get tracker_id from request args or JSON body."""
    tid = request.args.get('tracker_id')
    if tid:
        return int(tid)
    data = request.get_json(silent=True) or {}
    if data.get('tracker_id'):
        return int(data['tracker_id'])
    t = Tracker.query.filter_by(is_active=True).order_by(Tracker.sort_order, Tracker.id).first()
    return t.id if t else None


def _build_report_data(target_date, tracker_id=None, existing_data=None):
    """Aggregate WorkEntry rows for *target_date* into a structured snapshot."""
    q = WorkEntry.query.filter_by(work_date=target_date)
    if tracker_id:
        q = q.filter_by(tracker_id=tracker_id)
    entries = q.all()

    tracker = Tracker.query.get(tracker_id) if tracker_id else None
    col_names = tracker.get_status_names() if tracker else AdminSettings.get_names()

    # Group by task_type → worker → [power_blocks]
    by_task     = defaultdict(lambda: defaultdict(list))
    by_worker   = defaultdict(lambda: defaultdict(list))
    by_pb       = defaultdict(lambda: defaultdict(list))
    worker_names = set()

    for e in entries:
        task   = e.task_type
        worker = e.worker.name if e.worker else '?'
        pb     = e.power_block.name if e.power_block else '?'
        by_task[task][worker].append(pb)
        by_worker[worker][task].append(pb)
        by_pb[pb][task].append(worker)
        worker_names.add(worker)

    existing_data = existing_data or {}

    return {
        'report_date':   target_date.isoformat(),
        'total_entries': len(entries),
        'worker_names':  sorted(worker_names),
        'by_task':       {t: dict(w) for t, w in by_task.items()},
        'by_worker':     {w: dict(t) for w, t in by_worker.items()},
        'by_power_block': {pb: dict(t) for pb, t in by_pb.items()},
        'task_labels':   col_names,
        'raw_entries': [e.to_dict() for e in entries],
        'claim_scans': list(existing_data.get('claim_scans') or []),
    }


def _get_or_generate_report(target_date, tracker_id=None):
    """Return the DailyReport for *target_date*, creating/updating it if needed."""
    q = DailyReport.query.filter_by(report_date=target_date)
    if tracker_id:
        q = q.filter_by(tracker_id=tracker_id)
    report = q.first()
    existing_data = report.get_data() if report else {}
    if report is None:
        report = DailyReport(report_date=target_date, tracker_id=tracker_id)
        db.session.add(report)
    report.set_data(_build_report_data(target_date, tracker_id, existing_data))
    report.generated_at = datetime.utcnow()
    db.session.commit()
    return report


def _normalize_people(people):
    normalized = []
    seen = set()
    for person in people or []:
        name = str(person or '').strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(name)
    return normalized


def _normalize_claim_assignments(assignments, valid_lbd_ids=None):
    normalized = {}
    if not isinstance(assignments, dict):
        return normalized

    valid_set = set(valid_lbd_ids or [])
    enforce_valid_ids = bool(valid_set)

    for status_type, lbd_ids in assignments.items():
        key = str(status_type or '').strip()
        if not key:
            continue
        if not isinstance(lbd_ids, list):
            lbd_ids = [lbd_ids]
        seen_ids = set()
        normalized_ids = []
        for lbd_id in lbd_ids:
            try:
                normalized_id = int(lbd_id)
            except (TypeError, ValueError):
                continue
            if normalized_id <= 0 or normalized_id in seen_ids:
                continue
            if enforce_valid_ids and normalized_id not in valid_set:
                continue
            seen_ids.add(normalized_id)
            normalized_ids.append(normalized_id)
        if normalized_ids:
            normalized[key] = normalized_ids

    return normalized


def _ensure_claim_workers(names):
    normalized = _normalize_people(names)
    if not normalized:
        return

    existing_workers = {
        name.casefold()
        for (name,) in db.session.query(Worker.name).all()
        if name
    }

    for name in normalized:
        folded = name.casefold()
        if folded in existing_workers:
            continue
        db.session.add(Worker(name=name, is_active=True))
        existing_workers.add(folded)


def _claim_payload(block):
    claimed_people = block.get_claimed_people()
    return {
        'claimed_by': block.claimed_by,
        'claimed_people': claimed_people,
        'claim_assignments': block.get_claim_assignments(),
        'claimed_label': ', '.join(claimed_people),
        'claimed_at': block.claimed_at.isoformat() if block.claimed_at else None,
    }


def _decode_claim_scan_image(image_base64):
    raw = str(image_base64 or '').strip()
    if not raw:
        raise ValueError('image_base64 is required')
    if ',' in raw and raw.lower().startswith('data:'):
        raw = raw.split(',', 1)[1]
    return base64.b64decode(raw)


def _guess_image_extension(file_name):
    ext = os.path.splitext(str(file_name or ''))[1].lower()
    return ext if ext in {'.jpg', '.jpeg', '.png', '.webp'} else '.jpg'


def _claim_scan_root():
    path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'claim_scans')
    os.makedirs(path, exist_ok=True)
    return path


def _save_claim_scan_file(file_name, image_bytes, target_date):
    ext = _guess_image_extension(file_name)
    day_dir = target_date.isoformat()
    rel_dir = os.path.join('claim_scans', day_dir)
    abs_dir = os.path.join(current_app.config['UPLOAD_FOLDER'], rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    stored_name = f'{uuid.uuid4().hex}{ext}'
    rel_path = os.path.join(rel_dir, stored_name)
    abs_path = os.path.join(abs_dir, stored_name)
    with open(abs_path, 'wb') as fh:
        fh.write(image_bytes)
    return {
        'file_name': stored_name,
        'relative_path': rel_path.replace('\\', '/'),
        'image_url': f"/api/reports/claim-scan-file/{rel_path.replace('\\', '/')}",
    }


def _resolve_claim_scan_file(relative_path):
    normalized = os.path.normpath(str(relative_path or '')).replace('\\', '/')
    normalized = normalized.lstrip('/')
    root = _claim_scan_root()
    abs_path = os.path.abspath(os.path.join(current_app.config['UPLOAD_FOLDER'], normalized))
    if not abs_path.startswith(os.path.abspath(root)):
        return None
    if not os.path.exists(abs_path):
        return None
    return abs_path


def _normalize_token(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())


def _extract_digit_tokens(value):
    return [token.lstrip('0') or '0' for token in re.findall(r'\d+', str(value or ''))]


def _status_aliases(status_type, status_label):
    aliases = set()
    for raw in [status_type, status_label, str(status_type or '').replace('_', ' '), str(status_label or '').replace('/', ' ')]:
        normalized = _normalize_token(raw)
        if normalized:
            aliases.add(normalized)
        for part in re.split(r'[^a-z0-9]+', str(raw or '').lower()):
            clean = _normalize_token(part)
            if len(clean) >= 3:
                aliases.add(clean)

    if status_type == 'term':
        aliases.update({
            'lug',
            'lugged',
            'land',
            'landed',
            'lugland',
            'luggedlanded',
            'luglanded',
            'luggedland',
        })
    elif status_type == 'stickers':
        aliases.update({'label', 'labels', 'sticker', 'stickers'})
    elif status_type == 'ground_brackets':
        aliases.update({'bg', 'bracketground', 'groundbracket', 'bracketsground'})
    return aliases


def _claim_scan_status_types(tracker):
    preferred_order = ['ground_brackets', 'stuff', 'term', 'stickers']
    available = tracker.all_column_keys() if tracker else AdminSettings.all_column_keys()
    ordered = [status_type for status_type in preferred_order if status_type in available]
    return ordered or available


def _order_claim_scan_quad(points):
    ordered = [None, None, None, None]
    sums = [point[0] + point[1] for point in points]
    diffs = [point[1] - point[0] for point in points]
    ordered[0] = points[sums.index(min(sums))]
    ordered[2] = points[sums.index(max(sums))]
    ordered[1] = points[diffs.index(min(diffs))]
    ordered[3] = points[diffs.index(max(diffs))]
    return ordered


def _find_claim_scan_page_quad(frame):
    try:
        import cv2
        import numpy as np
    except Exception:
        return None

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, threshold = cv2.threshold(blurred, 170, 255, cv2.THRESH_BINARY)
    threshold = cv2.morphologyEx(threshold, cv2.MORPH_CLOSE, np.ones((9, 9), dtype=np.uint8))

    contours, _ = cv2.findContours(threshold, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    image_area = frame.shape[0] * frame.shape[1]
    best_quad = None
    best_area = 0
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.35:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        points = approx.reshape(-1, 2) if approx is not None else None
        if points is None or len(points) < 4:
            rect = cv2.minAreaRect(contour)
            points = cv2.boxPoints(rect)
        elif len(points) > 4:
            rect = cv2.minAreaRect(contour)
            points = cv2.boxPoints(rect)

        if points is None or len(points) != 4:
            continue
        if area > best_area:
            best_area = area
            best_quad = _order_claim_scan_quad([tuple(map(float, point)) for point in points])

    return best_quad


def _rectify_claim_scan(frame):
    try:
        import cv2
        import numpy as np
    except Exception:
        gray = None
        try:
            import cv2  # type: ignore
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        except Exception:
            return frame, None
        return frame, gray

    quad = _find_claim_scan_page_quad(frame)
    if not quad:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return frame, gray

    source = np.array(quad, dtype=np.float32)
    destination = np.array([
        [0.0, 0.0],
        [float(CLAIM_SCAN_PAGE_WIDTH - 1), 0.0],
        [float(CLAIM_SCAN_PAGE_WIDTH - 1), float(CLAIM_SCAN_PAGE_HEIGHT - 1)],
        [0.0, float(CLAIM_SCAN_PAGE_HEIGHT - 1)],
    ], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(source, destination)
    warped = cv2.warpPerspective(frame, matrix, (CLAIM_SCAN_PAGE_WIDTH, CLAIM_SCAN_PAGE_HEIGHT))
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    return warped, gray


def _find_claim_scan_table_bbox(binary):
    try:
        import cv2
    except Exception:
        return None

    height, width = binary.shape[:2]
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, height // 25)))
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, width // 12), 1))
    vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    grid_mask = cv2.add(vertical_lines, horizontal_lines)

    contours, _ = cv2.findContours(grid_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    table_bbox = None
    table_area = 0
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if w < width * 0.45 or h < height * 0.45:
            continue
        if area > table_area:
            table_area = area
            table_bbox = (x, y, w, h)
    return table_bbox


def _estimate_claim_scan_x_boundaries(table_bbox, status_column_count):
    if not table_bbox or status_column_count <= 0:
        return None

    x, _, w, _ = table_bbox
    total_columns = status_column_count + 1
    label_ratio = CLAIM_SCAN_LABEL_COLUMN_RATIO
    remaining_ratio = max(0.0, 1.0 - label_ratio)
    task_width_ratio = remaining_ratio / max(1, total_columns - 1)

    boundaries = [x]
    boundaries.append(int(round(x + (w * label_ratio))))
    for index in range(1, total_columns):
        boundaries.append(int(round(x + (w * (label_ratio + (task_width_ratio * index))))))

    boundaries[-1] = x + w
    return boundaries


def _estimate_claim_scan_y_boundaries(table_bbox, y_lines, row_count):
    if not table_bbox or row_count <= 0:
        return None

    _, y, _, h = table_bbox
    detected = sorted(y + center for center, _ in (y_lines or []))
    top = detected[0] if detected else y
    bottom = detected[-1] if detected else (y + h)
    if bottom <= top:
        bottom = y + h

    expected_meta_ratio = 0.048
    expected_header_ratio = 0.103
    tolerance = max(8, int(h * 0.04))

    def pick_nearest(target, lower_bound):
        candidates = [line for line in detected if line > lower_bound]
        if not candidates:
            return target
        nearest = min(candidates, key=lambda line: abs(line - target))
        if abs(nearest - target) <= tolerance:
            return nearest
        return target

    meta_target = int(round(y + (h * expected_meta_ratio)))
    header_target = int(round(y + (h * expected_header_ratio)))
    meta_line = pick_nearest(meta_target, top + 2)
    header_line = pick_nearest(header_target, meta_line + 4)
    if header_line <= meta_line:
        header_line = max(meta_line + 4, header_target)

    data_top = header_line
    data_height = max(1, bottom - data_top)
    row_height = data_height / float(row_count)

    boundaries = [top, meta_line, header_line]
    for index in range(1, row_count + 1):
        boundaries.append(int(round(data_top + (row_height * index))))
    boundaries[-1] = bottom
    return boundaries


def _fit_claim_scan_rows_from_ocr(items, row_number_map, image_width, row_count=CLAIM_SCAN_FORM_ROWS):
    if not items or not row_number_map:
        return {}

    row_markers = {}
    left_threshold = image_width * 0.28
    for item in items:
        if item.get('left', 0) > left_threshold:
            continue
        if item.get('width', 0) > image_width * 0.12:
            continue

        tokens = []
        for token in _extract_digit_tokens(item.get('text')):
            if token.isdigit():
                number = int(token)
                if 1 <= number <= row_count:
                    tokens.append(number)
        if len(tokens) != 1:
            continue

        row_number = tokens[0]
        center_y = float(item['top'] + (item['height'] / 2.0))
        existing = row_markers.get(row_number)
        if existing is None or item.get('conf', 0) > existing['conf']:
            row_markers[row_number] = {
                'center_y': center_y,
                'conf': float(item.get('conf', 0.0)),
                'height': max(1.0, float(item.get('height', 1.0))),
                'width': max(1.0, float(item.get('width', 1.0))),
            }

    if len(row_markers) < 4:
        return {}

    ordered_rows = sorted(row_markers.items())
    xs = [float(row_number) for row_number, _ in ordered_rows]
    ys = [entry['center_y'] for _, entry in ordered_rows]
    count = float(len(xs))
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xx = sum(value * value for value in xs)
    sum_xy = sum(row * center for row, center in zip(xs, ys))
    denominator = (count * sum_xx) - (sum_x * sum_x)
    if abs(denominator) < 1e-6:
        return {}

    slope = ((count * sum_xy) - (sum_x * sum_y)) / denominator
    intercept = (sum_y - (slope * sum_x)) / count
    if slope <= 0:
        return {}

    estimated_height = max(8.0, abs(slope) * 0.88)
    estimated_width = max(entry['width'] for entry in row_markers.values())
    fitted = {}
    for row_number, lbd_id in row_number_map.items():
        center_y = row_markers.get(row_number, {}).get('center_y', (slope * row_number) + intercept)
        fitted[lbd_id] = {
            'top': int(round(center_y - (estimated_height / 2.0))),
            'height': int(round(estimated_height)),
            'width': int(round(estimated_width)),
            'source': 'ocr-row-fit',
            'conf': row_markers.get(row_number, {}).get('conf', 0.0),
        }
    return fitted


def _build_lbd_candidates(block):
    lookup = {}
    labels = {}
    for lbd in block.lbds:
        label = lbd.identifier or lbd.name or f'LBD {lbd.id}'
        labels[lbd.id] = label
        candidates = set()
        for raw in [lbd.identifier, lbd.inventory_number, lbd.name]:
            normalized = _normalize_token(raw)
            if normalized and len(normalized) <= 12:
                candidates.add(normalized)
            candidates.update(token for token in _extract_digit_tokens(raw) if len(token) <= 4)
        for candidate in candidates:
            lookup.setdefault(candidate, set()).add(lbd.id)
    return lookup, labels


def _line_centers_from_projection(signal, threshold, min_gap=6):
    centers = []
    strengths = []
    start = None
    last = None
    for index, value in enumerate(signal):
        if value >= threshold:
            if start is None:
                start = index
            last = index
            continue
        if start is None:
            continue
        if centers and start - centers[-1] <= min_gap:
            prev_strength = strengths[-1]
            strengths[-1] = max(prev_strength, int(max(signal[start:last + 1])))
            centers[-1] = int((centers[-1] + ((start + last) / 2)) / 2)
        else:
            centers.append(int((start + last) / 2))
            strengths.append(int(max(signal[start:last + 1])))
        start = None
        last = None
    if start is not None and last is not None:
        centers.append(int((start + last) / 2))
        strengths.append(int(max(signal[start:last + 1])))
    return list(zip(centers, strengths))


def _select_evenly_spaced_lines(lines, expected_count, tolerance=0.35):
    if len(lines) <= expected_count:
        return [center for center, _ in lines]
    centers = [center for center, _ in sorted(lines, key=lambda entry: entry[0])]
    best = None
    for start in range(0, len(centers) - expected_count + 1):
        window = centers[start:start + expected_count]
        gaps = [window[index + 1] - window[index] for index in range(len(window) - 1)]
        if not gaps:
            continue
        median_gap = sorted(gaps)[len(gaps) // 2]
        if median_gap <= 0:
            continue
        deviation = max(abs(gap - median_gap) for gap in gaps) / median_gap
        if deviation <= tolerance:
            score = (deviation, abs(expected_count - len(window)))
            if best is None or score < best[0]:
                best = (score, window)
    if best:
        return best[1]
    ranked = sorted(lines, key=lambda entry: entry[1], reverse=True)[:expected_count]
    return sorted(center for center, _ in ranked)


def _extract_term_form_layout(binary, row_count=CLAIM_SCAN_FORM_ROWS, status_column_count=4):
    try:
        import cv2
    except Exception:
        return None

    height, width = binary.shape[:2]
    table_bbox = _find_claim_scan_table_bbox(binary)
    if not table_bbox:
        return None

    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, height // 25)))
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, width // 12), 1))
    vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)

    x, y, w, h = table_bbox
    vertical_crop = vertical_lines[y:y + h, x:x + w]
    horizontal_crop = horizontal_lines[y:y + h, x:x + w]

    x_lines = _line_centers_from_projection(
        (vertical_crop > 0).sum(axis=0),
        threshold=max(10, int(h * 0.38)),
        min_gap=max(5, w // 120),
    )
    y_lines = _line_centers_from_projection(
        (horizontal_crop > 0).sum(axis=1),
        threshold=max(12, int(w * 0.42)),
        min_gap=max(4, h // 180),
    )

    expected_x_boundaries = status_column_count + 2
    expected_y_boundaries = row_count + 3

    x_boundaries = None
    if len(x_lines) >= expected_x_boundaries:
        x_boundaries = _select_evenly_spaced_lines(x_lines, expected_x_boundaries, tolerance=0.55)
        if len(x_boundaries) == expected_x_boundaries:
            x_boundaries = [x + value for value in x_boundaries]
        else:
            x_boundaries = None
    if x_boundaries is None:
        x_boundaries = _estimate_claim_scan_x_boundaries(table_bbox, status_column_count)

    y_boundaries = None
    y_detected = False
    if len(y_lines) >= expected_y_boundaries:
        selected = _select_evenly_spaced_lines(y_lines, expected_y_boundaries, tolerance=0.55)
        if len(selected) == expected_y_boundaries:
            y_boundaries = [y + value for value in selected]
            y_detected = True
    if y_boundaries is None:
        y_boundaries = _estimate_claim_scan_y_boundaries(table_bbox, y_lines, row_count)

    return {
        'bbox': table_bbox,
        'x_boundaries': x_boundaries,
        'y_boundaries': y_boundaries,
        'detected_rows': y_detected,
    }


def _map_form_rows_to_lbds(block, row_count=22):
    by_number = {}
    ordered = []
    for lbd in block.lbds:
        numbers = []
        for raw in [lbd.identifier, lbd.inventory_number, lbd.name]:
            numbers.extend(int(token) for token in _extract_digit_tokens(raw) if token.isdigit())
        chosen = min(numbers) if numbers else None
        ordered.append((chosen if chosen is not None else 10 ** 9, lbd.id))
        if chosen is not None and chosen not in by_number:
            by_number[chosen] = lbd.id

    mapping = {}
    matched = 0
    for row_number in range(1, row_count + 1):
        lbd_id = by_number.get(row_number)
        if lbd_id:
            mapping[row_number] = lbd_id
            matched += 1

    if matched >= max(6, min(row_count, len(block.lbds)) // 2):
        return mapping

    ordered_ids = [lbd_id for _, lbd_id in sorted(ordered)]
    for row_number, lbd_id in enumerate(ordered_ids[:row_count], start=1):
        mapping.setdefault(row_number, lbd_id)
    return mapping


def _ocr_scan_items(image):
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        return None, None, [f'OCR libraries unavailable: {exc}']

    arr = np.frombuffer(image, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None, None, ['Could not decode uploaded image']

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    tesseract_bin = _resolve_tesseract_binary()
    if not tesseract_bin:
        return frame, binary, ['Tesseract OCR binary not found']

    try:
        raw = _run_tesseract_tsv(
            gray,
            tesseract_bin,
            psm='6',
        )
    except Exception as exc:
        return frame, binary, [f'OCR failed: {exc}']

    items = []
    for idx, text in enumerate(raw.get('text', [])):
        clean = str(text or '').strip()
        if not clean:
            continue
        try:
            conf = float(raw.get('conf', ['0'])[idx])
        except (TypeError, ValueError):
            conf = 0.0
        items.append({
            'text': clean,
            'normalized': _normalize_token(clean),
            'left': int(raw.get('left', [0])[idx]),
            'top': int(raw.get('top', [0])[idx]),
            'width': int(raw.get('width', [0])[idx]),
            'height': int(raw.get('height', [0])[idx]),
            'conf': conf,
        })
    return frame, binary, items


def _resolve_tesseract_binary():
    explicit = os.environ.get('TESSERACT_CMD') or os.environ.get('TESSERACT_PATH')
    candidates = [
        explicit,
        shutil.which('tesseract'),
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Tesseract-OCR', 'tesseract.exe'),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _run_tesseract_tsv(gray_image, executable, psm='6'):
    try:
        import cv2
    except Exception as exc:
        raise RuntimeError(f'OpenCV unavailable for OCR: {exc}')

    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = os.path.join(temp_dir, 'scan.png')
        output_base = os.path.join(temp_dir, 'ocr')
        if not cv2.imwrite(image_path, gray_image):
            raise RuntimeError('Failed to write OCR temp image')

        command = [
            executable,
            image_path,
            output_base,
            '--psm',
            str(psm),
            'tsv',
        ]
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or 'Tesseract exited with an error')

        tsv_path = f'{output_base}.tsv'
        if not os.path.exists(tsv_path):
            raise RuntimeError('Tesseract did not produce TSV output')

        columns = {
            'text': [],
            'left': [],
            'top': [],
            'width': [],
            'height': [],
            'conf': [],
        }
        with open(tsv_path, 'r', encoding='utf-8', errors='ignore') as handle:
            lines = [line.rstrip('\n') for line in handle]
        if not lines:
            return columns

        headers = lines[0].split('\t')
        for line in lines[1:]:
            parts = line.split('\t')
            row = {headers[index]: parts[index] if index < len(parts) else '' for index in range(len(headers))}
            columns['text'].append(row.get('text', ''))
            columns['left'].append(row.get('left', '0'))
            columns['top'].append(row.get('top', '0'))
            columns['width'].append(row.get('width', '0'))
            columns['height'].append(row.get('height', '0'))
            columns['conf'].append(row.get('conf', '0'))
        return columns


def _extract_claim_cell_roi(binary, left, right, top, bottom):
    left = max(0, int(left))
    right = min(binary.shape[1], int(right))
    top = max(0, int(top))
    bottom = min(binary.shape[0], int(bottom))
    if right <= left or bottom <= top:
        return binary[0:0, 0:0]

    roi = binary[top:bottom, left:right]
    if roi.size == 0:
        return roi

    inset_y = min(max(1, roi.shape[0] // 12), 8)
    inset_x = min(max(1, roi.shape[1] // 12), 8)
    if roi.shape[0] > (inset_y * 2) + 4 and roi.shape[1] > (inset_x * 2) + 4:
        roi = roi[inset_y:roi.shape[0] - inset_y, inset_x:roi.shape[1] - inset_x]
    return roi


def _claim_mark_metrics(roi):
    try:
        import cv2
        import numpy as np
    except Exception:
        if roi.size == 0:
            return {
                'raw_fill_ratio': 0.0,
                'fill_ratio': 0.0,
                'peak_ratio': 0.0,
                'component_ratio': 0.0,
                'ink_pixels': 0,
            }
        fill_ratio = float((roi > 0).sum()) / float(roi.size)
        return {
            'raw_fill_ratio': fill_ratio,
            'fill_ratio': fill_ratio,
            'peak_ratio': fill_ratio,
            'component_ratio': fill_ratio,
            'ink_pixels': int((roi > 0).sum()),
        }

    if roi.size == 0:
        return {
            'raw_fill_ratio': 0.0,
            'fill_ratio': 0.0,
            'peak_ratio': 0.0,
            'component_ratio': 0.0,
            'ink_pixels': 0,
        }

    work = (roi > 0).astype(np.uint8) * 255
    raw_fill_ratio = float((work > 0).sum()) / float(work.size)
    height, width = work.shape[:2]
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(5, width // 3), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(5, height // 3)))
    horizontal_lines = cv2.morphologyEx(work, cv2.MORPH_OPEN, horizontal_kernel)
    vertical_lines = cv2.morphologyEx(work, cv2.MORPH_OPEN, vertical_kernel)
    residual = cv2.subtract(work, cv2.max(horizontal_lines, vertical_lines))

    noise_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    residual = cv2.morphologyEx(residual, cv2.MORPH_OPEN, noise_kernel)
    ink_mask = (residual > 0).astype(np.uint8)
    ink_pixels = int(ink_mask.sum())
    if ink_pixels <= 0:
        return {
            'raw_fill_ratio': raw_fill_ratio,
            'fill_ratio': 0.0,
            'peak_ratio': 0.0,
            'component_ratio': 0.0,
            'ink_pixels': 0,
        }

    window_h = max(4, min(ink_mask.shape[0], max(4, ink_mask.shape[0] // 3)))
    window_w = max(4, min(ink_mask.shape[1], max(4, ink_mask.shape[1] // 3)))
    density = cv2.blur(ink_mask.astype(np.float32), (window_w, window_h))

    component_ratio = 0.0
    count, _, stats, _ = cv2.connectedComponentsWithStats(ink_mask, 8)
    if count > 1:
        largest_component = int(stats[1:, cv2.CC_STAT_AREA].max())
        component_ratio = float(largest_component) / float(ink_mask.size)

    return {
        'raw_fill_ratio': raw_fill_ratio,
        'fill_ratio': float(ink_pixels) / float(ink_mask.size),
        'peak_ratio': float(density.max()) if density.size else 0.0,
        'component_ratio': component_ratio,
        'ink_pixels': ink_pixels,
    }


def _is_claim_marked(metrics, use_form_layout=False):
    if metrics.get('raw_fill_ratio', 0.0) >= 0.11:
        return True

    if metrics.get('ink_pixels', 0) < 8:
        return False

    peak_threshold = 0.14 if use_form_layout else 0.17
    component_threshold = 0.025 if use_form_layout else 0.03
    if metrics.get('peak_ratio', 0.0) >= peak_threshold:
        return True
    if metrics.get('component_ratio', 0.0) >= component_threshold:
        return True

    fill_ratio = metrics.get('fill_ratio', 0.0)
    peak_ratio = metrics.get('peak_ratio', 0.0)
    return fill_ratio >= 0.008 and peak_ratio >= 0.055


def _parse_claim_scan(block, tracker, image_bytes):
    frame, binary, ocr_result = _ocr_scan_items(image_bytes)
    if frame is None or binary is None:
        return {
            'assignments': {},
            'preview_rows': [],
            'warnings': ocr_result or ['Scan parsing unavailable'],
            'source': 'manual',
            'detected_date': _cst_today().isoformat(),
        }

    items = ocr_result
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        return {
            'assignments': {},
            'preview_rows': [],
            'warnings': list(items) if isinstance(items, list) else ['Scan parsing unavailable'],
            'source': 'manual',
            'detected_date': _cst_today().isoformat(),
        }

    rectified_frame, rectified_gray = _rectify_claim_scan(frame)
    if rectified_gray is not None:
        try:
            import cv2
            rectified_blur = cv2.GaussianBlur(rectified_gray, (5, 5), 0)
            _, rectified_binary = cv2.threshold(rectified_blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            scan_binary = rectified_binary
        except Exception:
            scan_binary = binary
    else:
        scan_binary = binary

    height, width = scan_binary.shape[:2]
    tracker = tracker or (Tracker.query.get(block.lbds[0].tracker_id) if block.lbds and block.lbds[0].tracker_id else None)
    status_types = _claim_scan_status_types(tracker)
    status_names = tracker.get_status_names() if tracker else AdminSettings.get_names()
    status_positions = {}
    warnings = []
    source = 'ocr-grid'
    form_row_count = CLAIM_SCAN_FORM_ROWS
    layout = _extract_term_form_layout(scan_binary, row_count=form_row_count, status_column_count=len(status_types))

    if layout and layout.get('x_boundaries') and status_types:
        x_boundaries = layout['x_boundaries']
        fixed_positions = []
        for index in range(min(len(status_types), len(x_boundaries) - 2)):
            left = x_boundaries[index + 1]
            right = x_boundaries[index + 2]
            fixed_positions.append(int((left + right) / 2))
        for status_type, center_x in zip(status_types, fixed_positions):
            status_positions[status_type] = center_x
        if layout.get('detected_rows'):
            source = 'form-grid'
        elif layout.get('y_boundaries'):
            source = 'form-estimated'
        else:
            source = 'form-bbox'

    if len(status_positions) < len(status_types):
        for status_type in status_types:
            if status_type in status_positions:
                continue
            aliases = _status_aliases(status_type, status_names.get(status_type))
            matches = []
            for item in items:
                if item['top'] > height * 0.45:
                    continue
                normalized = item['normalized']
                if not normalized:
                    continue
                if any(normalized == alias or alias in normalized or normalized in alias for alias in aliases):
                    matches.append(item)
            if matches:
                status_positions[status_type] = int(sum(m['left'] + (m['width'] / 2) for m in matches) / len(matches))

    if not status_positions:
        warnings.append('Could not detect task columns from the claim sheet')
        if status_types:
            fallback_start = int(width * 0.52)
            usable_width = max(width - fallback_start - 24, len(status_types) * 30)
            step = usable_width / len(status_types)
            for index, status_type in enumerate(status_types):
                status_positions[status_type] = int(fallback_start + ((index + 0.5) * step))
            warnings.append('Using fallback task column positions; confirm scan results before saving')

    lbd_lookup, lbd_labels = _build_lbd_candidates(block)
    row_candidates = {}
    row_number_map = _map_form_rows_to_lbds(block, row_count=form_row_count)

    if layout and layout.get('y_boundaries'):
        y_boundaries = layout['y_boundaries']
        for row_number in range(1, min(form_row_count, len(y_boundaries) - 2) + 1):
            lbd_id = row_number_map.get(row_number)
            if not lbd_id:
                continue
            top = y_boundaries[row_number + 1]
            bottom = y_boundaries[row_number + 2]
            row_candidates[lbd_id] = {
                'top': int((top + bottom) / 2),
                'height': max(1, int(bottom - top)),
                'width': max(1, int((layout['x_boundaries'][1] - layout['x_boundaries'][0]) * 0.5)),
                'source': 'layout-row',
            }

    fitted_rows = _fit_claim_scan_rows_from_ocr(items, row_number_map, width, row_count=form_row_count)
    for lbd_id, row_data in fitted_rows.items():
        row_candidates.setdefault(lbd_id, row_data)

    if not layout and not row_candidates:
        for item in items:
            normalized = item['normalized']
            if not normalized:
                continue
            candidate_tokens = {normalized, *_extract_digit_tokens(item['text'])}
            matched_ids = set()
            for token in candidate_tokens:
                matched_ids.update(lbd_lookup.get(token, set()))
            if len(matched_ids) != 1:
                continue
            lbd_id = next(iter(matched_ids))
            existing = row_candidates.get(lbd_id)
            if existing is None or item['conf'] > existing.get('conf', -1):
                row_candidates[lbd_id] = item

    if not row_candidates:
        warnings.append('Could not match any LBD numbers from the claim sheet')

    assignments = {status_type: [] for status_type in status_types}
    preview_rows = []
    for lbd_id, item in sorted(row_candidates.items(), key=lambda entry: entry[1]['top']):
        row_y = int(item['top'] + (item['height'] / 2))
        row_statuses = []
        for status_type, center_x in status_positions.items():
            if layout and source == 'form-grid':
                x_boundaries = layout['x_boundaries']
                try:
                    status_index = status_types.index(status_type)
                except ValueError:
                    status_index = -1
                if 0 <= status_index <= len(x_boundaries) - 3:
                    left = max(0, x_boundaries[status_index + 1] + 2)
                    right = min(width, x_boundaries[status_index + 2] - 2)
                else:
                    horizontal_padding = max(18, int(item['width'] * 1.15))
                    left = max(0, center_x - horizontal_padding)
                    right = min(width, center_x + horizontal_padding)
                vertical_padding = max(10, int(item['height'] * 0.38))
                top = max(0, row_y - vertical_padding)
                bottom = min(height, row_y + vertical_padding)
            else:
                horizontal_padding = max(18, int(item['width'] * 1.15))
                vertical_padding = max(12, int(item['height'] * 1.25))
                left = max(0, center_x - horizontal_padding)
                right = min(width, center_x + horizontal_padding)
                top = max(0, row_y - vertical_padding)
                bottom = min(height, row_y + vertical_padding)
            roi = _extract_claim_cell_roi(scan_binary, left, right, top, bottom)
            if roi.size == 0:
                continue
            metrics = _claim_mark_metrics(roi)
            if _is_claim_marked(metrics, use_form_layout=bool(layout and source == 'form-grid')):
                assignments[status_type].append(lbd_id)
                row_statuses.append(status_type)
        preview_rows.append({
            'lbd_id': lbd_id,
            'lbd_label': lbd_labels.get(lbd_id, f'LBD {lbd_id}'),
            'statuses': row_statuses,
        })

    assignments = {key: value for key, value in assignments.items() if value}

    detected_date = _cst_today().isoformat()
    date_candidates = []
    for item in items:
        match = re.search(r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', item['text'])
        if match:
            date_candidates.append(match.group(1))
    if date_candidates:
        raw_date = date_candidates[0].replace('-', '/')
        parts = raw_date.split('/')
        if len(parts) == 3:
            month, day, year = parts
            if len(year) == 2:
                year = f'20{year}'
            try:
                detected_date = date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                pass

    if not assignments:
        warnings.append('No marked task cells were confidently detected; review selections manually')

    return {
        'assignments': assignments,
        'preview_rows': preview_rows,
        'warnings': warnings,
        'source': source,
        'detected_date': detected_date,
    }


def _append_claim_scan(report, scan_record):
    data = report.get_data() or {}
    scans = list(data.get('claim_scans') or [])
    scans.append(scan_record)
    data['claim_scans'] = scans
    report.set_data(data)
    report.generated_at = datetime.utcnow()


# ─────────────────────────────────────────────────────────────────────────────
# Workers
# ─────────────────────────────────────────────────────────────────────────────

@bp.route('/workers', methods=['GET'])
def list_workers():
    include_inactive = request.args.get('all', 'false').lower() == 'true'
    q = Worker.query if include_inactive else Worker.query.filter_by(is_active=True)
    workers = q.order_by(Worker.name).all()
    return jsonify({'success': True, 'data': [w.to_dict() for w in workers]}), 200


@bp.route('/workers', methods=['POST'])
def create_worker():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    if Worker.query.filter_by(name=name).first():
        return jsonify({'error': f'Worker "{name}" already exists'}), 409
    w = Worker(name=name)
    db.session.add(w)
    db.session.commit()
    return jsonify({'success': True, 'data': w.to_dict()}), 201


@bp.route('/workers/<int:worker_id>', methods=['PUT'])
def update_worker(worker_id):
    w = Worker.query.get_or_404(worker_id)
    data = request.get_json() or {}
    if 'name' in data:
        new_name = data['name'].strip()
        if not new_name:
            return jsonify({'error': 'name cannot be empty'}), 400
        w.name = new_name
    if 'is_active' in data:
        w.is_active = bool(data['is_active'])
    db.session.commit()
    return jsonify({'success': True, 'data': w.to_dict()}), 200


@bp.route('/workers/<int:worker_id>', methods=['DELETE'])
def delete_worker(worker_id):
    w = Worker.query.get_or_404(worker_id)
    w.is_active = False        # soft-delete so historical entries are preserved
    db.session.commit()
    return jsonify({'success': True}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Work Entries
# ─────────────────────────────────────────────────────────────────────────────

@bp.route('/work-entries', methods=['GET'])
def list_work_entries():
    date_str = request.args.get('date')
    if date_str:
        try:
            target = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({'error': 'Invalid date format, use YYYY-MM-DD'}), 400
    else:
        target = _cst_today()

    tracker_id = _resolve_tracker_id()
    q = WorkEntry.query.filter_by(work_date=target)
    if tracker_id:
        q = q.filter_by(tracker_id=tracker_id)
    entries = q.all()
    return jsonify({'success': True, 'data': [e.to_dict() for e in entries], 'date': target.isoformat()}), 200


@bp.route('/work-entries', methods=['POST'])
def log_work_entries():
    """
    Batch-log work entries for one day.
    Body: {
      "date": "YYYY-MM-DD",          // optional, defaults to CST today
      "worker_ids": [1, 2],
      "power_block_ids": [3, 5, 7],
      "task_type": "stuff"
    }
    Duplicate entries (same worker+pb+task+date) are silently skipped.
    """
    data = request.get_json() or {}
    date_str     = (data.get('date') or '').strip()
    worker_ids   = data.get('worker_ids') or []
    pb_ids       = data.get('power_block_ids') or []
    task_type    = (data.get('task_type') or '').strip()
    tracker_id   = data.get('tracker_id')

    if not worker_ids or not pb_ids or not task_type:
        return jsonify({'error': 'worker_ids, power_block_ids, and task_type are required'}), 400

    # Validate task_type against tracker or global settings
    tracker = Tracker.query.get(tracker_id) if tracker_id else None
    valid_tasks = tracker.all_column_keys() if tracker else AdminSettings.all_column_keys()
    if task_type not in valid_tasks:
        return jsonify({'error': f'Unknown task_type "{task_type}", must be one of: {valid_tasks}'}), 400

    try:
        target = date.fromisoformat(date_str) if date_str else _cst_today()
    except ValueError:
        return jsonify({'error': 'Invalid date format, use YYYY-MM-DD'}), 400

    logged_by = _current_user_name()
    created   = 0
    skipped   = 0

    for wid in worker_ids:
        for pbid in pb_ids:
            exists = WorkEntry.query.filter_by(
                worker_id=wid, power_block_id=pbid,
                task_type=task_type, work_date=target
            ).first()
            if exists:
                skipped += 1
                continue
            entry = WorkEntry(
                worker_id=wid, power_block_id=pbid,
                task_type=task_type, work_date=target,
                tracker_id=tracker_id,
                logged_by=logged_by,
            )
            db.session.add(entry)
            created += 1

    db.session.commit()

    # Regenerate today's report snapshot automatically
    _get_or_generate_report(target, tracker_id)

    return jsonify({'success': True, 'created': created, 'skipped': skipped}), 201


@bp.route('/work-entries/<int:entry_id>', methods=['DELETE'])
def delete_work_entry(entry_id):
    entry = WorkEntry.query.get_or_404(entry_id)
    target = entry.work_date
    tid = entry.tracker_id
    db.session.delete(entry)
    db.session.commit()
    _get_or_generate_report(target, tid)   # refresh snapshot
    return jsonify({'success': True}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────────

@bp.route('/reports', methods=['GET'])
def list_reports():
    """Return summary of all reports, newest first (tracker-aware)."""
    tracker_id = _resolve_tracker_id()
    q = DailyReport.query
    if tracker_id:
        q = q.filter_by(tracker_id=tracker_id)
    reports = q.order_by(DailyReport.report_date.desc()).all()
    return jsonify({'success': True, 'data': [r.to_summary() for r in reports]}), 200


@bp.route('/reports/<int:report_id>', methods=['GET'])
def get_report(report_id):
    r = DailyReport.query.get_or_404(report_id)
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/claim-scan-file/<path:relative_path>', methods=['GET'])
def serve_claim_scan_file(relative_path):
    abs_path = _resolve_claim_scan_file(relative_path)
    if not abs_path:
        return jsonify({'error': 'Scan file not found'}), 404
    directory, filename = os.path.split(abs_path)
    return send_from_directory(directory, filename)


@bp.route('/reports/claim-scan/draft', methods=['POST'])
def draft_claim_scan():
    data = request.get_json() or {}
    try:
        block_id = int(data.get('power_block_id') or 0)
    except (TypeError, ValueError):
        block_id = 0
    if block_id <= 0:
        return jsonify({'error': 'power_block_id is required'}), 400

    block = PowerBlock.query.options(
        subqueryload(PowerBlock.lbds).subqueryload(LBD.statuses)
    ).get_or_404(block_id)
    tracker_id = data.get('tracker_id')
    tracker = Tracker.query.get(tracker_id) if tracker_id else None

    try:
        image_bytes = _decode_claim_scan_image(data.get('image_base64'))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400

    target_date = _cst_today()
    stored = _save_claim_scan_file(data.get('file_name'), image_bytes, target_date)
    parsed = _parse_claim_scan(block, tracker, image_bytes)

    return jsonify({
        'success': True,
        'data': {
            'power_block_id': block.id,
            'power_block_name': block.name,
            'work_date': parsed.get('detected_date') or target_date.isoformat(),
            'assignments': parsed.get('assignments', {}),
            'preview_rows': parsed.get('preview_rows', []),
            'warnings': parsed.get('warnings', []),
            'source': parsed.get('source', 'manual'),
            'image_url': stored['image_url'],
            'image_path': stored['relative_path'],
            'image_name': stored['file_name'],
        }
    }), 200


@bp.route('/reports/claim-scan/submit', methods=['POST'])
def submit_claim_scan():
    data = request.get_json() or {}
    draft = data.get('draft') or {}

    try:
        block_id = int(data.get('power_block_id') or 0)
    except (TypeError, ValueError):
        block_id = 0
    if block_id <= 0:
        return jsonify({'error': 'power_block_id is required'}), 400

    block = PowerBlock.query.options(
        subqueryload(PowerBlock.lbds).subqueryload(LBD.statuses)
    ).get_or_404(block_id)
    tracker_id = data.get('tracker_id') or next((lbd.tracker_id for lbd in block.lbds if lbd.tracker_id), None)
    tracker = Tracker.query.get(tracker_id) if tracker_id else None
    people = _normalize_people(data.get('people') or [])
    actor = _current_user_name()
    if actor and actor.casefold() not in {name.casefold() for name in people}:
        people = _normalize_people([actor, *people])
    valid_lbd_ids = [lbd.id for lbd in block.lbds]
    assignments = _normalize_claim_assignments(data.get('assignments') or {}, valid_lbd_ids)

    try:
        target = date.fromisoformat(str(draft.get('work_date') or data.get('work_date') or _cst_today().isoformat()))
    except ValueError:
        target = _cst_today()

    _ensure_claim_workers(people)
    db.session.flush()

    workers_by_name = {
        worker.name.casefold(): worker
        for worker in Worker.query.filter(Worker.name.in_(people)).all()
    }

    created = 0
    skipped = 0
    for status_type, lbd_ids in assignments.items():
        if not lbd_ids:
            continue
        for person in people:
            worker = workers_by_name.get(person.casefold())
            if not worker:
                continue
            exists = WorkEntry.query.filter_by(
                worker_id=worker.id,
                power_block_id=block.id,
                task_type=status_type,
                work_date=target,
            ).first()
            if exists:
                skipped += 1
                continue
            db.session.add(WorkEntry(
                worker_id=worker.id,
                power_block_id=block.id,
                tracker_id=tracker_id,
                task_type=status_type,
                work_date=target,
                logged_by=actor,
            ))
            created += 1

    block.claimed_by = actor or (people[0] if people else None)
    block.set_claim_state(people, assignments)
    block.claimed_at = datetime.utcnow()

    report = _get_or_generate_report(target, tracker_id)
    scan_record = {
        'id': uuid.uuid4().hex,
        'created_at': datetime.utcnow().isoformat(),
        'created_by': actor,
        'power_block_id': block.id,
        'power_block_name': block.name,
        'people': people,
        'assignments': assignments,
        'assignment_summary': {key: len(value) for key, value in assignments.items()},
        'image_url': draft.get('image_url'),
        'image_path': draft.get('image_path'),
        'image_name': draft.get('image_name'),
        'source': draft.get('source', 'manual'),
        'warnings': list(draft.get('warnings') or []),
    }
    _append_claim_scan(report, scan_record)
    db.session.commit()

    try:
        from app import socketio
        socketio.emit('claim_update', {
            'pb_id': block.id,
            **_claim_payload(block),
        })
    except Exception:
        pass

    return jsonify({
        'success': True,
        'data': {
            'created': created,
            'skipped': skipped,
            'report_id': report.id,
            'scan_record': scan_record,
            'claim': _claim_payload(block),
        }
    }), 200


@bp.route('/reports/date/<date_str>', methods=['GET'])
def get_report_by_date(date_str):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    tracker_id = _resolve_tracker_id()
    q = DailyReport.query.filter_by(report_date=target)
    if tracker_id:
        q = q.filter_by(tracker_id=tracker_id)
    r = q.first()
    if not r:
        return jsonify({'success': True, 'data': None}), 200
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/generate', methods=['POST'])
def generate_report():
    """Manually generate/refresh a report for a given date (default: CST today)."""
    data = request.get_json() or {}
    date_str = (data.get('date') or '').strip()
    tracker_id = data.get('tracker_id') or _resolve_tracker_id()
    try:
        target = date.fromisoformat(date_str) if date_str else _cst_today()
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    r = _get_or_generate_report(target, tracker_id)
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/range', methods=['GET'])
def get_reports_range():
    """
    week:  ?type=week&date=YYYY-MM-DD   (ISO week containing that date)
    month: ?type=month&year=YYYY&month=MM
    """
    range_type = request.args.get('type', 'week')

    if range_type == 'week':
        date_str = request.args.get('date', _cst_today().isoformat())
        try:
            pivot = date.fromisoformat(date_str)
        except ValueError:
            pivot = _cst_today()
        start = pivot - timedelta(days=pivot.weekday())   # Monday
        end   = start + timedelta(days=6)                 # Sunday
    elif range_type == 'month':
        try:
            year  = int(request.args.get('year',  _cst_today().year))
            month = int(request.args.get('month', _cst_today().month))
        except ValueError:
            return jsonify({'error': 'Invalid year/month'}), 400
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
    else:
        return jsonify({'error': 'type must be week or month'}), 400

    reports = DailyReport.query.filter(
        DailyReport.report_date >= start,
        DailyReport.report_date <= end,
    ).order_by(DailyReport.report_date).all()

    return jsonify({
        'success': True,
        'range':   {'start': start.isoformat(), 'end': end.isoformat()},
        'data':    [r.to_dict() for r in reports],
    }), 200
