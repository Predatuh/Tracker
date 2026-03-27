from flask import Blueprint, request, jsonify, session, send_file
from io import BytesIO
from sqlalchemy.orm import subqueryload
from sqlalchemy import func
from app import db
from app.models import PowerBlock, LBD, LBDStatus
from app.models.tracker import Tracker
from app.models.site_area import SiteArea
from app.models.user import User, is_claim_eligible_role
from app.models.worker import Worker, WorkEntry
from app.models.claim_activity import ClaimActivity
from app.models.admin_settings import AdminSettings
from datetime import date, datetime
import pytz
import re
from app.utils.tracker_access import allowed_tracker_ids, current_session_user, guest_session_active, resolve_accessible_tracker


CST = pytz.timezone('America/Chicago')


def _get_socketio():
    try:
        from app import socketio
        return socketio
    except Exception:
        return None


def _current_user_name():
    """Return display name of the logged-in user, or None for guests."""
    user = current_session_user()
    return user.name if user else None


def _is_admin_user(user=None):
    user = user or current_session_user()
    return bool(user and (user.is_admin or user.normalized_role() == 'admin'))


def _cst_today():
    return datetime.now(CST).date()


def _block_has_claim(block):
    if not block:
        return False
    return bool(block.claimed_by or block.get_claimed_people() or block.get_claim_assignments())


def _claim_permission_for_action(action, block=None):
    normalized_action = str(action or 'claim').strip().lower() or 'claim'
    if normalized_action == 'unclaim':
        return 'claim_delete'
    return 'claim_create'


def _can_manage_claim(action, block=None, user=None):
    user = user or current_session_user()
    if not user:
        return False
    if _is_admin_user(user):
        return True
    return user.has_permission(_claim_permission_for_action(action, block))


def _available_claim_people(extra_names=None):
    names = []
    names.extend(
        name
        for name, role in db.session.query(User.name, User.role).order_by(User.name).all()
        if name and is_claim_eligible_role(role)
    )
    names.extend(
        name
        for (name,) in db.session.query(Worker.name).filter_by(is_active=True).order_by(Worker.name).all()
        if name
    )
    names.extend(extra_names or [])
    return _normalize_people(names)


def _validate_claim_people(names, extra_names=None):
    allowed_lookup = {name.casefold() for name in _available_claim_people(extra_names=extra_names)}
    invalid = [name for name in _normalize_people(names) if name.casefold() not in allowed_lookup]
    if invalid:
        raise ValueError('Only Foreman, Worker, and Lead crew members can be assigned to claims')


def _can_view_ifc(user=None):
    return bool(user or current_session_user())


def _pb_sort_key(name):
    """Extract numeric part from PB name for natural sorting (INV-1, INV-2, ..., INV-96)."""
    m = re.search(r'(\d+)', name or '')
    return int(m.group(1)) if m else 0


def _resolve_tracker():
    """Resolve tracker from request args."""
    return resolve_accessible_tracker()


def _allowed_tracker_id_set():
    return set(allowed_tracker_ids())


def _lbd_is_accessible(lbd):
    tracker_id = getattr(lbd, 'tracker_id', None)
    return bool(tracker_id and resolve_accessible_tracker(tracker_id))


def _block_is_accessible(block):
    user = current_session_user()
    if _is_admin_user(user):
        return True
    allowed_ids = _allowed_tracker_id_set()
    if not allowed_ids:
        return False
    block_tracker_ids = {lbd.tracker_id for lbd in block.lbds if lbd.tracker_id}
    has_unassigned = any(lbd.tracker_id is None for lbd in block.lbds)
    return bool(block_tracker_ids & allowed_ids) or has_unassigned


def _serialize_accessible_block(block):
    user = current_session_user()
    if _is_admin_user(user):
        return block.to_dict()
    allowed_ids = _allowed_tracker_id_set()
    payload = block.to_dict()
    visible_lbds = [lbd for lbd in payload.get('lbds', []) if lbd.get('tracker_id') in allowed_ids or lbd.get('tracker_id') is None]
    payload['lbds'] = visible_lbds
    payload['lbd_count'] = len(visible_lbds)

    summary = {'total': len(visible_lbds)}
    for col in AdminSettings.all_column_keys():
        summary[col] = sum(
            1 for lbd in visible_lbds
            if any(status.get('status_type') == col and status.get('is_completed') for status in lbd.get('statuses', []))
        )
    payload['lbd_summary'] = summary
    if not _can_view_ifc(user):
        payload['has_ifc'] = False
        payload['ifc_page_number'] = None
        payload['ifc_filename'] = None
        payload['ifc_url'] = None
    return payload


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


