"""Find problematic LBD rows in local SQLite."""
import sqlite3
import os

LOCAL_DB = os.path.join(os.path.dirname(__file__), "dist", "LBDTracker_data", "lbd_tracker.db")
local = sqlite3.connect(LOCAL_DB)
local.row_factory = sqlite3.Row

rows = local.execute("SELECT id, power_block_id, name, identifier, x_position, y_position, notes FROM lbds ORDER BY id").fetchall()

for i, row in enumerate(rows):
    for field in ['name', 'identifier', 'notes']:
        val = row[field]
        if val is not None:
            if not isinstance(val, str):
                print(f"  Row {row['id']} field '{field}' is type {type(val)}: {repr(val)[:100]}")
            else:
                try:
                    val.encode('utf-8')
                except Exception as e:
                    print(f"  Row {row['id']} field '{field}' encoding error: {e}")
                if '\x00' in val:
                    print(f"  Row {row['id']} field '{field}' contains null byte")

print(f"Checked {len(rows)} rows")
local.close()
