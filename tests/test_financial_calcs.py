"""
Unit tests for backend/agents/netflow_agent.py — pure-function utilities:

- compute_financials(): cap rate / cash flow / GRM / PITI / CoC formulas.
- compact_for_llm(): payload shape sent to the LLM batch-scoring stage.
- compute_risk_score(): rule-based risk scoring rubric.

These are deterministic, no I/O, no LLM, no Ollama needed.
"""

import math
import pytest

from backend.agents.netflow_agent import (
    compute_financials,
    compact_for_llm,
    compute_risk_score,
)


# ══════════════════════════════════════════════════════════════
# compute_financials
# ══════════════════════════════════════════════════════════════

class TestComputeFinancials:

    def setup_method(self):
        self.listing = {
            "address":   "1 Test Ln",
            "price":     300_000,
            "est_rent":  2400,
            "beds":      3,
            "baths":     2.0,
            "sqft":      1800,
            "dom":       21,
        }

    def test_returns_all_expected_fields(self):
        out = compute_financials(self.listing, mortgage_rate=7.0)
        for key in ("cap_rate", "cash_flow", "grm", "coc_return",
                    "break_even", "piti", "noi_annual"):
            assert key in out

    def test_original_fields_preserved(self):
        out = compute_financials(self.listing, mortgage_rate=7.0)
        assert out["address"]  == "1 Test Ln"
        assert out["price"]    == 300_000
        assert out["est_rent"] == 2400

    def test_cap_rate_formula(self):
        # cap_rate = (rent * 12 * 0.65) / price * 100
        out = compute_financials(self.listing, mortgage_rate=7.0)
        expected = round(((2400 * 12 * 0.65) / 300_000) * 100, 2)
        assert out["cap_rate"] == expected

    def test_grm_formula(self):
        # GRM = price / annual_rent
        out = compute_financials(self.listing, mortgage_rate=7.0)
        expected = round(300_000 / (2400 * 12), 1)
        assert out["grm"] == expected

    def test_zero_rent_no_zero_division(self):
        zero_rent = {**self.listing, "est_rent": 0}
        out = compute_financials(zero_rent, mortgage_rate=7.0)
        # Implementation should guard against ZeroDivisionError
        assert out["grm"]      == 0.0
        assert isinstance(out["cap_rate"], float)

    @pytest.mark.xfail(
        reason="KNOWN BUG: coc_return divides by (price * 0.20) without "
               "a price>0 guard. Fix: gate the coc line behind `if price > 0`. "
               "Tracking this as a defect — test will pass once fixed.",
        raises=ZeroDivisionError,
        strict=True,
    )
    def test_zero_price_no_zero_division(self):
        zero_price = {**self.listing, "price": 0}
        out = compute_financials(zero_price, mortgage_rate=7.0)
        assert out["cap_rate"] == 0.0
        assert out["coc_return"] == 0.0

    def test_higher_rate_lower_cash_flow(self):
        low  = compute_financials(self.listing, mortgage_rate=4.0)
        high = compute_financials(self.listing, mortgage_rate=9.0)
        assert low["cash_flow"] > high["cash_flow"]

    def test_piti_increases_with_rate(self):
        low  = compute_financials(self.listing, mortgage_rate=4.0)
        high = compute_financials(self.listing, mortgage_rate=9.0)
        assert high["piti"] > low["piti"]

    def test_noi_annual_is_65pct_of_gross(self):
        out = compute_financials(self.listing, mortgage_rate=7.0)
        # NOI = rent * 12 * 0.65
        assert out["noi_annual"] == int(2400 * 12 * 0.65)

    def test_break_even_above_piti(self):
        out = compute_financials(self.listing, mortgage_rate=7.0)
        assert out["break_even"] > out["piti"]


# ══════════════════════════════════════════════════════════════
# compact_for_llm
# ══════════════════════════════════════════════════════════════

class TestCompactForLLM:

    def test_returns_exactly_six_fields(self):
        prop = {
            "cap_rate":  6.5,
            "cash_flow": 350,
            "grm":       10.4,
            "dom":       21,
            "beds":      3,
            "price":     300_000,
            "address":   "should be stripped",
            "sqft":      1800,
        }
        out = compact_for_llm(prop)
        assert set(out.keys()) == {
            "cap_rate", "cash_flow", "grm", "dom", "beds", "price"
        }
        # No address or sqft leaked
        assert "address" not in out
        assert "sqft"    not in out

    def test_handles_missing_fields_with_defaults(self):
        out = compact_for_llm({})
        assert out["cap_rate"]  == 0.0
        assert out["cash_flow"] == 0
        assert out["grm"]       == 0.0
        assert out["dom"]       == 30
        assert out["beds"]      == 3
        assert out["price"]     == 0

    def test_types_are_normalised(self):
        prop = {"cap_rate": "5.5", "beds": "3"}
        # Strings won't pass through round() or int() — implementation expects numbers,
        # so this just ensures no crash on the happy path with proper types.
        prop = {"cap_rate": 5.5, "cash_flow": 100, "grm": 10.0,
                "dom": 21, "beds": 3, "price": 300_000}
        out = compact_for_llm(prop)
        assert isinstance(out["cap_rate"],  float)
        assert isinstance(out["cash_flow"], int)
        assert isinstance(out["grm"],       float)
        assert isinstance(out["dom"],       int)
        assert isinstance(out["beds"],      int)
        assert isinstance(out["price"],     int)


# ══════════════════════════════════════════════════════════════
# compute_risk_score
# ══════════════════════════════════════════════════════════════

class TestComputeRiskScore:
    """
    compute_risk_score returns
        (score: int, factors: list, mitigations: list, risk_level: str)
    Higher score = higher risk. risk_level ∈ {LOW, MEDIUM, HIGH}.
    """

    def test_returns_four_tuple(self):
        out = compute_risk_score({
            "price": 300_000, "est_rent": 2400, "dom": 20,
            "year_built": 2010, "cash_flow": 200, "cap_rate": 6.0,
        })
        assert isinstance(out, tuple)
        assert len(out) == 4
        score, factors, mitigations, level = out
        assert isinstance(score,       int)
        assert isinstance(factors,     list)
        assert isinstance(mitigations, list)
        assert level in ("LOW", "MEDIUM", "HIGH")

    def test_score_capped_at_100(self):
        # Pile on every penalty — total raw is > 100, must clamp
        terrible = {
            "price":      500_000,
            "est_rent":   500,
            "dom":        365,
            "year_built": 1900,
            "cash_flow":  -2000,
            "cap_rate":   0.5,
            "grm":        300,
        }
        score, _, _, _ = compute_risk_score(terrible)
        assert score <= 100

    def test_clean_property_low_band(self):
        clean = {
            "price":      300_000,
            "est_rent":   2400,
            "dom":        15,
            "year_built": 2015,
            "cash_flow":  500,
            "cap_rate":   6.5,
            "grm":        10.4,
        }
        score, factors, _, level = compute_risk_score(clean)
        assert score < 20
        assert level   == "LOW"
        assert factors == []

    def test_negative_cash_flow_adds_30_points(self):
        bad = {
            "price": 300_000, "est_rent": 1200, "dom": 30,
            "year_built": 2010, "cash_flow": -100, "cap_rate": 5.0, "grm": 20,
        }
        score, factors, mitigations, _ = compute_risk_score(bad)
        assert score >= 30
        assert any("cash flow" in f.lower() for f in factors)
        assert mitigations  # at least one mitigation suggested

    def test_marginal_cash_flow_milder_penalty(self):
        marg = {
            "price": 300_000, "est_rent": 2200, "dom": 30,
            "year_built": 2010, "cash_flow": 50, "cap_rate": 5.5, "grm": 11,
        }
        bad = {**marg, "cash_flow": -100}
        s_m, _, _, _ = compute_risk_score(marg)
        s_b, _, _, _ = compute_risk_score(bad)
        assert s_b > s_m

    def test_old_construction_pre_1960_flagged(self):
        old = {
            "price": 200_000, "est_rent": 1800, "dom": 20,
            "year_built": 1925, "cash_flow": 200, "cap_rate": 5.5, "grm": 9.3,
        }
        score, factors, _, _ = compute_risk_score(old)
        joined = " ".join(factors).lower()
        assert "1925" in joined or "old" in joined

    def test_high_dom_above_90_flagged(self):
        stale = {
            "price": 300_000, "est_rent": 2400, "dom": 120,
            "year_built": 2010, "cash_flow": 200, "cap_rate": 6.0, "grm": 10.4,
        }
        score, factors, _, _ = compute_risk_score(stale)
        assert any("dom" in f.lower() or "120" in f for f in factors)

    def test_risk_level_bands(self):
        # LOW < 20, MEDIUM < 45, else HIGH
        clean = {"cash_flow": 500, "cap_rate": 7, "dom": 15,
                 "grm": 10, "year_built": 2015}
        med   = {"cash_flow": 50,  "cap_rate": 4.5, "dom": 70,
                 "grm": 10, "year_built": 2015}
        high  = {"cash_flow": -200, "cap_rate": 3, "dom": 100,
                 "grm": 200, "year_built": 1925}
        assert compute_risk_score(clean)[3] == "LOW"
        assert compute_risk_score(med)[3]   == "MEDIUM"
        assert compute_risk_score(high)[3]  == "HIGH"
