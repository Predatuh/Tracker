import os
import re
from flask import Blueprint, request, jsonify, session
from app import db
from app.models.user import User

bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _make_username(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '_', name.strip().lower()).strip('_') or 'user'


# ── GET /api/auth/me ──────────────────────────────────────────
@bp.route('/me', methods=['GET'])
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'user': None}), 200
    user = User.query.get(user_id)
    if not user:
        session.clear()
        return jsonify({'user': None}), 200
    return jsonify({'user': user.to_dict()}), 200


# ── POST /api/auth/login ──────────────────────────────────────
@bp.route('/login', methods=['POST'])
def login():
    data     = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    pin      = str(data.get('pin') or '').strip()
    username = _make_username(name)

    if not name or not pin:
        return jsonify({'error': 'Name and PIN are required'}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_pin(pin):
        return jsonify({'error': 'Incorrect name or PIN'}), 401

    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'user': user.to_dict()}), 200


# ── POST /api/auth/register ───────────────────────────────────
@bp.route('/register', methods=['POST'])
def register():
    data     = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    pin      = str(data.get('pin') or '').strip()
    username = _make_username(name)

    if not name:
        return jsonify({'error': 'Name is required'}), 400
    if len(pin) != 4 or not pin.isdigit():
        return jsonify({'error': 'PIN must be exactly 4 digits (0-9)'}), 400
    if username == 'admin':
        return jsonify({'error': 'That name is reserved — please choose another'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'An account with that name already exists. Try signing in.'}), 409

    user = User(name=name, username=username, is_admin=False)
    user.set_pin(pin)
    db.session.add(user)
    db.session.commit()

    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'user': user.to_dict()}), 201


# ── POST /api/auth/logout ─────────────────────────────────────
@bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True}), 200


# ── Helper: require admin ──────────────────────────────────────
def _require_admin():
    uid = session.get('user_id')
    if not uid:
        return None, jsonify({'error': 'Not authenticated'}), 401
    user = User.query.get(uid)
    if not user or not user.is_admin:
        return None, jsonify({'error': 'Admin access required'}), 403
    return user, None, None


# ── GET /api/auth/users ── list all users (admin only) ─────────
@bp.route('/users', methods=['GET'])
def list_users():
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]
    from app.models.user import ALL_PRIVILEGES
    users = User.query.order_by(User.name).all()
    return jsonify({
        'users': [u.to_dict() for u in users],
        'all_privileges': ALL_PRIVILEGES,
    }), 200


# ── PUT /api/auth/users/<id>/role ── set role + permissions ────
@bp.route('/users/<int:user_id>/role', methods=['PUT'])
def update_user_role(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    # Cannot demote the main admin account
    if target.username == 'admin':
        return jsonify({'error': 'Cannot change the main admin account'}), 400

    data = request.get_json() or {}
    new_role = data.get('role', 'user')
    perms = data.get('permissions', [])

    if new_role not in ('user', 'assistant_admin'):
        return jsonify({'error': 'Invalid role'}), 400

    from app.models.user import ALL_PRIVILEGES
    # Filter to valid privileges only
    valid_perms = [p for p in perms if p in ALL_PRIVILEGES]

    target.role = new_role
    target.is_admin = False  # only the main Admin is is_admin=True
    if new_role == 'assistant_admin':
        target.set_permissions(valid_perms)
    else:
        target.set_permissions([])

    db.session.commit()
    return jsonify({'user': target.to_dict()}), 200
