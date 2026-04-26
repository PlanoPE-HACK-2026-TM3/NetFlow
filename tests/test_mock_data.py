"""
Unit tests for backend/services/mock_data.py — deterministic fallback
data generators used when external API keys are absent or DEMO_MODE=true.

These generators must be:
- Deterministic per-ZIP (same ZIP → same listings on every call).
- Within sane numeric ranges (no negative prices, plausible bed counts).
- Honour the limit / min_beds / max_price constraints.
"""

import pytest

from backend.services.mock_data import (
    mock_listings,
    mock_rent_estimate,
    mock_market_stats,
    mock_mortgage_rate,
    _seed,
    STREET_NAMES,
    PROPERTY_TYPES,
)


# ══════════════════════════════════════════════════════════════
# _seed
# ══════════════════════════════════════════════════════════════

class TestSeed:

    def test_same_zip_same_seed(self):
        rng1 = _seed("75070")
        rng2 = _seed("75070")
        assert rng1.random() == rng2.random()

    def test_different_zip_different_seed(self):
        rng1 = _seed("75070")
        rng2 = _seed("90210")
        # Probability of collision on a single draw is essentially 0
        assert rng1.random() != rng2.random()


# ══════════════════════════════════════════════════════════════
# mock_listings
# ══════════════════════════════════════════════════════════════

class TestMockListings:

    def test_deterministic_same_inputs(self):
        a = mock_listings("75070", 450_000, "SFH", 3, limit=5)
        b = mock_listings("75070", 450_000, "SFH", 3, limit=5)
        assert a == b

    def test_respects_limit(self):
        out = mock_listings("75070", 450_000, "SFH", 3, limit=5)
        assert len(out) == 5

        out_full = mock_listings("75070", 450_000, "SFH", 3, limit=10)
        assert len(out_full) == 10

    def test_required_fields_present(self):
        out = mock_listings("75070", 450_000, "SFH", 3, limit=3)
        required = {
            "address", "zip_code", "price", "beds", "baths",
            "sqft", "dom", "property_type", "year_built",
            "lot_size", "rentcast_id",
        }
        for listing in out:
            assert required.issubset(listing.keys()), \
                f"missing: {required - set(listing.keys())}"

    def test_all_under_max_price(self):
        max_price = 400_000
        out = mock_listings("75070", max_price, "SFH", 3, limit=10)
        for listing in out:
            assert listing["price"] <= max_price

    def test_min_beds_respected(self):
        out = mock_listings("75070", 450_000, "SFH", 4, limit=10)
        for listing in out:
            assert listing["beds"] >= 4

    def test_zip_code_propagated(self):
        out = mock_listings("90210", 450_000, "SFH", 3, limit=3)
        for listing in out:
            assert listing["zip_code"] == "90210"

    def test_property_type_translated(self):
        condo = mock_listings("75070", 450_000, "Condo", 2, limit=3)
        for listing in condo:
            assert listing["property_type"] == "Condo"

        multi = mock_listings("75070", 450_000, "Multi", 3, limit=3)
        for listing in multi:
            assert listing["property_type"] == "Multi-Family"

    def test_unique_addresses_within_batch(self):
        out = mock_listings("75070", 450_000, "SFH", 3, limit=10)
        addrs = [l["address"] for l in out]
        # Address combines random house number + shuffled street → very high
        # probability all 10 are unique with the 30-name street pool
        assert len(set(addrs)) == len(addrs)

    def test_addresses_use_known_street_names(self):
        out = mock_listings("75070", 450_000, "SFH", 3, limit=10)
        for listing in out:
            # Strip leading house number; what remains should be a known street
            parts = listing["address"].split(" ", 1)
            assert len(parts) == 2
            assert parts[1] in STREET_NAMES


# ══════════════════════════════════════════════════════════════
# mock_rent_estimate
# ══════════════════════════════════════════════════════════════

class TestMockRentEstimate:

    def test_floor_at_900(self):
        # Cheap property → minimum rent floor
        rent = mock_rent_estimate(price=10_000, beds=1, baths=1.0)
        assert rent >= 900

    def test_typical_case_returns_int(self):
        rent = mock_rent_estimate(price=350_000, beds=3, baths=2.0)
        assert isinstance(rent, int)
        assert rent > 0

    def test_more_beds_higher_or_equal_rent(self):
        # bedroom_bump = (beds - 2) * 130, monotonic in beds
        r2 = mock_rent_estimate(price=350_000, beds=2, baths=2.0)
        r4 = mock_rent_estimate(price=350_000, beds=4, baths=2.0)
        assert r4 >= r2

    def test_rent_in_plausible_range_for_typical_property(self):
        # A 350k 3/2 should rent for low-thousands, not millions
        rent = mock_rent_estimate(price=350_000, beds=3, baths=2.0)
        assert 900 <= rent < 20_000


# ══════════════════════════════════════════════════════════════
# mock_market_stats
# ══════════════════════════════════════════════════════════════

class TestMockMarketStats:

    def test_deterministic_per_zip(self):
        a = mock_market_stats("75070")
        b = mock_market_stats("75070")
        assert a == b

    def test_required_keys(self):
        s = mock_market_stats("75070")
        assert {"median_rent", "avg_days_on_market",
                "vacancy_rate", "rent_growth_yoy"} <= s.keys()

    def test_value_ranges(self):
        s = mock_market_stats("75070")
        assert 1600 <= s["median_rent"]        <= 2800
        assert 12   <= s["avg_days_on_market"] <= 45
        assert 2.5  <= s["vacancy_rate"]       <= 7.0
        assert 1.5  <= s["rent_growth_yoy"]    <= 6.5


# ══════════════════════════════════════════════════════════════
# mock_mortgage_rate
# ══════════════════════════════════════════════════════════════

class TestMockMortgageRate:

    def test_returns_constant(self):
        # Implementation pins to 7.2; if that ever changes, this catches it.
        assert mock_mortgage_rate() == 7.2

    def test_returns_float(self):
        assert isinstance(mock_mortgage_rate(), float)
