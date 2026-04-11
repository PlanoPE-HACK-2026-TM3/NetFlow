from __future__ import annotations

import csv
import re
from pathlib import Path

from app.config import settings
from app.schemas import PropertyOut


def _listings_path() -> Path:
    configured = Path(settings.local_listings_path)
    if configured.is_absolute():
        return configured
    backend_root = Path(__file__).resolve().parents[2]
    return backend_root / configured


def _safe_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _safe_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except Exception:
        return None


def _normalize_zip(text: str) -> str | None:
    match = re.search(r"\b(\d{5})(?:-\d{4})?\b", text)
    return match.group(1) if match else None


def _load_rows() -> list[dict[str, str]]:
    path = _listings_path()
    if not path.exists():
        return []
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Skip the None overflow key that DictReader creates when a row has
            # more columns than the header (e.g. unquoted commas in descriptions).
            rows.append({k: (str(v) if v is not None else "").strip() for k, v in row.items() if k is not None})
    return rows


def get_local_listings_stats() -> dict:
    path = _listings_path()
    rows = _load_rows()
    return {
        "path": str(path),
        "exists": path.exists(),
        "records": len(rows),
    }


def search_local_listings(location: str, limit: int = 10) -> list[PropertyOut]:
    location_lower = location.lower().strip()
    zip_code = _normalize_zip(location)

    matched: list[dict[str, str]] = []
    for row in _load_rows():
        row_zip = _normalize_zip(row.get("zip", ""))
        row_city = row.get("city", "").lower()
        row_state = row.get("state", "").lower()
        haystack = f"{row.get('address', '')} {row.get('city', '')} {row.get('state', '')} {row.get('zip', '')}".lower()

        zip_match = bool(zip_code and row_zip and row_zip == zip_code)
        text_match = location_lower in haystack or location_lower == row_city or location_lower == f"{row_city}, {row_state}"

        if zip_match or text_match:
            matched.append(row)

    items: list[PropertyOut] = []
    for idx, row in enumerate(matched[:limit]):
        price = _safe_float(row.get("price")) or 0
        if price <= 0:
            continue
        items.append(
            PropertyOut(
                property_id=row.get("property_id") or f"local-{idx}",
                address=row.get("address") or "Unknown address",
                city=row.get("city") or "Unknown",
                state=row.get("state") or "",
                zip=row.get("zip") or None,
                price=price,
                beds=_safe_float(row.get("beds")),
                baths=_safe_float(row.get("baths")),
                sqft=_safe_int(row.get("sqft")),
                listing_url=row.get("listing_url") or None,
                description=row.get("description") or None,
                source=row.get("source") or "local_dataset",
            )
        )

    return items
