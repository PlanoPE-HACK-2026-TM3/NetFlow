import re

import httpx

from app.schemas import PropertyOut
from app.services.local_listings import search_local_listings


class PropertySearchProviderError(RuntimeError):
    pass


def _demo_properties(location: str, limit: int) -> list[PropertyOut]:
    city = location.split(",")[0].strip().title()
    state_match = re.search(r",\s*([A-Za-z]{2})\b", location)
    state = state_match.group(1).upper() if state_match else "NA"
    zip_match = re.search(r"\b(\d{5})(?:-\d{4})?\b", location)
    zip_code = zip_match.group(1) if zip_match else None
    return [
        PropertyOut(
            property_id=f"demo-{i}",
            address=f"{120 + i} Market St",
            city=city or "Unknown",
            state=state,
            zip=zip_code,
            price=650000 + i * 25000,
            beds=2 + (i % 3),
            baths=2,
            sqft=980 + i * 35,
            listing_url="https://example.com/listing/demo",
            description="Demo listing used when HomeHarvest is unavailable.",
            source="demo",
        )
        for i in range(limit)
    ]


def _normalize_location(location: str) -> str:
    normalized = location.strip()
    zip_match = re.fullmatch(r"\d{5}(?:-\d{4})?", normalized)
    if zip_match:
        try:
            response = httpx.get(f"https://api.zippopotam.us/us/{normalized[:5]}", timeout=10)
            response.raise_for_status()
            payload = response.json()
            place = (payload.get("places") or [{}])[0]
            city = place.get("place name")
            state = place.get("state abbreviation")
            if city and state:
                return f"{city}, {state} {normalized[:5]}"
        except Exception:
            return normalized[:5]
    return normalized


def search_properties(location: str, limit: int = 10, allow_demo: bool = False) -> list[PropertyOut]:
    normalized_location = _normalize_location(location)
    provider_errors: list[str] = []

    # Free/local-first mode: search local listings cache before network scraping.
    local_items = search_local_listings(normalized_location, limit=limit)
    if local_items:
        return local_items
    provider_errors.append("Local dataset returned no listings")

    try:
        from homeharvest import scrape_property

        raw = scrape_property(location=normalized_location, listing_type="for_sale", past_days=30)
        items = []
        for idx, row in raw.head(limit).iterrows():
            price = float(row.get("list_price") or 0)
            if price <= 0:
                continue
            items.append(
                PropertyOut(
                    property_id=str(row.get("property_url") or f"hh-{idx}"),
                    address=str(row.get("street") or "Unknown address"),
                    city=str(row.get("city") or "Unknown"),
                    state=str(row.get("state") or ""),
                    zip=str(row.get("zip_code") or ""),
                    price=price,
                    beds=float(row.get("beds") or 0),
                    baths=float(row.get("full_baths") or 0),
                    sqft=int(row.get("sqft") or 0),
                    listing_url=str(row.get("property_url") or ""),
                    description=str(row.get("description") or ""),
                )
            )
        if items:
            return items
        if not allow_demo:
            detail = "; ".join(provider_errors) if provider_errors else ""
            raise PropertySearchProviderError(
                f"No real property listings were returned for '{normalized_location}'. "
                "ZIP parsing succeeded, but the upstream listing provider returned no usable results. "
                f"{detail}".strip()
            )
        return _demo_properties(normalized_location, limit)
    except Exception as exc:
        if isinstance(exc, PropertySearchProviderError):
            raise exc
        # JSONDecodeError means Realtor.com returned empty/HTML (anti-bot block) — treat same as 403
        exc_type = type(exc).__name__
        exc_str = str(exc)
        is_blocked = (
            "403" in exc_str
            or "JSONDecodeError" in exc_type
            or "RetryError" in exc_type
            or "JSONDecodeError" in exc_str
        )
        provider_errors.append(f"HomeHarvest: {exc_type}: {exc_str[:120]}")
        if not allow_demo:
            detail = "; ".join(provider_errors)
            if is_blocked:
                raise PropertySearchProviderError(
                    f"Real property provider blocked for '{normalized_location}': {detail}"
                ) from exc
            raise PropertySearchProviderError(
                f"Real property provider failed for '{normalized_location}': {detail}"
            ) from exc
        return _demo_properties(normalized_location, limit)
