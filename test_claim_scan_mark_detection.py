import sys
import unittest
from pathlib import Path

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from app.routes.report_routes import (  # noqa: E402
    CLAIM_SCAN_FORM_ROWS,
    CLAIM_SCAN_PAGE_HEIGHT,
    CLAIM_SCAN_PAGE_WIDTH,
    _claim_mark_metrics,
    _claim_scan_status_types,
    _estimate_claim_scan_y_boundaries,
    _extract_claim_cell_roi,
    _fit_claim_scan_rows_from_ocr,
    _is_claim_marked,
    _map_form_rows_to_lbds,
    _order_claim_scan_quad,
)


# ---------------------------------------------------------------------------
# Realistic form-cell sizes matching a rectified 1400x1980 page.
# Table approx 1360x1780.  5 columns (1 label ~19%, 4 status ~20% each).
# 22 data rows + 2 header rows → each row ~74px.
# After ROI inset the cell is roughly 240x50.
# ---------------------------------------------------------------------------

CELL_W = 250    # approximate status column width
CELL_H = 68     # approximate row height


def _make_form_cell(marks=None, grid_lines=True):
    """Create a realistic form cell at actual scan resolution.

    marks  – None (blank), 'x', 'check', 'fill', 'dot'
    grid_lines – draw 2px border lines simulating the printed grid
    """
    roi = np.zeros((CELL_H, CELL_W), dtype=np.uint8)

    if grid_lines:
        # top & bottom horizontal grid lines (2px)
        roi[0:2, :] = 255
        roi[-2:, :] = 255
        # left & right vertical grid lines (2px)
        roi[:, 0:2] = 255
        roi[:, -2:] = 255

    cx, cy = CELL_W // 2, CELL_H // 2
    pad = min(cx, cy) - 8  # mark extent from center

    if marks == 'x':
        cv2.line(roi, (cx - pad, cy - pad), (cx + pad, cy + pad), 255, 3)
        cv2.line(roi, (cx + pad, cy - pad), (cx - pad, cy + pad), 255, 3)
    elif marks == 'check':
        cv2.line(roi, (cx - pad, cy), (cx - pad // 2, cy + pad), 255, 3)
        cv2.line(roi, (cx - pad // 2, cy + pad), (cx + pad, cy - pad), 255, 3)
    elif marks == 'fill':
        cv2.rectangle(roi, (cx - pad, cy - pad), (cx + pad, cy + pad), 255, -1)
    elif marks == 'dot':
        cv2.circle(roi, (cx, cy), 6, 255, -1)

    return roi


def _make_checkbox(mark=None):
    """Legacy small checkbox for backward compat tests."""
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


# ---------------------------------------------------------------------------
# Build a synthetic full-page form image (1400x1980) with a grid of cells,
# some marked and some not, to run end-to-end detection on.
# ---------------------------------------------------------------------------

def _build_form_page(marked_cells=None):
    """Return a binary (thresh-inv) form page with optional marks.

    marked_cells – set of (row_1based, col_0based) tuples to mark with X.
    Returns (page_binary, table_bbox, x_boundaries, y_boundaries).
    """
    marked_cells = marked_cells or set()
    W, H = CLAIM_SCAN_PAGE_WIDTH, CLAIM_SCAN_PAGE_HEIGHT
    page = np.zeros((H, W), dtype=np.uint8)

    # Table geometry
    tx, ty = 20, 200
    tw, th = W - 40, H - 240
    num_cols = 5  # 1 label + 4 status
    num_rows = 22

    label_w = int(tw * 0.19)
    status_w = (tw - label_w) // 4

    # x boundaries
    x_bounds = [tx, tx + label_w]
    for c in range(4):
        x_bounds.append(tx + label_w + status_w * (c + 1))
    x_bounds[-1] = tx + tw

    # y boundaries: meta row, header row, then 22 data rows
    row_h = th // (num_rows + 2)
    y_bounds = [ty, ty + row_h, ty + 2 * row_h]
    for r in range(1, num_rows + 1):
        y_bounds.append(ty + (2 + r) * row_h)
    y_bounds[-1] = ty + th

    # Draw grid lines (2px)
    for yb in y_bounds:
        cv2.line(page, (tx, yb), (tx + tw, yb), 255, 2)
    for xb in x_bounds:
        cv2.line(page, (xb, ty), (xb, ty + th), 255, 2)

    # Draw marks
    for (row, col) in marked_cells:
        if row < 1 or row > num_rows or col < 0 or col >= 4:
            continue
        left = x_bounds[col + 1]
        right = x_bounds[col + 2]
        top = y_bounds[row + 1]  # +1 to skip header
        bottom = y_bounds[row + 2]
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        pad = min(right - left, bottom - top) // 2 - 8
        cv2.line(page, (cx - pad, cy - pad), (cx + pad, cy + pad), 255, 3)
        cv2.line(page, (cx + pad, cy - pad), (cx - pad, cy + pad), 255, 3)

    return page, (tx, ty, tw, th), x_bounds, y_bounds


class ClaimScanMarkDetectionTests(unittest.TestCase):

    # -- realistic form-cell tests (match actual scan geometry) --

    def test_blank_form_cell_is_not_marked(self):
        roi = _make_form_cell(marks=None, grid_lines=True)
        metrics = _claim_mark_metrics(roi)
        self.assertFalse(_is_claim_marked(metrics, use_form_layout=True),
                         f'Blank cell wrongly detected: {metrics}')

    def test_form_cell_x_mark_is_detected(self):
        roi = _make_form_cell(marks='x', grid_lines=True)
        metrics = _claim_mark_metrics(roi)
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True),
                        f'X-mark cell missed: {metrics}')

    def test_form_cell_check_mark_is_detected(self):
        roi = _make_form_cell(marks='check', grid_lines=True)
        metrics = _claim_mark_metrics(roi)
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True),
                        f'Checkmark cell missed: {metrics}')

    def test_form_cell_filled_is_detected(self):
        roi = _make_form_cell(marks='fill', grid_lines=True)
        metrics = _claim_mark_metrics(roi)
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True),
                        f'Filled cell missed: {metrics}')

    def test_form_cell_no_grid_x_mark_is_detected(self):
        roi = _make_form_cell(marks='x', grid_lines=False)
        metrics = _claim_mark_metrics(roi)
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=True),
                        f'X-mark (no grid) missed: {metrics}')

    def test_form_cell_tiny_dot_is_not_marked(self):
        roi = _make_form_cell(marks='dot', grid_lines=True)
        metrics = _claim_mark_metrics(roi)
        self.assertFalse(_is_claim_marked(metrics, use_form_layout=True),
                         f'Tiny dot wrongly detected: {metrics}')

    def test_form_cell_grid_only_no_mark_various_thickness(self):
        """Grid lines of various thickness should never trigger a mark."""
        for thickness in [1, 2, 3, 4]:
            roi = np.zeros((CELL_H, CELL_W), dtype=np.uint8)
            roi[0:thickness, :] = 255
            roi[-thickness:, :] = 255
            roi[:, 0:thickness] = 255
            roi[:, -thickness:] = 255
            metrics = _claim_mark_metrics(roi)
            self.assertFalse(_is_claim_marked(metrics, use_form_layout=True),
                             f'Grid-only (thickness={thickness}) wrongly detected: {metrics}')

    # -- full-page end-to-end form test --

    def test_full_form_page_only_marked_cells_detected(self):
        """Build a synthetic form page with marks in specific cells,
        extract each cell's ROI, and verify only marked cells are detected."""
        # Mark rows 17 and 18 in all 4 columns
        marked = {(17, c) for c in range(4)} | {(18, c) for c in range(4)}
        page, bbox, x_bounds, y_bounds = _build_form_page(marked)

        false_positives = []
        false_negatives = []

        for row in range(1, 19):  # 18-LBD block
            for col in range(4):
                left = x_bounds[col + 1]
                right = x_bounds[col + 2]
                top = y_bounds[row + 1]
                bottom = y_bounds[row + 2]
                roi = _extract_claim_cell_roi(page, left, right, top, bottom)
                metrics = _claim_mark_metrics(roi)
                detected = _is_claim_marked(metrics, use_form_layout=True)
                expected = (row, col) in marked

                if detected and not expected:
                    false_positives.append((row, col, metrics))
                if not detected and expected:
                    false_negatives.append((row, col, metrics))

        self.assertEqual(false_positives, [],
                         f'False positives: {false_positives}')
        self.assertEqual(false_negatives, [],
                         f'False negatives: {false_negatives}')

    def test_full_form_page_all_blank_no_marks_detected(self):
        """A completely blank form grid should produce zero mark detections."""
        page, bbox, x_bounds, y_bounds = _build_form_page(set())
        detected_cells = []

        for row in range(1, 23):  # all 22 rows
            for col in range(4):
                left = x_bounds[col + 1]
                right = x_bounds[col + 2]
                top = y_bounds[row + 1]
                bottom = y_bounds[row + 2]
                roi = _extract_claim_cell_roi(page, left, right, top, bottom)
                metrics = _claim_mark_metrics(roi)
                if _is_claim_marked(metrics, use_form_layout=True):
                    detected_cells.append((row, col, metrics))

        self.assertEqual(detected_cells, [],
                         f'Blank form had false positives: {detected_cells}')

    # -- legacy small checkbox tests --

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
        # Small checkbox is not realistic form-cell size; test without form layout
        self.assertTrue(_is_claim_marked(metrics, use_form_layout=False))

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