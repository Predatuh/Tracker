from flask import request, session

from app.models.tracker import Tracker
from app.models.user import User


def current_session_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return User.query.get(user_id)


def allowed_tracker_query(user=None, include_inactive=False):
    user = user or current_session_user()
    query = Tracker.query
    if not include_inactive:
        query = query.filter_by(is_active=True)
    if not user:
        return query.filter(False).order_by(Tracker.sort_order, Tracker.id)
    if user.is_admin or user.role == 'admin':
        return query.order_by(Tracker.sort_order, Tracker.id)
    if user.job_site_name:
        query = query.filter(Tracker.job_site_name == user.job_site_name)
    else:
        query = query.filter(False)
    return query.order_by(Tracker.sort_order, Tracker.id)


def resolve_accessible_tracker(tracker_id=None, user=None):
    query = allowed_tracker_query(user=user)
    if tracker_id:
        try:
            tracker_id = int(tracker_id)
        except (TypeError, ValueError):
            return None
        return query.filter(Tracker.id == tracker_id).first()

    request_tracker_id = request.args.get('tracker_id')
    if request_tracker_id:
        return resolve_accessible_tracker(request_tracker_id, user=user)

    data = request.get_json(silent=True) or {}
    if data.get('tracker_id'):
        return resolve_accessible_tracker(data.get('tracker_id'), user=user)

    return query.first()


def tracker_is_accessible(tracker_id, user=None):
    return resolve_accessible_tracker(tracker_id, user=user) is not None