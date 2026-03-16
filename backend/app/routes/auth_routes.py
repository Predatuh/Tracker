import re

from flask import Blueprint, current_app, jsonify, request, session

from app import db
from app.models.user import User
from app.utils.audit import log_action
from app.utils.job_sites import resolve_job_site
from app.utils.mailers import can_send_email, send_verification_email

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

EMAIL_RE = re.compile(r'^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$', re.IGNORECASE)


def _make_username(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '_', name.strip().lower()).strip('_') or 'user'


def _normalized_email(value: str) -> str:
    return str(value or '').strip().lower()


def _serialize_verification_response(user, *, status_code=202, preview_code=None, message=None):
    payload = {
        'ok': True,
        'verification_required': True,
        'email': user.email,
        'job_site_name': user.job_site_name,
        'message': message or 'Enter the verification code sent to your email to finish setting up your account.',
    }
    if preview_code:
        payload['preview_code'] = preview_code
        payload['message'] = 'Email delivery is not configured locally, so a preview code is included for testing.'
    return jsonify(payload), status_code


def _validate_registration_payload(data):
    name = (data.get('name') or '').strip()
    pin = str(data.get('pin') or '').strip()
    email = _normalized_email(data.get('email'))
    job_token = str(data.get('job_token') or '').strip()
    username = _make_username(name)
    job_site = resolve_job_site(job_token)

    if not name:
        return None, jsonify({'error': 'Name is required'}), 400
    if len(pin) != 4 or not pin.isdigit():
        return None, jsonify({'error': 'PIN must be exactly 4 digits (0-9)'}), 400
    if not email or not EMAIL_RE.match(email):
        return None, jsonify({'error': 'A valid recovery email is required'}), 400
    if not job_site:
        return None, jsonify({'error': 'That job token is not valid'}), 400
    if username == 'admin':
        return None, jsonify({'error': 'That name is reserved — please choose another'}), 400
    if User.query.filter_by(username=username).first():
        return None, jsonify({'error': 'An account with that name already exists. Try signing in.'}), 409
    if User.query.filter_by(email=email).first():
        return None, jsonify({'error': 'That email is already attached to an account'}), 409

    return {
        'name': name,
        'pin': pin,
        'email': email,
        'username': username,
        'job_site_name': job_site['name'],
        'job_site_slug': job_site['slug'],
    }, None, None


def _can_deliver_verification():
    if can_send_email():
        return True, None
    if current_app.config.get('IS_CLOUD_MODE'):
        return False, (jsonify({'error': 'Email verification is not configured on the server yet'}), 503)
    return True, None


def _queue_verification(user):
    code = User.generate_verification_code()
    user.set_email_verification_code(code)
    preview_code = None
    if can_send_email():
        send_verification_email(user, code)
    else:
        current_app.logger.warning('SMTP not configured. Verification preview code for %s: %s', user.email, code)
        preview_code = code
    return preview_code


def _create_pending_user(payload):
    user = User(
        name=payload['name'],
        username=payload['username'],
        email=payload['email'],
        is_admin=False,
        role='user',
        job_site_name=payload['job_site_name'],
        job_site_slug=payload['job_site_slug'],
        email_verified=False,
    )
    user.set_pin(payload['pin'])
    preview_code = _queue_verification(user)
    db.session.add(user)
    db.session.commit()
    return user, preview_code


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


@bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    pin = str(data.get('pin') or '').strip()
    username = _make_username(name)

    if not name or not pin:
        return jsonify({'error': 'Name and PIN are required'}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_pin(pin):
        return jsonify({'error': 'Incorrect name or PIN'}), 401
    if not user.email_verified and not user.is_admin:
        return jsonify({
            'error': 'Verify your email before signing in',
            'verification_required': True,
            'email': user.email,
            'job_site_name': user.job_site_name,
        }), 403

    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'user': user.to_dict()}), 200


@bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    payload, err, status = _validate_registration_payload(data)
    if err:
        return err, status

    can_deliver, failure = _can_deliver_verification()
    if not can_deliver:
        return failure

    user, preview_code = _create_pending_user(payload)
    log_action('user.register', 'user', user.id, {'job_site_name': user.job_site_name, 'email': user.email})
    return _serialize_verification_response(user, status_code=201, preview_code=preview_code)


@bp.route('/verify-email', methods=['POST'])
def verify_email():
    data = request.get_json() or {}
    email = _normalized_email(data.get('email'))
    code = str(data.get('code') or '').strip()

    if not email or not code:
        return jsonify({'error': 'Email and verification code are required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Account not found for that email'}), 404
    if user.email_verified:
        session.clear()
        session['user_id'] = user.id
        session.permanent = True
        return jsonify({'user': user.to_dict(), 'message': 'Email already verified'}), 200
    if not user.verify_email_code(code):
        return jsonify({'error': 'That verification code is invalid or expired'}), 400

    user.mark_email_verified()
    db.session.commit()

    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    log_action('user.verify_email', 'user', user.id, {'email': user.email})
    return jsonify({'user': user.to_dict(), 'message': 'Email verified'}), 200


@bp.route('/resend-verification', methods=['POST'])
def resend_verification():
    data = request.get_json() or {}
    email = _normalized_email(data.get('email'))
    if not email:
        return jsonify({'error': 'Email is required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'Account not found for that email'}), 404
    if user.email_verified:
        return jsonify({'error': 'That account is already verified'}), 400

    can_deliver, failure = _can_deliver_verification()
    if not can_deliver:
        return failure

    preview_code = _queue_verification(user)
    db.session.commit()
    return _serialize_verification_response(user, preview_code=preview_code, message='A new verification code has been sent.')


@bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True}), 200


def _require_admin():
    uid = session.get('user_id')
    if not uid:
        return None, jsonify({'error': 'Not authenticated'}), 401
    user = User.query.get(uid)
    if not user or not user.is_admin:
        return None, jsonify({'error': 'Admin access required'}), 403
    return user, None, None


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


@bp.route('/users', methods=['POST'])
def admin_create_user():
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    data = request.get_json() or {}
    payload, failure, status = _validate_registration_payload(data)
    if failure:
        return failure, status

    can_deliver, delivery_failure = _can_deliver_verification()
    if not can_deliver:
        return delivery_failure

    user, preview_code = _create_pending_user(payload)
    log_action('user.create', 'user', user.id, {'job_site_name': user.job_site_name, 'email': user.email}, actor=caller)
    return _serialize_verification_response(
        user,
        status_code=201,
        preview_code=preview_code,
        message='User created. They must verify their email before they can sign in.',
    )


@bp.route('/users/<int:user_id>/role', methods=['PUT'])
def update_user_role(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    if target.username == 'admin':
        return jsonify({'error': 'Cannot change the main admin account'}), 400

    data = request.get_json() or {}
    new_role = data.get('role', 'user')
    perms = data.get('permissions', [])

    if new_role not in ('user', 'assistant_admin'):
        return jsonify({'error': 'Invalid role'}), 400

    from app.models.user import ALL_PRIVILEGES
    valid_perms = [p for p in perms if p in ALL_PRIVILEGES]

    target.role = new_role
    target.is_admin = False
    if new_role == 'assistant_admin':
        target.set_permissions(valid_perms)
    else:
        target.set_permissions([])

    db.session.commit()
    log_action('user.role.update', 'user', target.id, {'role': new_role, 'permissions': valid_perms}, actor=caller)
    return jsonify({'user': target.to_dict()}), 200
