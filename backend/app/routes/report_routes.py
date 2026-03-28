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

from flask import Blueprint, request, jsonify, session, current_app, send_file, send_from_directory
from app import db
from app.models.worker import Worker, WorkEntry
from app.models.daily_report import DailyReport
from app.models.review_entry import ReviewEntry
from app.models.daily_review_report import DailyReviewReport
from app.models.admin_settings import AdminSettings
from app.models.tracker import Tracker
from app.models.power_block import PowerBlock
from app.models.claim_activity import ClaimActivity
from app.models.lbd import LBD
from collections import defaultdict
from datetime import date, datetime, timedelta
from sqlalchemy.orm import subqueryload
from sqlalchemy import or_
from io import BytesIO
import pytz
import base64
import os
import re
import json
import shutil
import subprocess
import tempfile
import uuid
from app.utils.tracker_access import allowed_tracker_ids, current_session_user, resolve_accessible_tracker

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
    user = current_session_user()
    if not user:
        return 'Guest'
    return user.name or 'Guest'


def _current_user():
    return current_session_user()


def _is_admin_user(user=None):
    user = user or _current_user()
    return bool(user and (getattr(user, 'is_admin', False) or getattr(user, 'role', None) == 'admin'))


def _can_manage_reviews(user=None):
    user = user or _current_user()
    return bool(user and (_is_admin_user(user) or user.has_permission('admin_settings')))


def _allowed_tracker_id_set(user=None):
    return set(allowed_tracker_ids(user=user))


def _scope_query_to_accessible_trackers(query, tracker_column, tracker_id=None, user=None):
    user = user or _current_user()
    if tracker_id:
        return query.filter(tracker_column == tracker_id)
    if _is_admin_user(user):
        return query
    allowed_ids = _allowed_tracker_id_set(user=user)
    if not allowed_ids:
        return query.filter(False)
    return query.filter(tracker_column.in_(allowed_ids))


def _resolve_requested_tracker(allow_admin_none=False):
    tracker = resolve_accessible_tracker()
    if tracker:
        return tracker
    if allow_admin_none and _is_admin_user():
        return None
    return None


def _report_is_accessible(report, user=None):
    if not report:
        return False
    user = user or _current_user()
    if _is_admin_user(user):
        return True
    tracker_id = getattr(report, 'tracker_id', None)
    return bool(tracker_id and tracker_id in _allowed_tracker_id_set(user=user))


def _work_entry_is_accessible(entry, user=None):
    if not entry:
        return False
    user = user or _current_user()
    if _is_admin_user(user):
        return True
    tracker_id = getattr(entry, 'tracker_id', None)
    return bool(tracker_id and tracker_id in _allowed_tracker_id_set(user=user))


def _review_entry_is_accessible(entry, user=None):
    if not entry:
        return False
    user = user or _current_user()
    if not _can_manage_reviews(user):
        return False
    if _is_admin_user(user):
        return True
    tracker_id = getattr(entry, 'tracker_id', None)
    return bool(tracker_id and tracker_id in _allowed_tracker_id_set(user=user))


def _review_report_is_accessible(report, user=None):
    if not report:
        return False
    user = user or _current_user()
    if not _can_manage_reviews(user):
        return False
    if _is_admin_user(user):
        return True
    tracker_id = getattr(report, 'tracker_id', None)
    return bool(tracker_id and tracker_id in _allowed_tracker_id_set(user=user))


def _resolve_block_tracker(block, requested_tracker_id=None, user=None):
    user = user or _current_user()
    candidate_ids = []
    seen = set()
    for lbd in block.lbds:
        tracker_id = getattr(lbd, 'tracker_id', None)
        if not tracker_id or tracker_id in seen:
            continue
        seen.add(tracker_id)
        candidate_ids.append(tracker_id)

    if requested_tracker_id:
        tracker = resolve_accessible_tracker(requested_tracker_id, user=user)
        if tracker and (tracker.id in seen or _is_admin_user(user) or not seen):
            return tracker
        return None

    for tracker_id in candidate_ids:
        tracker = resolve_accessible_tracker(tracker_id, user=user)
        if tracker:
            return tracker

    if _is_admin_user(user) and candidate_ids:
        return Tracker.query.get(candidate_ids[0])
    return None


def _block_accessible_lbd_ids(block, tracker=None):
    if tracker:
        exact_ids = [lbd.id for lbd in block.lbds if lbd.tracker_id == tracker.id]
        if exact_ids:
            return exact_ids
        return [lbd.id for lbd in block.lbds if lbd.tracker_id is None]
    if _is_admin_user():
        return [lbd.id for lbd in block.lbds]
    allowed_ids = _allowed_tracker_id_set()
    return [lbd.id for lbd in block.lbds if lbd.tracker_id in allowed_ids]


def _claim_scan_path_is_accessible(relative_path, user=None):
    normalized = str(relative_path or '').replace('\\', '/').lstrip('/')
    user = user or _current_user()
    query = DailyReport.query
    if not _is_admin_user(user):
        allowed_ids = _allowed_tracker_id_set(user=user)
        if not allowed_ids:
            return False
        query = query.filter(DailyReport.tracker_id.in_(allowed_ids))
    for report in query.all():
        for scan in list(report.get_data().get('claim_scans') or []):
            if str(scan.get('image_path') or '').replace('\\', '/').lstrip('/') == normalized:
                return True
    return False


def _resolve_tracker_id():
    """Get tracker_id from request args or JSON body."""
    t = resolve_accessible_tracker()
    return t.id if t else None


def _can_backfill_claims(user=None):
    user = user or _current_user()
    return bool(user and (_is_admin_user(user) or user.has_permission('admin_settings')))


def _parse_claim_activity_timestamp(raw_value, target_date):
    raw = str(raw_value or '').strip()
    if not raw:
        local_dt = CST.localize(datetime.combine(target_date, datetime.min.time().replace(hour=12)))
        return local_dt.astimezone(pytz.utc).replace(tzinfo=None)
    try:
        parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('Invalid claim time, use YYYY-MM-DDTHH:MM') from exc
    if parsed.tzinfo is None:
        parsed = CST.localize(parsed)
    else:
        parsed = parsed.astimezone(CST)
    return parsed.astimezone(pytz.utc).replace(tzinfo=None)


