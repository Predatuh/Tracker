import requests
from ops_env import login_session

s, base_url = login_session()
r = s.get(f'{base_url}/api/tracker/power-blocks')
d = r.json()
pbs = d.get('data', [])
print(f'PBs: {len(pbs)}')
if pbs:
    print(f'First PB: {pbs[0]["name"]} id={pbs[0]["id"]}')
r2 = s.get(f'{base_url}/api/pdf/get-map')
print(f'Map: {r2.json()}')
