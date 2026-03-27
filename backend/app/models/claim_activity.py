import json
from datetime import datetime

from app import db


class ClaimActivity(db.Model):
    __tablename__ = 'claim_activities'

    id = db.Column(db.Integer, primary_key=True)
    power_block_id = db.Column(db.Integer, db.ForeignKey('power_blocks.id'), nullable=False)
    tracker_id = db.Column(db.Integer, db.ForeignKey('trackers.id'), nullable=True)
    work_date = db.Column(db.Date, nullable=False)
    claimed_by = db.Column(db.String(100))
    source = db.Column(db.String(50), default='manual')
    claimed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    people_json = db.Column(db.Text, default='[]', nullable=False)
    assignments_json = db.Column(db.Text, default='{}', nullable=False)

    power_block = db.relationship('PowerBlock', backref=db.backref('claim_activities', lazy=True))

    def get_people(self):
        try:
            raw = json.loads(self.people_json or '[]')
        except Exception:
            raw = []
        if not isinstance(raw, list):
            raw = []
        people = []
        seen = set()
        for person in raw:
            name = str(person or '').strip()
            if not name:
                continue
            folded = name.casefold()
            if folded in seen:
                continue
            seen.add(folded)
            people.append(name)
        return people

    def set_people(self, people):
        normalized = []
        seen = set()
        for person in people or []:
            name = str(person or '').strip()
            if not name:
                continue
            folded = name.casefold()
            if folded in seen:
                continue
            seen.add(folded)
            normalized.append(name)
        self.people_json = json.dumps(normalized)

    def get_assignments(self):
        try:
            raw = json.loads(self.assignments_json or '{}')
        except Exception:
            raw = {}
        if not isinstance(raw, dict):
            raw = {}
        normalized = {}
        for status_type, lbd_ids in raw.items():
            key = str(status_type or '').strip()
            if not key:
                continue
            if not isinstance(lbd_ids, list):
                lbd_ids = [lbd_ids]
            ids = []
            seen = set()
            for value in lbd_ids:
                try:
                    lbd_id = int(value)
                except (TypeError, ValueError):
                    continue
                if lbd_id <= 0 or lbd_id in seen:
                    continue
                seen.add(lbd_id)
                ids.append(lbd_id)
            if ids:
                normalized[key] = ids
        return normalized

    def set_assignments(self, assignments):
        normalized = {}
        for status_type, lbd_ids in (assignments or {}).items():
            key = str(status_type or '').strip()
            if not key:
                continue
            if not isinstance(lbd_ids, list):
                lbd_ids = [lbd_ids]
            ids = []
            seen = set()
            for value in lbd_ids:
                try:
                    lbd_id = int(value)
                except (TypeError, ValueError):
                    continue
                if lbd_id <= 0 or lbd_id in seen:
                    continue
                seen.add(lbd_id)
                ids.append(lbd_id)
            if ids:
                normalized[key] = ids
        self.assignments_json = json.dumps(normalized)

    def total_assignment_count(self):
        return sum(len(lbd_ids) for lbd_ids in self.get_assignments().values())

    def to_dict(self):
        return {
            'id': self.id,
            'power_block_id': self.power_block_id,
            'tracker_id': self.tracker_id,
            'work_date': self.work_date.isoformat() if self.work_date else None,
            'claimed_by': self.claimed_by,
            'source': self.source,
            'claimed_at': self.claimed_at.isoformat() if self.claimed_at else None,
            'people': self.get_people(),
            'assignments': self.get_assignments(),
            'assignment_count': self.total_assignment_count(),
            'power_block_name': self.power_block.name if self.power_block else None,
        }