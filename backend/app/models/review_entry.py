from datetime import datetime

from app import db


class ReviewEntry(db.Model):
    __tablename__ = 'review_entries'

    id = db.Column(db.Integer, primary_key=True)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'), nullable=False)
    tracker_id = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    review_result = db.Column(db.String(20), nullable=False)
    review_date = db.Column(db.Date, nullable=False)
    reviewed_by = db.Column(db.String(100), nullable=False)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    power_block = db.relationship('PowerBlock', backref=db.backref('review_entries', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'power_block_id': self.power_block_id,
            'power_block_name': self.power_block.name if self.power_block else None,
            'tracker_id': self.tracker_id,
            'review_result': self.review_result,
            'review_date': self.review_date.isoformat() if self.review_date else None,
            'reviewed_by': self.reviewed_by,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }