import psycopg2
from ops_env import get_db_url

conn = psycopg2.connect(get_db_url())
cur = conn.cursor()
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
for row in cur.fetchall():
    cur2 = conn.cursor()
    cur2.execute(f"SELECT COUNT(*) FROM \"{row[0]}\"")
    count = cur2.fetchone()[0]
    print(f"  {row[0]}: {count} rows")
    cur2.close()
cur.close()
conn.close()