def _report_block_label(entry):
    power_block_name = str(entry.get('power_block_name') or '?')
    count = int(entry.get('assignment_count') or 0)
    if count > 1:
        return f'{power_block_name} ({count} LBDs)'
    if count == 1:
        return f'{power_block_name} (1 LBD)'
    return power_block_name


def _report_worker_label(entry):
    worker_name = str(entry.get('worker_name') or '?')
    count = int(entry.get('assignment_count') or 0)
    if count > 1:
        return f'{worker_name} ({count})'
    return worker_name


def _claim_activity_rows(target_date, tracker_id=None, user=None):
    user = user or _current_user()
    query = _scope_query_to_accessible_trackers(
        ClaimActivity.query.options(subqueryload(ClaimActivity.power_block)).filter_by(work_date=target_date),
        ClaimActivity.tracker_id,
        tracker_id=tracker_id,
        user=user,
    ).order_by(ClaimActivity.claimed_at.asc(), ClaimActivity.id.asc())

    rows = []
    for activity in query.all():
        people = activity.get_people()
        assignments = activity.get_assignments()
        if not people or not assignments:
            continue
        power_block_name = activity.power_block.name if activity.power_block else f'Power Block {activity.power_block_id}'
        claimed_at_iso = activity.claimed_at.isoformat() if activity.claimed_at else None
        for status_type, lbd_ids in assignments.items():
            count = len(lbd_ids or [])
            if count <= 0:
                continue
            for person in people:
                rows.append({
                    'id': activity.id,
                    'worker_id': None,
                    'worker_name': person,
                    'power_block_id': activity.power_block_id,
                    'tracker_id': activity.tracker_id,
                    'power_block_name': power_block_name,
                    'task_type': status_type,
                    'work_date': activity.work_date.isoformat() if activity.work_date else None,
                    'logged_by': activity.claimed_by,
                    'created_at': claimed_at_iso,
                    'source': activity.source or 'claim_activity',
                    'assignment_count': count,
                    'claimed_at': claimed_at_iso,
                })
    return rows


def _claim_day_utc_bounds(target_date):
    start_local = CST.localize(datetime.combine(target_date, datetime.min.time()))
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(pytz.utc).replace(tzinfo=None),
        end_local.astimezone(pytz.utc).replace(tzinfo=None),
    )


def _claim_snapshot_rows(target_date, tracker=None, tracker_id=None, user=None, existing_keys=None):
    user = user or _current_user()
    seen_keys = existing_keys if existing_keys is not None else set()
    start_utc, end_utc = _claim_day_utc_bounds(target_date)

    query = PowerBlock.query.options(subqueryload(PowerBlock.lbds)).filter(
        PowerBlock.claimed_at >= start_utc,
        PowerBlock.claimed_at < end_utc,
    )
    if tracker_id:
        query = query.filter(PowerBlock.lbds.any(LBD.tracker_id == tracker_id))
    elif not _is_admin_user(user):
        allowed_ids = _allowed_tracker_id_set(user=user)
        if not allowed_ids:
            return []
        query = query.filter(PowerBlock.lbds.any(LBD.tracker_id.in_(allowed_ids)))

    rows = []
    for block in query.all():
        accessible_lbd_ids = set(_block_accessible_lbd_ids(block, tracker=tracker))
        if not accessible_lbd_ids:
            continue

        assignments = {}
        for status_type, lbd_ids in (block.get_claim_assignments() or {}).items():
            filtered_ids = [lbd_id for lbd_id in (lbd_ids or []) if lbd_id in accessible_lbd_ids]
            if filtered_ids:
                assignments[status_type] = filtered_ids

        people = block.get_claimed_people()
        if not people or not assignments:
            continue

        claimed_at_iso = block.claimed_at.isoformat() if block.claimed_at else None
        for status_type, lbd_ids in assignments.items():
            for person in people:
                dedupe_key = (str(person or '').casefold(), block.id, str(status_type or '').strip())
                if dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)
                rows.append({
                    'id': None,
                    'worker_id': None,
                    'worker_name': person,
                    'power_block_id': block.id,
                    'tracker_id': tracker.id if tracker else None,
                    'power_block_name': block.name,
                    'task_type': status_type,
                    'work_date': target_date.isoformat(),
                    'logged_by': block.claimed_by,
                    'created_at': claimed_at_iso,
                    'source': 'claim_snapshot',
                    'assignment_count': len(lbd_ids),
                    'claimed_at': claimed_at_iso,
                })
    return rows


def _build_report_data(target_date, tracker_id=None, existing_data=None):
    """Aggregate claim activity for *target_date*, with legacy fallbacks."""
    user = _current_user()
    tracker = resolve_accessible_tracker(tracker_id, user=user) if tracker_id else None
    col_names = tracker.get_status_names() if tracker else AdminSettings.get_names()
    raw_entries = _claim_activity_rows(target_date, tracker_id=tracker_id, user=user)

    # Group by task_type → worker → [power_blocks]
    by_task     = defaultdict(lambda: defaultdict(list))
    by_worker   = defaultdict(lambda: defaultdict(list))
    by_pb       = defaultdict(lambda: defaultdict(list))
    worker_names = set()

    if not raw_entries:
        q = _scope_query_to_accessible_trackers(
            WorkEntry.query.filter_by(work_date=target_date),
            WorkEntry.tracker_id,
            tracker_id=tracker_id,
            user=user,
        )
        entries = q.all()
        existing_keys = set()
        for e in entries:
            worker = e.worker.name if e.worker else '?'
            raw_entries.append({
                **e.to_dict(),
                'source': 'work_entry',
                'assignment_count': 1,
            })
            existing_keys.add((worker.casefold(), e.power_block_id, e.task_type))

        raw_entries.extend(_claim_snapshot_rows(
            target_date,
            tracker=tracker,
            tracker_id=tracker_id,
            user=user,
            existing_keys=existing_keys,
        ))

    for entry in raw_entries:
        task = entry.get('task_type')
        worker = entry.get('worker_name') or '?'
        pb = _report_block_label(entry)
        by_task[task][worker].append(pb)
        by_worker[worker][task].append(pb)
        by_pb[str(entry.get('power_block_name') or '?')][task].append(_report_worker_label(entry))
        worker_names.add(worker)

    existing_data = existing_data or {}
    total_lbd_count = sum(int(entry.get('assignment_count') or 1) for entry in raw_entries)

    return {
        'report_date':   target_date.isoformat(),
        'total_entries': len(raw_entries),
        'total_lbd_count': total_lbd_count,
        'worker_names':  sorted(worker_names),
        'by_task':       {t: dict(w) for t, w in by_task.items()},
        'by_worker':     {w: dict(t) for w, t in by_worker.items()},
        'by_power_block': {pb: dict(t) for pb, t in by_pb.items()},
        'task_labels':   col_names,
        'raw_entries': raw_entries,
        'claim_scans': list(existing_data.get('claim_scans') or []),
    }


def _get_or_generate_report(target_date, tracker_id=None):
    """Return the DailyReport for *target_date*, creating/updating it if needed."""
    user = _current_user()
    tracker = resolve_accessible_tracker(tracker_id, user=user) if tracker_id else None
    if tracker_id and not tracker:
        return None
    if not tracker and not tracker_id and not _is_admin_user(user):
        tracker = resolve_accessible_tracker(user=user)
        if not tracker:
            return None
        tracker_id = tracker.id

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


def _report_pdf_bytes(report):
    from html import escape
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    payload = report.get_data() or {}
    by_task = payload.get('by_task') or {}
    by_worker = payload.get('by_worker') or {}
    by_power_block = payload.get('by_power_block') or {}
    raw_entries = payload.get('raw_entries') or []
    claim_scans = payload.get('claim_scans') or []
    worker_names = payload.get('worker_names') or []

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'ReportTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=22,
        leading=26,
        textColor=colors.HexColor('#0f172a'),
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        'ReportSubtitle',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#475569'),
        spaceAfter=6,
    )
    section_style = ParagraphStyle(
        'ReportSection',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=colors.HexColor('#0f766e'),
        spaceBefore=12,
        spaceAfter=6,
    )
    body_style = ParagraphStyle(
        'ReportBody',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#1e293b'),
    )
    muted_style = ParagraphStyle(
        'ReportMuted',
        parent=body_style,
        textColor=colors.HexColor('#64748b'),
    )

    def _paragraph(text, style=body_style):
        return Paragraph(escape(str(text or '')), style)

    def _kv_table(rows, column_widths=None, header=False):
        table = Table(rows, colWidths=column_widths, hAlign='LEFT')
        style_commands = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]
        if header:
            style_commands.extend([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e2e8f0')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#0f172a')),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ])
        table.setStyle(TableStyle(style_commands))
        return table

    story = [
        _paragraph('Princess Trackers', title_style),
        _paragraph('Daily Progress Report', subtitle_style),
        _paragraph(report.report_date.isoformat() if report.report_date else '', muted_style),
        Spacer(1, 12),
    ]

    stats = _kv_table([
        ['Total Entries', str(payload.get('total_entries', 0)), 'LBDs', str(payload.get('total_lbd_count', 0)), 'Workers', str(len(worker_names)), 'Power Blocks', str(len(by_power_block))],
    ], column_widths=[85, 48, 50, 48, 65, 48, 85, 48])
    stats.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#0f172a')),
    ]))
    story.extend([stats, Spacer(1, 14)])

    if by_power_block:
        story.append(_paragraph('Work By Power Block', section_style))
        for power_block, task_map in by_power_block.items():
            rows = [['Task', 'Workers']]
            for task, workers in (task_map or {}).items():
                rows.append([str(task), ', '.join(str(worker) for worker in (workers or [])) or 'None'])
            story.append(_paragraph(power_block, ParagraphStyle('BlockName', parent=body_style, fontName='Helvetica-Bold', fontSize=11)))
            story.append(_kv_table(rows, column_widths=[140, 340], header=True))
            story.append(Spacer(1, 8))

    if by_task:
        story.append(_paragraph('Task Breakdown', section_style))
        for task, worker_map in by_task.items():
            rows = [['Worker', 'Power Blocks']]
            for worker, blocks in (worker_map or {}).items():
                rows.append([str(worker), ', '.join(str(block) for block in (blocks or [])) or 'None'])
            story.append(_paragraph(task, ParagraphStyle('TaskName', parent=body_style, fontName='Helvetica-Bold', fontSize=11)))
            story.append(_kv_table(rows, column_widths=[140, 340], header=True))
            story.append(Spacer(1, 8))

    if by_worker:
        story.append(_paragraph('Worker Summary', section_style))
        for worker, task_map in by_worker.items():
            rows = [['Task', 'Power Blocks']]
            for task, blocks in (task_map or {}).items():
                rows.append([str(task), ', '.join(str(block) for block in (blocks or [])) or 'None'])
            story.append(_paragraph(worker, ParagraphStyle('WorkerName', parent=body_style, fontName='Helvetica-Bold', fontSize=11)))
            story.append(_kv_table(rows, column_widths=[140, 340], header=True))
            story.append(Spacer(1, 8))

    if claim_scans:
        story.append(_paragraph('Claim Scans', section_style))
        rows = [['Power Block', 'Crew', 'Assignments', 'Created']]
        for scan in claim_scans:
            summary = scan.get('assignment_summary') or {}
            summary_text = ', '.join(f'{task}: {count}' for task, count in summary.items()) or 'No assignments'
            rows.append([
                str(scan.get('power_block_name') or ''),
                ', '.join(str(name) for name in (scan.get('people') or [])) or 'No crew listed',
                summary_text,
                str(scan.get('created_at') or ''),
            ])
        story.append(_kv_table(rows, column_widths=[120, 140, 170, 90], header=True))
        story.append(Spacer(1, 8))

    if raw_entries:
        story.append(_paragraph('Detailed Log', section_style))
        rows = [['Worker', 'Task', 'Power Block', 'LBD Count', 'Date', 'Logged By']]
        for entry in raw_entries:
            rows.append([
                str(entry.get('worker_name') or ''),
                str(entry.get('task_type') or ''),
                str(entry.get('power_block_name') or ''),
                str(entry.get('assignment_count') or 1),
                str(entry.get('work_date') or ''),
                str(entry.get('logged_by') or ''),
            ])
        story.append(_kv_table(rows, column_widths=[80, 80, 140, 60, 60, 80], header=True))
    elif not by_power_block and not by_task and not by_worker and not claim_scans:
        story.append(_paragraph('No work was logged for this day.', muted_style))

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=28,
        rightMargin=28,
        topMargin=28,
        bottomMargin=28,
    )
    doc.build(story)
    return buffer.getvalue()


