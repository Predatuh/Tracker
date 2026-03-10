#!/usr/bin/env python
"""Quick test of the optimized LBD scanner"""
import requests
import json
import time

BASE_URL = "http://localhost:5000"
PDF_PATH = r"C:\Users\tanne\Desktop\LBD TRACKER\backend\uploads\25-07-01_-_IFC_-_Pierce_County_-Didars_edits.pdf"

print("Testing optimized LBD scanner...")
print(f"PDF exists: {__import__('os').path.exists(PDF_PATH)}")
print()

print("1. Testing /api/pdf/scan-lbds endpoint...")
try:
    start = time.time()
    response = requests.post(
        f"{BASE_URL}/api/pdf/scan-lbds",
        json={"pdf_path": PDF_PATH},
        timeout=120  # 2 minute timeout
    )
    elapsed = time.time() - start
    
    print(f"   Status: {response.status_code}")
    print(f"   Time: {elapsed:.2f}s")
    
    if response.status_code == 200:
        data = response.json()
        print(f"   ✓ Success!")
        print(f"   - Power blocks created: {data.get('power_blocks_created')}")
        print(f"   - LBDs created: {data.get('lbds_created')}")
        if data.get('power_blocks'):
            print(f"   - Sample power block: {data['power_blocks'][0]}")
    else:
        print(f"   ✗ Error: {response.text}")
        
except requests.exceptions.Timeout:
    print("   ✗ TIMEOUT - Scanner took too long!")
except Exception as e:
    print(f"   ✗ Error: {e}")