def _merge_claim_people(*name_lists):
    merged = []
    for name_list in name_lists:
        merged.extend(name_list or [])
    return _normalize_people(merged)


def _parse_claim_work_date(raw_value):
    if isinstance(raw_value, date):
        return raw_value

    raw = str(raw_value or '').strip()
    if not raw:
        return _cst_today()

    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError('Invalid work_date, use YYYY-MM-DD') from exc


def _resolve_claim_tracker_for_block(block, requested_tracker_id=None, user=None):
    user = user or current_session_user()
    if requested_tracker_id:
        tracker = resolve_accessible_tracker(requested_tracker_id, user=user)
        if not tracker:
            return None
        block_tracker_ids = {lbd.tracker_id for lbd in block.lbds if lbd.tracker_id}
        if not block_tracker_ids or tracker.id in block_tracker_ids or _is_admin_user(user):
            return tracker
        return None
    return _resolve_tracker()


def _block_accessible_lbd_ids(block, tracker=None, user=None):
    user = user or current_session_user()
    if tracker:
        return [lbd.id for lbd in block.lbds if lbd.tracker_id == tracker.id or lbd.tracker_id is None]
    if _is_admin_user(user):
        return [lbd.id for lbd in block.lbds]
    allowed_ids = _allowed_tracker_id_set()
    return [lbd.id for lbd in block.lbds if lbd.tracker_id in allowed_ids or lbd.tracker_id is None]


def _claim_payload(block):
    claimed_people = block.get_claimed_people()
    return {
        'claimed_by': block.claimed_by,
        'claimed_people': claimed_people,
        'claim_assignments': block.get_claim_assignments(),
        'claimed_label': ', '.join(claimed_people),
        'claimed_at': block.claimed_at.isoformat() if block.claimed_at else None,
    }


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


def _merge_claim_assignments(*assignment_maps):
    merged = {}
    for assignment_map in assignment_maps:
        if not isinstance(assignment_map, dict):
            continue
        for status_type, lbd_ids in assignment_map.items():
            key = str(status_type or '').strip()
            if not key:
                continue
            if not isinstance(lbd_ids, list):
                lbd_ids = [lbd_ids]
            seen_ids = set(merged.get(key, []))
            merged.setdefault(key, [])
            for lbd_id in lbd_ids:
                try:
                    normalized_id = int(lbd_id)
                except (TypeError, ValueError):
                    continue
                if normalized_id <= 0 or normalized_id in seen_ids:
                    continue
                seen_ids.add(normalized_id)
                merged[key].append(normalized_id)
    return merged


def _completed_claim_assignments(block, valid_lbd_ids=None):
    if not block:
        return {}

    valid_set = set(valid_lbd_ids or [])
    enforce_valid_ids = bool(valid_set)
    completed = {}
    for lbd in block.lbds or []:
        if enforce_valid_ids and lbd.id not in valid_set:
            continue
        for status in lbd.statuses or []:
            if not getattr(status, 'is_completed', False):
                continue
            completed.setdefault(status.status_type, []).append(lbd.id)

    return _normalize_claim_assignments(completed, valid_lbd_ids)


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


def _record_claim_work_entries(block, people, assignments, work_date, actor=None, tracker=None):
    normalized_people = _normalize_people(people)
    normalized_assignments = _normalize_claim_assignments(assignments)
    if not block or not normalized_people or not normalized_assignments:
        return {'created': 0, 'skipped': 0}

    _ensure_claim_workers(normalized_people)
    db.session.flush()

    workers_by_name = {
        worker.name.casefold(): worker
        for worker in Worker.query.filter(Worker.name.in_(normalized_people)).all()
    }

    tracker_id = tracker.id if tracker else None
    created = 0
    skipped = 0

    for status_type, lbd_ids in normalized_assignments.items():
        if not lbd_ids:
            continue
        for person in normalized_people:
            worker = workers_by_name.get(person.casefold())
            if not worker:
                continue
            exists = WorkEntry.query.filter_by(
                worker_id=worker.id,
                power_block_id=block.id,
                tracker_id=tracker_id,
                task_type=status_type,
                work_date=work_date,
            ).first()
            if exists:
                skipped += 1
                continue
            db.session.add(WorkEntry(
                worker_id=worker.id,
                power_block_id=block.id,
                tracker_id=tracker_id,
                task_type=status_type,
                work_date=work_date,
                logged_by=actor,
            ))
            created += 1

    return {'created': created, 'skipped': skipped}


