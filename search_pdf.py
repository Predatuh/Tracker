#!/usr/bin/env python3
"""Search PDF for LBD and power block related content"""
from PyPDF2 import PdfReader
import re

pdf_file = r"c:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

print("=" * 80)
print("PDF Search - Looking for LBD and Power Block Information")
print("=" * 80)

try:
    pdf = PdfReader(pdf_file)
    total_pages = len(pdf.pages)
    
    keywords = ['LBD', 'Power Block', 'INV', 'INVERTER', 'DCDB', 'ACDB', 'Inventory']
    
    results = {}
    
    for page_num in range(total_pages):
        page = pdf.pages[page_num]
        text = page.extract_text()
        
        # Search for keywords
        for keyword in keywords:
            if keyword.lower() in text.lower():
                if keyword not in results:
                    results[keyword] = []
                results[keyword].append(page_num + 1)
    
    print("\nKeyword occurrences by page:")
    for keyword, pages in sorted(results.items()):
        print(f"\n{keyword}: Found on {len(pages)} pages")
        print(f"  Pages: {pages[:20]}")  # Show first 20
        
    # Show sample pages that have LBD content
    if 'LBD' in results:
        print(f"\n\nSample LBD pages content:")
        sample_pages = results['LBD'][:3]
        for page_num in sample_pages:
            text = pdf.pages[page_num - 1].extract_text()
            print(f"\n{'='*80}")
            print(f"PAGE {page_num}")
            print(f"{'='*80}")
            # Find lines with LBD
            lines = text.split('\n')
            for line in lines:
                if 'LBD' in line.upper() or 'INV' in line.upper():
                    print(line)
            
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
