from app import db
from datetime import datetime

class LBD(db.Model):
    __tablename__ = 'lbds'
    
    id = db.Column(db.Integer, primary_key=True)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'), nullable=False)
    tracker_id = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    name = db.Column(db.String(100), nullable=False)
    identifier = db.Column(db.String(50))  # e.g., LBD-001, LBD-002
    inventory_number = db.Column(db.String(100))  # e.g., D.1.LBD.01/20B-500
    x_position = db.Column(db.Float)  # Position on the image
    y_position = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    notes = db.Column(db.Text)
    
    # Relationships
    statuses = db.relationship('LBDStatus', backref='lbd', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'power_block_id': self.power_block_id,
            'tracker_id': self.tracker_id,
            'name': self.name,
            'identifier': self.identifier,
            'inventory_number': self.inventory_number,
            'x_position': self.x_position,
            'y_position': self.y_position,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'statuses': [s.to_dict() for s in self.statuses],
            'completion_percentage': self._get_completion_percentage()
        }
    
    def _get_completion_percentage(self):
        """Calculate completion percentage based on statuses"""
        if not self.statuses:
            return 0
        completed = sum(1 for s in self.statuses if s.is_completed)
        return int((completed / len(self.statuses)) * 100)
