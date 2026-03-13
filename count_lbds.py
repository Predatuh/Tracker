"""Count LBDs on Railway and find duplicates."""
import requests
from ops_env import login_session

s, RAILWAY_URL = login_session()

r = s.get(f"{RAILWAY_URL}/api/tracker/power-blocks")
pbs = r.json().get("data", [])

total = 0
dupes_total = 0
for pb in pbs:
    r2 = s.get(f"{RAILWAY_URL}/api/lbd/power-block/{pb['id']}/lbds")
    lbds = r2.json().get("lbds", [])
    
    # Check for duplicate names within this PB
    names = [l["name"] for l in lbds]
    seen = {}
    for name in names:
        seen[name] = seen.get(name, 0) + 1
    dupes = {n: c for n, c in seen.items() if c > 1}
    if dupes:
        dupes_total += sum(c - 1 for c in dupes.values())
        print(f"  PB '{pb['name']}': {len(lbds)} LBDs, DUPES: {dupes}")
    
    total += len(lbds)

print(f"\nTotal LBDs: {total}")
print(f"Total duplicates: {dupes_total}")
print(f"Expected after cleanup: {total - dupes_total}")
