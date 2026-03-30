import re

from flask import Blueprint, jsonify, request, session

from app import db
from app.models.user import User, ALL_PRIVILEGES, ROLE_DEFINITIONS, default_permissions_for_role, normalize_role_key
from app.utils.audit import log_action
from app.utils.job_sites import list_job_sites, resolve_job_site
from app.utils.tracker_access import current_guest_job_site

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

EMAIL_RE = re.compile(r'^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$', re.IGNORECASE)


def _make_username(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '_', name.strip().lower()).strip('_') or 'user'


def _normalized_email(value: str) -> str:
    return str(value or '').strip().lower()


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
    if not job_site:
        return None, jsonify({'error': 'That job token is not valid'}), 400
    if username == 'admin':
        return None, jsonify({'error': 'That name is reserved — please choose another'}), 400
    if User.query.filter_by(username=username).first():
        return None, jsonify({'error': 'An account with that name already exists. Try signing in.'}), 409
    if email and not EMAIL_RE.match(email):
        return None, jsonify({'error': 'If provided, recovery email must be valid'}), 400
    if email and User.query.filter_by(email=email).first():
        return None, jsonify({'error': 'That email is already attached to an account'}), 409

    return {
        'name': name,
        'pin': pin,
        'email': email,
        'username': username,
        'job_site_name': job_site['name'],
        'job_site_slug': job_site['slug'],
    }, None, None


def _create_user(payload, self_registered=False):
    default_role = normalize_role_key(payload.get('role') or 'worker')
    user = User(
        name=payload['name'],
        username=payload['username'],
        email=payload['email'] or None,
        is_admin=False,
        role=default_role,
        job_site_name=payload['job_site_name'],
        job_site_slug=payload['job_site_slug'],
        email_verified=True,
        needs_review=self_registered,
    )
    user.set_pin(payload['pin'])
    user.set_permissions(default_permissions_for_role(default_role))
    user.verification_code_hash = None
    user.verification_sent_at = None
    user.verification_expires_at = None
    user.verified_at = None
    db.session.add(user)
    db.session.commit()
    return user


@bp.route('/me', methods=['GET'])
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'user': None, 'guest': current_guest_job_site()}), 200
    user = User.query.get(user_id)
    if not user:
        session.clear()
        return jsonify({'user': None, 'guest': None}), 200
    return jsonify({'user': user.to_dict(), 'guest': None}), 200


@bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    pin = str(data.get('pin') or '').strip()
    username = _make_username(name)

    if not name or not pin:
        return jsonify({'error': 'Name and PIN are required'}), 400

    user = User.query.filter_by(username=username).first()

    # If user exists and their PIN was cleared for reset, signal the client
    if user and user.pin_needs_reset and not user.pin_hash:
        return jsonify({'needs_pin_reset': True, 'user_id': user.id}), 200

    if not user or not user.check_pin(pin):
        return jsonify({'error': 'Incorrect name or PIN'}), 401

    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    return jsonify({'user': user.to_dict()}), 200


@bp.route('/guest', methods=['POST'])
def guest_login():
    data = request.get_json() or {}
    job_token = str(data.get('job_token') or '').strip()
    job_site = resolve_job_site(job_token)
    if not job_site:
        return jsonify({'error': 'That site token is not valid'}), 400

    session.clear()
    session['guest_job_site_name'] = job_site['name']
    session['guest_job_site_slug'] = job_site['slug']
    session.permanent = True
    return jsonify({'guest': {'job_site_name': job_site['name'], 'job_site_slug': job_site['slug']}}), 200


@bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    payload, err, status = _validate_registration_payload(data)
    if err:
        return err, status

    user = _create_user(payload, self_registered=True)
    session.clear()
    session['user_id'] = user.id
    session.permanent = True
    log_action('user.register', 'user', user.id, {'job_site_name': user.job_site_name, 'email': user.email})
    return jsonify({
        'user': user.to_dict(),
        'message': 'Account created. An admin will assign your role shortly.',
    }), 201


