from flask import Blueprint, request, jsonify
from app import db
from app.models import LBDStatus, AuditLog
from app.models.admin_settings import AdminSettings
from app.models.tracker import Tracker
from app.utils.audit import require_any_permission, require_permission, log_action
from app.utils.job_sites import default_job_site
from app.utils.tracker_access import allowed_tracker_query, resolve_accessible_tracker

bp = Blueprint('admin', __name__, url_prefix='/api/admin')

ADMIN_PAGE_PERMISSIONS = [
    'manage_trackers',
    'manage_tracker_names',
    'manage_columns',
    'manage_tasks',
    'manage_workers',
    'manage_ui',
    'edit_map',
]


# ------------------------------------------------------------------ #
# Tracker CRUD
# ------------------------------------------------------------------ #
@bp.route('/trackers', methods=['GET'])
def list_trackers():
    trackers = allowed_tracker_query().all()
    return jsonify({'success': True, 'data': [t.to_dict() for t in trackers]}), 200


@bp.route('/trackers', methods=['POST'])
def create_tracker():
    actor, err, status = require_any_permission(['manage_trackers'])
    if not actor:
        return err, status
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    slug = (data.get('slug') or '').strip().lower().replace(' ', '-')
    if not name or not slug:
        return jsonify({'error': 'name and slug are required'}), 400
    if Tracker.query.filter_by(slug=slug).first():
        return jsonify({'error': f'Tracker with slug "{slug}" already exists'}), 409

    t = Tracker(
        name=name, slug=slug,
        item_name_singular=data.get('item_name_singular', 'Item'),
        item_name_plural=data.get('item_name_plural', 'Items'),
        stat_label=data.get('stat_label', f'Total {data.get("item_name_plural", "Items")}'),
        dashboard_progress_label=data.get('dashboard_progress_label', 'Complete'),
        dashboard_blocks_label=data.get('dashboard_blocks_label', 'Power Blocks'),
        dashboard_open_label=data.get('dashboard_open_label', 'Open Tracker'),
        job_site_name=data.get('job_site_name') or default_job_site()['name'],
        icon=data.get('icon', '📋'),
        sort_order=data.get('sort_order', 99),
    )
    types = data.get('status_types', [])
    t.set_status_types(types)
    t.set_status_colors(data.get('status_colors', {}))
    t.set_status_names(data.get('status_names', {}))
    db.session.add(t)
    db.session.commit()
    log_action('tracker.create', 'tracker', t.id, {'name': t.name, 'slug': t.slug}, actor=actor)
    return jsonify({'success': True, 'data': t.to_dict()}), 201


@bp.route('/trackers/<int:tracker_id>', methods=['PUT'])
def update_tracker(tracker_id):
    actor, err, status = require_any_permission(['manage_trackers'])
    if not actor:
        return err, status
    t = Tracker.query.get_or_404(tracker_id)
    data = request.get_json() or {}
    for field in ('name', 'slug', 'item_name_singular', 'item_name_plural', 'stat_label', 'dashboard_progress_label', 'dashboard_blocks_label', 'dashboard_open_label', 'job_site_name', 'icon', 'sort_order', 'progress_unit'):
        if field in data:
            setattr(t, field, data[field])
    if 'completion_status_type' in data:
        t.completion_status_type = data['completion_status_type'] or None
    if 'show_per_lbd_ui' in data:
        t.show_per_lbd_ui = bool(data['show_per_lbd_ui'])
    if 'status_types' in data:
        t.set_status_types(data['status_types'])
    if 'status_colors' in data:
        t.set_status_colors(data['status_colors'])
    if 'status_names' in data:
        t.set_status_names(data['status_names'])
    if 'column_order' in data:
        t.set_column_order(data['column_order'])
    db.session.commit()
    log_action('tracker.update', 'tracker', t.id, {'fields': sorted(list(data.keys()))}, actor=actor)
    return jsonify({'success': True, 'data': t.to_dict()}), 200


