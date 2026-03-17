"""Check what the power-blocks API returns for tanner regarding visual state data."""
import requests

BASE = 'http://127.0.0.1:5000'
s = requests.Session()
r = s.post(f'{BASE}/api/auth/login', json={'name': 'tanner', 'pin': '1234'})
print('login:', r.status_code)

r = s.get(f'{BASE}/api/tracker/power-blocks')
pbs = r.json().get('data', [])
print(f'Total PBs: {len(pbs)}')

# Check visual state data for a few PBs
completed = 0
in_progress = 0
not_started = 0
for pb in pbs:
    summary = pb.get('lbd_summary', {})
    lbds = pb.get('lbds', [])
    total = pb.get('lbd_count', 0)
    
    # Check if all types are complete
    all_done = total > 0 and all(
        any(s.get('status_type') == 'term' and s.get('is_completed') for s in lbd.get('statuses', []))
        for lbd in lbds
    )
    
    has_any = any(summary.get(k, 0) > 0 for k in ['ground_brackets', 'stuff', 'term'])
    
    if all_done:
        completed += 1
    elif has_any:
        in_progress += 1
    else:
        not_started += 1

print(f'Completed: {completed}, In Progress: {in_progress}, Not Started: {not_started}')

# Show first few PBs with data
for pb in pbs[:3]:
    print(f'\nPB {pb["name"]} (id={pb["id"]}):')
    print(f'  lbd_count: {pb.get("lbd_count")}')
    print(f'  lbd_summary: {pb.get("lbd_summary")}')
    print(f'  lbds count: {len(pb.get("lbds", []))}')
    if pb.get('lbds'):
        lbd = pb['lbds'][0]
        print(f'  first lbd statuses: {lbd.get("statuses", [])}')

# Check a completed PB
for pb in pbs:
    summary = pb.get('lbd_summary', {})
    if summary.get('term', 0) > 0 and summary.get('term', 0) >= pb.get('lbd_count', 0):
        print(f'\nCompleted PB {pb["name"]}:')
        print(f'  lbd_count: {pb.get("lbd_count")}')
        print(f'  summary: {summary}')
        if pb.get('lbds'):
            print(f'  first lbd statuses: {pb["lbds"][0].get("statuses", [])}')
        break
