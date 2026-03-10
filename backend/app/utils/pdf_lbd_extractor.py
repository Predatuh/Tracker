"""Extract LBD and Power Block data from PDF.

Uses PyMuPDF (fitz) which is ~10x faster than PyPDF2, plus
ThreadPoolExecutor to scan pages in parallel.
"""
import re
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import fitz  # PyMuPDF
    USE_PYMUPDF = True
except ImportError:
    from PyPDF2 import PdfReader
    USE_PYMUPDF = False

logger = logging.getLogger(__name__)

# Compiled regex patterns
RE_ARRAY_LAYOUT = re.compile(r'ARRAY\s+LAYOUT\s+INV[- ]?(\d+)', re.IGNORECASE)
RE_INV_NUMBER   = re.compile(r'INV[- ]?(\d+)', re.IGNORECASE)
RE_LBD_ROW      = re.compile(r'\*[\s\-]*LBD[\s\-]*(\d+)', re.IGNORECASE)
RE_LBD_ANY      = re.compile(r'LBD[\s\-]*(\d+)', re.IGNORECASE)
RE_FUSE_NUMBER  = re.compile(r'[A-Z]\.\d+\.LBD\.\d+/[A-Z0-9\-&]+', re.IGNORECASE)


class LBDExtractor:
    """Extract LBD data from solar facility PDF documents."""

    def __init__(self, pdf_path, progress_callback=None):
        self.pdf_path = pdf_path
        self.progress_callback = progress_callback
        self._lock = threading.Lock()
        self._pages_done = 0
        self._total_pages = 0
        self._pb_count = 0
        self._lbd_count = 0

    def _tick(self):
        """Thread-safe progress increment."""
        if self.progress_callback:
            with self._lock:
                self._pages_done += 1
                self.progress_callback(
                    current_page=self._pages_done,
                    total_pages=self._total_pages,
                    power_blocks_found=self._pb_count,
                    lbds_found=self._lbd_count,
                )

    def _get_page_text(self, pdf_source, idx):
        """Extract text from one page from a pre-built texts list or PdfReader."""
        try:
            if isinstance(pdf_source, list):
                # Pre-extracted texts list (fast path)
                return idx, pdf_source[idx] if idx < len(pdf_source) else ''
            else:
                text = pdf_source.pages[idx].extract_text() or ""
                return idx, text
        except Exception as e:
            logger.error(f"Page {idx+1} read error: {e}")
            return idx, ""

    def _parse_page(self, idx, text):
        """Return (inv_num, page_lbds) for a PB page, or (None, []) otherwise."""
        if not RE_INV_NUMBER.search(text):
            return None, []

        layout_match = RE_ARRAY_LAYOUT.search(text)
        if layout_match:
            inv_num = layout_match.group(1)
        else:
            inv_match = RE_INV_NUMBER.search(text)
            has_lbd = RE_LBD_ROW.search(text) or RE_LBD_ANY.search(text)
            if not (inv_match and has_lbd):
                return None, []
            inv_num = inv_match.group(1)

        pb_name = f"INV-{inv_num}"
        page_number = idx + 1
        fuse_numbers = RE_FUSE_NUMBER.findall(text)
        page_lbds = []
        seen_nums = set()

        for line in text.split('\n'):
            row_match = RE_LBD_ROW.search(line) or RE_LBD_ANY.search(line)
            if not row_match:
                continue
            lbd_num = row_match.group(1).lstrip('0') or '0'
            if lbd_num in seen_nums:
                continue
            seen_nums.add(lbd_num)
            fuse_match = RE_FUSE_NUMBER.search(line)
            page_lbds.append({
                '_key': f"{pb_name}_LBD-{lbd_num.zfill(2)}",
                '_number': int(lbd_num),
                'identifier': f'LBD-{lbd_num.zfill(2)}',
                'power_block': pb_name,
                'inventory_number': fuse_match.group(0) if fuse_match else '',
                'capacity': '0',
                'page_number': page_number,
            })

        # Bulk fallback
        if not page_lbds:
            all_m = RE_LBD_ROW.findall(text) or RE_LBD_ANY.findall(text)
            seen = set()
            for s in all_m:
                n = s.lstrip('0') or '0'
                if n in seen:
                    continue
                seen.add(n)
                page_lbds.append({
                    '_key': f"{pb_name}_LBD-{n.zfill(2)}",
                    '_number': int(n),
                    'identifier': f'LBD-{n.zfill(2)}',
                    'power_block': pb_name,
                    'inventory_number': '',
                    'capacity': '0',
                    'page_number': page_number,
                })

        # Assign fuse numbers in order if grabbed globally
        if fuse_numbers and page_lbds:
            page_lbds.sort(key=lambda x: x['_number'])
            for i, lbd in enumerate(page_lbds):
                if not lbd['inventory_number'] and i < len(fuse_numbers):
                    lbd['inventory_number'] = fuse_numbers[i]

        return inv_num, page_lbds

    def extract_data(self):
        """Scan all pages sequentially (texts pre-extracted in one fast pass)."""
        try:
            if USE_PYMUPDF:
                logger.info("Pre-extracting all page texts with PyMuPDF (single pass)...")
                doc = fitz.open(self.pdf_path)
                total_pages = len(doc)
                page_texts = [page.get_text() for page in doc]
                doc.close()
            else:
                reader = PdfReader(self.pdf_path)
                total_pages = len(reader.pages)
                page_texts = [p.extract_text() or '' for p in reader.pages]

            self._total_pages = total_pages
            self._pages_done = 0
            logger.info(f"PDF has {total_pages} pages. Parsing sequentially...")

            power_blocks = {}   # inv_num -> dict
            lbds = []           # list of lbd dicts
            seen_keys = set()

            for idx in range(total_pages):
                text = page_texts[idx]
                self._pages_done = idx + 1

                inv_num, page_lbds = self._parse_page(idx, text)

                # Fire progress callback every page
                if self.progress_callback:
                    self.progress_callback(
                        current_page=self._pages_done,
                        total_pages=total_pages,
                        power_blocks_found=len(power_blocks),
                        lbds_found=len(lbds),
                    )

                if inv_num is None:
                    continue

                pb_name = f"INV-{inv_num}"
                page_number = idx + 1

                if inv_num not in power_blocks:
                    power_blocks[inv_num] = {
                        'name': pb_name,
                        'page_number': page_number,
                        'lbd_count': 0,
                    }
                for lbd in page_lbds:
                    if lbd['_key'] not in seen_keys:
                        lbds.append(lbd)
                        seen_keys.add(lbd['_key'])
                        power_blocks[inv_num]['lbd_count'] += 1

                self._pb_count = len(power_blocks)
                self._lbd_count = len(lbds)
                logger.info(f"Page {page_number}: {pb_name} -> {len(page_lbds)} LBDs")

            logger.info(f"Done: {len(power_blocks)} PBs, {len(lbds)} LBDs")
            return {
                'success': True,
                'power_blocks': list(power_blocks.values()),
                'lbds': lbds,
            }

        except Exception as e:
            logger.error(f"Extraction error: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {'success': False, 'error': str(e), 'power_blocks': [], 'lbds': []}

    def extract_lbds_for_page(self, page_num):
        """Extract LBDs from a specific page."""
        try:
            _, text = self._get_page_text(None, page_num - 1)
            lbds = []
            seen = set()
            for line in text.split('\n'):
                match = RE_LBD_ROW.search(line) or RE_LBD_ANY.search(line)
                if not match:
                    continue
                n = match.group(1).lstrip('0') or '0'
                if n in seen:
                    continue
                seen.add(n)
                fuse = RE_FUSE_NUMBER.search(line)
                lbds.append({
                    'number': int(n),
                    'identifier': f'LBD-{n.zfill(2)}',
                    'inventory_number': fuse.group(0) if fuse else '',
                    'capacity': '0',
                    'page_number': page_num,
                })
            return lbds
        except Exception as e:
            logger.error(f"Error on page {page_num}: {e}")
            return []
