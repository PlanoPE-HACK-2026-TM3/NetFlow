"""
NetFlow — Mock data generator
Used when RENTCAST_API_KEY / FRED_API_KEY are not set.
Generates realistic-looking property listings seeded from zip_code
so same zip always returns the same results.
"""

import hashlib
import random
from typing import Any


# Extended street name pool — 30 names so we always have 10+ unique addresses
STREET_NAMES = [
    "Maple Ridge Dr", "Oak Hollow Ln", "Prairie Wind Blvd", "Cedar Creek Ct",
    "Sunset Valley Rd", "Elm Crossing St", "Blue Bonnet Way", "Heritage Oak Dr",
    "Stone Bridge Ln", "Willow Run Ct", "Timber Creek Dr", "Fox Hollow Ln",
    "Pecan Grove Blvd", "Spring Meadow Ct", "Creekside Rd", "Valley Ranch Pkwy",
    "Autumn Breeze Dr", "Lakeside Cir", "Ridge Point Ln", "Canyon Falls Dr",
    "Windmill Ranch Rd", "Longhorn Trail", "Bluebonnet Blvd", "Mockingbird Ln",
    "Shady Brook Ct", "Sunflower Way", "Iron Horse Pkwy", "Clear Creek Dr",
    "Saddlebrook Ln", "Twin Oaks Dr",
]

PROPERTY_TYPES = {
    "SFH": "Single Family",
    "Multi": "Multi-Family",
    "Condo": "Condo",
    "Townhouse": "Townhouse",
}


def _seed(zip_code: str) -> random.Random:
    """Deterministic RNG seeded from zip so same zip → same results."""
    seed = int(hashlib.md5(zip_code.encode()).hexdigest()[:8], 16)
    return random.Random(seed)


def mock_listings(
    zip_code: str,
    max_price: int,
    property_type: str = "SFH",
    min_beds: int = 3,
    limit: int = 10,
) -> list[dict[str, Any]]:
    rng = _seed(zip_code)
    listings = []
    # Use all 30 street names as a pool, shuffle deterministically
    streets = STREET_NAMES.copy()
    rng.shuffle(streets)

    count = 0
    for i, street in enumerate(streets):
        if count >= limit:
            break
        beds  = rng.randint(max(min_beds, 2), min(min_beds + 2, 6))
        baths = rng.choice([1.0, 1.5, 2.0, 2.5, 3.0])
        sqft  = rng.randint(1100, 3600)
        price = int(rng.uniform(max_price * 0.52, max_price * 0.97) // 1000 * 1000)
        dom   = rng.randint(3, 65)
        year  = rng.randint(1980, 2023)
        lot   = rng.randint(4500, 15000)
        house_num = rng.randint(1000, 9999)
        listings.append({
            "address":       f"{house_num} {street}",
            "zip_code":      zip_code,
            "price":         price,
            "beds":          beds,
            "baths":         baths,
            "sqft":          sqft,
            "dom":           dom,
            "property_type": PROPERTY_TYPES.get(property_type, "Single Family"),
            "year_built":    year,
            "lot_size":      lot,
            "rentcast_id":   f"MOCK-{zip_code}-{i:03d}",
        })
        count += 1
    return listings


def mock_rent_estimate(price: int, beds: int, baths: float) -> int:
    """Rough rent: ~0.50-0.65% of purchase price per month."""
    base         = price * _rng_val(price)
    bedroom_bump = (beds - 2) * 130
    bath_bump    = int(baths * 65)
    return max(900, int((base + bedroom_bump + bath_bump) // 10 * 10))


def _rng_val(seed_val: int) -> float:
    return 0.005 + (seed_val % 1000) / 1_000_000 * 1500


def mock_market_stats(zip_code: str) -> dict[str, Any]:
    rng = _seed(zip_code)
    return {
        "median_rent":        rng.randint(1600, 2800),
        "avg_days_on_market": rng.randint(12, 45),
        "vacancy_rate":       round(rng.uniform(2.5, 7.0), 1),
        "rent_growth_yoy":    round(rng.uniform(1.5, 6.5), 1),
    }


def mock_mortgage_rate() -> float:
    return 7.2
