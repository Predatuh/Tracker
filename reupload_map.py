"""Re-upload the map image to Railway so it gets stored as a DB blob."""
import requests, os, time
from ops_env import login_session

MAP_FILE = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "uploads", "maps",
                        "map_Gemini_Generated_Image_l30ce4l30ce4l30c.png")

s, RAILWAY_URL = login_session()

print("Waiting 60s for Railway to redeploy...")
time.sleep(60)

print(f"Uploading map ({os.path.getsize(MAP_FILE) / 1024 / 1024:.1f} MB)...")
with open(MAP_FILE, "rb") as f:
    r = s.post(f"{RAILWAY_URL}/api/pdf/upload-map",
               files={"file": (os.path.basename(MAP_FILE), f, "image/png")})
print(f"  Upload: {r.status_code} {r.text[:200]}")

# Verify
r = s.get(f"{RAILWAY_URL}/api/pdf/get-map")
print(f"  get-map: {r.status_code} {r.text[:200]}")
