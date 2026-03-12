from flask import Blueprint, request, jsonify, session
from sqlalchemy.orm import subqueryload
from sqlalchemy import func
from app import db
from app.models import PowerBlock, LBD, LBDStatus
from datetime import datetime
import re


def _get_socketio():
    try:
        from app import socketio
        return socketio
    except Exception:
        return None


def _current_user_name():
    """Return display name of the logged-in user, or None for guests."""
    uid = session.get('user_id')
    if not uid:
        return None
    try:
        from app.models.user import User
        u = User.query.get(uid)
        return u.name if u else None
    except Exception:
        return None


def _pb_sort_key(name):
    """Extract numeric part from PB name for natural sorting (INV-1, INV-2, ..., INV-96)."""
    m = re.search(r'(\d+)', name or '')
    return int(m.group(1)) if m else 0


bp = Blueprint('tracker', __name__, url_prefix='/api/tracker')

@bp.route('/power-blocks', methods=['GET'])
def get_power_blocks():
    """Get all power blocks with LBD dot data (3 bulk queries, no lazy loading)."""
    try:
        from app.models.admin_settings import AdminSettings

        # Query 1: All power blocks
        blocks = PowerBlock.query.all()

        # Query 2: All LBDs (minimal columns)
        lbd_rows = db.session.query(
            LBD.id, LBD.power_block_id, LBD.name, LBD.identifier, LBD.inventory_number
        ).order_by(LBD.id).all()

        # Query 3: All statuses (minimal columns)
        status_rows = db.session.query(
            LBDStatus.lbd_id, LBDStatus.status_type, LBDStatus.is_completed
        ).all()

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

        all_cols = AdminSettings.all_column_keys()

        result = []
        for b in blocks:
            pb_lbds = lbds_by_pb.get(b.id, [])
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
                'is_completed': b.is_completed,
                'claimed_by': b.claimed_by,
                'claimed_at': b.claimed_at.isoformat() if b.claimed_at else None,
                'last_updated_by': b.last_updated_by,
                'last_updated_at': b.last_updated_at.isoformat() if b.last_updated_at else None,
                'lbd_count': lbd_count,
                'lbd_summary': summary,
                'lbds': pb_lbds,
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
        return jsonify({
            'success': True,
            'data': block.to_dict()
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/power-blocks/<int:block_id>', methods=['PUT'])
def update_power_block(block_id):
    """Update power block"""
    try:
        block = PowerBlock.query.get_or_404(block_id)
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
            'data': block.to_dict()
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@bp.route('/lbds', methods=['POST'])
def create_lbd():
    """Create a new LBD in a power block"""
    try:
        data = request.get_json()
        
        lbd = LBD(
            power_block_id=data.get('power_block_id'),
            name=data.get('name'),
            identifier=data.get('identifier'),
            x_position=data.get('x_position'),
            y_position=data.get('y_position'),
            notes=data.get('notes', '')
        )
        
        db.session.add(lbd)
        db.session.flush()
        
        # Create status records for each status type
        for status_type in LBDStatus.STATUS_TYPES:
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
        
        # Create status record if it doesn't exist yet (LBDs from scan have no statuses)
        status = LBDStatus.query.filter_by(
            lbd_id=lbd_id,
            status_type=status_type
        ).first()
        if not status:
            if status_type not in LBDStatus.STATUS_TYPES:
                return jsonify({'error': f'Unknown status type: {status_type}'}), 400
            status = LBDStatus(lbd_id=lbd_id, status_type=status_type, is_completed=False)
            db.session.add(status)

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
        pb = status.lbd.power_block
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
                'pb_id':        status.lbd.power_block_id
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
    """Claim or unclaim a power block for the current user."""
    try:
        block = PowerBlock.query.get_or_404(block_id)
        data  = request.get_json() or {}
        action = data.get('action', 'claim')   # 'claim' or 'unclaim'
        actor  = _current_user_name()

        if action == 'unclaim':
            block.claimed_by = None
            block.claimed_at = None
        else:
            if not actor:
                return jsonify({'error': 'You must be logged in to claim a block'}), 401
            block.claimed_by = actor
            block.claimed_at = datetime.utcnow()

        db.session.commit()

        sio = _get_socketio()
        if sio:
            sio.emit('claim_update', {
                'pb_id':      block_id,
                'claimed_by': block.claimed_by,
                'claimed_at': block.claimed_at.isoformat() if block.claimed_at else None,
            })

        return jsonify({
            'success': True,
            'data': {
                'claimed_by': block.claimed_by,
                'claimed_at': block.claimed_at.isoformat() if block.claimed_at else None,
            }
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
