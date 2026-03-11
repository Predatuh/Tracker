from app import db
from datetime import datetime
import json


class DailyReport(db.Model):
    """A generated snapshot of all work done on a specific day."""
    __tablename__ = 'daily_reports'

    id           = db.Column(db.Integer, primary_key=True)
    report_date  = db.Column(db.Date, nullable=False, unique=True)   # the day this covers
    generated_at = db.Column(db.DateTime, default=datetime.utcnow)   # when it was generated
    _data        = db.Column('data', db.Text)                         # JSON snapshot

    def set_data(self, obj):
        self._data = json.dumps(obj, default=str)

    def get_data(self):
        try:
            return json.loads(self._data) if self._data else {}
        except Exception:
            return {}

    def to_dict(self):
        return {
            'id':           self.id,
            'report_date':  self.report_date.isoformat() if self.report_date else None,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'data':         self.get_data(),
        }

    def to_summary(self):
        """Lighter version for list views – no full data payload."""
        data = self.get_data()
        return {
            'id':            self.id,
            'report_date':   self.report_date.isoformat() if self.report_date else None,
            'generated_at':  self.generated_at.isoformat() if self.generated_at else None,
            'total_entries': data.get('total_entries', 0),
            'workers':       data.get('worker_names', []),
        }