@bp.route('/trackers/<int:tracker_id>', methods=['DELETE'])
def delete_tracker(tracker_id):
    actor, err, status = require_any_permission(['manage_trackers'])
    if not actor:
        return err, status
    t = Tracker.query.get_or_404(tracker_id)
    t.is_active = False
    db.session.commit()
    log_action('tracker.delete', 'tracker', t.id, {'name': t.name}, actor=actor)
    return jsonify({'success': True}), 200


@bp.route('/audit-logs', methods=['GET'])
def list_audit_logs():
    actor, err, status = require_permission(admin_only=True)
    if not actor:
        return err, status
    limit = min(int(request.args.get('limit', 100)), 250)
    items = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return jsonify({'success': True, 'data': [item.to_dict() for item in items]}), 200


# ------------------------------------------------------------------ #
# Helper: resolve tracker from request
# ------------------------------------------------------------------ #
def _get_tracker():
    """Return the Tracker for the current request (from tracker_id param)."""
    return resolve_accessible_tracker()


# ------------------------------------------------------------------ #
# GET all settings (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings', methods=['GET'])
def get_settings():
    try:
        tracker = _get_tracker()
        if tracker:
            colors = tracker.get_status_colors()
            names = tracker.get_status_names()
            all_columns = tracker.all_column_keys() or AdminSettings.all_column_keys()
            zone_names = AdminSettings.get(f'zone_names_{tracker.id}', [])
        else:
            colors = AdminSettings.get_colors()
            names = AdminSettings.get_names()
            all_columns = AdminSettings.all_column_keys()
            zone_names = AdminSettings.get('zone_names', [])

        return jsonify({
            'success': True,
            'data': {
                'colors': colors,
                'names': names,
                'custom_columns': [],
                'all_columns': all_columns,
                'pb_label_font_size': AdminSettings.get('pb_label_font_size', 14),
                'tracker_id': tracker.id if tracker else None,
                'zone_names': zone_names if isinstance(zone_names, list) else [],
                'claim_people': AdminSettings.get_claim_people(),
                'appearance': AdminSettings.get('appearance') or {},
                'ui_text': AdminSettings.get('ui_text') or {},
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/settings/claim-people', methods=['PUT'])
def update_claim_people():
    try:
        actor, err, status = require_any_permission(['manage_workers'])
        if not actor:
            return err, status
        data = request.get_json() or {}
        people = data.get('people', [])
        if not isinstance(people, list):
            return jsonify({'error': 'people must be a list'}), 400
        normalized = []
        seen = set()
        for value in people:
            name = str(value or '').strip()
            if not name:
                continue
            folded = name.casefold()
            if folded in seen:
                continue
            seen.add(folded)
            normalized.append(name)
        AdminSettings.set('claim_people', normalized)
        log_action('settings.claim_people', 'global', 'claim_people', {'count': len(normalized)}, actor=actor)
        return jsonify({'success': True, 'data': normalized}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update zone names (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/zone-names', methods=['PUT'])
def update_zone_names():
    try:
        actor, err, status = require_any_permission(['edit_map'])
        if not actor:
            return err, status
        data = request.get_json() or {}
        names = data.get('names', [])
        if not isinstance(names, list):
            return jsonify({'error': 'names must be a list'}), 400
        tracker = _get_tracker()
        key = f'zone_names_{tracker.id}' if tracker else 'zone_names'
        AdminSettings.set(key, names)
        log_action('settings.zone_names', 'tracker' if tracker else 'global', tracker.id if tracker else key, {'count': len(names)}, actor=actor)
        return jsonify({'success': True, 'data': names}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update status colors (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/colors', methods=['PUT'])
def update_colors():
    try:
        actor, err, status = require_any_permission(['manage_ui'], admin_only=True)
        if not actor:
            return err, status
        data = request.get_json()
        colors = data.get('colors', {})
        tracker = _get_tracker()
        if tracker:
            tracker.set_status_colors(colors)
            db.session.commit()
            log_action('settings.colors', 'tracker', tracker.id, {'keys': sorted(list(colors.keys()))}, actor=actor)
            return jsonify({'success': True, 'data': tracker.get_status_colors()}), 200
        AdminSettings.set('status_colors', colors)
        log_action('settings.colors', 'global', 'status_colors', {'keys': sorted(list(colors.keys()))}, actor=actor)
        return jsonify({'success': True, 'data': AdminSettings.get_colors()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update status display names (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/names', methods=['PUT'])
def update_names():
    try:
        actor, err, status = require_any_permission(['manage_tracker_names'])
        if not actor:
            return err, status
        data = request.get_json()
        names = data.get('names', {})
        tracker = _get_tracker()
        if tracker:
            tracker.set_status_names(names)
            db.session.commit()
            log_action('settings.names', 'tracker', tracker.id, {'keys': sorted(list(names.keys()))}, actor=actor)
            return jsonify({'success': True, 'data': tracker.get_status_names()}), 200
        AdminSettings.set('status_names', names)
        log_action('settings.names', 'global', 'status_names', {'keys': sorted(list(names.keys()))}, actor=actor)
        return jsonify({'success': True, 'data': AdminSettings.get_names()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Add custom column (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/columns', methods=['POST'])
def add_column():
    try:
        actor, err, status = require_any_permission(['manage_columns', 'manage_tasks'])
        if not actor:
            return err, status
        data = request.get_json()
        key = data.get('key', '').strip().lower().replace(' ', '_')
        label = data.get('label', '').strip()
        color = data.get('color', '#CCCCCC')

        if not key or not label:
            return jsonify({'error': 'key and label are required'}), 400

        tracker = _get_tracker()
        if tracker:
            types = tracker.get_status_types()
            if key in types:
                return jsonify({'error': f'Column "{key}" already exists'}), 400
            types.append(key)
            tracker.set_status_types(types)
            colors = tracker.get_status_colors()
            colors[key] = color
            tracker.set_status_colors(colors)
            names = tracker.get_status_names()
            names[key] = label
            tracker.set_status_names(names)
            db.session.commit()
            log_action('column.add', 'tracker', tracker.id, {'key': key, 'label': label}, actor=actor)
            return jsonify({
                'success': True,
                'data': {'key': key, 'label': label, 'color': color, 'all_columns': tracker.all_column_keys()}
            }), 201

        # Fallback to legacy AdminSettings
        existing_keys = AdminSettings.all_column_keys()
        if key in existing_keys:
            return jsonify({'error': f'Column "{key}" already exists'}), 400

        from app.models.status import LBDStatus
        builtin_keys = LBDStatus.STATUS_TYPES
        if key in builtin_keys:
            disabled = AdminSettings.get('disabled_builtins') or []
            if key in disabled:
                disabled.remove(key)
            AdminSettings.set('disabled_builtins', disabled)
        else:
            custom = AdminSettings.get_custom_columns()
            custom.append(key)
            AdminSettings.set('custom_columns', custom)

        names_store = AdminSettings.get_names()
        names_store[key] = label
        AdminSettings.set('status_names', names_store)
        colors_store = AdminSettings.get_colors()
        colors_store[key] = color
        AdminSettings.set('status_colors', colors_store)

        log_action('column.add', 'global', key, {'label': label}, actor=actor)

        return jsonify({
            'success': True,
            'data': {'key': key, 'label': label, 'color': color, 'all_columns': AdminSettings.all_column_keys()}
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Delete custom column (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/columns/<column_key>', methods=['DELETE'])
def delete_column(column_key):
    try:
        actor, err, status = require_any_permission(['manage_columns', 'manage_tasks'])
        if not actor:
            return err, status
        tracker = _get_tracker()
        if tracker:
            types = tracker.get_status_types()
            types = [t for t in types if t != column_key]
            tracker.set_status_types(types)
            colors = tracker.get_status_colors()
            colors.pop(column_key, None)
            tracker.set_status_colors(colors)
            names = tracker.get_status_names()
            names.pop(column_key, None)
            tracker.set_status_names(names)
            db.session.commit()
            log_action('column.delete', 'tracker', tracker.id, {'key': column_key}, actor=actor)
            return jsonify({'success': True, 'all_columns': tracker.all_column_keys()}), 200

        from app.models.status import LBDStatus
        builtin_keys = LBDStatus.STATUS_TYPES
        if column_key in builtin_keys:
            disabled = AdminSettings.get('disabled_builtins') or []
            if column_key not in disabled:
                disabled.append(column_key)
            AdminSettings.set('disabled_builtins', disabled)
        else:
            custom = AdminSettings.get_custom_columns()
            if column_key in custom:
                custom.remove(column_key)
            AdminSettings.set('custom_columns', custom)

        names = AdminSettings.get('status_names') or {}
        names.pop(column_key, None)
        AdminSettings.set('status_names', names)
        colors = AdminSettings.get('status_colors') or {}
        colors.pop(column_key, None)
        AdminSettings.set('status_colors', colors)

        log_action('column.delete', 'global', column_key, {'key': column_key}, actor=actor)

        return jsonify({'success': True, 'all_columns': AdminSettings.all_column_keys()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update PB label font size (for map view)
# ------------------------------------------------------------------ #
@bp.route('/settings/font-size', methods=['PUT'])
def update_font_size():
    try:
        actor, err, status = require_any_permission(['manage_ui'], admin_only=True)
        if not actor:
            return err, status
        data = request.get_json()
        size = data.get('size', 14)
        AdminSettings.set('pb_label_font_size', int(size))
        log_action('settings.font_size', 'global', 'pb_label_font_size', {'size': int(size)}, actor=actor)
        return jsonify({'success': True, 'data': int(size)}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update column order (tracker-aware)
# ------------------------------------------------------------------ #
@bp.route('/settings/column-order', methods=['PUT'])
def update_column_order():
    try:
        actor, err, status = require_any_permission(['manage_columns', 'manage_tasks'])
        if not actor:
            return err, status
        data = request.get_json()
        order = data.get('order', [])
        if not isinstance(order, list):
            return jsonify({'error': 'order must be a list'}), 400

        tracker = _get_tracker()
        if tracker:
            active = set(tracker.all_column_keys())
            order = [k for k in order if k in active]
            tracker.set_column_order(order)
            db.session.commit()
            log_action('column.reorder', 'tracker', tracker.id, {'order': order}, actor=actor)
            return jsonify({'success': True, 'all_columns': tracker.all_column_keys()}), 200

        active = set(AdminSettings.all_column_keys())
        order = [k for k in order if k in active]
        AdminSettings.set('column_order', order)
        log_action('column.reorder', 'global', 'column_order', {'order': order}, actor=actor)
        return jsonify({
            'success': True,
            'all_columns': AdminSettings.all_column_keys()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update visual appearance (brand, colors, login text)
# ------------------------------------------------------------------ #
@bp.route('/settings/appearance', methods=['PUT'])
def update_appearance():
    try:
        actor, err, status = require_any_permission(['manage_ui'], admin_only=True)
        if not actor:
            return err, status
        data = request.get_json() or {}
        appearance = data.get('appearance', {})
        allowed_keys = {
            'brand_word1', 'brand_sep', 'brand_word2',
            'login_title', 'login_subtitle', 'login_btn',
            'color_cyan', 'color_purple', 'color_green', 'color_red', 'color_bg'
        }
        appearance = {k: v for k, v in appearance.items() if k in allowed_keys and isinstance(v, str)}
        AdminSettings.set('appearance', appearance)
        log_action('settings.appearance', 'global', 'appearance', {'keys': sorted(list(appearance.keys()))}, actor=actor)
        return jsonify({'success': True, 'data': appearance}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update UI text / labels (nav items, page titles)
# ------------------------------------------------------------------ #
@bp.route('/settings/ui-text', methods=['PUT'])
def update_ui_text():
    try:
        actor, err, status = require_any_permission(['manage_ui'], admin_only=True)
        if not actor:
            return err, status
        data = request.get_json() or {}
        ui_text = data.get('ui_text', {})
        allowed_keys = {
            'nav_dashboard', 'nav_upload', 'nav_blocks', 'nav_sitemap',
            'nav_worklog', 'nav_reports', 'nav_admin',
            'title_dashboard', 'sub_dashboard', 'title_blocks', 'title_upload',
            'title_worklog', 'title_reports', 'title_admin',
            'dashboard_loading', 'dashboard_empty', 'dashboard_complete',
            'dashboard_power_blocks', 'dashboard_open_tracker'
        }
        ui_text = {k: v for k, v in ui_text.items() if k in allowed_keys and isinstance(v, str)}
        AdminSettings.set('ui_text', ui_text)
        log_action('settings.ui_text', 'global', 'ui_text', {'keys': sorted(list(ui_text.keys()))}, actor=actor)
        return jsonify({'success': True, 'data': ui_text}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Bulk-complete statuses for a power block
# ------------------------------------------------------------------ #
@bp.route('/bulk-complete', methods=['POST'])
def bulk_complete():
    """
    Mark all LBDs in a power block as completed (or uncompleted) for the
    given status types.

    Body: { power_block_id, status_types: [...], is_completed: bool }
    """
    try:
        actor, err, status = require_permission('manage_blocks')
        if not actor:
            return err, status
        from app.models import PowerBlock, LBDStatus
        from datetime import datetime

        data = request.get_json()
        block_id = data.get('power_block_id')
        status_types = data.get('status_types', AdminSettings.all_column_keys())
        is_completed = bool(data.get('is_completed', True))

        block = PowerBlock.query.get_or_404(block_id)

        for lbd in block.lbds:
            for st in status_types:
                status = LBDStatus.query.filter_by(lbd_id=lbd.id, status_type=st).first()
                if status is None:
                    status = LBDStatus(lbd_id=lbd.id, status_type=st, is_completed=False)
                    db.session.add(status)
                status.is_completed = is_completed
                status.completed_at = datetime.utcnow() if is_completed else None

        db.session.commit()

        # Notify all connected clients
        try:
            from app import socketio
            socketio.emit('bulk_update', {'pb_id': block_id})
        except Exception:
            pass

        log_action('bulk.complete', 'power_block', block_id, {'status_types': status_types, 'is_completed': is_completed, 'updated': len(block.lbds)}, actor=actor)

        return jsonify({'success': True, 'updated': len(block.lbds)}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# One-time dedup: remove duplicate LBDs (TEMP - remove after use)
# ------------------------------------------------------------------ #
@bp.route('/dedup-lbds', methods=['POST'])
def dedup_lbds():
    """Delete duplicate LBDs keeping the one with the lowest id."""
    try:
        actor, err, status = require_permission(admin_only=True)
        if not actor:
            return err, status
        from app.models import LBD, PowerBlock

        blocks = PowerBlock.query.all()
        total_deleted = 0

        for block in blocks:
            lbds = LBD.query.filter_by(power_block_id=block.id).order_by(LBD.id).all()
            seen = {}
            for lbd in lbds:
                key = (block.id, lbd.name)
                if key in seen:
                    # This is a duplicate – delete it (and its statuses via cascade)
                    db.session.delete(lbd)
                    total_deleted += 1
                else:
                    seen[key] = lbd.id

        db.session.commit()
        remaining = LBD.query.count()
        log_action('lbd.dedup', 'global', 'lbds', {'deleted': total_deleted, 'remaining': remaining}, actor=actor)
        return jsonify({
            'success': True,
            'deleted': total_deleted,
            'remaining': remaining
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