def _record_claim_activity(block, people, assignments, work_date, actor=None, tracker=None, source='claim', claimed_at=None):
    normalized_people = _normalize_people(people)
    normalized_assignments = _normalize_claim_assignments(assignments)
    if not block or not normalized_people or not normalized_assignments or not work_date:
        return None

    activity = ClaimActivity(
        power_block_id=block.id,
        tracker_id=tracker.id if tracker else None,
        work_date=work_date,
        claimed_by=actor,
        source=str(source or 'claim').strip() or 'claim',
        claimed_at=claimed_at or datetime.utcnow(),
    )
    activity.set_people(normalized_people)
    activity.set_assignments(normalized_assignments)
    db.session.add(activity)
    return activity


def _apply_claim_assignments_to_statuses(block, assignments, actor=None):
    if not block or not isinstance(assignments, dict):
        return []

    lbd_by_id = {lbd.id: lbd for lbd in block.lbds}
    changed = []
    now = datetime.utcnow()
    completed_by = str(actor or '').strip() or None

    for status_type, lbd_ids in assignments.items():
        normalized_status_type = str(status_type or '').strip()
        if not normalized_status_type:
            continue

        for lbd_id in lbd_ids or []:
            lbd = lbd_by_id.get(lbd_id)
            if not lbd:
                continue

            status = next((item for item in lbd.statuses if item.status_type == normalized_status_type), None)
            if not status:
                status = LBDStatus(
                    lbd_id=lbd.id,
                    status_type=normalized_status_type,
                    is_completed=False,
                )
                db.session.add(status)
                lbd.statuses.append(status)

            if status.is_completed:
                if not status.completed_at:
                    status.completed_at = now
                if completed_by and not status.completed_by:
                    status.completed_by = completed_by
                continue

            status.is_completed = True
            status.completed_at = now
            if completed_by:
                status.completed_by = completed_by
            changed.append({
                'lbd_id': lbd.id,
                'status_type': normalized_status_type,
                'is_completed': True,
                'pb_id': block.id,
            })

    if actor and changed:
        block.last_updated_by = actor
        block.last_updated_at = now

    return changed


def _bulk_claim_status_types(data):
    raw_status_types = data.get('status_types') or []
    if not isinstance(raw_status_types, list):
        raw_status_types = [raw_status_types]

    normalized = []
    seen = set()
    for status_type in raw_status_types:
        key = str(status_type or '').strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def _resolve_bulk_claim_assignments(block, data):
    valid_lbd_ids = [lbd.id for lbd in block.lbds if _lbd_is_accessible(lbd)]
    assignments_by_block = data.get('assignments_by_block') or {}
    if isinstance(assignments_by_block, dict):
        block_assignments = assignments_by_block.get(str(block.id))
        if block_assignments is None:
            block_assignments = assignments_by_block.get(block.id)
        if block_assignments is not None:
            return _normalize_claim_assignments(block_assignments, valid_lbd_ids)

    status_types = _bulk_claim_status_types(data)
    return {
        status_type: list(valid_lbd_ids)
        for status_type in status_types
        if valid_lbd_ids
    }


def _apply_block_claim(block, action, actor, requested_people=None, assignments=None, tracker=None):
    requested_people = requested_people or []
    if not isinstance(requested_people, list):
        requested_people = [requested_people]

    if action == 'unclaim':
        block.claimed_by = None
        block.set_claim_state([], {})
        block.claimed_at = None
        return []

    people = _normalize_people(requested_people)
    if not people:
        raise ValueError('A crew member is required to claim a block')

    _validate_claim_people(people, extra_names=block.get_claimed_people())

    valid_lbd_ids = _block_accessible_lbd_ids(block, tracker=tracker)
    normalized_assignments = _normalize_claim_assignments(assignments or {}, valid_lbd_ids)
    completed_assignments = _completed_claim_assignments(block, valid_lbd_ids)
    merged_assignments = _merge_claim_assignments(block.get_claim_assignments(), completed_assignments, normalized_assignments)
    merged_people = _merge_claim_people(block.get_claimed_people(), people)
    block.claimed_by = actor or people[0]
    block.set_claim_state(merged_people, merged_assignments)
    block.claimed_at = datetime.utcnow()
    _ensure_claim_workers(people)
    return {
        'merged_people': merged_people,
        'normalized_assignments': normalized_assignments,
        'merged_assignments': merged_assignments,
        'status_updates': _apply_claim_assignments_to_statuses(block, normalized_assignments, actor),
    }


