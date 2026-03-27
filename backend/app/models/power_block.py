from app import db
from datetime import datetime
import json


class PowerBlock(db.Model):
    __tablename__ = 'power_blocks'
    TRACKER_CLAIM_GLOBAL_KEY = '__global__'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)  # e.g., INV-1
    description = db.Column(db.Text)
    page_number = db.Column(db.Integer)
    image_path = db.Column(db.String(255))
    power_block_number = db.Column(db.String(50))  # e.g., "1" from INV-1
    ifc_pdf_data = db.Column(db.LargeBinary)
    ifc_pdf_mime = db.Column(db.String(100))
    ifc_pdf_filename = db.Column(db.String(255))
    ifc_page_number = db.Column(db.Integer)
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
            'has_ifc': bool(self.ifc_pdf_data),
            'ifc_page_number': self.ifc_page_number,
            'ifc_filename': self.ifc_pdf_filename,
            'ifc_url': f'/api/tracker/power-blocks/{self.id}/ifc' if self.ifc_pdf_data else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'is_completed': self.is_completed,
            'claimed_by': self.claimed_by,
            'claimed_people': claimed_people,
            'claim_assignments': self.get_claim_assignments(),
            'claimed_label': ', '.join(claimed_people),
            'claimed_at': self.claimed_at.isoformat() if self.claimed_at else None,
            'last_updated_by': self.last_updated_by,
            'last_updated_at': self.last_updated_at.isoformat() if self.last_updated_at else None,
            'lbd_count': len(self.lbds),
            'lbds': [lbd.to_dict() for lbd in self.lbds],
            'lbd_summary': self._get_lbd_summary()
        }

    @staticmethod
    def _normalize_people_list(people):
        normalized = []
        seen_people = set()
        for person in people or []:
            name = str(person or '').strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen_people:
                continue
            seen_people.add(key)
            normalized.append(name)
        return normalized

    @staticmethod
    def _normalize_assignments_map(assignments):
        normalized = {}
        for status_type, lbd_ids in (assignments or {}).items():
            key = str(status_type or '').strip()
            if not key:
                continue
            if not isinstance(lbd_ids, list):
                lbd_ids = [lbd_ids]
            normalized_ids = []
            seen_ids = set()
            for lbd_id in lbd_ids:
                try:
                    normalized_id = int(lbd_id)
                except (TypeError, ValueError):
                    continue
                if normalized_id <= 0 or normalized_id in seen_ids:
                    continue
                seen_ids.add(normalized_id)
                normalized_ids.append(normalized_id)
            if normalized_ids:
                normalized[key] = normalized_ids
        return normalized

    @classmethod
    def _normalize_tracker_claim_key(cls, tracker_id):
        try:
            normalized_tracker_id = int(tracker_id)
        except (TypeError, ValueError):
            return cls.TRACKER_CLAIM_GLOBAL_KEY
        return str(normalized_tracker_id) if normalized_tracker_id > 0 else cls.TRACKER_CLAIM_GLOBAL_KEY

    @staticmethod
    def _parse_claimed_at_value(value):
        if isinstance(value, datetime):
            return value
        raw = str(value or '').strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace('Z', '+00:00'))
        except ValueError:
            return None

    def _legacy_tracker_claims(self, people, assignments):
        tracker_claims = {}
        if not assignments:
            return tracker_claims

        lbd_tracker_lookup = {lbd.id: lbd.tracker_id for lbd in self.lbds}
        claimed_at_raw = self.claimed_at.isoformat() if self.claimed_at else None

        for status_type, lbd_ids in assignments.items():
            for lbd_id in lbd_ids:
                tracker_key = self._normalize_tracker_claim_key(lbd_tracker_lookup.get(lbd_id))
                tracker_claim = tracker_claims.setdefault(tracker_key, {
                    'people': list(people),
                    'assignments': {},
                    'claimed_by': self.claimed_by,
                    'claimed_at': claimed_at_raw,
                })
                tracker_claim['assignments'].setdefault(status_type, []).append(lbd_id)

        for tracker_key, tracker_claim in list(tracker_claims.items()):
            normalized_assignments = self._normalize_assignments_map(tracker_claim.get('assignments'))
            if not normalized_assignments:
                tracker_claims.pop(tracker_key, None)
                continue
            tracker_claims[tracker_key] = {
                'people': self._normalize_people_list(tracker_claim.get('people')),
                'assignments': normalized_assignments,
                'claimed_by': str(tracker_claim.get('claimed_by') or '').strip() or None,
                'claimed_at': tracker_claim.get('claimed_at'),
            }

        if not tracker_claims and assignments:
            tracker_claims[self.TRACKER_CLAIM_GLOBAL_KEY] = {
                'people': list(people),
                'assignments': self._normalize_assignments_map(assignments),
                'claimed_by': self.claimed_by,
                'claimed_at': claimed_at_raw,
            }

        return tracker_claims

    def _parse_claim_state(self):
        try:
            raw = json.loads(self.claimed_people or '[]')
        except (TypeError, json.JSONDecodeError):
            raw = []

        raw_people = []
        raw_assignments = {}
        raw_tracker_claims = {}
        if isinstance(raw, dict):
            raw_people = raw.get('people', [])
            raw_assignments = raw.get('assignments', {})
            raw_tracker_claims = raw.get('tracker_claims', {})
        elif isinstance(raw, list):
            raw_people = raw

        people = self._normalize_people_list(raw_people)
        assignments = self._normalize_assignments_map(raw_assignments)

        tracker_claims = {}
        if isinstance(raw_tracker_claims, dict):
            for tracker_key, tracker_claim in raw_tracker_claims.items():
                if not isinstance(tracker_claim, dict):
                    continue
                normalized_assignments = self._normalize_assignments_map(tracker_claim.get('assignments'))
                if not normalized_assignments:
                    continue
                normalized_key = self._normalize_tracker_claim_key(tracker_key)
                tracker_claims[normalized_key] = {
                    'people': self._normalize_people_list(tracker_claim.get('people')),
                    'assignments': normalized_assignments,
                    'claimed_by': str(tracker_claim.get('claimed_by') or '').strip() or None,
                    'claimed_at': str(tracker_claim.get('claimed_at') or '').strip() or None,
                }

        if not tracker_claims and assignments:
            tracker_claims = self._legacy_tracker_claims(people, assignments)

        if tracker_claims:
            aggregate_people = []
            aggregate_assignments = {}
            for tracker_claim in tracker_claims.values():
                aggregate_people.extend(tracker_claim.get('people') or [])
                for status_type, lbd_ids in (tracker_claim.get('assignments') or {}).items():
                    aggregate_assignments.setdefault(status_type, []).extend(lbd_ids)
            people = self._normalize_people_list(aggregate_people)
            assignments = self._normalize_assignments_map(aggregate_assignments)

        if not people and self.claimed_by and assignments:
            people = [self.claimed_by]

        return {
            'people': people,
            'assignments': assignments,
            'tracker_claims': tracker_claims,
        }

    def _get_tracker_claim(self, tracker_id=None):
        state = self._parse_claim_state()
        if tracker_id is None:
            return {
                'people': state['people'],
                'assignments': state['assignments'],
                'claimed_by': self.claimed_by if state['assignments'] else None,
                'claimed_at': self.claimed_at.isoformat() if state['assignments'] and self.claimed_at else None,
            }

        tracker_key = self._normalize_tracker_claim_key(tracker_id)
        tracker_claim = state['tracker_claims'].get(tracker_key)
        if tracker_claim:
            return tracker_claim
        if tracker_key == self.TRACKER_CLAIM_GLOBAL_KEY and state['assignments']:
            return {
                'people': state['people'],
                'assignments': state['assignments'],
                'claimed_by': self.claimed_by if state['assignments'] else None,
                'claimed_at': self.claimed_at.isoformat() if state['assignments'] and self.claimed_at else None,
            }
        return {
            'people': [],
            'assignments': {},
            'claimed_by': None,
            'claimed_at': None,
        }

    def get_claimed_people(self, tracker_id=None):
        return list(self._get_tracker_claim(tracker_id).get('people') or [])

    def get_claim_assignments(self, tracker_id=None):
        return dict(self._get_tracker_claim(tracker_id).get('assignments') or {})

    def get_claimed_by(self, tracker_id=None):
        return self._get_tracker_claim(tracker_id).get('claimed_by')

    def get_claimed_at(self, tracker_id=None):
        return self._parse_claimed_at_value(self._get_tracker_claim(tracker_id).get('claimed_at'))

    def set_claim_state(self, people=None, assignments=None, tracker_id=None, claimed_by=None, claimed_at=None):
        state = self._parse_claim_state()

        if tracker_id is None:
            normalized_people = self._normalize_people_list(state['people'] if people is None else people)
            normalized_assignments = self._normalize_assignments_map(state['assignments'] if assignments is None else assignments)
            tracker_claims = self._legacy_tracker_claims(normalized_people, normalized_assignments)
        else:
            tracker_claims = {
                key: {
                    'people': self._normalize_people_list(value.get('people')),
                    'assignments': self._normalize_assignments_map(value.get('assignments')),
                    'claimed_by': str(value.get('claimed_by') or '').strip() or None,
                    'claimed_at': str(value.get('claimed_at') or '').strip() or None,
                }
                for key, value in (state.get('tracker_claims') or {}).items()
                if isinstance(value, dict) and self._normalize_assignments_map(value.get('assignments'))
            }
            tracker_key = self._normalize_tracker_claim_key(tracker_id)
            current_tracker_claim = tracker_claims.get(tracker_key, {})
            normalized_tracker_people = self._normalize_people_list(current_tracker_claim.get('people') if people is None else people)
            normalized_tracker_assignments = self._normalize_assignments_map(current_tracker_claim.get('assignments') if assignments is None else assignments)
            normalized_claimed_by = str(
                current_tracker_claim.get('claimed_by') if claimed_by is None else claimed_by or ''
            ).strip() or None
            claimed_at_value = current_tracker_claim.get('claimed_at') if claimed_at is None else claimed_at
            normalized_claimed_at = claimed_at_value.isoformat() if isinstance(claimed_at_value, datetime) else str(claimed_at_value or '').strip() or None

            if normalized_tracker_assignments:
                tracker_claims[tracker_key] = {
                    'people': normalized_tracker_people,
                    'assignments': normalized_tracker_assignments,
                    'claimed_by': normalized_claimed_by,
                    'claimed_at': normalized_claimed_at,
                }
            else:
                tracker_claims.pop(tracker_key, None)

            aggregate_people = []
            aggregate_assignments = {}
            for tracker_claim in tracker_claims.values():
                aggregate_people.extend(tracker_claim.get('people') or [])
                for status_type, lbd_ids in (tracker_claim.get('assignments') or {}).items():
                    aggregate_assignments.setdefault(status_type, []).extend(lbd_ids)
            normalized_people = self._normalize_people_list(aggregate_people)
            normalized_assignments = self._normalize_assignments_map(aggregate_assignments)

        self.claimed_people = json.dumps({
            'people': normalized_people,
            'assignments': normalized_assignments,
            'tracker_claims': tracker_claims,
        })

    def set_claimed_people(self, people, tracker_id=None):
        self.set_claim_state(people=people, tracker_id=tracker_id)

    def set_claim_assignments(self, assignments, tracker_id=None):
        self.set_claim_state(assignments=assignments, tracker_id=tracker_id)

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
            summary[col] = completed
        return summary
