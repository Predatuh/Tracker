"""
Migrate local EXE SQLite data → Railway hosted site.

Reads from: dist/LBDTracker_data/lbd_tracker.db
Pushes to:  https://www.princesscoded.net  (Railway)

Transfers: map image, power blocks, LBDs, LBD statuses, site areas, admin settings, users.
"""

import sqlite3
import requests
import os
import json
import time
import sys

# -------------------------------------------------------------------
RAILWAY_URL = "https://www.princesscoded.net"
LOCAL_DB = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "lbd_tracker.db")
MAP_FILE = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "uploads", "maps",
                        "map_Gemini_Generated_Image_l30ce4l30ce4l30c.png")
# -------------------------------------------------------------------

session = requests.Session()


def api(method, path, **kwargs):
    """Make API call and return response."""
    url = f"{RAILWAY_URL}{path}"
    resp = getattr(session, method)(url, timeout=300, **kwargs)
    return resp


def check_connection():
    print("Checking Railway connection...")
    r = api("get", "/")
    if r.status_code == 200:
        print(f"  Connected to {RAILWAY_URL}")
        return True
    print(f"  FAILED: status {r.status_code}")
    return False


def login_admin():
    """Login as admin so we have permission to create data."""
    print("Logging in as admin...")
    r = api("post", "/api/auth/login", json={"name": "Admin", "pin": "9067"})
    if r.status_code == 200:
        print("  Logged in as Admin")
        return True
    print(f"  Login failed: {r.status_code} {r.text}")
    return False


def upload_map():
    """Upload the map image file."""
    if not os.path.exists(MAP_FILE):
        print(f"  Map file not found: {MAP_FILE}")
        return False
    print(f"Uploading map ({os.path.getsize(MAP_FILE) / 1024 / 1024:.1f} MB)...")
    with open(MAP_FILE, "rb") as f:
        r = api("post", "/api/map/upload",
                files={"file": (os.path.basename(MAP_FILE), f, "image/png")},
                data={"name": os.path.basename(MAP_FILE)})
    if r.status_code in (200, 201):
        data = r.json()
        print(f"  Map uploaded: id={data.get('id', '?')}")
        return data.get("id", 1)
    print(f"  Map upload failed: {r.status_code} {r.text[:200]}")
    return None


def migrate_admin_settings(db):
    """Push admin settings (status colors, custom columns, font size)."""
    print("Migrating admin settings...")
    rows = db.execute("SELECT key, value FROM admin_settings").fetchall()
    for key, value in rows:
        parsed = json.loads(value)
        if key == "status_colors":
            r = api("put", "/api/admin/settings/colors", json={"colors": parsed})
            print(f"  status_colors: {r.status_code}")
        elif key == "custom_columns":
            # Custom columns need to be created one at a time
            for col_key in parsed:
                r = api("post", "/api/admin/settings/columns", json={"key": col_key, "label": col_key.replace("_", " ").title()})
                print(f"  custom column '{col_key}': {r.status_code}")
        elif key == "pb_label_font_size":
            r = api("put", "/api/admin/settings/font-size", json={"size": parsed})
            print(f"  pb_label_font_size: {r.status_code}")


def migrate_power_blocks(db):
    """Create all 119 power blocks."""
    print("Migrating power blocks...")
    rows = db.execute(
        "SELECT id, name, power_block_number, description, page_number FROM power_blocks ORDER BY id"
    ).fetchall()
    
    # Use the create-power-blocks endpoint for batch creation
    pages = []
    for row in rows:
        pb_id, name, pb_num, description, page_number = row
        pages.append({
            "page_number": page_number or pb_id,
            "block_name": name,
            "image_path": "",
            "description": description or "",
        })
    
    r = api("post", "/api/pdf/create-power-blocks", json={"pages": pages})
    if r.status_code in (200, 201):
        print(f"  Created {len(pages)} power blocks")
        return True
    print(f"  Failed: {r.status_code} {r.text[:200]}")
    return False


def migrate_lbds(db):
    """Create all LBDs for each power block."""
    print("Migrating LBDs (2350 total)...")
    
    # Get remote power blocks to map names → IDs
    r = api("get", "/api/tracker/power-blocks")
    if r.status_code != 200:
        print(f"  Failed to fetch remote power blocks: {r.status_code}")
        return False
    
    resp = r.json()
    pb_list = resp.get("data", resp) if isinstance(resp, dict) else resp
    remote_pbs = {pb["name"]: pb["id"] for pb in pb_list}
    
    rows = db.execute("""
        SELECT l.id, pb.name as pb_name, l.name, l.identifier, l.x_position, l.y_position, l.notes
        FROM lbds l
        JOIN power_blocks pb ON l.power_block_id = pb.id
        ORDER BY l.id
    """).fetchall()
    
    created = 0
    failed = 0
    for i, row in enumerate(rows):
        local_id, pb_name, lbd_name, identifier, x_pos, y_pos, notes = row
        remote_pb_id = remote_pbs.get(pb_name)
        if not remote_pb_id:
            failed += 1
            continue
        
        payload = {
            "power_block_id": remote_pb_id,
            "name": lbd_name,
            "identifier": identifier or "",
            "x_position": x_pos,
            "y_position": y_pos,
            "notes": notes or "",
        }
        r = api("post", "/api/tracker/lbds", json=payload)
        if r.status_code in (200, 201):
            created += 1
        else:
            failed += 1
        
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(rows)} LBDs processed...")
    
    print(f"  Done: {created} created, {failed} failed")
    return True


