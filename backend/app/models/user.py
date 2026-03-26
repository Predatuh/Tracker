from app import db
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import json
import secrets


# Assignable privileges for configurable roles
ALL_PRIVILEGES = [
    'claim_create',
    'claim_edit',
    'claim_delete',
    'upload_pdf',
    'edit_map',
    'manage_trackers',
    'manage_tracker_names',
    'manage_columns',
    'manage_tasks',
    'manage_blocks',
    'manage_workers',
    'view_reports',
    'manage_ui',
    'admin_settings',
]

ROLE_DEFINITIONS = {
    'admin': {
        'label': 'Admin',
        'default_permissions': list(ALL_PRIVILEGES),
        'claim_eligible': False,
    },
    'foreman': {
        'label': 'Foreman',
        'default_permissions': [
            'claim_create',
            'claim_edit',
            'claim_delete',
            'manage_trackers',
            'manage_tracker_names',
            'manage_columns',
            'manage_tasks',
            'manage_blocks',
            'view_reports',
        ],
        'claim_eligible': True,
    },
    'fe': {
        'label': 'FE',
        'default_permissions': [
            'manage_trackers',
            'manage_tracker_names',
            'manage_columns',
            'manage_tasks',
            'manage_blocks',
            'view_reports',
        ],
        'claim_eligible': False,
    },
    'worker': {
        'label': 'Worker',
        'default_permissions': [
            'claim_create',
            'claim_edit',
            'view_reports',
        ],
        'claim_eligible': True,
    },
    'lead': {
        'label': 'Lead',
        'default_permissions': [
            'claim_create',
            'claim_edit',
            'view_reports',
        ],
        'claim_eligible': True,
    },
    'supt': {
        'label': 'Supt',
        'default_permissions': [
            'view_reports',
            'manage_blocks',
        ],
        'claim_eligible': False,
    },
    'site_manager': {
        'label': 'Site Manager',
        'default_permissions': [
            'view_reports',
            'manage_blocks',
            'claim_edit',
        ],
        'claim_eligible': False,
    },
    'project_manager': {
        'label': 'Project Manager',
        'default_permissions': [
            'view_reports',
        ],
        'claim_eligible': False,
    },
    'pcc': {
        'label': 'PCC',
        'default_permissions': [
            'view_reports',
        ],
        'claim_eligible': False,
    },
}

LEGACY_ROLE_ALIASES = {
    'user': 'worker',
    'assistant_admin': 'fe',
}


def normalize_role_key(role):
    raw_role = str(role or '').strip().lower()
    if not raw_role:
        return 'worker'
    return LEGACY_ROLE_ALIASES.get(raw_role, raw_role)


def role_definition(role):
    return ROLE_DEFINITIONS.get(normalize_role_key(role), ROLE_DEFINITIONS['worker'])


def default_permissions_for_role(role):
    return list(role_definition(role).get('default_permissions', []))


def role_label(role):
    return role_definition(role).get('label', 'Worker')


def is_claim_eligible_role(role):
    return bool(role_definition(role).get('claim_eligible', False))


class User(db.Model):
    __tablename__ = 'users'

    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), nullable=False)
    username   = db.Column(db.String(100), nullable=False, unique=True)
    email      = db.Column(db.String(255), nullable=True)
    pin_hash   = db.Column(db.String(255), nullable=False)
    is_admin   = db.Column(db.Boolean, default=False)
    role       = db.Column(db.String(20), default='worker')
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
        normalized_role = self.normalized_role()
        if self.is_admin or normalized_role == 'admin':
            return list(ALL_PRIVILEGES)
        try:
            perms = json.loads(self.permissions or '[]')
        except (json.JSONDecodeError, TypeError):
            perms = []
        if not isinstance(perms, list) or not perms:
            return default_permissions_for_role(normalized_role)
        return [perm for perm in dict.fromkeys(str(perm or '').strip() for perm in perms) if perm in ALL_PRIVILEGES]

    def set_permissions(self, perms):
        cleaned = [perm for perm in dict.fromkeys(str(perm or '').strip() for perm in (perms or [])) if perm in ALL_PRIVILEGES]
        self.permissions = json.dumps(cleaned)

    def normalized_role(self):
        if self.is_admin:
            return 'admin'
        return normalize_role_key(self.role)

    def role_label(self):
        return role_label(self.normalized_role())

    def is_claim_eligible(self):
        return is_claim_eligible_role(self.normalized_role())

    def has_permission(self, perm):
        if self.is_admin or self.normalized_role() == 'admin':
            return True
        return perm in self.get_permissions()

    def to_dict(self):
        normalized_role = self.normalized_role()
        return {
            'id':          self.id,
            'name':        self.name,
            'username':    self.username,
            'email':       self.email,
            'recovery_email': self.email,
            'is_admin':    self.is_admin,
            'role':        normalized_role,
            'role_label':  self.role_label(),
            'permissions': self.get_permissions(),
            'claim_eligible': self.is_claim_eligible(),
            'job_site_name': self.job_site_name,
            'job_site_slug': self.job_site_slug,
            'email_verified': bool(self.email_verified),
        }
