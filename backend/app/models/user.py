from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import json
import secrets


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
    email      = db.Column(db.String(255), nullable=True)
    pin_hash   = db.Column(db.String(255), nullable=False)
    is_admin   = db.Column(db.Boolean, default=False)
    role       = db.Column(db.String(20), default='user')        # 'admin', 'assistant_admin', 'user'
    permissions = db.Column(db.Text, default='[]')                # JSON list of privilege keys
    job_site_name = db.Column(db.String(120), nullable=True)
    job_site_slug = db.Column(db.String(120), nullable=True)
    email_verified = db.Column(db.Boolean, default=False)
    verification_code_hash = db.Column(db.String(255), nullable=True)
    verification_sent_at = db.Column(db.DateTime, nullable=True)
    verification_expires_at = db.Column(db.DateTime, nullable=True)
    verified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_pin(self, pin: str):
        self.pin_hash = generate_password_hash(str(pin))

    def check_pin(self, pin: str) -> bool:
        return check_password_hash(self.pin_hash, str(pin))

    def set_email_verification_code(self, code: str, lifetime_minutes: int = 15):
        self.email_verified = False
        self.verification_code_hash = generate_password_hash(str(code))
        self.verification_sent_at = datetime.utcnow()
        self.verification_expires_at = self.verification_sent_at + timedelta(minutes=lifetime_minutes)
        self.verified_at = None

    def verify_email_code(self, code: str) -> bool:
        if not self.verification_code_hash or not self.verification_expires_at:
            return False
        if self.verification_expires_at < datetime.utcnow():
            return False
        return check_password_hash(self.verification_code_hash, str(code or '').strip())

    def mark_email_verified(self):
        self.email_verified = True
        self.verification_code_hash = None
        self.verification_sent_at = None
        self.verification_expires_at = None
        self.verified_at = datetime.utcnow()

    @staticmethod
    def generate_verification_code() -> str:
        return ''.join(secrets.choice('0123456789') for _ in range(6))

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
            'email':       self.email,
            'recovery_email': self.email,
            'is_admin':    self.is_admin,
            'role':        self.role or ('admin' if self.is_admin else 'user'),
            'permissions': self.get_permissions(),
            'job_site_name': self.job_site_name,
            'job_site_slug': self.job_site_slug,
            'email_verified': bool(self.email_verified),
        }
