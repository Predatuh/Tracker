import json
from app import db
from datetime import datetime


class AdminSettings(db.Model):
    """Key-value store for admin-configurable settings."""
    __tablename__ = 'admin_settings'

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text)  # JSON-encoded
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def get_value(self):
        try:
            return json.loads(self.value) if self.value else None
        except Exception:
            return self.value

    def set_value(self, val):
        self.value = json.dumps(val)

    # ------------------------------------------------------------------ #
    # Class-level helpers
    # ------------------------------------------------------------------ #

    @classmethod
    def get(cls, key, default=None):
        rec = cls.query.filter_by(key=key).first()
        return rec.get_value() if rec else default

    @classmethod
    def set(cls, key, val):
        rec = cls.query.filter_by(key=key).first()
        if rec is None:
            rec = cls(key=key)
            db.session.add(rec)
        rec.set_value(val)
        db.session.commit()

    # ------------------------------------------------------------------ #
    # Defaults
    # ------------------------------------------------------------------ #

    DEFAULT_COLORS = {
        'ground_brackets': '#95E1D3',
        'stuff': '#FF6B6B',
        'term': '#4ECDC4',
        'quality_check': '#A8E6CF',
        'quality_docs': '#56AB91',
    }

    DEFAULT_NAMES = {
        'ground_brackets': 'Bracket/Ground',
        'stuff': 'Stuffed',
        'term': 'Termed',
        'quality_check': 'Quality Check',
        'quality_docs': 'Quality Docs',
    }

    @classmethod
    def get_colors(cls):
        stored = cls.get('status_colors')
        if stored:
            # Merge defaults so missing keys still get a color
            merged = dict(cls.DEFAULT_COLORS)
            merged.update(stored)
            # Filter to only active keys (built-ins minus disabled, plus custom)
            valid = set(cls.all_column_keys())
            return {k: v for k, v in merged.items() if k in valid}
        return dict(cls.DEFAULT_COLORS)

    @classmethod
    def get_names(cls):
        stored = cls.get('status_names')
        if stored:
            merged = dict(cls.DEFAULT_NAMES)
            merged.update(stored)
            # Filter to only active keys (built-ins minus disabled, plus custom)
            valid = set(cls.all_column_keys())
            return {k: v for k, v in merged.items() if k in valid}
        return dict(cls.DEFAULT_NAMES)

    @classmethod
    def get_custom_columns(cls):
        """Return list of user-added custom column keys."""
        return cls.get('custom_columns') or []

    @classmethod
    def all_column_keys(cls):
        """All status keys: built-in (minus disabled) + custom."""
        from app.models.status import LBDStatus
        disabled = cls.get('disabled_builtins') or []
        base = [k for k in LBDStatus.STATUS_TYPES if k not in disabled]
        custom = cls.get_custom_columns()
        for c in custom:
            if c not in base:
                base.append(c)
        return base