def _build_review_report_data(target_date, tracker_id=None):
    query = ReviewEntry.query.options(
        subqueryload(ReviewEntry.power_block),
        subqueryload(ReviewEntry.lbd).subqueryload(LBD.power_block),
    ).filter_by(review_date=target_date)
    if tracker_id:
        query = query.filter(or_(ReviewEntry.tracker_id == tracker_id, ReviewEntry.tracker_id.is_(None)))
    entries = query.order_by(ReviewEntry.created_at.asc(), ReviewEntry.id.asc()).all()

    reviewer_names = sorted({entry.reviewed_by for entry in entries if entry.reviewed_by})
    by_power_block = defaultdict(list)
    latest_by_target = {}

    for entry in entries:
        item = entry.to_dict()
        block_name = item.get('power_block_name') or f"Power Block {entry.power_block_id}"
        target_key = f"lbd:{entry.lbd_id}" if entry.lbd_id else f"block:{entry.power_block_id}"
        by_power_block[block_name].append(item)
        latest_by_target[target_key] = item

    by_reviewer = defaultdict(lambda: {'pass': [], 'fail': []})
    latest_reviews = sorted(
        latest_by_target.values(),
        key=lambda item: (
            str(item.get('power_block_name') or '').lower(),
            str(item.get('review_target_label') or '').lower(),
            str(item.get('created_at') or ''),
        ),
    )
    for item in latest_reviews:
        reviewer = item.get('reviewed_by') or 'Unknown'
        result = 'pass' if item.get('review_result') == 'pass' else 'fail'
        target_label = item.get('review_target_label') or item.get('power_block_name') or 'Unknown'
        if item.get('power_block_name') and item.get('lbd_id'):
            target_label = f"{item.get('power_block_name')} / {target_label}"
        by_reviewer[reviewer][result].append(target_label)

    failed_lbds = [item for item in latest_reviews if item.get('review_result') == 'fail']

    return {
        'report_date': target_date.isoformat(),
        'total_reviews': len(entries),
        'pass_count': sum(1 for item in latest_reviews if item.get('review_result') == 'pass'),
        'fail_count': len(failed_lbds),
        'reviewer_names': reviewer_names,
        'raw_entries': [entry.to_dict() for entry in entries],
        'latest_reviews': latest_reviews,
        'failed_lbds': failed_lbds,
        'failed_blocks': failed_lbds,
        'by_power_block': {name: items for name, items in by_power_block.items()},
        'by_reviewer': {name: groups for name, groups in by_reviewer.items()},
    }


def _get_or_generate_review_report(target_date, tracker_id=None):
    user = _current_user()
    tracker = resolve_accessible_tracker(tracker_id, user=user) if tracker_id else None
    if tracker_id and not tracker and _is_admin_user(user):
        try:
            tracker = Tracker.query.get(int(tracker_id))
        except (TypeError, ValueError):
            tracker = None
    if tracker_id and not tracker:
        return None
    if not tracker and not tracker_id and not _is_admin_user(user):
        tracker = resolve_accessible_tracker(user=user)
        if not tracker:
            return None
        tracker_id = tracker.id

    query = DailyReviewReport.query.filter_by(report_date=target_date)
    if tracker_id:
        query = query.filter_by(tracker_id=tracker_id)
    report = query.first()
    if report is None:
        report = DailyReviewReport(report_date=target_date, tracker_id=tracker_id)
        db.session.add(report)
    report.set_data(_build_review_report_data(target_date, tracker_id))
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


