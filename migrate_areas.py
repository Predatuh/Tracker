"""Upload just site areas (PB positions on map) to Railway PostgreSQL."""
import sqlite3, requests, json, os, time

RAILWAY_URL = "https://www.princesscoded.net"
LOCAL_DB = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "lbd_tracker.db")

s = requests.Session()
s.post(f"{RAILWAY_URL}/api/auth/login", json={"name": "Admin", "pin": "9067"})

# Get remote PB name->id mapping
r = s.get(f"{RAILWAY_URL}/api/tracker/power-blocks")
resp = r.json()
pb_list = resp.get("data", resp) if isinstance(resp, dict) else resp
remote_pbs = {pb["name"]: pb["id"] for pb in pb_list}
print(f"Remote PBs: {len(remote_pbs)}")

# Check if areas already exist
r = s.get(f"{RAILWAY_URL}/api/map/sitemaps")
maps = r.json().get("data", [])
if maps and len(maps[0].get("areas", [])) >= 128:
    print(f"All site areas already exist: {len(maps[0]['areas'])} areas on map {maps[0]['id']}")
    print("Skipping - already done!")
    exit(0)

# Get existing area names to avoid duplicates
existing_areas = set()
if maps:
    for a in maps[0].get("areas", []):
        existing_areas.add((a.get("power_block_id"), round(a.get("bbox_x", 0), 2), round(a.get("bbox_y", 0), 2)))
    print(f"  {len(existing_areas)} areas already exist, uploading missing ones...")

remote_map_id = maps[0]["id"] if maps else 1
print(f"Using map id: {remote_map_id}")

db = sqlite3.connect(LOCAL_DB)
rows = db.execute("""
    SELECT sa.id, sa.power_block_id, pb.name as pb_name, sa.name,
           sa.bbox_x, sa.bbox_y, sa.bbox_w, sa.bbox_h,
           sa.polygon_points, sa.label_font_size
    FROM site_areas sa
    LEFT JOIN power_blocks pb ON sa.power_block_id = pb.id
    ORDER BY sa.id
""").fetchall()

print(f"Migrating {len(rows)} site areas...")
created = 0
failed = 0
for i, row in enumerate(rows):
    sa_id, local_pb_id, pb_name, name, bx, by, bw, bh, polygon_json, font_size = row
    remote_pb_id = remote_pbs.get(pb_name) if pb_name else None
    
    payload = {
        "site_map_id": remote_map_id,
        "name": name or "",
        "bbox_x": bx,
        "bbox_y": by,
        "bbox_w": bw,
        "bbox_h": bh,
    }
    if remote_pb_id:
        payload["power_block_id"] = remote_pb_id
    if polygon_json:
        try:
            payload["polygon"] = json.loads(polygon_json)
        except json.JSONDecodeError:
            pass
    if font_size:
        payload["label_font_size"] = font_size
    
    # Skip if this area already exists on remote
    key = (remote_pb_id, round(bx or 0, 2), round(by or 0, 2))
    if key in existing_areas:
        continue

    for attempt in range(3):
        try:
            r = s.post(f"{RAILWAY_URL}/api/map/area", json=payload, timeout=30)
            if r.status_code in (200, 201):
                created += 1
            else:
                failed += 1
                if attempt == 0:
                    print(f"  Area '{name}' failed: {r.status_code} {r.text[:100]}")
            break
        except Exception as e:
            if attempt < 2:
                time.sleep(2)
            else:
                failed += 1
    
    if (i + 1) % 20 == 0:
        print(f"  {i + 1}/{len(rows)}...")

db.close()
print(f"Done: {created} created, {failed} failed")
