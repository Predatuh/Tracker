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

from flask import Blueprint, request, jsonify, session
from app import db
from app.models.worker import Worker, WorkEntry
from app.models.daily_report import DailyReport
from app.models.admin_settings import AdminSettings
from collections import defaultdict
from datetime import date, datetime, timedelta
import pytz

bp = Blueprint('reports', __name__, url_prefix='/api')

CST = pytz.timezone('America/Chicago')


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


def _build_report_data(target_date):
    """Aggregate WorkEntry rows for *target_date* into a structured snapshot."""
    entries = WorkEntry.query.filter_by(work_date=target_date).all()
    col_names = AdminSettings.get_names()

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

    return {
        'report_date':   target_date.isoformat(),
        'total_entries': len(entries),
        'worker_names':  sorted(worker_names),
        'by_task':       {t: dict(w) for t, w in by_task.items()},
        'by_worker':     {w: dict(t) for w, t in by_worker.items()},
        'by_power_block': {pb: dict(t) for pb, t in by_pb.items()},
        'task_labels':   col_names,
        'raw_entries': [e.to_dict() for e in entries],
    }


def _get_or_generate_report(target_date):
    """Return the DailyReport for *target_date*, creating/updating it if needed."""
    report = DailyReport.query.filter_by(report_date=target_date).first()
    if report is None:
        report = DailyReport(report_date=target_date)
        db.session.add(report)
    report.set_data(_build_report_data(target_date))
    report.generated_at = datetime.utcnow()
    db.session.commit()
    return report


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

    entries = WorkEntry.query.filter_by(work_date=target).all()
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

    if not worker_ids or not pb_ids or not task_type:
        return jsonify({'error': 'worker_ids, power_block_ids, and task_type are required'}), 400

    # Validate task_type
    valid_tasks = AdminSettings.all_column_keys()
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
                logged_by=logged_by,
            )
            db.session.add(entry)
            created += 1

    db.session.commit()

    # Regenerate today's report snapshot automatically
    _get_or_generate_report(target)

    return jsonify({'success': True, 'created': created, 'skipped': skipped}), 201


@bp.route('/work-entries/<int:entry_id>', methods=['DELETE'])
def delete_work_entry(entry_id):
    entry = WorkEntry.query.get_or_404(entry_id)
    target = entry.work_date
    db.session.delete(entry)
    db.session.commit()
    _get_or_generate_report(target)   # refresh snapshot
    return jsonify({'success': True}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────────

@bp.route('/reports', methods=['GET'])
def list_reports():
    """Return summary of all reports, newest first."""
    reports = DailyReport.query.order_by(DailyReport.report_date.desc()).all()
    return jsonify({'success': True, 'data': [r.to_summary() for r in reports]}), 200


@bp.route('/reports/<int:report_id>', methods=['GET'])
def get_report(report_id):
    r = DailyReport.query.get_or_404(report_id)
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/date/<date_str>', methods=['GET'])
def get_report_by_date(date_str):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    r = DailyReport.query.filter_by(report_date=target).first()
    if not r:
        return jsonify({'success': True, 'data': None}), 200
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/generate', methods=['POST'])
def generate_report():
    """Manually generate/refresh a report for a given date (default: CST today)."""
    data = request.get_json() or {}
    date_str = (data.get('date') or '').strip()
    try:
        target = date.fromisoformat(date_str) if date_str else _cst_today()
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    r = _get_or_generate_report(target)
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