def _emit_claim_updates(block_payloads, status_updates):
    sio = _get_socketio()
    if not sio:
        return

    for block_id, payload in block_payloads:
        sio.emit('claim_update', {
            'pb_id': block_id,
            **payload,
        })
    for update in status_updates:
        sio.emit('status_update', update)


bp = Blueprint('tracker', __name__, url_prefix='/api/tracker')


@bp.route('/claim-people', methods=['GET'])
def get_claim_people():
    people = _available_claim_people()
    return jsonify({'success': True, 'data': people}), 200

@bp.route('/power-blocks', methods=['GET'])
def get_power_blocks():
    """Get all power blocks with LBD dot data (3 bulk queries, no lazy loading)."""
    try:
        user = current_session_user()
        is_admin = _is_admin_user(user)
        can_view_ifc = _can_view_ifc(user)
        tracker = _resolve_tracker()
        allowed_ids = _allowed_tracker_id_set()
        if not is_admin and not allowed_ids:
            return jsonify({'success': True, 'data': []}), 200
        tracker_id = tracker.id if tracker else None

        # Query 1: All power blocks
        blocks = PowerBlock.query.all()

        # Query 2: LBDs filtered by tracker
        lbd_q = db.session.query(
            LBD.id, LBD.power_block_id, LBD.name, LBD.identifier, LBD.inventory_number
        )
        if is_admin:
            pass
        elif tracker_id:
            lbd_q = lbd_q.filter(db.or_(LBD.tracker_id == tracker_id, LBD.tracker_id.is_(None)))
        else:
            lbd_q = lbd_q.filter(db.or_(LBD.tracker_id.in_(allowed_ids), LBD.tracker_id.is_(None)))
        lbd_rows = lbd_q.order_by(LBD.id).all()

        lbd_ids = [l.id for l in lbd_rows]

        # Query 3: Statuses for those LBDs
        status_rows = []
        if lbd_ids:
            status_rows = db.session.query(
                LBDStatus.lbd_id, LBDStatus.status_type, LBDStatus.is_completed
            ).filter(LBDStatus.lbd_id.in_(lbd_ids)).all()

        # Build lookup: lbd_id -> [{ status_type, is_completed }]
        status_by_lbd = {}
        for s in status_rows:
            status_by_lbd.setdefault(s.lbd_id, []).append({
                'status_type': s.status_type,
                'is_completed': bool(s.is_completed)
            })

        # Build lookup: pb_id -> [{ id, name, identifier, inventory_number, statuses }]
        lbds_by_pb = {}
        for l in lbd_rows:
            lbds_by_pb.setdefault(l.power_block_id, []).append({
                'id': l.id,
                'name': l.name,
                'identifier': l.identifier,
                'inventory_number': l.inventory_number,
                'statuses': status_by_lbd.get(l.id, [])
            })

        all_cols = tracker.all_column_keys() if tracker else AdminSettings.all_column_keys()

        # Query 4: Zone per power block from site_areas
        zone_rows = db.session.query(SiteArea.power_block_id, SiteArea.zone).filter(
            SiteArea.power_block_id.isnot(None),
            SiteArea.zone.isnot(None)
        ).all()
        zone_by_pb = {r.power_block_id: r.zone for r in zone_rows}

        result = []
        for b in blocks:
            pb_lbds = lbds_by_pb.get(b.id, [])
            if not is_admin and tracker_id and not pb_lbds:
                continue
            lbd_count = len(pb_lbds)
            # Build summary counts from pre-fetched data
            summary = {'total': lbd_count}
            for col in all_cols:
                summary[col] = sum(
                    1 for lbd in pb_lbds
                    if any(s['status_type'] == col and s['is_completed'] for s in lbd['statuses'])
                )
            result.append({
                'id': b.id,
                'name': b.name,
                'power_block_number': b.power_block_number,
                'description': b.description,
                'page_number': b.page_number,
                'image_path': b.image_path,
                'has_ifc': bool(b.ifc_pdf_data) if can_view_ifc else False,
                'ifc_page_number': b.ifc_page_number if can_view_ifc else None,
                'ifc_filename': b.ifc_pdf_filename if can_view_ifc else None,
                'ifc_url': f'/api/tracker/power-blocks/{b.id}/ifc' if can_view_ifc and b.ifc_pdf_data else None,
                'is_completed': b.is_completed,
                'claimed_by': b.claimed_by,
                'claimed_people': b.get_claimed_people(),
                'claim_assignments': b.get_claim_assignments(),
                'claimed_label': ', '.join(b.get_claimed_people()),
                'claimed_at': b.claimed_at.isoformat() if b.claimed_at else None,
                'last_updated_by': b.last_updated_by,
                'last_updated_at': b.last_updated_at.isoformat() if b.last_updated_at else None,
                'lbd_count': lbd_count,
                'lbd_summary': summary,
                'lbds': pb_lbds,
                'zone': zone_by_pb.get(b.id),
            })

        # Natural sort: INV-1, INV-2, ... INV-96
        result.sort(key=lambda b: _pb_sort_key(b['name']))

        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/power-blocks/<int:block_id>', methods=['GET'])
