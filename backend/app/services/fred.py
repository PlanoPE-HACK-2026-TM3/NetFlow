from datetime import datetime

import httpx

from app.config import settings

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"


async def get_mortgage_rate() -> dict:
    if not settings.fred_api_key:
        return {"series": "MORTGAGE30US", "value": 6.75, "date": datetime.utcnow().date().isoformat()}

    params = {
        "series_id": "MORTGAGE30US",
        "api_key": settings.fred_api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": 1,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(FRED_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    observation = payload.get("observations", [{}])[0]
    value = observation.get("value")
    date = observation.get("date")
    return {"series": "MORTGAGE30US", "value": float(value), "date": date}
