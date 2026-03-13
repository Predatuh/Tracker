import psycopg2
from ops_env import get_db_url

c = psycopg2.connect(get_db_url())
cur = c.cursor()
for table in ['site_maps', 'site_areas']:
    print(f"\n{table}:")
    cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' ORDER BY ordinal_position")
    for r in cur.fetchall():
        print(f"  {r[0]}: {r[1]}")
c.close()
