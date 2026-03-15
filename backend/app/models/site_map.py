from app import db
from datetime import datetime

class SiteMap(db.Model):
    __tablename__ = 'site_maps'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    svg_content = db.Column(db.Text)  # Store SVG content if it's an SVG file
    image_data = db.Column(db.LargeBinary)  # Map image stored as blob (survives redeploys)
    image_mime = db.Column(db.String(50))   # e.g. 'image/png'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    areas = db.relationship('SiteArea', backref='site_map', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'file_path': self.file_path,
            'image_url': f'/api/map/sitemap/{self.id}/image',
            'svg_content': self.svg_content,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'areas': [a.to_dict() for a in self.areas]
        }
