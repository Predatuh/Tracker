from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import json


# Assignable privileges for assistant admins
ALL_PRIVILEGES = [
    'upload_pdf',
    'edit_map',
    'manage_blocks',
    'manage_workers',
    'view_reports',
    'admin_settings',
]


class User(db.Model):
    __tablename__ = 'users'

    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), nullable=False)
    username   = db.Column(db.String(100), nullable=False, unique=True)
    pin_hash   = db.Column(db.String(255), nullable=False)
    is_admin   = db.Column(db.Boolean, default=False)
    role       = db.Column(db.String(20), default='user')        # 'admin', 'assistant_admin', 'user'
    permissions = db.Column(db.Text, default='[]')                # JSON list of privilege keys
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_pin(self, pin: str):
        self.pin_hash = generate_password_hash(str(pin))

    def check_pin(self, pin: str) -> bool:
        return check_password_hash(self.pin_hash, str(pin))

    def get_permissions(self):
        """Return the list of assigned privilege keys."""
        if self.is_admin or self.role == 'admin':
            return list(ALL_PRIVILEGES)
        try:
            return json.loads(self.permissions or '[]')
        except (json.JSONDecodeError, TypeError):
            return []

    def set_permissions(self, perms):
        self.permissions = json.dumps(perms or [])

    def has_permission(self, perm):
        if self.is_admin or self.role == 'admin':
            return True
        return perm in self.get_permissions()

    def to_dict(self):
        return {
            'id':          self.id,
            'name':        self.name,
            'username':    self.username,
            'is_admin':    self.is_admin,
            'role':        self.role or ('admin' if self.is_admin else 'user'),
            'permissions': self.get_permissions(),
        }
