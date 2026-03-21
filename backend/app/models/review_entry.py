from datetime import datetime

from app import db


class ReviewEntry(db.Model):
    __tablename__ = 'review_entries'

    id = db.Column(db.Integer, primary_key=True)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'), nullable=False)
    lbd_id = db.Column(db.Integer, db.ForeignKey('lbds.id'), nullable=True)
    tracker_id = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    review_result = db.Column(db.String(20), nullable=False)
    review_date = db.Column(db.Date, nullable=False)
    reviewed_by = db.Column(db.String(100), nullable=False)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    power_block = db.relationship('PowerBlock', backref=db.backref('review_entries', lazy=True))
    lbd = db.relationship('LBD', backref=db.backref('review_entries', lazy=True))

    def to_dict(self):
        lbd = self.lbd
        power_block = self.power_block or (lbd.power_block if lbd and getattr(lbd, 'power_block', None) else None)
        lbd_label = None
        if lbd:
            lbd_label = lbd.identifier or lbd.name or (f'LBD {lbd.id}' if lbd.id else None)
        return {
            'id': self.id,
            'power_block_id': self.power_block_id,
            'power_block_name': power_block.name if power_block else None,
            'lbd_id': self.lbd_id,
            'lbd_name': lbd.name if lbd else None,
            'lbd_identifier': lbd.identifier if lbd else None,
            'inventory_number': lbd.inventory_number if lbd else None,
            'review_target_label': lbd_label or (power_block.name if power_block else None),
            'tracker_id': self.tracker_id,
            'review_result': self.review_result,
            'review_date': self.review_date.isoformat() if self.review_date else None,
            'reviewed_by': self.reviewed_by,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }