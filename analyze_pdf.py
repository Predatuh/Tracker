#!/usr/bin/env python3
"""Extract text from PDF to understand structure"""
from PyPDF2 import PdfReader
import sys

pdf_file = r"c:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

print("=" * 80)
print("PDF Text Extraction - Structure Analysis")
print("=" * 80)

try:
    pdf = PdfReader(pdf_file)
    total_pages = len(pdf.pages)
    
    print(f"\nTotal pages: {total_pages}")
    print(f"Analyzing first 5 pages for structure...\n")
    
    for page_num in range(min(5, total_pages)):
        page = pdf.pages[page_num]
        text = page.extract_text()
        
        print(f"\n{'='*80}")
        print(f"PAGE {page_num + 1}")
        print(f"{'='*80}")
        print(text[:2000] if len(text) > 2000 else text)
        print(f"\n... (Total text length: {len(text)} chars)")
        
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
