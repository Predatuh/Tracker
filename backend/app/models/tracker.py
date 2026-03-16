import json
from app import db
from datetime import datetime


class Tracker(db.Model):
    """A tracker defines a task/activity category (e.g. LBD, Inverter DC Landing).
    Each tracker has its own items per power block and its own status columns."""
    __tablename__ = 'trackers'

    id                  = db.Column(db.Integer, primary_key=True)
    name                = db.Column(db.String(100), nullable=False)           # "LBD Tracker"
    slug                = db.Column(db.String(50), unique=True, nullable=False)  # "lbd"
    item_name_singular  = db.Column(db.String(50), default='Item')            # "LBD"
    item_name_plural    = db.Column(db.String(50), default='Items')           # "LBDs"
    stat_label          = db.Column(db.String(100), default='Total Items')    # "Total LBDs"
    dashboard_progress_label = db.Column(db.String(100), default='Complete')
    dashboard_blocks_label   = db.Column(db.String(100), default='Power Blocks')
    dashboard_open_label     = db.Column(db.String(100), default='Open Tracker')
    job_site_name       = db.Column(db.String(120), nullable=True)
    icon                = db.Column(db.String(10), default='📋')
    _status_types       = db.Column('status_types', db.Text)                  # JSON list
    _status_colors      = db.Column('status_colors', db.Text)                 # JSON dict
    _status_names       = db.Column('status_names', db.Text)                  # JSON dict
    _column_order       = db.Column('column_order', db.Text)                  # JSON list (optional)
    is_active           = db.Column(db.Boolean, default=True)
    sort_order          = db.Column(db.Integer, default=0)
    created_at          = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    lbds          = db.relationship('LBD', backref='tracker', lazy=True)
    work_entries  = db.relationship('WorkEntry', backref='tracker', lazy=True)

    # ── JSON helpers ──────────────────────────────────────────

    def get_status_types(self):
        try:
            return json.loads(self._status_types) if self._status_types else []
        except Exception:
            return []

    def set_status_types(self, val):
        self._status_types = json.dumps(val)

    def get_status_colors(self):
        try:
            return json.loads(self._status_colors) if self._status_colors else {}
        except Exception:
            return {}

    def set_status_colors(self, val):
        self._status_colors = json.dumps(val)

    def get_status_names(self):
        try:
            return json.loads(self._status_names) if self._status_names else {}
        except Exception:
            return {}

    def set_status_names(self, val):
        self._status_names = json.dumps(val)

    def get_column_order(self):
        try:
            return json.loads(self._column_order) if self._column_order else None
        except Exception:
            return None

    def set_column_order(self, val):
        self._column_order = json.dumps(val) if val else None

    def all_column_keys(self):
        """Return status types respecting column_order if set."""
        types = self.get_status_types()
        order = self.get_column_order()
        if order:
            active = set(types)
            ordered = [k for k in order if k in active]
            for k in types:
                if k not in ordered:
                    ordered.append(k)
            return ordered
        return types

    def to_dict(self):
        return {
            'id':                  self.id,
            'name':                self.name,
            'slug':                self.slug,
            'item_name_singular':  self.item_name_singular,
            'item_name_plural':    self.item_name_plural,
            'stat_label':          self.stat_label,
            'dashboard_progress_label': self.dashboard_progress_label,
            'dashboard_blocks_label':   self.dashboard_blocks_label,
            'dashboard_open_label':     self.dashboard_open_label,
            'job_site_name':       self.job_site_name,
            'icon':                self.icon,
            'status_types':        self.get_status_types(),
            'status_colors':       self.get_status_colors(),
            'status_names':        self.get_status_names(),
            'column_order':        self.get_column_order(),
            'is_active':           self.is_active,
            'sort_order':          self.sort_order,
            'created_at':          self.created_at.isoformat() if self.created_at else None,
        }
