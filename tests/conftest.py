"""
Pytest configuration & shared fixtures for the NetFlow test suite.

Strategy
--------
- Tests run in DEMO_MODE so external APIs are never hit.
- We force DEMO_MODE before any backend module is imported. The services
  (rentcast.py, fred.py) read DEMO_MODE at import time, so the env var
  must be in place first — that's why we set it in this conftest, which
  pytest loads before any test module is collected.
- Each test that touches module-level state (caches, rate-limit buckets)
  resets it explicitly via fixtures below.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# ── 1. Force demo / no-key mode BEFORE any backend import ───────────
os.environ["DEMO_MODE"] = "true"
os.environ.setdefault("RENTCAST_API_KEY", "")
os.environ.setdefault("FRED_API_KEY", "")
os.environ.setdefault("LANGCHAIN_API_KEY", "")
os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")
os.environ.setdefault("OLLAMA_MODEL", "llama3")

# ── 2. Make repo root importable so `import backend.xxx` resolves ───
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402


# ──────────────────────────────────────────────────────────────────────
# Cache-reset fixtures
# ──────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_rentcast_caches():
    """Wipe RentCast in-process caches between tests so cache hits don't bleed."""
    yield
    try:
        from backend.services import rentcast
        rentcast._rent_cache.clear()
        rentcast._market_cache.clear()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _reset_fred_caches():
    """Wipe FRED rate cache between tests."""
    yield
    try:
        from backend.services import fred
        fred._rate_cache = None
        fred._history_cache.clear()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _reset_user_agent_state():
    """Reset rate-limit buckets between tests so timing isn't carried over."""
    yield
    try:
        from backend.agents import user_agent as ua
        ua._rate_buckets.clear()
        ua.user_agent._audit_log.clear()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _reset_agent_memory():
    """Clear MarketMemory / RiskCache / ConversationMemory between tests."""
    yield
    try:
        from backend.agents import netflow_agent as na
        na.MarketMemory._store.clear()
        na.RiskCache._store.clear()
        na.ConversationMemory._store.clear()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────
# Common test data
# ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_listing():
    """A typical listing dict shaped like RentCast/mock_data output."""
    return {
        "address":       "1234 Maple Ridge Dr",
        "zip_code":      "75070",
        "price":         350_000,
        "beds":          3,
        "baths":         2.0,
        "sqft":          1800,
        "dom":           21,
        "property_type": "Single Family",
        "year_built":    2005,
        "lot_size":      7500,
        "rentcast_id":   "MOCK-75070-001",
        "est_rent":      2400,
    }


@pytest.fixture
def sample_listings(sample_listing):
    """A small batch of listings — useful for batch-scoring tests."""
    out = []
    for i in range(3):
        l = dict(sample_listing)
        l["address"]  = f"{1000 + i} Oak Hollow Ln"
        l["price"]    = 300_000 + i * 25_000
        l["est_rent"] = 2200 + i * 100
        l["rentcast_id"] = f"MOCK-75070-{i:03d}"
        out.append(l)
    return out
