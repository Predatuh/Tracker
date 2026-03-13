from app import db
from datetime import datetime
import json

class PowerBlock(db.Model):
    __tablename__ = 'power_blocks'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)  # e.g., INV-1
    description = db.Column(db.Text)
    page_number = db.Column(db.Integer)
    image_path = db.Column(db.String(255))
    power_block_number = db.Column(db.String(50))  # e.g., "1" from INV-1
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_completed = db.Column(db.Boolean, default=False)

    # Claimed / audit tracking
    claimed_by = db.Column(db.String(100))
    claimed_people = db.Column(db.Text, default='[]')
    claimed_at = db.Column(db.DateTime)
    last_updated_by = db.Column(db.String(100))
    last_updated_at = db.Column(db.DateTime)
    
    # Relationships
    lbds = db.relationship('LBD', backref='power_block', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        claimed_people = self.get_claimed_people()
        return {
            'id': self.id,
            'name': self.name,
            'power_block_number': self.power_block_number,
            'description': self.description,
            'page_number': self.page_number,
            'image_path': self.image_path,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'is_completed': self.is_completed,
            'claimed_by': self.claimed_by,
            'claimed_people': claimed_people,
            'claimed_label': ', '.join(claimed_people),
            'claimed_at': self.claimed_at.isoformat() if self.claimed_at else None,
            'last_updated_by': self.last_updated_by,
            'last_updated_at': self.last_updated_at.isoformat() if self.last_updated_at else None,
            'lbd_count': len(self.lbds),
            'lbds': [lbd.to_dict() for lbd in self.lbds],
            'lbd_summary': self._get_lbd_summary()
        }

    def get_claimed_people(self):
        try:
            people = json.loads(self.claimed_people or '[]')
        except (TypeError, json.JSONDecodeError):
            people = []
        if not isinstance(people, list):
            people = []
        normalized = []
        seen = set()
        for person in people:
            name = str(person or '').strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(name)
        if not normalized and self.claimed_by:
            normalized = [self.claimed_by]
        return normalized

    def set_claimed_people(self, people):
        normalized = []
        seen = set()
        for person in people or []:
            name = str(person or '').strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(name)
        self.claimed_people = json.dumps(normalized)
    
    def _get_lbd_summary(self):
        """Get summary of LBD statuses with completion counts"""
        from app.models.admin_settings import AdminSettings
        all_cols = AdminSettings.all_column_keys()
        total = len(self.lbds)
        summary = {'total': total}
        for col in all_cols:
            completed = 0
            for lbd in self.lbds:
                for s in lbd.statuses:
                    if s.status_type == col and s.is_completed:
                        completed += 1
                        break
            summary[col] = completed   # number of LBDs with this status completed
        return summary