def _align_assignments_to_tracker_columns(tracker, assignments):
    normalized_assignments = _normalize_claim_assignments(assignments)
    if not tracker or not normalized_assignments:
        return normalized_assignments

    tracker_columns = [str(column or '').strip() for column in tracker.all_column_keys() if str(column or '').strip()]
    if not tracker_columns:
        return normalized_assignments

    tracker_column_set = set(tracker_columns)
    if set(normalized_assignments.keys()).issubset(tracker_column_set):
        return normalized_assignments

    # Single-column trackers such as inverter landing should treat any submitted
    # assignment selection as work for that tracker column.
    if len(tracker_columns) == 1:
        merged_ids = []
        seen_ids = set()
        for lbd_ids in normalized_assignments.values():
            for lbd_id in lbd_ids:
                if lbd_id in seen_ids:
                    continue
                seen_ids.add(lbd_id)
                merged_ids.append(lbd_id)
        if merged_ids:
            return {tracker_columns[0]: merged_ids}

    return {
        status_type: lbd_ids
        for status_type, lbd_ids in normalized_assignments.items()
        if status_type in tracker_column_set
    }


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
        row_top = int(round(center_y - (estimated_height / 2.0)))
        row_height = int(round(estimated_height))
        fitted[lbd_id] = {
            'top': row_top,
            'height': row_height,
            'width': int(round(estimated_width)),
            'source': 'ocr-row-fit',
            'conf': row_markers.get(row_number, {}).get('conf', 0.0),
            'row_top': row_top,
            'row_bottom': row_top + row_height,
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

    inset_y = min(max(2, roi.shape[0] // 8), 12)
    inset_x = min(max(2, roi.shape[1] // 8), 12)
    if roi.shape[0] > (inset_y * 2) + 4 and roi.shape[1] > (inset_x * 2) + 4:
        roi = roi[inset_y:roi.shape[0] - inset_y, inset_x:roi.shape[1] - inset_x]
    return roi


def _claim_mark_metrics(roi):
    """Compute detection metrics for a cell ROI.

    The primary metric for form-layout mode is ``center_ratio`` — the fill
    ratio of the innermost 50 % of the cell *before* any morphological
    processing.  Grid lines live at cell borders, so the center crop is
    naturally line-free, making the measurement immune to the destructive
    line-removal that was previously eating thin pen strokes.

    The morphology-based metrics (fill_ratio, peak_ratio, …) are still
    computed as a secondary signal and used for non-form (freestyle) mode.
    """
    try:
        import cv2
        import numpy as np
    except Exception:
        if roi.size == 0:
            return {
                'raw_fill_ratio': 0.0,
                'center_ratio': 0.0,
                'center_pixels': 0,
                'fill_ratio': 0.0,
                'peak_ratio': 0.0,
                'component_ratio': 0.0,
                'ink_pixels': 0,
            }
        fill_ratio = float((roi > 0).sum()) / float(roi.size)
        return {
            'raw_fill_ratio': fill_ratio,
            'center_ratio': fill_ratio,
            'center_pixels': int((roi > 0).sum()),
            'fill_ratio': fill_ratio,
            'peak_ratio': fill_ratio,
            'component_ratio': fill_ratio,
            'ink_pixels': int((roi > 0).sum()),
        }

    if roi.size == 0:
        return {
            'raw_fill_ratio': 0.0,
            'center_ratio': 0.0,
            'center_pixels': 0,
            'fill_ratio': 0.0,
            'peak_ratio': 0.0,
            'component_ratio': 0.0,
            'ink_pixels': 0,
        }

    work = (roi > 0).astype(np.uint8) * 255
    raw_fill_ratio = float((work > 0).sum()) / float(work.size)
    height, width = work.shape[:2]

    # ---- CENTER-CROP metric (no morphology — primary for form layout) ----
    # Use the inner 50 % of the ROI.  Since the ROI already has a 1/8 inset
    # from cell borders, this center region is very far from any grid line.
    margin_y = max(2, height // 4)
    margin_x = max(2, width // 4)
    if height > margin_y * 2 + 2 and width > margin_x * 2 + 2:
        center_crop = work[margin_y:height - margin_y, margin_x:width - margin_x]
    else:
        center_crop = work
    center_pixels = int((center_crop > 0).sum())
    center_ratio = float(center_pixels) / float(center_crop.size) if center_crop.size else 0.0

    # ---- Morphology-based metrics (for non-form / freestyle mode) ----
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
            'center_ratio': center_ratio,
            'center_pixels': center_pixels,
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
        'center_ratio': center_ratio,
        'center_pixels': center_pixels,
        'fill_ratio': float(ink_pixels) / float(ink_mask.size),
        'peak_ratio': float(density.max()) if density.size else 0.0,
        'component_ratio': component_ratio,
        'ink_pixels': ink_pixels,
    }


def _is_claim_marked(metrics, use_form_layout=False):
    if use_form_layout:
        # ----- Form-layout mode -----
        # Primary signal: center_ratio — fill ratio of the innermost 50 %
        # of the ROI, computed directly on the binary image with NO
        # morphological processing.  Grid lines are at cell borders and
        # cannot reach this center crop, so blank cells read ~0 while any
        # pen mark (X, check, fill) crossing the center reads > 0.01.
        center_ratio = metrics.get('center_ratio', 0.0)
        center_pixels = metrics.get('center_pixels', 0)

        # Need at least a few real pixels to avoid noise
        if center_pixels < 5:
            return False

        # Any meaningful ink in the center region → marked
        if center_ratio >= 0.01:
            return True

        # Solid fill fallback (line-removal destroys ink but raw_fill stays)
        if metrics.get('raw_fill_ratio', 0.0) >= 0.18:
            return True

        return False

    # Non-form-layout (freestyle scanning)
    if metrics.get('raw_fill_ratio', 0.0) >= 0.11:
        return True
    if metrics.get('ink_pixels', 0) < 8:
        return False
    if metrics.get('peak_ratio', 0.0) >= 0.17:
        return True
    if metrics.get('component_ratio', 0.0) >= 0.03:
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
            # Adaptive threshold captures faint pen marks that global Otsu misses
            mark_binary = cv2.adaptiveThreshold(
                rectified_blur, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV,
                blockSize=51, C=10,
            )
        except Exception:
            scan_binary = binary
            mark_binary = binary
    else:
        scan_binary = binary
        mark_binary = binary

    height, width = scan_binary.shape[:2]
    tracker = tracker or (resolve_accessible_tracker(block.lbds[0].tracker_id) if block.lbds and block.lbds[0].tracker_id else None)
    status_types = _claim_scan_status_types(tracker)
    status_names = tracker.get_status_names() if tracker else AdminSettings.get_names()
    status_positions = {}
    warnings = []
    source = 'ocr-grid'
    form_row_count = CLAIM_SCAN_FORM_ROWS
    scan_row_count = max(1, min(form_row_count, len(block.lbds) or form_row_count))
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
    row_number_map = _map_form_rows_to_lbds(block, row_count=scan_row_count)

    if layout and layout.get('y_boundaries'):
        y_boundaries = layout['y_boundaries']
        for row_number in range(1, min(scan_row_count, len(y_boundaries) - 2) + 1):
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
                'row_top': int(top),
                'row_bottom': int(bottom),
            }

    fitted_rows = _fit_claim_scan_rows_from_ocr(items, row_number_map, width, row_count=scan_row_count)
    for lbd_id, row_data in fitted_rows.items():
        # Only use OCR-fitted rows when layout didn't already provide them.
        # Layout rows come from detected grid lines and are far more accurate
        # than OCR-estimated Y positions.
        if lbd_id not in row_candidates:
            row_candidates[lbd_id] = row_data

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
    debug_cells = []
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
                row_top = int(item.get('row_top', row_y - max(10, int(item['height'] * 0.38))))
                row_bottom = int(item.get('row_bottom', row_y + max(10, int(item['height'] * 0.38))))
                top = max(0, row_top + 2)
                bottom = min(height, row_bottom - 2)
            else:
                horizontal_padding = max(18, int(item['width'] * 1.15))
                vertical_padding = max(12, int(item['height'] * 1.25))
                left = max(0, center_x - horizontal_padding)
                right = min(width, center_x + horizontal_padding)
                top = max(0, row_y - vertical_padding)
                bottom = min(height, row_y + vertical_padding)
            roi = _extract_claim_cell_roi(mark_binary, left, right, top, bottom)
            if roi.size == 0:
                continue
            metrics = _claim_mark_metrics(roi)
            is_marked = _is_claim_marked(metrics, use_form_layout=bool(layout and source == 'form-grid'))
            debug_cells.append({
                'lbd_id': lbd_id,
                'lbd_label': lbd_labels.get(lbd_id, f'LBD {lbd_id}'),
                'status_type': status_type,
                'marked': is_marked,
                'center_ratio': round(metrics.get('center_ratio', 0), 5),
                'center_pixels': metrics.get('center_pixels', 0),
                'raw_fill': round(metrics.get('raw_fill_ratio', 0), 5),
                'roi_shape': f'{roi.shape[0]}x{roi.shape[1]}' if roi.size else '0x0',
                'cell_bbox': [int(left), int(top), int(right), int(bottom)],
                'row_source': item.get('source', 'ocr'),
            })
            if is_marked:
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
        'debug_cells': debug_cells,
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
    q = _scope_query_to_accessible_trackers(
        WorkEntry.query.filter_by(work_date=target),
        WorkEntry.tracker_id,
        tracker_id=tracker_id,
    )
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
    tracker = resolve_accessible_tracker(tracker_id) if tracker_id else _resolve_requested_tracker(allow_admin_none=True)
    if not tracker and not _is_admin_user():
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    tracker_id = tracker.id if tracker else None
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

    allowed_block_ids = set()
    if pb_ids:
        blocks = PowerBlock.query.options(subqueryload(PowerBlock.lbds)).filter(PowerBlock.id.in_(pb_ids)).all()
        if tracker:
            allowed_block_ids = {block.id for block in blocks if any(lbd.tracker_id == tracker.id for lbd in block.lbds)}
        elif _is_admin_user():
            allowed_block_ids = {block.id for block in blocks}
    invalid_block_ids = sorted({int(pbid) for pbid in pb_ids if str(pbid).isdigit()} - allowed_block_ids)
    if invalid_block_ids:
        return jsonify({'error': 'One or more power blocks are not accessible for your job site', 'power_block_ids': invalid_block_ids}), 403

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
    if not _work_entry_is_accessible(entry):
        return jsonify({'error': 'That work entry is not accessible for your job site'}), 403
    target = entry.work_date
    tid = entry.tracker_id
    db.session.delete(entry)
    db.session.commit()
    if tid:
        _get_or_generate_report(target, tid)   # refresh snapshot
    return jsonify({'success': True}), 200


# ─────────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────────

@bp.route('/reports', methods=['GET'])
def list_reports():
    """Return summary of all reports, newest first (tracker-aware)."""
    tracker_id = _resolve_tracker_id()
    q = _scope_query_to_accessible_trackers(DailyReport.query, DailyReport.tracker_id, tracker_id=tracker_id)
    reports = q.order_by(DailyReport.report_date.desc()).all()
    return jsonify({'success': True, 'data': [r.to_summary() for r in reports]}), 200


@bp.route('/reports/<int:report_id>', methods=['GET'])
def get_report(report_id):
    r = DailyReport.query.get_or_404(report_id)
    if not _report_is_accessible(r):
        return jsonify({'error': 'That report is not accessible for your job site'}), 403
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/claim-scan-file/<path:relative_path>', methods=['GET'])
def serve_claim_scan_file(relative_path):
    abs_path = _resolve_claim_scan_file(relative_path)
    if not abs_path:
        return jsonify({'error': 'Scan file not found'}), 404
    if not _claim_scan_path_is_accessible(relative_path):
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
    tracker = _resolve_block_tracker(block, data.get('tracker_id'))
    if not tracker and not _is_admin_user():
        return jsonify({'error': 'That power block is not accessible for your job site'}), 403

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
            'debug_cells': parsed.get('debug_cells', []),
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
    tracker = _resolve_block_tracker(block, data.get('tracker_id'))
    if not tracker and not _is_admin_user():
        return jsonify({'error': 'That power block is not accessible for your job site'}), 403
    tracker_id = tracker.id if tracker else None
    people = _normalize_people(data.get('people') or [])
    actor = _current_user_name() or str(data.get('actor_name') or '').strip() or None
    valid_lbd_ids = _block_accessible_lbd_ids(block, tracker=tracker)
    assignments = _normalize_claim_assignments(data.get('assignments') or {}, valid_lbd_ids)

    from app.routes.tracker_routes import _merge_claim_people, _parse_claim_work_date, _record_claim_work_entries, _record_claim_activity

    target = _parse_claim_work_date(draft.get('work_date') or data.get('work_date'))

    if not people:
        return jsonify({'error': 'At least one crew member is required'}), 400

    from app.routes.tracker_routes import _apply_claim_assignments_to_statuses, _completed_claim_assignments, _merge_claim_assignments

    work_entries = _record_claim_work_entries(block, people, assignments, target, actor=actor, tracker=tracker)
    _record_claim_activity(block, people, assignments, target, actor=actor, tracker=tracker, source=draft.get('source') or 'claim_scan')
    completed_assignments = _completed_claim_assignments(block, valid_lbd_ids)
    merged_assignments = _merge_claim_assignments(block.get_claim_assignments(tracker_id=tracker_id), completed_assignments, assignments)
    merged_people = _merge_claim_people(block.get_claimed_people(tracker_id=tracker_id), people)
    block.claimed_by = actor or (people[0] if people else None)
    block.set_claim_state(
        merged_people,
        merged_assignments,
        tracker_id=tracker_id,
        claimed_by=block.claimed_by,
        claimed_at=datetime.utcnow(),
    )
    block.claimed_at = datetime.utcnow()
    status_updates = _apply_claim_assignments_to_statuses(block, assignments, actor or (people[0] if people else None))

    report = _get_or_generate_report(target, tracker_id)
    if not report:
        db.session.rollback()
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    scan_record = {
        'id': uuid.uuid4().hex,
        'created_at': datetime.utcnow().isoformat(),
        'created_by': actor,
        'power_block_id': block.id,
        'power_block_name': block.name,
        'people': people,
        'assignments': merged_assignments,
        'assignment_summary': {key: len(value) for key, value in merged_assignments.items()},
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
        for update in status_updates:
            socketio.emit('status_update', update)
    except Exception:
        pass

    return jsonify({
        'success': True,
        'data': {
            'created': work_entries['created'],
            'skipped': work_entries['skipped'],
            'report_id': report.id,
            'scan_record': scan_record,
            'claim': _claim_payload(block),
        }
    }), 200


@bp.route('/reports/claim-activities/backfill', methods=['POST'])
def backfill_claim_activity():
    user = _current_user()
    if not _can_backfill_claims(user):
        return jsonify({'error': 'Claim backfill is restricted to admin users'}), 403

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

    tracker = _resolve_block_tracker(block, data.get('tracker_id'), user=user)
    if data.get('tracker_id') and not tracker and not _is_admin_user(user):
        return jsonify({'error': 'That tracker is not accessible for this power block'}), 403

    from app.routes.tracker_routes import (
        _apply_claim_assignments_to_statuses,
        _claim_payload,
        _completed_claim_assignments,
        _emit_claim_updates,
        _merge_claim_assignments,
        _merge_claim_people,
        _normalize_claim_assignments,
        _normalize_people,
        _parse_claim_work_date,
        _record_claim_activity,
        _record_claim_work_entries,
        _validate_claim_people,
    )

    people = _normalize_people(data.get('people') or [])
    if not people:
        return jsonify({'error': 'At least one crew member is required'}), 400

    _validate_claim_people(people, extra_names=block.get_claimed_people(tracker_id=tracker.id if tracker else None))
    work_date = _parse_claim_work_date(data.get('work_date') or data.get('date'))
    claimed_at = _parse_claim_activity_timestamp(data.get('claimed_at'), work_date)
    valid_lbd_ids = _block_accessible_lbd_ids(block, tracker=tracker)
    assignments = _align_assignments_to_tracker_columns(
        tracker,
        _normalize_claim_assignments(data.get('assignments') or {}, valid_lbd_ids),
    )
    if not assignments:
        return jsonify({'error': 'Select at least one LBD assignment before backfilling'}), 400

    actor = str(data.get('claimed_by') or _current_user_name()).strip() or None
    tracker_id = tracker.id if tracker else None
    completed_assignments = _completed_claim_assignments(block, valid_lbd_ids)
    merged_assignments = _merge_claim_assignments(
        block.get_claim_assignments(tracker_id=tracker_id),
        completed_assignments,
        assignments,
    )
    merged_assignments = _align_assignments_to_tracker_columns(tracker, merged_assignments)
    merged_people = _merge_claim_people(block.get_claimed_people(tracker_id=tracker_id), people)
    live_claimed_by = actor or people[0]

    block.claimed_by = live_claimed_by
    block.claimed_at = claimed_at
    block.set_claim_state(
        merged_people,
        merged_assignments,
        tracker_id=tracker_id,
        claimed_by=live_claimed_by,
        claimed_at=claimed_at,
    )

    work_entries = _record_claim_work_entries(
        block,
        people,
        assignments,
        work_date,
        actor=actor,
        tracker=tracker,
    )
    status_updates = _apply_claim_assignments_to_statuses(
        block,
        assignments,
        actor=live_claimed_by,
    )

    activity = _record_claim_activity(
        block,
        people,
        assignments,
        work_date,
        actor=actor,
        tracker=tracker,
        source='admin_backfill',
        claimed_at=claimed_at,
    )
    report = _get_or_generate_report(work_date, tracker.id if tracker else None)
    if not report:
        db.session.rollback()
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403

    db.session.commit()
    _emit_claim_updates([(block.id, _claim_payload(block, tracker=tracker))], status_updates)

    return jsonify({
        'success': True,
        'data': {
            'activity': activity.to_dict() if activity else None,
            'report_id': report.id,
            'work_entries': work_entries,
            'claim': _claim_payload(block, tracker=tracker),
        }
    }), 201


@bp.route('/reports/date/<date_str>', methods=['GET'])
def get_report_by_date(date_str):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    tracker_id = _resolve_tracker_id()
    ensure = str(request.args.get('ensure') or '').strip().lower() in {'1', 'true', 'yes'}
    if ensure:
        r = _get_or_generate_report(target, tracker_id)
        if tracker_id and not r:
            return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    else:
        q = _scope_query_to_accessible_trackers(
            DailyReport.query.filter_by(report_date=target),
            DailyReport.tracker_id,
            tracker_id=tracker_id,
        )
        r = q.first()
    if not r:
        return jsonify({'success': True, 'data': None}), 200
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reports/date/<date_str>/pdf', methods=['GET'])
def get_report_pdf_by_date(date_str):
    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400

    tracker_id = _resolve_tracker_id()
    report = _get_or_generate_report(target, tracker_id)
    if not report:
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403

    pdf_bytes = _report_pdf_bytes(report)
    filename = f'princess-trackers-{target.isoformat()}.pdf'
    return send_file(
        BytesIO(pdf_bytes),
        mimetype='application/pdf',
        download_name=filename,
        as_attachment=str(request.args.get('download') or '').strip().lower() in {'1', 'true', 'yes'},
        max_age=0,
    )


@bp.route('/reports/generate', methods=['POST'])
def generate_report():
    """Manually generate/refresh a report for a given date (default: CST today)."""
    data = request.get_json() or {}
    date_str = (data.get('date') or '').strip()
    tracker = resolve_accessible_tracker(data.get('tracker_id')) if data.get('tracker_id') else _resolve_requested_tracker(allow_admin_none=True)
    if not tracker and not _is_admin_user():
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    tracker_id = tracker.id if tracker else None
    try:
        target = date.fromisoformat(date_str) if date_str else _cst_today()
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
    r = _get_or_generate_report(target, tracker_id)
    if not r:
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    return jsonify({'success': True, 'data': r.to_dict()}), 200


@bp.route('/reviews', methods=['GET'])
def list_reviews():
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    tracker_id = _resolve_tracker_id()
    query = _scope_query_to_accessible_trackers(ReviewEntry.query, ReviewEntry.tracker_id, tracker_id=tracker_id, user=user)
    date_str = str(request.args.get('date') or '').strip()
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400
        query = query.filter(ReviewEntry.review_date == target_date)
    entries = query.order_by(ReviewEntry.created_at.desc(), ReviewEntry.id.desc()).all()
    return jsonify({'success': True, 'data': [entry.to_dict() for entry in entries]}), 200


@bp.route('/reviews', methods=['POST'])
def create_review():
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    data = request.get_json() or {}
    try:
        lbd_id = int(data.get('lbd_id') or 0)
    except (TypeError, ValueError):
        lbd_id = 0
    if lbd_id <= 0:
        return jsonify({'error': 'lbd_id is required'}), 400

    result = str(data.get('review_result') or '').strip().lower()
    if result not in {'pass', 'fail'}:
        return jsonify({'error': 'review_result must be pass or fail'}), 400

    try:
        review_date = date.fromisoformat(str(data.get('review_date') or _cst_today().isoformat()))
    except ValueError:
        return jsonify({'error': 'Invalid review_date, use YYYY-MM-DD'}), 400

    lbd = LBD.query.options(subqueryload(LBD.power_block)).get_or_404(lbd_id)
    block = lbd.power_block
    tracker = _resolve_block_tracker(block, data.get('tracker_id'), user=user)
    if not tracker and not _is_admin_user(user):
        return jsonify({'error': 'That LBD is not accessible for your job site'}), 403

    entry = ReviewEntry(
        power_block_id=block.id,
        lbd_id=lbd.id,
        tracker_id=tracker.id if tracker else None,
        review_result=result,
        review_date=review_date,
        reviewed_by=_current_user_name(),
        notes=str(data.get('notes') or '').strip() or None,
    )
    db.session.add(entry)
    db.session.commit()

    return jsonify({'success': True, 'data': entry.to_dict()}), 201


@bp.route('/reviews/bulk', methods=['POST'])
def create_reviews_bulk():
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    data = request.get_json() or {}
    raw_reviews = data.get('reviews') or []
    if not isinstance(raw_reviews, list) or not raw_reviews:
        return jsonify({'error': 'reviews must be a non-empty list'}), 400

    try:
        review_date = date.fromisoformat(str(data.get('review_date') or _cst_today().isoformat()))
    except ValueError:
        return jsonify({'error': 'Invalid review_date, use YYYY-MM-DD'}), 400

    shared_notes = str(data.get('notes') or '').strip() or None
    requested_tracker_id = data.get('tracker_id')

    normalized = {}
    for item in raw_reviews:
        if not isinstance(item, dict):
            continue
        try:
            lbd_id = int(item.get('lbd_id') or 0)
        except (TypeError, ValueError):
            lbd_id = 0
        result = str(item.get('review_result') or '').strip().lower()
        if lbd_id <= 0 or result not in {'pass', 'fail'}:
            continue
        normalized[lbd_id] = {
            'review_result': result,
            'notes': str(item.get('notes') or '').strip() or shared_notes,
        }

    if not normalized:
        return jsonify({'error': 'No valid review items were provided'}), 400

    lbds = LBD.query.options(subqueryload(LBD.power_block)).filter(LBD.id.in_(list(normalized.keys()))).all()
    found_ids = {lbd.id for lbd in lbds}
    missing_ids = sorted(set(normalized.keys()) - found_ids)
    if missing_ids:
        return jsonify({'error': f'LBDs not found: {", ".join(str(item) for item in missing_ids[:10])}'}), 404

    created_entries = []
    for lbd in lbds:
        block = lbd.power_block
        tracker = _resolve_block_tracker(block, requested_tracker_id, user=user)
        if not tracker and not _is_admin_user(user):
            return jsonify({'error': f'LBD {lbd.id} is not accessible for your job site'}), 403

        payload = normalized[lbd.id]
        entry = ReviewEntry(
            power_block_id=block.id,
            lbd_id=lbd.id,
            tracker_id=tracker.id if tracker else None,
            review_result=payload['review_result'],
            review_date=review_date,
            reviewed_by=_current_user_name(),
            notes=payload['notes'],
        )
        db.session.add(entry)
        created_entries.append(entry)

    db.session.commit()
    return jsonify({'success': True, 'data': [entry.to_dict() for entry in created_entries]}), 201


@bp.route('/review-reports', methods=['GET'])
def list_review_reports():
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    tracker_id = _resolve_tracker_id()
    query = DailyReviewReport.query
    if tracker_id:
        if _is_admin_user(user):
            query = query.filter(or_(DailyReviewReport.tracker_id == tracker_id, DailyReviewReport.tracker_id.is_(None)))
        else:
            query = query.filter(DailyReviewReport.tracker_id == tracker_id)
    else:
        query = _scope_query_to_accessible_trackers(
            query,
            DailyReviewReport.tracker_id,
            tracker_id=tracker_id,
            user=user,
        )
    reports = query.order_by(DailyReviewReport.report_date.desc()).all()
    return jsonify({'success': True, 'data': [report.to_summary() for report in reports]}), 200


@bp.route('/review-reports/<int:report_id>', methods=['GET'])
def get_review_report(report_id):
    report = DailyReviewReport.query.get_or_404(report_id)
    if not _review_report_is_accessible(report):
        return jsonify({'error': 'That review report is not accessible for your job site'}), 403
    return jsonify({'success': True, 'data': report.to_dict()}), 200


@bp.route('/review-reports/date/<date_str>', methods=['GET'])
def get_review_report_by_date(date_str):
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400

    tracker_id = _resolve_tracker_id()
    query = DailyReviewReport.query.filter_by(report_date=target)
    if tracker_id:
        if _is_admin_user(user):
            query = query.filter(or_(DailyReviewReport.tracker_id == tracker_id, DailyReviewReport.tracker_id.is_(None)))
        else:
            query = query.filter(DailyReviewReport.tracker_id == tracker_id)
    else:
        query = _scope_query_to_accessible_trackers(
            query,
            DailyReviewReport.tracker_id,
            tracker_id=tracker_id,
            user=user,
        )
    report = query.first()
    if not report:
        return jsonify({'success': True, 'data': None}), 200
    return jsonify({'success': True, 'data': report.to_dict()}), 200


@bp.route('/review-reports/generate', methods=['POST'])
def generate_review_report():
    user = _current_user()
    if not _can_manage_reviews(user):
        return jsonify({'error': 'Review access is restricted to admin users'}), 403

    data = request.get_json() or {}
    date_str = str(data.get('date') or '').strip()
    tracker = resolve_accessible_tracker(data.get('tracker_id'), user=user) if data.get('tracker_id') else _resolve_requested_tracker(allow_admin_none=True)
    if not tracker and not _is_admin_user(user):
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403

    try:
        target = date.fromisoformat(date_str) if date_str else _cst_today()
    except ValueError:
        return jsonify({'error': 'Invalid date, use YYYY-MM-DD'}), 400

    report = _get_or_generate_review_report(target, tracker.id if tracker else None)
    if not report:
        return jsonify({'error': 'No accessible tracker is available for this request'}), 403
    return jsonify({'success': True, 'data': report.to_dict()}), 200


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

    reports = _scope_query_to_accessible_trackers(
        DailyReport.query.filter(
        DailyReport.report_date >= start,
        DailyReport.report_date <= end,
        ),
        DailyReport.tracker_id,
    ).order_by(DailyReport.report_date).all()

    return jsonify({
        'success': True,
        'range':   {'start': start.isoformat(), 'end': end.isoformat()},
        'data':    [r.to_dict() for r in reports],
    }), 200
