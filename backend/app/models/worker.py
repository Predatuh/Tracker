from app import db
from datetime import datetime


class Worker(db.Model):
    """A field worker / crew member (separate from system User accounts)."""
    __tablename__ = 'workers'

    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), nullable=False, unique=True)
    is_active  = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    work_entries = db.relationship('WorkEntry', backref='worker', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':        self.id,
            'name':      self.name,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class WorkEntry(db.Model):
    """Records which workers performed which task on which power block on a given day."""
    __tablename__ = 'work_entries'

    id             = db.Column(db.Integer, primary_key=True)
    worker_id      = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=False)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'), nullable=False)
    task_type      = db.Column(db.String(50), nullable=False)   # e.g. 'stuff', 'term', 'ground_brackets'
    work_date      = db.Column(db.Date, nullable=False)          # local CST date
    logged_by      = db.Column(db.String(100))                   # username who submitted the entry
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)

    power_block = db.relationship('PowerBlock', backref=db.backref('work_entries', lazy=True))

    def to_dict(self):
        return {
            'id':             self.id,
            'worker_id':      self.worker_id,
            'worker_name':    self.worker.name if self.worker else None,
            'power_block_id': self.power_block_id,
            'power_block_name': self.power_block.name if self.power_block else None,
            'task_type':      self.task_type,
            'work_date':      self.work_date.isoformat() if self.work_date else None,
            'logged_by':      self.logged_by,
            'created_at':     self.created_at.isoformat() if self.created_at else None,
        }
