import sys
import unittest
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from app.routes.report_routes import CLAIM_SCAN_FORM_ROWS, CLAIM_SCAN_PAGE_HEIGHT, CLAIM_SCAN_PAGE_WIDTH, _claim_mark_metrics, _claim_scan_status_types, _estimate_claim_scan_y_boundaries, _fit_claim_scan_rows_from_ocr, _is_claim_marked, _map_form_rows_to_lbds, _order_claim_scan_quad  # noqa: E402


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

    def test_edge_noise_is_not_marked_on_form_layout(self):
        metrics = {
            'raw_fill_ratio': 0.03,
            'fill_ratio': 0.02,
            'peak_ratio': 0.19,
            'component_ratio': 0.04,
            'ink_pixels': 24,
            'inner_ratio': 0.003,
            'edge_touch_count': 3,
        }
        self.assertFalse(_is_claim_marked(metrics, use_form_layout=True))

    def test_claim_scan_uses_paper_column_order(self):
        class TrackerStub:
            def all_column_keys(self):
                return ['ground_brackets', 'stuff', 'term', 'quality_check', 'quality_docs', 'stickers']

        self.assertEqual(
            _claim_scan_status_types(TrackerStub()),
            ['ground_brackets', 'stuff', 'term', 'stickers'],
        )

    def test_claim_scan_uses_fixed_22_row_sheet(self):
        self.assertEqual(CLAIM_SCAN_FORM_ROWS, 22)

    def test_form_row_mapping_caps_to_block_lbd_count(self):
        class LbdStub:
            def __init__(self, idx):
                self.id = idx
                self.identifier = f'LBD-{idx:02d}'
                self.inventory_number = None
                self.name = f'LBD {idx}'

        class BlockStub:
            def __init__(self, count):
                self.lbds = [LbdStub(idx) for idx in range(1, count + 1)]

        mapping = _map_form_rows_to_lbds(BlockStub(18), row_count=18)

        self.assertEqual(len(mapping), 18)
        self.assertNotIn(19, mapping)
        self.assertEqual(mapping[18], 18)

    def test_row_fit_interpolates_from_sparse_even_rows(self):
        row_number_map = {row_number: 1000 + row_number for row_number in range(1, 11)}
        items = []
        for row_number in [2, 4, 6, 8]:
            items.append({
                'text': str(row_number),
                'left': 24,
                'top': 100 + ((row_number - 1) * 18),
                'width': 14,
                'height': 12,
                'conf': 92.0,
            })

        fitted = _fit_claim_scan_rows_from_ocr(items, row_number_map, image_width=800, row_count=10)

        self.assertEqual(set(fitted.keys()), set(row_number_map.values()))
        self.assertLess(fitted[1001]['top'], fitted[1002]['top'])
        self.assertLess(fitted[1002]['top'], fitted[1003]['top'])
        self.assertLess(fitted[1009]['top'], fitted[1010]['top'])

    def test_estimated_y_boundaries_cover_full_22_row_sheet(self):
        boundaries = _estimate_claim_scan_y_boundaries((10, 20, 500, 880), [], CLAIM_SCAN_FORM_ROWS)

        self.assertEqual(len(boundaries), CLAIM_SCAN_FORM_ROWS + 3)
        self.assertLess(boundaries[0], boundaries[1])
        self.assertLess(boundaries[1], boundaries[2])
        self.assertLess(boundaries[2], boundaries[3])
        self.assertLess(boundaries[-2], boundaries[-1])

    def test_claim_scan_quad_is_ordered_consistently(self):
        ordered = _order_claim_scan_quad([(400, 1800), (1200, 150), (200, 120), (1250, 1850)])

        self.assertEqual(ordered[0], (200, 120))
        self.assertEqual(ordered[1], (1200, 150))
        self.assertEqual(ordered[2], (1250, 1850))
        self.assertEqual(ordered[3], (400, 1800))

    def test_claim_scan_page_constants_are_portrait(self):
        self.assertGreater(CLAIM_SCAN_PAGE_HEIGHT, CLAIM_SCAN_PAGE_WIDTH)


if __name__ == '__main__':
    unittest.main()