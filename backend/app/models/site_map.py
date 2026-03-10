from app import db
from datetime import datetime

class SiteMap(db.Model):
    __tablename__ = 'site_maps'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    svg_content = db.Column(db.Text)  # Store SVG content if it's an SVG file
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    areas = db.relationship('SiteArea', backref='site_map', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'file_path': self.file_path,
            'svg_content': self.svg_content,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'areas': [a.to_dict() for a in self.areas]
        }
