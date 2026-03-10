from flask import Blueprint, jsonify
from app.models import LBD, PowerBlock, LBDStatus

bp = Blueprint('lbd', __name__, url_prefix='/api/lbd')

@bp.route('/power-block/<int:block_id>/lbds', methods=['GET'])
def get_power_block_lbds(block_id):
    """Get all LBDs for a power block with their status"""
    try:
        block = PowerBlock.query.get_or_404(block_id)
        lbds = LBD.query.filter_by(power_block_id=block_id).all()
        
        return jsonify({
            'success': True,
            'power_block': block.to_dict(),
            'lbds': [lbd.to_dict() for lbd in lbds]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@bp.route('/status-colors', methods=['GET'])
def get_status_colors():
    """Get color mapping for all status types"""
    return jsonify({
        'success': True,
        'colors': LBDStatus.STATUS_COLORS,
        'status_types': LBDStatus.STATUS_TYPES
    }), 200
