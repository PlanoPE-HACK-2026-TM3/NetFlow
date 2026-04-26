"""
RentCast API Service — with DEMO_MODE fallback
Docs: https://developers.rentcast.io/reference

OPTIMIZATIONS:
  1. Shared httpx.AsyncClient across all calls (connection pooling)
  2. Rent estimates fetched in parallel with asyncio.gather (was sequential)
  3. Listings limited to 10 (not 20) — only top 10 shown in UI
  4. Per-ZIP market stats cache (15 min TTL)
  5. Rent estimate cache keyed by beds/baths/zip (avoids duplicate calls)
  6. Timeout 12s → 8s (fail fast, mock fallback)
"""

import asyncio
import time
import httpx
from backend.config import RENTCAST_API_KEY, DEMO_MODE
from backend.services.mock_data import mock_listings, mock_rent_estimate, mock_market_stats

RENTCAST_BASE = "https://api.rentcast.io/v1"

_HEADERS = {
    "accept":    "application/json",
    "X-Api-Key": RENTCAST_API_KEY,
}

_TYPE_MAP = {
    "SFH":       "Single Family",
    "Multi":     "Multi Family",
    "Condo":     "Condo",
    "Townhouse": "Townhouse",
}

# ── Shared client ─────────────────────────────────────────────
_client: httpx.AsyncClient | None = None

def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=8.0)
    return _client

# ── Simple caches ─────────────────────────────────────────────
_rent_cache:   dict[str, tuple[float, int]]  = {}  # key -> (ts, rent)
_market_cache: dict[str, tuple[float, dict]] = {}  # zip -> (ts, stats)
RENT_TTL   = 900    # 15 min
MARKET_TTL = 900    # 15 min


async def _get(path: str, params: dict) -> dict:
    resp = await _get_client().get(
        f"{RENTCAST_BASE}{path}", headers=_HEADERS, params=params
    )
    resp.raise_for_status()
    return resp.json()


class RentCastService:

    async def search_listings(
        self,
        zip_code:      str,
        max_price:     int,
        property_type: str = "SFH",
        min_beds:      int = 3,
        limit:         int = 10,       # ← reduced from 20 to 10
    ) -> list[dict]:

        if DEMO_MODE or not RENTCAST_API_KEY:
            return mock_listings(zip_code, max_price, property_type, min_beds, limit)

        params = {
            "zipCode":      zip_code,
            "maxPrice":     max_price,
            "propertyType": _TYPE_MAP.get(property_type, property_type),
            "minBedrooms":  min_beds,
            "status":       "Active",
            "limit":        limit,
        }
        try:
            data = await _get("/listings/sale", params)
            return [
                {
                    "address":       item.get("formattedAddress", ""),
                    "zip_code":      zip_code,
                    "price":         item.get("price", 0),
                    "beds":          item.get("bedrooms", 0),
                    "baths":         item.get("bathrooms", 0),
                    "sqft":          item.get("squareFootage", 0),
                    "dom":           item.get("daysOnMarket", 0),
                    "property_type": item.get("propertyType", ""),
                    "year_built":    item.get("yearBuilt"),
                    "rentcast_id":   item.get("id"),
                }
                for item in data.get("data", [])
            ]
        except Exception:
            return mock_listings(zip_code, max_price, property_type, min_beds, limit)

    async def get_rent_estimate(
        self,
        address:  str,
        zip_code: str,
        beds:     int,
        baths:    float,
        price:    int = 0,
    ) -> int:
        if DEMO_MODE or not RENTCAST_API_KEY:
            return mock_rent_estimate(price, beds, baths)

        # Cache key — address-level granularity
        cache_key = f"{address}|{zip_code}|{beds}|{baths}"
        if cache_key in _rent_cache:
            ts, val = _rent_cache[cache_key]
            if (time.time() - ts) < RENT_TTL:
                return val

        try:
            data = await _get(
                "/avm/rent/long-term",
                {"address": address, "zipCode": zip_code,
                 "bedrooms": beds, "bathrooms": baths},
            )
            rent = int(data.get("rent", 0)) or mock_rent_estimate(price, beds, baths)
        except Exception:
            rent = mock_rent_estimate(price, beds, baths)

        _rent_cache[cache_key] = (time.time(), rent)
        return rent

    async def get_rent_estimates_parallel(
        self,
        listings:  list[dict],
        zip_code:  str,
    ) -> list[int]:
        """
        Fetch all rent estimates concurrently instead of sequentially.
        This is the primary latency fix — was N serial API calls, now 1 round-trip.
        """
        tasks = [
            self.get_rent_estimate(
                address=l["address"],
                zip_code=zip_code,
                beds=l["beds"],
                baths=l["baths"],
                price=l["price"],
            )
            for l in listings
        ]
        return await asyncio.gather(*tasks)

    async def get_market_stats(self, zip_code: str) -> dict:
        if cache_key := zip_code:
            if cache_key in _market_cache:
                ts, data = _market_cache[cache_key]
                if (time.time() - ts) < MARKET_TTL:
                    return data

        if DEMO_MODE or not RENTCAST_API_KEY:
            return mock_market_stats(zip_code)

        try:
            data = await _get("/markets", {"zipCode": zip_code})
            result = {
                "median_rent":         data.get("averageRent"),
                "avg_days_on_market":  data.get("averageDaysOnMarket"),
                "vacancy_rate":        data.get("vacancyRate"),
                "rent_growth_yoy":     data.get("rentGrowth"),
            }
        except Exception:
            result = mock_market_stats(zip_code)

        _market_cache[zip_code] = (time.time(), result)
        return result
