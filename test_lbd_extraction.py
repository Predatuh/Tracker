#!/usr/bin/env python3
"""Test LBD extraction functionality"""
import requests
import json
import time

BASE_URL = "http://localhost:5000"
PDF_FILE = r"c:\Users\tanne\Desktop\LBD PROGRAM\25-07-01 - IFC - Pierce County -Didar's edits.pdf"

print("=" * 80)
print("Testing LBD Extraction")
print("=" * 80)

# Step 1: Upload PDF
print("\n[1] Uploading PDF...")
try:
    with open(PDF_FILE, 'rb') as f:
        files = {'file': f}
        upload_response = requests.post(
            f"{BASE_URL}/api/pdf/upload",
            files=files,
            timeout=60
        )
    
    upload_data = upload_response.json()
    if not upload_data.get('success'):
        print(f"[ERROR] Upload failed: {upload_data}")
        exit(1)
    
    pdf_path = upload_data['pdf_path']
    print(f"[OK] PDF uploaded: {upload_data['page_count']} pages")
    print(f"     Path: {pdf_path}")
    
except Exception as e:
    print(f"[ERROR] Upload failed: {e}")
    exit(1)

# Step 2: Scan PDF for LBDs
print("\n[2] Scanning PDF for LBDs...")
try:
    scan_response = requests.post(
        f"{BASE_URL}/api/pdf/scan-lbds",
        json={'pdf_path': pdf_path},
        timeout=120
    )
    
    scan_data = scan_response.json()
    
    if scan_data.get('success'):
        print(f"[OK] Scan complete!")
        print(f"     Power Blocks: {scan_data.get('power_blocks_created', 0)}")
        print(f"     LBDs: {scan_data.get('lbds_created', 0)}")
        
        if scan_data.get('power_blocks'):
            print(f"\n     Power Block Details:")
            for pb in scan_data['power_blocks'][:5]:  # Show first 5
                print(f"       - {pb['name']}: {pb.get('lbd_count', 0)} LBDs")
                if pb.get('lbds'):
                    for lbd in pb['lbds'][:3]:  # Show first 3 LBDs
                        inv = lbd.get('inventory_number', 'N/A')
                        print(f"         * {lbd['identifier']}: {inv}")
    else:
        print(f"[ERROR] Scan failed: {scan_data.get('error', 'Unknown error')}")
        
except Exception as e:
    print(f"[ERROR] Scan request failed: {e}")
    import traceback
    traceback.print_exc()

# Step 3: Get power blocks
print("\n[3] Retrieving power blocks...")
try:
    blocks_response = requests.get(
        f"{BASE_URL}/api/tracker/power-blocks",
        timeout=10
    )
    
    blocks_data = blocks_response.json()
    print(f"[OK] Retrieved power blocks")
    
    if blocks_data.get('data'):
        print(f"     Total: {len(blocks_data['data'])} power blocks")
        for pb in blocks_data['data'][:3]:
            print(f"     - {pb['name']}: {pb.get('lbd_count', 0)} LBDs")
    
except Exception as e:
    print(f"[ERROR] Get blocks failed: {e}")

print("\n" + "=" * 80)
print("Test Complete")
print("=" * 80)
