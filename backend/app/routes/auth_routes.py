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
