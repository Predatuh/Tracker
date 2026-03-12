"""Hit the dedup endpoint to remove duplicate LBDs."""
import requests

RAILWAY_URL = "https://www.princesscoded.net"
s = requests.Session()
s.post(f"{RAILWAY_URL}/api/auth/login", json={"name": "Admin", "pin": "9067"})

r = s.post(f"{RAILWAY_URL}/api/admin/dedup-lbds", timeout=120)
print(f"Status: {r.status_code}")
print(f"Text: {r.text[:500]}")

# Also check if admin settings works
r2 = s.get(f"{RAILWAY_URL}/api/admin/settings")
print(f"\nAdmin settings status: {r2.status_code}")