def get_power_block(block_id):
    """Get specific power block with all LBDs"""
    try:
        block = PowerBlock.query.options(
            subqueryload(PowerBlock.lbds).subqueryload(LBD.statuses)
        ).get_or_404(block_id)
        if not _block_is_accessible(block):
            return jsonify({'error': 'That power block is not accessible for your job site'}), 403
        return jsonify({
            'success': True,
            'data': _serialize_accessible_block(block)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/power-blocks/<int:block_id>/ifc', methods=['GET'])
def get_power_block_ifc(block_id):
    try:
        block = PowerBlock.query.options(subqueryload(PowerBlock.lbds)).get_or_404(block_id)
        if guest_session_active() and not current_session_user():
            return jsonify({'error': 'IFC drawings are only available to created users'}), 403
        if not _block_is_accessible(block):
            return jsonify({'error': 'That power block is not accessible for your job site'}), 403
        if not block.ifc_pdf_data:
            return jsonify({'error': 'No IFC drawing is assigned to this power block'}), 404

        return send_file(
            BytesIO(block.ifc_pdf_data),
            mimetype=block.ifc_pdf_mime or 'application/pdf',
            download_name=block.ifc_pdf_filename or f'{block.name}-IFC.pdf',
            max_age=0,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/power-blocks/<int:block_id>', methods=['PUT'])
def update_power_block(block_id):
    """Update power block"""
    try:
        block = PowerBlock.query.get_or_404(block_id)
        if not _block_is_accessible(block):
            return jsonify({'error': 'That power block is not accessible for your job site'}), 403
        data = request.get_json()
        
        if 'name' in data:
            block.name = data['name']
        if 'description' in data:
            block.description = data['description']
        if 'is_completed' in data:
            block.is_completed = data['is_completed']
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': _serialize_accessible_block(block)
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/lbds', methods=['POST'])
def create_lbd():
    """Create a new LBD in a power block (tracker-aware)"""
    try:
        data = request.get_json()
        tracker_id = data.get('tracker_id')
        tracker = resolve_accessible_tracker(tracker_id) if tracker_id else resolve_accessible_tracker()
        if not tracker:
            return jsonify({'error': 'No accessible tracker is available for this request'}), 403
        tracker_id = tracker.id

        lbd = LBD(
            power_block_id=data.get('power_block_id'),
            tracker_id=tracker_id,
            name=data.get('name'),
            identifier=data.get('identifier'),
            x_position=data.get('x_position'),
            y_position=data.get('y_position'),
            notes=data.get('notes', '')
        )
        
        db.session.add(lbd)
        db.session.flush()
        
        # Create status records from tracker's status types
        status_types = tracker.get_status_types()
        for status_type in status_types:
            status = LBDStatus(
                lbd_id=lbd.id,
                status_type=status_type,
                is_completed=False
            )
            db.session.add(status)
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': lbd.to_dict()
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/lbds/<int:lbd_id>/status/<status_type>', methods=['PUT'])
def update_lbd_status(lbd_id, status_type):
    """Update specific status of an LBD"""
    try:
        data = request.get_json()
        lbd = LBD.query.get_or_404(lbd_id)
        if not _lbd_is_accessible(lbd):
            return jsonify({'error': 'That LBD is not accessible for your job site'}), 403
        
        # Create status record if it doesn't exist yet (LBDs from scan have no statuses)
        status = LBDStatus.query.filter_by(
            lbd_id=lbd_id,
            status_type=status_type
        ).first()
        if not status:
            status = LBDStatus(lbd_id=lbd_id, status_type=status_type, is_completed=False)
            db.session.add(status)
            db.session.flush()

        status.is_completed = data.get('is_completed', status.is_completed)
        actor = _current_user_name()
        if status.is_completed:
            status.completed_at = datetime.utcnow()
            if actor:
                status.completed_by = actor
        else:
            status.completed_at = None
            status.completed_by = None
        status.notes = data.get('notes', status.notes)

        # Update power-block audit trail
        pb = lbd.power_block
        if pb and actor:
            pb.last_updated_by = actor
            pb.last_updated_at = datetime.utcnow()

        db.session.commit()

        # Emit real-time update so all connected clients refresh
        sio = _get_socketio()
        if sio:
            sio.emit('status_update', {
                'lbd_id':       lbd_id,
                'status_type':  status_type,
                'is_completed': bool(status.is_completed),
                'pb_id':        lbd.power_block_id
            })

        return jsonify({
            'success': True,
            'data': status.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/lbds/<int:lbd_id>', methods=['GET'])
def get_lbd(lbd_id):
    """Get LBD with all status info. Auto-initializes status rows if missing."""
    try:
        lbd = LBD.query.get_or_404(lbd_id)
        if not _lbd_is_accessible(lbd):
            return jsonify({'error': 'That LBD is not accessible for your job site'}), 403
        if not lbd.statuses:
            for st in LBDStatus.STATUS_TYPES:
                db.session.add(LBDStatus(lbd_id=lbd.id, status_type=st, is_completed=False))
            db.session.commit()
            db.session.refresh(lbd)
        return jsonify({
            'success': True,
            'data': lbd.to_dict()
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/lbds/<int:lbd_id>', methods=['PUT'])
def update_lbd(lbd_id):
    """Update LBD information"""
    try:
        lbd = LBD.query.get_or_404(lbd_id)
        if not _lbd_is_accessible(lbd):
            return jsonify({'error': 'That LBD is not accessible for your job site'}), 403
        data = request.get_json()
        
        if 'name' in data:
            lbd.name = data['name']
        if 'identifier' in data:
            lbd.identifier = data['identifier']
        if 'x_position' in data:
            lbd.x_position = data['x_position']
        if 'y_position' in data:
            lbd.y_position = data['y_position']
        if 'notes' in data:
            lbd.notes = data['notes']
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': lbd.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/power-blocks/<int:block_id>/claim', methods=['POST'])
def claim_power_block(block_id):
    """Claim or unclaim a power block for one or more people."""
    try:
        block = PowerBlock.query.get_or_404(block_id)
        if not _block_is_accessible(block):
            return jsonify({'error': 'That power block is not accessible for your job site'}), 403
        data  = request.get_json() or {}
        action = data.get('action', 'claim')   # 'claim' or 'unclaim'
        if not _can_manage_claim(action, block):
            return jsonify({'error': 'Permission denied'}), 403
        actor  = _current_user_name() or str(data.get('actor_name') or '').strip() or None
        tracker = _resolve_claim_tracker_for_block(block, data.get('tracker_id'))
        if data.get('tracker_id') and not tracker and not _is_admin_user():
            return jsonify({'error': 'That tracker is not accessible for this power block'}), 403
        work_date = _parse_claim_work_date(data.get('work_date'))
        claim_result = _apply_block_claim(
            block,
            action,
            actor,
            requested_people=data.get('people') or [],
            assignments=data.get('assignments') or {},
            tracker=tracker,
        )

        work_entries = {'created': 0, 'skipped': 0}
        if action != 'unclaim':
            work_entries = _record_claim_work_entries(
                block,
                data.get('people') or [],
                claim_result['normalized_assignments'],
                work_date,
                actor=actor,
                tracker=tracker,
            )
            _record_claim_activity(
                block,
                data.get('people') or [],
                claim_result['normalized_assignments'],
                work_date,
                actor=actor,
                tracker=tracker,
                source='claim',
            )

        db.session.commit()
        payload = _claim_payload(block)
        _emit_claim_updates([(block_id, payload)], claim_result['status_updates'])

        if action != 'unclaim' and claim_result['normalized_assignments']:
            try:
                from app.routes.report_routes import _get_or_generate_report
                _get_or_generate_report(work_date, tracker.id if tracker else None)
            except Exception:
                pass

        return jsonify({
            'success': True,
            'data': {
                **payload,
                'work_date': work_date.isoformat(),
                'work_entries': work_entries,
            }
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@bp.route('/power-blocks/bulk-claim', methods=['POST'])
def bulk_claim_power_blocks():
    """Claim or unclaim multiple power blocks with one request."""
    try:
        data = request.get_json() or {}
        action = str(data.get('action') or 'claim').strip() or 'claim'
        actor = _current_user_name() or str(data.get('actor_name') or '').strip() or None

        raw_block_ids = data.get('block_ids') or []
        if not isinstance(raw_block_ids, list):
            raw_block_ids = [raw_block_ids]
        block_ids = []
        seen_ids = set()
        for value in raw_block_ids:
            try:
                block_id = int(value)
            except (TypeError, ValueError):
                continue
            if block_id <= 0 or block_id in seen_ids:
                continue
            seen_ids.add(block_id)
            block_ids.append(block_id)

        if not block_ids:
            return jsonify({'error': 'At least one power block is required'}), 400

        blocks = PowerBlock.query.options(
            subqueryload(PowerBlock.lbds).subqueryload(LBD.statuses)
        ).filter(PowerBlock.id.in_(block_ids)).all()
        blocks_by_id = {block.id: block for block in blocks}

        missing_ids = [block_id for block_id in block_ids if block_id not in blocks_by_id]
        inaccessible_ids = [
            block_id for block_id in block_ids
            if block_id in blocks_by_id and not _block_is_accessible(blocks_by_id[block_id])
        ]
        if missing_ids:
            return jsonify({'error': f'Power block not found: {missing_ids[0]}'}), 404
        if inaccessible_ids:
            return jsonify({'error': 'One or more selected power blocks are not accessible for your job site'}), 403
        required_permission = 'claim_delete' if action == 'unclaim' else 'claim_create'
        user = current_session_user()
        if not (user and (_is_admin_user(user) or user.has_permission(required_permission))):
            return jsonify({'error': 'Permission denied'}), 403

        requested_people = data.get('people') or []
        tracker = resolve_accessible_tracker(data.get('tracker_id'), user=user) if data.get('tracker_id') else _resolve_tracker()
        if data.get('tracker_id') and not tracker and not _is_admin_user(user):
            return jsonify({'error': 'That tracker is not accessible for this request'}), 403
        work_date = _parse_claim_work_date(data.get('work_date'))
        claimed_blocks = []
        claim_payloads = []
        all_status_updates = []
        total_created = 0
        total_skipped = 0

        for block_id in block_ids:
            block = blocks_by_id[block_id]
            assignments = _resolve_bulk_claim_assignments(block, data)
            claim_result = _apply_block_claim(
                block,
                action,
                actor,
                requested_people=requested_people,
                assignments=assignments,
                tracker=tracker,
            )
            work_entries = {'created': 0, 'skipped': 0}
            if action != 'unclaim':
                work_entries = _record_claim_work_entries(
                    block,
                    requested_people,
                    claim_result['normalized_assignments'],
                    work_date,
                    actor=actor,
                    tracker=tracker,
                )
                _record_claim_activity(
                    block,
                    requested_people,
                    claim_result['normalized_assignments'],
                    work_date,
                    actor=actor,
                    tracker=tracker,
                    source='bulk_claim',
                )
            payload = _claim_payload(block)
            claim_payloads.append((block.id, payload))
            claimed_blocks.append({
                'id': block.id,
                'name': block.name,
                'work_entries': work_entries,
                **payload,
            })
            all_status_updates.extend(claim_result['status_updates'])
            total_created += work_entries['created']
            total_skipped += work_entries['skipped']

        db.session.commit()
        _emit_claim_updates(claim_payloads, all_status_updates)

        if action != 'unclaim' and any(block['work_entries']['created'] or block['work_entries']['skipped'] for block in claimed_blocks):
            try:
                from app.routes.report_routes import _get_or_generate_report
                _get_or_generate_report(work_date, tracker.id if tracker else None)
            except Exception:
                pass

        return jsonify({
            'success': True,
            'data': {
                'count': len(claimed_blocks),
                'work_date': work_date.isoformat(),
                'work_entries': {'created': total_created, 'skipped': total_skipped},
                'blocks': claimed_blocks,
            }
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({'error': str(exc)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
