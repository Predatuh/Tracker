import sqlite3
db = sqlite3.connect('dist/LBDTracker_data/lbd_tracker.db')
c = db.cursor()
tables = c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
for t in tables:
    name = t[0]
    count = c.execute(f'SELECT COUNT(*) FROM [{name}]').fetchone()[0]
    print(f'{name}: {count} rows')

print('\n--- Site Maps ---')
for r in c.execute('SELECT id, name, file_path FROM site_maps').fetchall():
    print(r)

print('\n--- Power Blocks (first 5) ---')
for r in c.execute('SELECT id, name, power_block_number FROM power_blocks LIMIT 5').fetchall():
    print(r)

print('\n--- LBDs (first 5) ---')
for r in c.execute('SELECT id, power_block_id, name, identifier FROM lbds LIMIT 5').fetchall():
    print(r)

print('\n--- Site Areas (first 5) ---')
for r in c.execute('SELECT id, site_map_id, power_block_id, name, bbox_x, bbox_y, bbox_w, bbox_h FROM site_areas LIMIT 5').fetchall():
    print(r)

print('\n--- Users ---')
for r in c.execute('SELECT id, name, username, is_admin, role FROM users').fetchall():
    print(r)

print('\n--- Workers ---')
for r in c.execute('SELECT id, name, is_active FROM workers').fetchall():
    print(r)

print('\n--- Admin Settings ---')
for r in c.execute('SELECT id, key, value FROM admin_settings').fetchall():
    print(r)

db.close()
