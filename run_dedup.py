"""Hit the dedup endpoint to remove duplicate LBDs."""
import requests
from ops_env import login_session

s, RAILWAY_URL = login_session()

r = s.post(f"{RAILWAY_URL}/api/admin/dedup-lbds", timeout=120)
print(f"Status: {r.status_code}")
print(f"Text: {r.text[:500]}")

# Also check if admin settings works
r2 = s.get(f"{RAILWAY_URL}/api/admin/settings")
print(f"\nAdmin settings status: {r2.status_code}")
