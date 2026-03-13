"""Check what's already been migrated to PostgreSQL."""
import psycopg2
from ops_env import get_db_url

DB_URL = get_db_url()
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

tables = ['power_blocks', 'lbds', 'lbd_statuses', 'site_maps', 'site_areas', 'admin_settings', 'users']
for t in tables:
    cur.execute(f"SELECT COUNT(*) FROM {t}")
    print(f"  {t}: {cur.fetchone()[0]}")

cur.close()
conn.close()
