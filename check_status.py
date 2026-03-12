import requests
s = requests.Session()
s.post('https://www.princesscoded.net/api/auth/login', json={'name':'Admin','pin':'9067'})
r = s.get('https://www.princesscoded.net/api/tracker/power-blocks')
d = r.json()
pbs = d.get('data', [])
print(f'PBs: {len(pbs)}')
if pbs:
    print(f'First PB: {pbs[0]["name"]} id={pbs[0]["id"]}')
r2 = s.get('https://www.princesscoded.net/api/pdf/get-map')
print(f'Map: {r2.json()}')
