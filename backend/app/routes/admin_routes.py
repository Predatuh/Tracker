from flask import Blueprint, request, jsonify
from app import db
from app.models import LBDStatus
from app.models.admin_settings import AdminSettings

bp = Blueprint('admin', __name__, url_prefix='/api/admin')


# ------------------------------------------------------------------ #
# GET all settings
# ------------------------------------------------------------------ #
@bp.route('/settings', methods=['GET'])
def get_settings():
    try:
        return jsonify({
            'success': True,
            'data': {
                'colors': AdminSettings.get_colors(),
                'names': AdminSettings.get_names(),
                'custom_columns': AdminSettings.get_custom_columns(),
                'all_columns': AdminSettings.all_column_keys(),
                'pb_label_font_size': AdminSettings.get('pb_label_font_size', 14),
            }
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update status colors
# ------------------------------------------------------------------ #
@bp.route('/settings/colors', methods=['PUT'])
def update_colors():
    try:
        data = request.get_json()
        colors = data.get('colors', {})
        AdminSettings.set('status_colors', colors)
        return jsonify({'success': True, 'data': AdminSettings.get_colors()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Update status display names
# ------------------------------------------------------------------ #
@bp.route('/settings/names', methods=['PUT'])
def update_names():
    try:
        data = request.get_json()
        names = data.get('names', {})
        AdminSettings.set('status_names', names)
        return jsonify({'success': True, 'data': AdminSettings.get_names()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Add custom column
# ------------------------------------------------------------------ #
@bp.route('/settings/columns', methods=['POST'])
def add_column():
    try:
        data = request.get_json()
        key = data.get('key', '').strip().lower().replace(' ', '_')
        label = data.get('label', '').strip()
        color = data.get('color', '#CCCCCC')

        if not key or not label:
            return jsonify({'error': 'key and label are required'}), 400

        existing_keys = AdminSettings.all_column_keys()
        if key in existing_keys:
            return jsonify({'error': f'Column "{key}" already exists'}), 400

        from app.models.status import LBDStatus
        builtin_keys = LBDStatus.STATUS_TYPES

        if key in builtin_keys:
            # Re-enable a previously disabled built-in
            disabled = AdminSettings.get('disabled_builtins') or []
            if key in disabled:
                disabled.remove(key)
            AdminSettings.set('disabled_builtins', disabled)
        else:
            # Add to custom list
            custom = AdminSettings.get_custom_columns()
            custom.append(key)
            AdminSettings.set('custom_columns', custom)

        # Add to names/colors
        names = AdminSettings.get_names()
        names[key] = label
        AdminSettings.set('status_names', names)

        colors = AdminSettings.get_colors()
        colors[key] = color
        AdminSettings.set('status_colors', colors)

        return jsonify({
            'success': True,
            'data': {
                'key': key,
                'label': label,
                'color': color,
                'all_columns': AdminSettings.all_column_keys(),
            }
        }), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ------------------------------------------------------------------ #
# Delete custom column
# ------------------------------------------------------------------ #
@bp.route('/settings/columns/<column_key>', methods=['DELETE'])
def delete_column(column_key):
    try:
        from app.models.status import LBDStatus
        builtin_keys = LBDStatus.STATUS_TYPES

        if column_key in builtin_keys:
            # Mark built-in as disabled
            disabled = AdminSettings.get('disabled_builtins') or []
            if column_key not in disabled:
                disabled.append(column_key)
            AdminSettings.set('disabled_builtins', disabled)
        else:
            # Remove from custom list
            custom = AdminSettings.get_custom_columns()
            if column_key in custom:
                custom.remove(column_key)
            AdminSettings.set('custom_columns', custom)

        # Clean up names/colors
        names = AdminSettings.get('status_names') or {}
        names.pop(column_key, None)
        AdminSettings.set('status_names', names)

        colors = AdminSettings.get('status_colors') or {}
        colors.pop(column_key, None)
        AdminSettings.set('status_colors', colors)

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
        data = request.get_json()
        size = data.get('size', 14)
        AdminSettings.set('pb_label_font_size', int(size))
        return jsonify({'success': True, 'data': int(size)}), 200
    except Exception as e:
        db.session.rollback()
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

        return jsonify({'success': True, 'updated': len(block.lbds)}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
