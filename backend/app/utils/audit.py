from flask import jsonify, session

from app import db
from app.models.audit_log import AuditLog
from app.models.user import User


def current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return User.query.get(user_id)


def require_permission(permission=None, admin_only=False):
    user = current_user()
    if not user:
        return None, jsonify({'error': 'Not authenticated'}), 401
    if user.is_admin or user.role == 'admin':
        return user, None, None
    if admin_only:
        return None, jsonify({'error': 'Admin access required'}), 403
    if permission and user.has_permission(permission):
        return user, None, None
    return None, jsonify({'error': 'Permission denied'}), 403


def log_action(action, target_type=None, target_id=None, details=None, actor=None):
    actor = actor or current_user()
    actor_name = actor.name if actor else 'System'
    actor_id = actor.id if actor else None
    entry = AuditLog(
        actor_user_id=actor_id,
        actor_name=actor_name,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
    )
    entry.set_details(details or {})
    db.session.add(entry)
    db.session.commit()
    return entry