"""
FRED API Service — Federal Reserve Economic Data
Series MORTGAGE30US: weekly 30-yr fixed published by Freddie Mac.
Docs: https://fred.stlouisfed.org/docs/api/fred/

OPTIMIZATIONS:
  - In-process TTL cache (1 hour) — FRED data is weekly, no need to re-fetch
  - Single shared httpx.AsyncClient (connection pooling)
  - Timeout reduced to 6s (FRED is fast)
"""

import time
import httpx
from datetime import datetime, timedelta
from backend.config import FRED_API_KEY, DEMO_MODE
from backend.services.mock_data import mock_mortgage_rate

FRED_BASE = "https://api.stlouisfed.org/fred"

# ── Shared client (connection pooling) ───────────────────────
_client: httpx.AsyncClient | None = None

def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=6.0)
    return _client

# ── Simple TTL cache ──────────────────────────────────────────
_rate_cache:    tuple[float, float] | None = None   # (timestamp, rate)
_history_cache: dict[int, tuple[float, list]]  = {}  # months -> (timestamp, data)
RATE_TTL     = 3600   # 1 hour — FRED data is weekly
HISTORY_TTL  = 3600


class FREDService:

    async def get_30yr_rate(self) -> float:
        global _rate_cache

        # Return cached value if fresh
        if _rate_cache and (time.time() - _rate_cache[0]) < RATE_TTL:
            return _rate_cache[1]

        if DEMO_MODE or not FRED_API_KEY:
            return mock_mortgage_rate()

        end_date   = datetime.today().strftime("%Y-%m-%d")
        start_date = (datetime.today() - timedelta(days=14)).strftime("%Y-%m-%d")
        params = {
            "series_id":         "MORTGAGE30US",
            "api_key":           FRED_API_KEY,
            "file_type":         "json",
            "observation_start": start_date,
            "observation_end":   end_date,
            "sort_order":        "desc",
            "limit":             1,
        }
        try:
            resp = await _get_client().get(f"{FRED_BASE}/series/observations", params=params)
            resp.raise_for_status()
            observations = resp.json().get("observations", [])
            if observations:
                val = observations[0].get("value", ".")
                if val != ".":
                    rate = float(val)
                    _rate_cache = (time.time(), rate)
                    return rate
        except Exception:
            pass

        rate = mock_mortgage_rate()
        _rate_cache = (time.time(), rate)
        return rate

    async def get_rate_history(self, months: int = 12) -> list[dict]:
        # Check cache
        if months in _history_cache:
            ts, data = _history_cache[months]
            if (time.time() - ts) < HISTORY_TTL:
                return data

        if DEMO_MODE or not FRED_API_KEY:
            return _mock_rate_history(months)

        start_date = (datetime.today() - timedelta(days=months * 30)).strftime("%Y-%m-%d")
        params = {
            "series_id":         "MORTGAGE30US",
            "api_key":           FRED_API_KEY,
            "file_type":         "json",
            "observation_start": start_date,
            "frequency":         "m",
            "aggregation_method":"avg",
        }
        try:
            resp = await _get_client().get(f"{FRED_BASE}/series/observations", params=params)
            resp.raise_for_status()
            result = [
                {"date": o["date"], "rate": float(o["value"])}
                for o in resp.json().get("observations", [])
                if o["value"] != "."
            ]
            _history_cache[months] = (time.time(), result)
            return result
        except Exception:
            return _mock_rate_history(months)


def _mock_rate_history(months: int) -> list[dict]:
    base  = 7.2
    today = datetime.today()
    return [
        {"date": (today - timedelta(days=i*30)).strftime("%Y-%m-%d"),
         "rate": round(base - (i*0.03) + (i%3)*0.05, 2)}
        for i in range(months, 0, -1)
    ]
