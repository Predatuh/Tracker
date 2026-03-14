import sys
import unittest
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from app.routes.report_routes import _claim_mark_metrics, _claim_scan_status_types, _is_claim_marked  # noqa: E402


def _make_checkbox(mark=None):
    roi = np.zeros((36, 42), dtype=np.uint8)
    cv2.rectangle(roi, (6, 6), (30, 30), 255, 1)
    if mark == 'check':
        cv2.line(roi, (12, 20), (18, 26), 255, 2)
        cv2.line(roi, (18, 26), (28, 12), 255, 2)
    elif mark == 'x':
        cv2.line(roi, (12, 12), (28, 28), 255, 2)
        cv2.line(roi, (28, 12), (12, 28), 255, 2)
    elif mark == 'fill':
        cv2.rectangle(roi, (12, 12), (24, 24), 255, -1)
    return roi


class ClaimScanMarkDetectionTests(unittest.TestCase):
    def test_empty_checkbox_is_not_marked(self):
        metrics = _claim_mark_metrics(_make_checkbox())
        self.assertFalse(_is_claim_marked(metrics, use_form_layout=True))

    def test_checkmark_is_detected(self):
        metrics = _claim_mark_metrics(_make_checkbox('check'))
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True))

    def test_x_mark_is_detected(self):
        metrics = _claim_mark_metrics(_make_checkbox('x'))
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True))

    def test_filled_box_is_detected(self):
        metrics = _claim_mark_metrics(_make_checkbox('fill'))
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True))

    def test_claim_scan_uses_paper_column_order(self):
        class TrackerStub:
            def all_column_keys(self):
                return ['ground_brackets', 'stuff', 'term', 'quality_check', 'quality_docs', 'stickers']

        self.assertEqual(
            _claim_scan_status_types(TrackerStub()),
            ['ground_brackets', 'stuff', 'term', 'stickers'],
        )


if __name__ == '__main__':
    unittest.main()