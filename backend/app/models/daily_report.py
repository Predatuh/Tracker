import os
from flask import current_app

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

    def _claim_scan_file_exists(self, scan):
        image_path = str((scan or {}).get('image_path') or '').replace('\\', '/').lstrip('/')
        if not image_path:
            return False
        upload_root = current_app.config.get('UPLOAD_FOLDER')
        if not upload_root:
            return False
        abs_path = os.path.abspath(os.path.join(upload_root, image_path))
        claim_scan_root = os.path.abspath(os.path.join(upload_root, 'claim_scans'))
        return abs_path.startswith(claim_scan_root) and os.path.exists(abs_path)

    def _serialized_claim_scans(self, claim_scans):
        serialized = []
        for scan in list(claim_scans or []):
            item = dict(scan)
            if not self._claim_scan_file_exists(item):
                item['image_url'] = None
            serialized.append(item)
        return serialized

    def to_dict(self):
        data = self.get_data()
        if 'claim_scans' in data:
            data = dict(data)
            data['claim_scans'] = self._serialized_claim_scans(data.get('claim_scans'))
        return {
            'id':           self.id,
            'report_date':  self.report_date.isoformat() if self.report_date else None,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'data':         data,
        }

    def to_summary(self):
        """Lighter version for list views – no full data payload."""
        data = self.get_data()
        claim_scans = self._serialized_claim_scans(data.get('claim_scans'))
        latest_scan = next((scan for scan in reversed(claim_scans) if scan.get('image_url')), {})
        by_task = data.get('by_task') or {}
        fix_worker_map = by_task.get('fix') or {}
        fix_entry_count = sum(
            len(blocks or [])
            for blocks in fix_worker_map.values()
            if isinstance(blocks, list)
        )
        return {
            'id':            self.id,
            'report_date':   self.report_date.isoformat() if self.report_date else None,
            'generated_at':  self.generated_at.isoformat() if self.generated_at else None,
            'total_entries': data.get('total_entries', 0),
            'workers':       data.get('worker_names', []),
            'fix_entry_count': fix_entry_count,
            'claim_scan_count': len(claim_scans),
            'latest_claim_scan_image_url': latest_scan.get('image_url'),
            'latest_claim_scan_power_block': latest_scan.get('power_block_name'),
        }
