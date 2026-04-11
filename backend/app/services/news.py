from datetime import datetime

import httpx

from app.config import settings

NEWS_URL = "https://newsapi.org/v2/everything"


async def get_housing_news(limit: int = 5) -> dict:
    if not settings.news_api_key:
        now = datetime.utcnow().isoformat()
        return {
            "headlines": [
                {
                    "title": "Mortgage rates remain a key affordability driver",
                    "source": "demo",
                    "url": "https://example.com/mortgage-rates",
                    "published_at": now,
                },
                {
                    "title": "Housing inventory trends vary by metro",
                    "source": "demo",
                    "url": "https://example.com/housing-inventory",
                    "published_at": now,
                },
            ][:limit]
        }

    params = {
        "q": "real estate OR housing market OR mortgage",
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": max(1, min(limit, 20)),
        "apiKey": settings.news_api_key,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(NEWS_URL, params=params)
        response.raise_for_status()
        payload = response.json()

    headlines = []
    for article in payload.get("articles", []):
        headlines.append(
            {
                "title": article.get("title", "Untitled"),
                "source": (article.get("source") or {}).get("name", "unknown"),
                "url": article.get("url", ""),
                "published_at": article.get("publishedAt", ""),
            }
        )
    return {"headlines": headlines}
