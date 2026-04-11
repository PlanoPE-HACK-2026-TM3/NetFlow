import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.chdir(os.path.dirname(os.path.dirname(__file__)))

from app.services.local_listings import search_local_listings, _load_rows
from app.services.properties import _normalize_location

for test in ["Frisco, TX", "75078", "Plano, TX", "Prosper, TX"]:
    norm = _normalize_location(test)
    results = search_local_listings(norm, limit=50)
    print(f"{test!r} -> normalized={norm!r} -> {len(results)} results")

rows = _load_rows()
print(f"\nTotal CSV rows: {len(rows)}")
r = rows[0] if rows else {}
print(f"First row keys: {list(r.keys())}")
print(f"First row sample: {r}")
