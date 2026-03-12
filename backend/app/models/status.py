from app import db
from datetime import datetime

class LBDStatus(db.Model):
    __tablename__ = 'lbd_statuses'
    
    STATUS_TYPES = [
        'ground_brackets',
        'stuff',
        'term',
        'quality_check',
        'quality_docs'
    ]
    
    # Color mapping for each status type
    STATUS_COLORS = {
        'ground_brackets': '#95E1D3', # Mint – Bracket/Ground
        'stuff': '#FF6B6B',           # Red – Stuffed
        'term': '#4ECDC4',            # Teal – Termed
        'quality_check': '#A8E6CF',   # Light Green
        'quality_docs': '#56AB91'     # Dark Green
    }
    
    id = db.Column(db.Integer, primary_key=True)
    lbd_id = db.Column(db.Integer, db.ForeignKey('lbds.id'), nullable=False)
    status_type = db.Column(db.String(50), nullable=False)
    is_completed = db.Column(db.Boolean, default=False)
    completed_at = db.Column(db.DateTime)
    completed_by = db.Column(db.String(100))  # display name of user who last toggled
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    notes = db.Column(db.Text)
    
    def to_dict(self):
        return {
            'id': self.id,
            'lbd_id': self.lbd_id,
            'status_type': self.status_type,
            'is_completed': self.is_completed,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'completed_by': self.completed_by,
            'color': self.STATUS_COLORS.get(self.status_type, '#CCCCCC'),
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
