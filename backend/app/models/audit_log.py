import json
from datetime import datetime

from app import db


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    actor_user_id = db.Column(db.Integer, nullable=True)
    actor_name = db.Column(db.String(100), nullable=False)
    action = db.Column(db.String(100), nullable=False)
    target_type = db.Column(db.String(50), nullable=True)
    target_id = db.Column(db.String(100), nullable=True)
    details = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def set_details(self, value):
        self.details = json.dumps(value or {})

    def get_details(self):
        try:
            return json.loads(self.details) if self.details else {}
        except Exception:
            return {'raw': self.details}

    def to_dict(self):
        return {
            'id': self.id,
            'actor_user_id': self.actor_user_id,
            'actor_name': self.actor_name,
            'action': self.action,
            'target_type': self.target_type,
            'target_id': self.target_id,
            'details': self.get_details(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }