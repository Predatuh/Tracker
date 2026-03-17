"""
Direct SQLite → PostgreSQL migration (bypasses the web API entirely).
Reads from local SQLite, writes directly into Railway PostgreSQL.
"""
import importlib
import ssl
import sqlite3
import os
from urllib.parse import parse_qs, unquote, urlparse
from ops_env import get_db_url


def load_postgres_driver():
    try:
        pg8000 = importlib.import_module("pg8000.dbapi")
        return "pg8000", pg8000
    except ImportError:
        try:
            psycopg2 = importlib.import_module("psycopg2")
            return "psycopg2", psycopg2
        except ImportError as exc:
            raise SystemExit(
                "A PostgreSQL driver is required for direct migration. "
                "Install pg8000 or psycopg2 in the active environment."
            ) from exc


def connect_postgres(driver_name, driver_module, url):
    if driver_name == "pg8000":
        parsed = urlparse(url.replace("postgres://", "postgresql://", 1))
        query = parse_qs(parsed.query)
        connect_kwargs = {
            "user": unquote(parsed.username or ""),
            "password": unquote(parsed.password or ""),
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 5432,
            "database": unquote((parsed.path or "/").lstrip("/")),
        }
        sslmode = (query.get("sslmode", [""])[0] or "").lower()
        if sslmode and sslmode != "disable":
            connect_kwargs["ssl_context"] = ssl.create_default_context()
        return driver_module.connect(**connect_kwargs)
    return driver_module.connect(url)


def execute_many(driver_name, driver_module, cur, sql, rows, page_size=200):
    if driver_name == "pg8000":
        sql_parts = sql.split("VALUES", 1)
        if len(sql_parts) != 2:
            raise ValueError("pg8000 bulk insert requires an INSERT ... VALUES statement")
        prefix = sql_parts[0].rstrip()
        value_template = sql_parts[1].strip().rstrip(';')
        for start in range(0, len(rows), page_size):
            chunk = rows[start:start + page_size]
            statement = f"{prefix} VALUES {', '.join([value_template] * len(chunk))}"
            params = []
            for row in chunk:
                params.extend(row)
            cur.execute(statement, tuple(params))
        return
    extras = importlib.import_module("psycopg2.extras")
    extras.execute_batch(cur, sql, rows, page_size=page_size)


def binary_value(driver_name, driver_module, payload):
    if payload is None or driver_name == "pg8000":
        return payload
    return driver_module.Binary(payload)


def build_lbd_mapping(cur, local_rows, local_to_remote_pb):
    cur.execute("SELECT id, power_block_id, name FROM lbds ORDER BY id")
    remote_lbds = cur.fetchall()
    remote_lbd_lookup = {}
    for remote_id, remote_pb_id, remote_name in remote_lbds:
        remote_lbd_lookup[(remote_pb_id, remote_name)] = remote_id

    local_to_remote_lbd = {}
    for row in local_rows:
        remote_pb_id = local_to_remote_pb.get(row['power_block_id'])
        if not remote_pb_id:
            continue
        remote_lbd_id = remote_lbd_lookup.get((remote_pb_id, row['name']))
        if remote_lbd_id:
            local_to_remote_lbd[row['id']] = remote_lbd_id
    return local_to_remote_lbd

LOCAL_DB = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "lbd_tracker.db")
MAP_FILE = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "uploads", "maps",
                        "map_Gemini_Generated_Image_l30ce4l30ce4l30c.png")



