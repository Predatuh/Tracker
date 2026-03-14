from app import db
from datetime import datetime
import json


class DailyReport(db.Model):
    """A generated snapshot of all work done on a specific day."""
    __tablename__ = 'daily_reports'

    id           = db.Column(db.Integer, primary_key=True)
    report_date  = db.Column(db.Date, nullable=False)                  # the day this covers
    tracker_id   = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow)    # when it was generated
    _data        = db.Column('data', db.Text)                          # JSON snapshot

    __table_args__ = (
        db.UniqueConstraint('report_date', 'tracker_id', name='uq_report_date_tracker'),
    )

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
        claim_scans = list(data.get('claim_scans') or [])
        latest_scan = claim_scans[-1] if claim_scans else {}
        return {
            'id':            self.id,
            'report_date':   self.report_date.isoformat() if self.report_date else None,
            'generated_at':  self.generated_at.isoformat() if self.generated_at else None,
            'total_entries': data.get('total_entries', 0),
            'workers':       data.get('worker_names', []),
            'claim_scan_count': len(claim_scans),
            'latest_claim_scan_image_url': latest_scan.get('image_url'),
            'latest_claim_scan_power_block': latest_scan.get('power_block_name'),
        }