def migrate_lbd_statuses(db):
    """Update LBD status completions."""
    print("Migrating LBD statuses (completed ones)...")
    
    # Only migrate completed statuses
    rows = db.execute("""
        SELECT l.name, pb.name as pb_name, s.status_type, s.is_completed, s.completed_by, s.notes
        FROM lbd_statuses s
        JOIN lbds l ON s.lbd_id = l.id
        JOIN power_blocks pb ON l.power_block_id = pb.id
        WHERE s.is_completed = 1
        ORDER BY s.id
    """).fetchall()
    
    if not rows:
        print("  No completed statuses to migrate")
        return True
    
    print(f"  {len(rows)} completed statuses to update...")
    
    # Get remote LBDs mapped by (pb_name, lbd_name) → lbd_id
    r = api("get", "/api/tracker/power-blocks")
    if r.status_code != 200:
        print(f"  Failed to fetch remote PBs: {r.status_code}")
        return False
    
    resp = r.json()
    remote_pbs = resp.get("data", resp) if isinstance(resp, dict) else resp
    lbd_map = {}  # (pb_name, lbd_name) → remote_lbd_id
    
    for pb in remote_pbs:
        # LBDs are included inline in each PB from the list endpoint
        for lbd in pb.get("lbds", []):
            lbd_map[(pb["name"], lbd["name"])] = lbd["id"]
        if not pb.get("lbds"):
            # Fetch individually if not inline
            r2 = api("get", f"/api/tracker/power-blocks/{pb['id']}")
            if r2.status_code == 200:
                pb_data = r2.json()
                if isinstance(pb_data, dict) and "data" in pb_data:
                    pb_data = pb_data["data"]
                for lbd in pb_data.get("lbds", []):
                    lbd_map[(pb["name"], lbd["name"])] = lbd["id"]
            time.sleep(0.05)
    
    updated = 0
    failed = 0
    for i, row in enumerate(rows):
        lbd_name, pb_name, status_type, is_completed, completed_by, notes = row
        remote_lbd_id = lbd_map.get((pb_name, lbd_name))
        if not remote_lbd_id:
            failed += 1
            continue
        
        payload = {"is_completed": True}
        if notes:
            payload["notes"] = notes
        
        r = api("put", f"/api/tracker/lbds/{remote_lbd_id}/status/{status_type}", json=payload)
        if r.status_code in (200, 201):
            updated += 1
        else:
            failed += 1
        
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(rows)} statuses processed...")
    
    print(f"  Done: {updated} updated, {failed} failed")
    return True


def migrate_site_areas(db, remote_map_id):
    """Create site areas (PB positions on the map)."""
    print("Migrating site areas (PB positions on map)...")
    
    # Get remote power blocks name→id mapping
    r = api("get", "/api/tracker/power-blocks")
    if r.status_code != 200:
        print(f"  Failed to fetch remote PBs: {r.status_code}")
        return False
    resp = r.json()
    pb_list = resp.get("data", resp) if isinstance(resp, dict) else resp
    remote_pbs = {pb["name"]: pb["id"] for pb in pb_list}
    
    rows = db.execute("""
        SELECT sa.id, sa.power_block_id, pb.name as pb_name, sa.name,
               sa.bbox_x, sa.bbox_y, sa.bbox_w, sa.bbox_h,
               sa.polygon_points, sa.label_font_size
        FROM site_areas sa
        LEFT JOIN power_blocks pb ON sa.power_block_id = pb.id
        ORDER BY sa.id
    """).fetchall()
    
    created = 0
    failed = 0
    for row in rows:
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
        
        r = api("post", "/api/map/area", json=payload)
        if r.status_code in (200, 201):
            created += 1
        else:
            failed += 1
    
    print(f"  Done: {created} created, {failed} failed")
    return True


def main():
    print("=" * 60)
    print("  LBD Tracker: Local → Railway Migration")
    print("=" * 60)
    print()
    
    if not os.path.exists(LOCAL_DB):
        print(f"ERROR: Local DB not found: {LOCAL_DB}")
        sys.exit(1)
    
    if not check_connection():
        sys.exit(1)
    
    if not login_admin():
        sys.exit(1)
    
    db = sqlite3.connect(LOCAL_DB)
    
    try:
        # 1. Upload map
        remote_map_id = upload_map()
        if not remote_map_id:
            print("WARN: Map upload failed, continuing without map...")
            remote_map_id = 1
        
        # 2. Admin settings (colors, custom columns)
        migrate_admin_settings(db)
        
        # 3. Power blocks
        migrate_power_blocks(db)
        
        # 4. LBDs
        migrate_lbds(db)
        
        # 5. LBD statuses (completed ones)
        migrate_lbd_statuses(db)
        
        # 6. Site areas (PB positions on map)
        migrate_site_areas(db, remote_map_id)
        
        print()
        print("=" * 60)
        print("  Migration complete!")
        print(f"  Visit: {RAILWAY_URL}")
        print("=" * 60)
    
    finally:
        db.close()


if __name__ == "__main__":
    main()
