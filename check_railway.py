import requests, json
s = requests.Session()
s.post('https://www.princesscoded.net/api/auth/login', json={'name':'Admin','pin':'9067'})
r = s.get('https://www.princesscoded.net/api/map/sitemaps')
d = r.json()
maps = d.get('data', d)
for m in maps:
    mid = m["id"]
    areas = len(m.get("areas", []))
    print(f"Map id={mid} areas={areas}")

# Check if map image is accessible
for m in maps:
    mid = m["id"]
    r2 = s.get(f'https://www.princesscoded.net/api/map/sitemap/{mid}')
    print(f"Map {mid} image: status={r2.status_code} content-type={r2.headers.get('content-type','?')[:40]}")

# Check how frontend loads the map
r3 = s.get('https://www.princesscoded.net/api/map/sitemaps')
d3 = r3.json()
maps3 = d3.get('data', d3)
if maps3:
    m = maps3[0]
    print(f"\nFirst map file_path: {m.get('file_path')}")
    print(f"First map name: {m.get('name')}")
    # Try accessing the file directly
    fp = m.get('file_path', '')
    if fp:
        # Try the uploads path
        fname = fp.split('/')[-1]
        r4 = s.get(f'https://www.princesscoded.net/uploads/maps/{fname}')
        print(f"Direct file access: {r4.status_code}")
