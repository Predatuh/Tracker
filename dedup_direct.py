"""Connect directly to Railway PostgreSQL and remove duplicate LBDs."""
import psycopg2
from ops_env import get_db_url

DB_URL = get_db_url()

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# Count before
cur.execute("SELECT COUNT(*) FROM lbds")
before = cur.fetchone()[0]
print(f"LBDs before: {before}")

# Find and delete duplicates - keep the row with the lowest id for each (power_block_id, name) pair
cur.execute("""
    DELETE FROM lbd_statuses
    WHERE lbd_id IN (
        SELECT id FROM lbds
        WHERE id NOT IN (
            SELECT MIN(id) FROM lbds GROUP BY power_block_id, name
        )
    )
""")
deleted_statuses = cur.rowcount
print(f"Deleted {deleted_statuses} duplicate lbd_statuses")

cur.execute("""
    DELETE FROM lbds
    WHERE id NOT IN (
        SELECT MIN(id) FROM lbds GROUP BY power_block_id, name
    )
""")
deleted_lbds = cur.rowcount
print(f"Deleted {deleted_lbds} duplicate LBDs")

conn.commit()

# Count after
cur.execute("SELECT COUNT(*) FROM lbds")
after = cur.fetchone()[0]
print(f"LBDs after: {after}")

cur.close()
conn.close()