def main():
    pg_url = get_db_url()
    driver_name, driver_module = load_postgres_driver()
    local = None
    pg = None
    cur = None

    try:
        print("Connecting...")
        local = sqlite3.connect(LOCAL_DB)
        local.row_factory = sqlite3.Row
        pg = connect_postgres(driver_name, driver_module, pg_url)
        pg.autocommit = False
        cur = pg.cursor()

        cur.execute("SELECT COUNT(*) FROM power_blocks")
        existing_pbs = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM lbds")
        existing_lbds = cur.fetchone()[0]
        print(f"Existing in PostgreSQL: {existing_pbs} PBs, {existing_lbds} LBDs")

        if existing_lbds > 0 and existing_lbds != 2350:
            print("Unexpected LBD count. Clearing dependent tables...")
            cur.execute("DELETE FROM lbd_statuses")
            cur.execute("DELETE FROM site_areas")
            cur.execute("DELETE FROM lbds")
            cur.execute("DELETE FROM site_maps")
            pg.commit()
            print("  Cleared LBDs, statuses, areas, maps.")
            existing_lbds = 0

        print("\n1. Admin settings...")
        rows = local.execute("SELECT key, value FROM admin_settings").fetchall()
        for row in rows:
            cur.execute("SELECT COUNT(*) FROM admin_settings WHERE key = %s", (row['key'],))
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO admin_settings (key, value) VALUES (%s, %s)", (row['key'], row['value']))
            else:
                cur.execute("UPDATE admin_settings SET value = %s WHERE key = %s", (row['value'], row['key']))
        pg.commit()
        print(f"   {len(rows)} settings migrated")

        print("\n2. Power blocks...")
        rows = local.execute("SELECT id, name, power_block_number, description, page_number, claimed_by FROM power_blocks ORDER BY id").fetchall()
        local_to_remote_pb = {}

        cur.execute("SELECT id, name FROM power_blocks")
        existing = {name: pid for pid, name in cur.fetchall()}

        for row in rows:
            if row['name'] in existing:
                local_to_remote_pb[row['id']] = existing[row['name']]
            else:
                cur.execute("""
                    INSERT INTO power_blocks (name, power_block_number, description, page_number, claimed_by)
                    VALUES (%s, %s, %s, %s, %s) RETURNING id
                """, (row['name'], row['power_block_number'], row['description'], row['page_number'], row['claimed_by']))
                remote_id = cur.fetchone()[0]
                local_to_remote_pb[row['id']] = remote_id
        pg.commit()
        print(f"   {len(rows)} power blocks mapped ({len(existing)} existed, {len(rows) - len(existing)} new)")

        print("\n3. LBDs...")
        rows = local.execute("SELECT id, power_block_id, name, identifier, x_position, y_position, notes FROM lbds ORDER BY id").fetchall()
        local_to_remote_lbd = {}

        if existing_lbds == 2350:
            print("   2350 LBDs already exist, building ID mapping...")
            local_to_remote_lbd = build_lbd_mapping(cur, rows, local_to_remote_pb)
            print(f"   Mapped {len(local_to_remote_lbd)} LBDs")
        else:
            batch = []
            for row in rows:
                remote_pb_id = local_to_remote_pb.get(row['power_block_id'])
                if not remote_pb_id:
                    continue
                name = (row['name'] or '').encode('utf-8', errors='replace').decode('utf-8')
                identifier = (row['identifier'] or '').encode('utf-8', errors='replace').decode('utf-8')
                notes = (row['notes'] or '').encode('utf-8', errors='replace').decode('utf-8')
                batch.append((remote_pb_id, name, identifier, row['x_position'], row['y_position'], notes))

            print(f"   Inserting {len(batch)} LBDs in batch...")
            execute_many(driver_name, driver_module, cur, """
                INSERT INTO lbds (power_block_id, name, identifier, x_position, y_position, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, batch, page_size=200)
            pg.commit()
            local_to_remote_lbd = build_lbd_mapping(cur, rows, local_to_remote_pb)
            print(f"   {len(local_to_remote_lbd)} LBDs migrated")

        print("\n4. LBD statuses...")
        pg.close()
        pg = connect_postgres(driver_name, driver_module, pg_url)
        pg.autocommit = False
        cur = pg.cursor()

        cur.execute("SELECT COUNT(*) FROM lbd_statuses")
        existing_statuses = cur.fetchone()[0]
        if existing_statuses >= 3193:
            print(f"   {existing_statuses} statuses already migrated, skipping...")
        elif existing_statuses > 0:
            print(f"   {existing_statuses} statuses already exist, clearing...")
            cur.execute("DELETE FROM lbd_statuses")
            pg.commit()
            existing_statuses = 0

        if existing_statuses < 3193:
            rows = local.execute("SELECT id, lbd_id, status_type, is_completed, completed_at, completed_by, notes FROM lbd_statuses ORDER BY id").fetchall()
            batch = []
            for row in rows:
                remote_lbd_id = local_to_remote_lbd.get(row['lbd_id'])
                if not remote_lbd_id:
                    continue
                notes_val = (row['notes'] or '').encode('utf-8', errors='replace').decode('utf-8') if row['notes'] else row['notes']
                batch.append((remote_lbd_id, row['status_type'], bool(row['is_completed']), row['completed_at'], row['completed_by'], notes_val))

            print(f"   Inserting {len(batch)} statuses in batch...")
            execute_many(driver_name, driver_module, cur, """
                INSERT INTO lbd_statuses (lbd_id, status_type, is_completed, completed_at, completed_by, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, batch, page_size=200)
            pg.commit()
            print(f"   {len(batch)} statuses migrated")

        print("\n5. Site map...")
        pg.close()
        pg = connect_postgres(driver_name, driver_module, pg_url)
        pg.autocommit = False
        cur = pg.cursor()
        image_data = None
        image_mime = None
        if os.path.exists(MAP_FILE):
            with open(MAP_FILE, 'rb') as file_obj:
                image_data = file_obj.read()
            image_mime = 'image/png'
            print(f"   Map file: {len(image_data)} bytes")

        map_rows = local.execute("SELECT id, name, file_path FROM site_maps ORDER BY id").fetchall()
        local_to_remote_map = {}
        for row in map_rows:
            cur.execute("""
                INSERT INTO site_maps (name, file_path, image_data, image_mime)
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (row['name'], row['file_path'],
                  binary_value(driver_name, driver_module, image_data), image_mime))
            remote_id = cur.fetchone()[0]
            local_to_remote_map[row['id']] = remote_id
        pg.commit()
        print(f"   {len(map_rows)} maps migrated")

        print("\n6. Site areas...")
        rows = local.execute("SELECT id, site_map_id, power_block_id, name, bbox_x, bbox_y, bbox_w, bbox_h, polygon_points, label_font_size FROM site_areas ORDER BY id").fetchall()
        count = 0
        for row in rows:
            remote_map_id = local_to_remote_map.get(row['site_map_id'], 1)
            remote_pb_id = local_to_remote_pb.get(row['power_block_id']) if row['power_block_id'] else None
            cur.execute("""
                INSERT INTO site_areas (site_map_id, power_block_id, name, bbox_x, bbox_y, bbox_w, bbox_h, polygon_points, label_font_size)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (remote_map_id, remote_pb_id, row['name'], row['bbox_x'], row['bbox_y'],
                  row['bbox_w'], row['bbox_h'], row['polygon_points'], row['label_font_size']))
            count += 1
        pg.commit()
        print(f"   {count} site areas migrated")

        print("\n" + "=" * 50)
        print("FINAL COUNTS:")
        for table in ['power_blocks', 'lbds', 'lbd_statuses', 'site_maps', 'site_areas', 'admin_settings']:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"   {table}: {cur.fetchone()[0]}")
        print("=" * 50)
        print("Migration complete!")
    finally:
        if cur is not None:
            cur.close()
        if pg is not None:
            pg.close()
        if local is not None:
            local.close()


if __name__ == '__main__':
    main()
