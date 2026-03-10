"""
OTA update routes
  GET  /api/version          – returns current server version + download URL
  POST /api/update/upload    – admin uploads a new LBDTracker.exe (replaces the served binary)
  GET  /download/LBDTracker.exe  – serves the latest EXE binary
"""
import os
from flask import Blueprint, jsonify, request, send_file, current_app

bp = Blueprint('update', __name__)

# ── helpers ──────────────────────────────────────────────────────────────────

def _version_path():
    """Path to version.txt bundled with the server."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
    root = os.path.dirname(base)                                          # project root
    for candidate in [
        os.path.join(root, 'version.txt'),
        os.path.join(base, 'version.txt'),
    ]:
        if os.path.exists(candidate):
            return candidate
    return None


def _exe_path():
    """Where the hosted EXE lives (next to version.txt or in uploads)."""
    vp = _version_path()
    if vp:
        candidate = os.path.join(os.path.dirname(vp), 'LBDTracker.exe')
        if os.path.exists(candidate):
            return candidate
    # Fall back to uploads folder
    upload_dir = current_app.config.get('UPLOAD_FOLDER', '/tmp/lbd_uploads')
    return os.path.join(upload_dir, 'LBDTracker.exe')


def _read_version():
    p = _version_path()
    if p and os.path.exists(p):
        return open(p).read().strip()
    return '0.0.0'


# ── GET /api/version ─────────────────────────────────────────────────────────

@bp.route('/api/version', methods=['GET'])
def get_version():
    version = _read_version()
    # Build the download URL from the request's own host
    host = request.host_url.rstrip('/')
    download_url = f'{host}/download/LBDTracker.exe'
    exe_exists = os.path.exists(_exe_path())
    return jsonify({
        'version':      version,
        'download_url': download_url if exe_exists else None,
    }), 200


# ── GET /download/LBDTracker.exe ─────────────────────────────────────────────

@bp.route('/download/LBDTracker.exe', methods=['GET'])
def download_exe():
    path = _exe_path()
    if not os.path.exists(path):
        return jsonify({'error': 'No EXE available on server yet'}), 404
    return send_file(
        path,
        as_attachment=True,
        download_name='LBDTracker.exe',
        mimetype='application/octet-stream'
    )


# ── POST /api/update/upload ───────────────────────────────────────────────────

@bp.route('/api/update/upload', methods=['POST'])
def upload_exe():
    """Admin-only: upload a new LBDTracker.exe + version number."""
    # Simple admin check via session
    from flask import session
    from app.models.user import User
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Not authenticated'}), 401
    user = User.query.get(user_id)
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin only'}), 403

    new_version = (request.form.get('version') or '').strip()
    if not new_version:
        return jsonify({'error': 'version field required'}), 400

    f = request.files.get('exe')
    if not f:
        return jsonify({'error': 'exe file required'}), 400

    # Save EXE
    exe_dest = _exe_path()
    os.makedirs(os.path.dirname(exe_dest), exist_ok=True)
    f.save(exe_dest)

    # Update version.txt
    vp = _version_path()
    if vp:
        with open(vp, 'w') as fh:
            fh.write(new_version + '\n')

    return jsonify({'ok': True, 'version': new_version}), 200
