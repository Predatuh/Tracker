from app import db
from datetime import datetime
import json

class SiteArea(db.Model):
    __tablename__ = 'site_areas'
    
    id = db.Column(db.Integer, primary_key=True)
    site_map_id = db.Column(db.Integer, db.ForeignKey('site_maps.id'), nullable=False)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'))
    name = db.Column(db.String(100), nullable=False)
    svg_element_id = db.Column(db.String(100))  # ID of the SVG element
    # Bounding box as percentage of image dimensions (0-100)
    bbox_x = db.Column(db.Float)      # left edge %
    bbox_y = db.Column(db.Float)      # top edge %
    bbox_w = db.Column(db.Float)      # width %
    bbox_h = db.Column(db.Float)      # height %
    # Polygon outline: JSON list of {x_pct, y_pct} points (% of image dims)
    polygon_points = db.Column(db.Text)   # JSON string
    label_font_size = db.Column(db.Integer)  # optional per-area override
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def get_polygon(self):
        """Return polygon as list of dicts, or None."""
        if self.polygon_points:
            try:
                return json.loads(self.polygon_points)
            except Exception:
                return None
        return None

    def set_polygon(self, points):
        """Accept list of {x_pct, y_pct} dicts and store as JSON."""
        if points:
            self.polygon_points = json.dumps(points)
        else:
            self.polygon_points = None
    
    def to_dict(self):
        return {
            'id': self.id,
            'site_map_id': self.site_map_id,
            'power_block_id': self.power_block_id,
            'name': self.name,
            'svg_element_id': self.svg_element_id,
            'bbox_x': self.bbox_x,
            'bbox_y': self.bbox_y,
            'bbox_w': self.bbox_w,
            'bbox_h': self.bbox_h,
            'polygon': self.get_polygon(),
            'label_font_size': self.label_font_size,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
