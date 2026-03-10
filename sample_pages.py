#!/usr/bin/env python3
"""Sample random pages from PDF to find LBD data"""
from PyPDF2 import PdfReader

pdf_file = r"c:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

try:
    pdf = PdfReader(pdf_file)
    total_pages = len(pdf.pages)
    
    print(f"Total pages: {total_pages}\n")
    
    # Check pages in the middle and later
    test_pages = [50, 100, 150, 170]
    
    for page_num in test_pages:
        if page_num <= total_pages:
            page = pdf.pages[page_num - 1]
            text = page.extract_text()
            
            print(f"\n{'='*80}")
            print(f"PAGE {page_num}")
            print(f"{'='*80}")
            print(text[:1500])  # First 1500 chars
            
            if 'LBD' in text or 'INV' in text or 'Inverter' in text:
                print("\n[FOUND RELEVANT CONTENT]")
            
except Exception as e:
    print(f"Error: {e}")
