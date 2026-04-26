"""
Unit tests for backend/services/rentcast.py and backend/services/fred.py.

These services have a DEMO_MODE / no-API-key fallback path that is the
primary code path under test here — we exercise it via pytest-asyncio
without ever hitting a network. The "live" branch is intentionally not
tested here (would require a fixture HTTP server or VCR cassette).
"""

import asyncio
import time
import pytest

from backend.services.rentcast import RentCastService, RENT_TTL, MARKET_TTL
from backend.services.fred     import FREDService, RATE_TTL
from backend.services import rentcast as rc_mod
from backend.services import fred     as fred_mod


# ══════════════════════════════════════════════════════════════
# RentCastService — DEMO_MODE / no-key fallback
# ══════════════════════════════════════════════════════════════

class TestRentCastSearchListings:

    @pytest.mark.asyncio
    async def test_returns_mock_listings_in_demo_mode(self):
        svc = RentCastService()
        out = await svc.search_listings(
            zip_code="75070", max_price=450_000,
            property_type="SFH", min_beds=3, limit=5,
        )
        assert isinstance(out, list)
        assert len(out) == 5
        for listing in out:
            assert listing["zip_code"] == "75070"
            assert listing["price"]   <= 450_000
            assert listing["beds"]    >= 3

    @pytest.mark.asyncio
    async def test_deterministic_per_zip(self):
        svc = RentCastService()
        a = await svc.search_listings(zip_code="75070", max_price=450_000, limit=5)
        b = await svc.search_listings(zip_code="75070", max_price=450_000, limit=5)
        assert a == b


class TestRentCastRentEstimates:

    @pytest.mark.asyncio
    async def test_single_estimate_returns_int(self):
        svc = RentCastService()
        rent = await svc.get_rent_estimate(
            address="1 Test Ln", zip_code="75070",
            beds=3, baths=2.0, price=300_000,
        )
        assert isinstance(rent, int)
        assert rent > 0

    @pytest.mark.asyncio
    async def test_parallel_estimates(self):
        svc = RentCastService()
        listings = [
            {"address": f"{i} Test", "beds": 3, "baths": 2.0, "price": 300_000 + i}
            for i in range(5)
        ]
        rents = await svc.get_rent_estimates_parallel(listings, "75070")
        assert len(rents) == 5
        for r in rents:
            assert isinstance(r, int)
            assert r > 0


class TestRentCastMarketCache:
    """
    NOTE on caching behaviour:
    Both rentcast and fred services SHORT-CIRCUIT to mock data when DEMO_MODE
    is true, returning BEFORE the cache-write line. That means the in-process
    cache only ever populates on the live-API code path. To exercise caching
    in tests we monkeypatch DEMO_MODE off and stub the underlying _get call.
    """

    @pytest.mark.asyncio
    async def test_market_stats_deterministic_in_demo_mode(self):
        # In DEMO_MODE the cache is bypassed but mock data is seeded by ZIP,
        # so equal calls still produce equal results.
        svc = RentCastService()
        a = await svc.get_market_stats("75070")
        b = await svc.get_market_stats("75070")
        assert a == b

    @pytest.mark.asyncio
    async def test_market_stats_cache_populates_on_live_path(self, monkeypatch):
        # Force the live path
        monkeypatch.setattr(rc_mod, "DEMO_MODE",        False)
        monkeypatch.setattr(rc_mod, "RENTCAST_API_KEY", "fake-key-for-test")

        async def fake_get(path, params):
            return {
                "averageRent":         2400,
                "averageDaysOnMarket": 25,
                "vacancyRate":         4.5,
                "rentGrowth":          3.2,
            }
        monkeypatch.setattr(rc_mod, "_get", fake_get)

        svc = RentCastService()
        first = await svc.get_market_stats("75070")
        # Cache should now be populated
        assert "75070" in rc_mod._market_cache
        ts, data = rc_mod._market_cache["75070"]
        assert data == first
        assert (time.time() - ts) < MARKET_TTL

        # Second call should hit cache (fake_get not invoked again — verified
        # by replacing it with one that would raise)
        async def boom(*a, **kw):
            raise AssertionError("cache should have served this call")
        monkeypatch.setattr(rc_mod, "_get", boom)
        second = await svc.get_market_stats("75070")
        assert second == first


# ══════════════════════════════════════════════════════════════
# FREDService — DEMO_MODE / no-key fallback
# ══════════════════════════════════════════════════════════════

class TestFREDService:

    @pytest.mark.asyncio
    async def test_get_30yr_rate_returns_float(self):
        svc = FREDService()
        rate = await svc.get_30yr_rate()
        assert isinstance(rate, float)
        assert 0 < rate < 25  # sanity: any plausible mortgage rate

    @pytest.mark.asyncio
    async def test_rate_deterministic_in_demo_mode(self):
        # DEMO_MODE bypasses the cache write, but mock_mortgage_rate is constant
        svc = FREDService()
        first  = await svc.get_30yr_rate()
        second = await svc.get_30yr_rate()
        assert first == second

    @pytest.mark.asyncio
    async def test_rate_cache_populates_on_live_path(self, monkeypatch):
        monkeypatch.setattr(fred_mod, "DEMO_MODE",    False)
        monkeypatch.setattr(fred_mod, "FRED_API_KEY", "fake-key-for-test")

        # Build a minimal httpx-like fake response
        class FakeResp:
            def __init__(self, payload): self._p = payload
            def raise_for_status(self): pass
            def json(self): return self._p

        class FakeClient:
            def __init__(self, *a, **kw): pass
            async def get(self, url, params=None):
                return FakeResp({"observations": [{"date": "2026-04-20", "value": "6.85"}]})

        monkeypatch.setattr(fred_mod, "_get_client", lambda: FakeClient())

        svc = FREDService()
        rate = await svc.get_30yr_rate()
        assert rate == 6.85
        assert fred_mod._rate_cache is not None
        ts, val = fred_mod._rate_cache
        assert val == 6.85
        assert (time.time() - ts) < RATE_TTL

    @pytest.mark.asyncio
    async def test_rate_history_returns_list_of_dated_points(self):
        svc = FREDService()
        history = await svc.get_rate_history(months=6)
        assert isinstance(history, list)
        assert len(history) == 6
        for point in history:
            assert "date" in point
            assert "rate" in point
            assert isinstance(point["rate"], float)

    @pytest.mark.asyncio
    async def test_rate_history_deterministic_in_demo_mode(self):
        svc = FREDService()
        a = await svc.get_rate_history(months=12)
        b = await svc.get_rate_history(months=12)
        assert a == b