@bp.route('/verify-email', methods=['POST'])
def verify_email():
    return jsonify({'error': 'Email verification is currently disabled. Contact Princess for PIN resets.'}), 410


@bp.route('/resend-verification', methods=['POST'])
def resend_verification():
    return jsonify({'error': 'Email verification is currently disabled. Contact Princess for PIN resets.'}), 410


@bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True}), 200


def _require_admin():
    uid = session.get('user_id')
    if not uid:
        return None, jsonify({'error': 'Not authenticated'}), 401
    user = User.query.get(uid)
    if not user or not (user.is_admin or user.normalized_role() == 'admin'):
        return None, jsonify({'error': 'Admin access required'}), 403
    return user, None, None


@bp.route('/users', methods=['GET'])
def list_users():
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]
    users = User.query.order_by(User.name).all()
    return jsonify({
        'users': [u.to_dict() for u in users],
        'all_privileges': ALL_PRIVILEGES,
        'roles': [
            {
                'key': key,
                'label': details.get('label', key.title()),
                'default_permissions': details.get('default_permissions', []),
                'claim_eligible': bool(details.get('claim_eligible')),
            }
            for key, details in ROLE_DEFINITIONS.items()
            if key != 'admin'
        ],
        'job_sites': list_job_sites(),
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

    user = _create_user(payload, self_registered=False)
    log_action('user.create', 'user', user.id, {'job_site_name': user.job_site_name, 'email': user.email}, actor=caller)
    return jsonify({
        'created_user': user.to_dict(),
        'message': 'User created. Contact Princess if the PIN ever needs to be reset.',
    }), 201


@bp.route('/users/<int:user_id>/name', methods=['PUT'])
def rename_user(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target.username == 'admin':
        return jsonify({'error': 'Cannot rename the main admin account'}), 400

    data = request.get_json() or {}
    new_name = (data.get('name') or '').strip()
    if not new_name:
        return jsonify({'error': 'Name is required'}), 400

    new_username = _make_username(new_name)
    if new_username == 'admin':
        return jsonify({'error': 'That name is reserved'}), 400
    existing = User.query.filter_by(username=new_username).first()
    if existing and existing.id != target.id:
        return jsonify({'error': 'An account with that name already exists'}), 409

    old_name = target.name
    target.name = new_name
    target.username = new_username
    db.session.commit()
    log_action('user.rename', 'user', target.id, {'old_name': old_name, 'new_name': new_name}, actor=caller)
    return jsonify({'user': target.to_dict()}), 200


@bp.route('/forgot-pin', methods=['POST'])
def forgot_pin():
    """User-initiated PIN reset request. Always returns success to prevent name enumeration."""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if name:
        username = _make_username(name)
        user = User.query.filter_by(username=username).first()
        if user and not user.is_admin:
            user.pin_reset_requested = True
            db.session.commit()
    return jsonify({'ok': True, 'message': 'If that name exists, a reset request has been sent to the admin.'}), 200


@bp.route('/users/<int:user_id>/approve-pin-reset', methods=['POST'])
def approve_pin_reset(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if target.username == 'admin':
        return jsonify({'error': 'Cannot reset admin PIN this way'}), 400

    target.pin_hash = None
    target.pin_needs_reset = True
    target.pin_reset_requested = False
    db.session.commit()
    log_action('user.pin.approve_reset', 'user', target.id, {'approved_by': caller.name}, actor=caller)
    return jsonify({'user': target.to_dict(), 'message': f'PIN reset approved for {target.name}. They can now set a new PIN on next sign-in.'}), 200


@bp.route('/users/<int:user_id>/dismiss-review', methods=['POST'])
def dismiss_user_review(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    target.needs_review = False
    db.session.commit()
    log_action('user.review.dismiss', 'user', target.id, {'dismissed_by': caller.name}, actor=caller)
    return jsonify({'user': target.to_dict()}), 200


@bp.route('/set-pin', methods=['POST'])
def set_pin():
    """Public endpoint — lets a user set their new PIN after admin approves a reset."""
    data = request.get_json() or {}
    user_id = data.get('user_id')
    new_pin = str(data.get('new_pin') or '').strip()

    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400
    if len(new_pin) != 4 or not new_pin.isdigit():
        return jsonify({'error': 'PIN must be exactly 4 digits'}), 400

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404
    if not target.pin_needs_reset:
        return jsonify({'error': 'No PIN reset is pending for this account'}), 400

    target.set_pin(new_pin)
    target.pin_needs_reset = False
    db.session.commit()
    log_action('user.pin.set', 'user', target.id, {})

    session.clear()
    session['user_id'] = target.id
    session.permanent = True
    return jsonify({'user': target.to_dict()}), 200


@bp.route('/pending-count', methods=['GET'])
def pending_count():
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    needs_review = User.query.filter_by(needs_review=True).count()
    pin_reset_requested = User.query.filter_by(pin_reset_requested=True).count()
    return jsonify({
        'needs_review': needs_review,
        'pin_reset_requested': pin_reset_requested,
        'total': needs_review + pin_reset_requested,
    }), 200


@bp.route('/users/<int:user_id>/pin', methods=['PUT'])
def reset_user_pin(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json() or {}
    new_pin = str(data.get('pin') or '').strip()
    if len(new_pin) != 4 or not new_pin.isdigit():
        return jsonify({'error': 'PIN must be exactly 4 digits (0-9)'}), 400

    target.set_pin(new_pin)
    db.session.commit()
    log_action('user.pin.reset', 'user', target.id, {'reset_by': caller.name}, actor=caller)
    return jsonify({'user': target.to_dict(), 'message': f'PIN updated for {target.name}'}), 200


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
    new_role = normalize_role_key(data.get('role', 'worker'))
    perms = data.get('permissions', [])

    if new_role not in ROLE_DEFINITIONS or new_role == 'admin':
        return jsonify({'error': 'Invalid role'}), 400

    if not isinstance(perms, list):
        perms = []
    valid_perms = [p for p in perms if p in ALL_PRIVILEGES]
    if not valid_perms:
        valid_perms = default_permissions_for_role(new_role)

    target.role = new_role
    target.is_admin = False
    target.set_permissions(valid_perms)

    db.session.commit()
    log_action('user.role.update', 'user', target.id, {'role': new_role, 'permissions': valid_perms}, actor=caller)
    return jsonify({'user': target.to_dict()}), 200


@bp.route('/users/<int:user_id>/job-site', methods=['PUT'])
def update_user_job_site(user_id):
    caller, *err = _require_admin()
    if not caller:
        return err[0], err[1]

    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    if target.username == 'admin':
        return jsonify({'error': 'Cannot change access for the main admin account'}), 400

    data = request.get_json() or {}
    raw_token = str(data.get('job_token') or '').strip()

    if not raw_token:
        target.job_site_name = None
        target.job_site_slug = None
        db.session.commit()
        log_action('user.job_site.clear', 'user', target.id, {'cleared_by': caller.name}, actor=caller)
        return jsonify({'user': target.to_dict(), 'message': f'Access removed for {target.name}'}), 200

    job_site = resolve_job_site(raw_token)
    if not job_site:
        return jsonify({'error': 'That job token is not valid'}), 400

    target.job_site_name = job_site['name']
    target.job_site_slug = job_site['slug']
    db.session.commit()
    log_action(
        'user.job_site.update',
        'user',
        target.id,
        {'job_site_name': target.job_site_name, 'job_site_slug': target.job_site_slug, 'updated_by': caller.name},
        actor=caller,
    )
    return jsonify({'user': target.to_dict(), 'message': f'Access updated for {target.name}'}), 200
