import configparser
import os
import re
import sys
from pathlib import Path

from PyPDF2 import PdfReader, PdfWriter


def load_config(base_dir):
    cfg = configparser.ConfigParser()
    cfg.read(base_dir / 'config.ini')
    return cfg


def pb_sort_key(block):
    raw = str(block.power_block_number or block.name or '')
    match = re.search(r'(\d+)', raw)
    return int(match.group(1)) if match else 0


def single_page_pdf_bytes(reader, page_index):
    writer = PdfWriter()
    writer.add_page(reader.pages[page_index])
    from io import BytesIO
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def main():
    if len(sys.argv) < 2:
      raise SystemExit('Usage: python import_ifc_pdf.py <path-to-IFC.pdf>')

    pdf_path = Path(sys.argv[1]).expanduser()
    if not pdf_path.exists():
        raise SystemExit(f'IFC PDF not found: {pdf_path}')

    base_dir = Path(__file__).resolve().parent
    cfg = load_config(base_dir)
    sys.path.insert(0, str(base_dir / 'backend'))

    os.environ['DATABASE_URL'] = cfg.get('database', 'url', fallback='').strip()
    os.environ['SECRET_KEY'] = cfg.get('app', 'secret_key', fallback='local-secret').strip()
    os.environ['ADMIN_PIN'] = cfg.get('admin', 'pin', fallback='1234').strip()

    from app import create_app, db
    from app.models import PowerBlock

    reader = PdfReader(str(pdf_path))
    app = create_app()
    with app.app_context():
        blocks = sorted(PowerBlock.query.all(), key=pb_sort_key)
        assignable = min(len(blocks), len(reader.pages))
        if assignable == 0:
            raise SystemExit('No power blocks or IFC pages available for assignment.')

        for index, block in enumerate(blocks[:assignable]):
            block.ifc_pdf_data = single_page_pdf_bytes(reader, index)
            block.ifc_pdf_mime = 'application/pdf'
            block.ifc_pdf_filename = f'{pdf_path.stem}-PB-{block.power_block_number or index + 1}.pdf'
            block.ifc_page_number = index + 1

        db.session.commit()
        print(f'Assigned {assignable} IFC pages from {pdf_path.name}.')
        if len(reader.pages) != len(blocks):
            print(f'Note: PDF pages={len(reader.pages)}, power blocks={len(blocks)}. Only the first {assignable} were assigned.')


if __name__ == '__main__':
    main()