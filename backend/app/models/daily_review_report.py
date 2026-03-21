import json

from datetime import datetime

from app import db


class DailyReviewReport(db.Model):
    __tablename__ = 'daily_review_reports'

    id = db.Column(db.Integer, primary_key=True)
    report_date = db.Column(db.Date, nullable=False)
    tracker_id = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow)
    _data = db.Column('data', db.Text)

    __table_args__ = (
        db.UniqueConstraint('report_date', 'tracker_id', name='uq_review_report_date_tracker'),
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
            'id': self.id,
            'report_date': self.report_date.isoformat() if self.report_date else None,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'data': self.get_data(),
        }

    def to_summary(self):
        data = self.get_data()
        failed_blocks = data.get('failed_blocks') or []
        return {
            'id': self.id,
            'report_date': self.report_date.isoformat() if self.report_date else None,
            'generated_at': self.generated_at.isoformat() if self.generated_at else None,
            'total_reviews': data.get('total_reviews', 0),
            'pass_count': data.get('pass_count', 0),
            'fail_count': data.get('fail_count', 0),
            'reviewers': data.get('reviewer_names', []),
            'failed_blocks': failed_blocks,
        }