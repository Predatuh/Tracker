import psycopg2
from ops_env import get_db_url

conn = psycopg2.connect(get_db_url())
cur = conn.cursor()

# Check all schemas
cur.execute("SELECT schema_name FROM information_schema.schemata")
print("Schemas:", [r[0] for r in cur.fetchall()])

# Check ALL tables regardless of schema
cur.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE'")
for row in cur.fetchall():
    print(f"  {row[0]}.{row[1]}")

# Also try pg_tables
cur.execute("SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
print("\npg_tables:")
for row in cur.fetchall():
    print(f"  {row[0]}.{row[1]}")

cur.close()
conn.close()
