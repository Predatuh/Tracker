#!/usr/bin/env python3
"""Test the extraction flow to debug the issue"""
import requests
import json
import time
from pathlib import Path

BASE_URL = "http://localhost:5000"
PDF_FILE = r"c:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

print("=" * 60)
print("LBD Tracker - Page Extraction Test")
print("=" * 60)

# Step 1: Upload PDF
print("\n[1] Uploading PDF...")
print(f"File: {PDF_FILE}")

with open(PDF_FILE, 'rb') as f:
    files = {'file': f}
    try:
        upload_response = requests.post(
            f"{BASE_URL}/api/pdf/upload",
            files=files,
            timeout=60
        )
        print(f"Upload Status: {upload_response.status_code}")
        upload_data = upload_response.json()
        print(f"Upload Response: {json.dumps(upload_data, indent=2)}")
        
        if not upload_data.get('success'):
            print("[ERROR] Upload failed!")
            exit(1)
        
        pdf_path = upload_data['pdf_path']
        page_count = upload_data['page_count']
        print(f"[OK] PDF uploaded successfully: {page_count} pages")
        print(f"  Path: {pdf_path}")
        
    except Exception as e:
        print(f"[ERROR] Upload error: {e}")
        exit(1)

# Step 2: Extract pages
print("\n[2] Extracting pages 1-5...")
selected_pages = [1, 2, 3, 4, 5]

extract_payload = {
    'pdf_path': pdf_path,
    'page_numbers': selected_pages
}

print(f"Request payload: {json.dumps(extract_payload, indent=2)}")

try:
    extract_response = requests.post(
        f"{BASE_URL}/api/pdf/extract-pages",
        json=extract_payload,
        timeout=120
    )
    
    print(f"Extract Status: {extract_response.status_code}")
    print(f"Extract Headers: {dict(extract_response.headers)}")
    
    extract_data = extract_response.json()
    print(f"\nFull Response:\n{json.dumps(extract_data, indent=2)}")
    
    # Detailed inspection
    print("\n[Response Structure Analysis]")
    print(f"Response type: {type(extract_data)}")
    print(f"Response keys: {extract_data.keys() if isinstance(extract_data, dict) else 'N/A'}")
    
    if 'extracted_pages' in extract_data:
        print(f"[OK] 'extracted_pages' found in response")
        pages = extract_data['extracted_pages']
        print(f"  Type: {type(pages)}")
        print(f"  Length: {len(pages) if isinstance(pages, list) else 'N/A'}")
        if pages:
            print(f"  First page: {pages[0]}")
    else:
        print(f"[ERROR] 'extracted_pages' NOT found in response")
        print(f"  Available keys: {list(extract_data.keys())}")
    
    if extract_response.status_code == 200:
        print("\n[OK] Extraction successful!")
    else:
        print(f"\n[ERROR] Extraction failed with status {extract_response.status_code}")
        
except Exception as e:
        print(f"[ERROR] Extraction error: {e}")
    traceback.print_exc()

print("\n" + "=" * 60)
print("Test Complete")
print("=" * 60)
