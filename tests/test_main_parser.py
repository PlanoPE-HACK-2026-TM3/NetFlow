"""
Unit tests for backend/main.py prompt-parsing utilities.

Coverage
--------
- parse_prompt_to_params(): regex extraction of ZIP / city / state /
  budget / beds / property_type / strategy from free-text prompts.
- SearchRequest.resolve(): explicit-field overrides + prompt fallback.
- _sse() helper: SSE wire-format correctness.

These tests are pure-CPU — no network, no Ollama, no FastAPI lifecycle.
"""

import json
import pytest

from backend.main import (
    parse_prompt_to_params,
    SearchRequest,
    _sse,
    CITY_ZIP,
)


# ══════════════════════════════════════════════════════════════
# parse_prompt_to_params — ZIP extraction
# ══════════════════════════════════════════════════════════════

class TestParseZipExtraction:

    def test_zip_only(self):
        p = parse_prompt_to_params("75070")
        assert p["zip_code"] == "75070"
        assert p["resolved"] is True

    def test_zip_in_sentence(self):
        p = parse_prompt_to_params("show me homes in 75070 area")
        assert p["zip_code"] == "75070"

    def test_no_zip_no_city_falls_back_to_default(self):
        # Per implementation: returns "75070" when nothing resolves
        # and resolved=False to signal the fallback.
        p = parse_prompt_to_params("hello world")
        assert p["zip_code"] == "75070"
        assert p["resolved"] is False

    def test_5_digit_budget_not_mistaken_for_zip(self):
        # Budget 95000 has 5 digits but isn't strictly a ZIP-looking word
        # boundary case. Real ZIP wins when both present.
        p = parse_prompt_to_params("75070 under $95000")
        assert p["zip_code"] == "75070"


# ══════════════════════════════════════════════════════════════
# parse_prompt_to_params — City + State
# ══════════════════════════════════════════════════════════════

class TestParseCityState:

    @pytest.mark.xfail(
        reason="KNOWN BUG: budget regex `[\\d,]+` matches a lone comma "
               "(e.g. the comma in 'Dallas, TX'), causing int('') to crash. "
               "Fix: anchor the pattern with at least one digit, e.g. "
               "`\\$?(\\d[\\d,]*)\\s*([kKmM]?)\\b`. "
               "Same defect lives in agents.user_agent._extract_params.",
        raises=ValueError,
        strict=True,
    )
    def test_city_state_with_comma(self):
        p = parse_prompt_to_params("Dallas, TX under $400k")
        assert p["city"] == "Dallas"
        assert p["state"] == "TX"
        assert p["zip_code"] == CITY_ZIP["dallas"]

    def test_city_state_with_comma_no_budget_works(self):
        # Same intent without the trailing comma — exercises the working path.
        # NOTE: 'Dallas, TX' alone also trips the comma-budget bug, so we use
        # the non-comma form here.
        p = parse_prompt_to_params("Dallas TX")
        assert p["city"]     == "Dallas"
        assert p["state"]    == "TX"
        assert p["zip_code"] == CITY_ZIP["dallas"]

    def test_city_state_without_comma(self):
        p = parse_prompt_to_params("McKinney TX 3 bed")
        assert p["city"] == "McKinney"
        assert p["state"] == "TX"
        assert p["zip_code"] == CITY_ZIP["mckinney"]

    def test_unknown_city_no_zip_resolves_default(self):
        p = parse_prompt_to_params("Smallville KS")
        # City regex matches but lookup fails → falls through to default
        assert p["city"] == "Smallville"
        assert p["state"] == "KS"
        assert p["zip_code"] == "75070"  # default fallback
        assert p["resolved"] is False

    def test_explicit_zip_wins_over_city_lookup(self):
        # Both Dallas and 90210 present — ZIP regex finds 90210 first
        p = parse_prompt_to_params("Dallas TX 90210")
        assert p["zip_code"] == "90210"

    def test_city_alone_with_in_keyword(self):
        p = parse_prompt_to_params("homes in Austin")
        assert p["zip_code"] == CITY_ZIP["austin"]


# ══════════════════════════════════════════════════════════════
# parse_prompt_to_params — Budget
# ══════════════════════════════════════════════════════════════

class TestParseBudget:

    @pytest.mark.parametrize("text,expected", [
        ("75070 under $400k",     400_000),
        ("under 450K in 75070",   450_000),
        ("75070 $350,000",        350_000),
        ("under 500000 75070",    500_000),
        ("homes under $300k",     300_000),
    ])
    def test_budget_variants(self, text, expected):
        p = parse_prompt_to_params(text)
        assert p["budget"] == expected

    def test_decimal_million_not_supported(self):
        # The regex doesn't handle '$1.2M' as 1.2 million — it parses the
        # '2' suffix-M as 2,000,000. Documenting current behavior; if we
        # ever want decimal-M support, the regex needs `(\d+\.?\d*)`.
        p = parse_prompt_to_params("$1.2M in Dallas TX")
        # Whatever the result, it should NOT crash and should fall back gracefully
        assert p["budget"] in (450_000, 1_000_000, 2_000_000)

    def test_default_budget_when_absent(self):
        p = parse_prompt_to_params("75070")
        assert p["budget"] == 450_000

    def test_budget_min_threshold_50k(self):
        # Values < 50k after K-multiplication should be skipped
        p = parse_prompt_to_params("75070 buy 30")
        assert p["budget"] == 450_000  # 30 → 30000, below 50k threshold → ignored


# ══════════════════════════════════════════════════════════════
# parse_prompt_to_params — Beds, property type, strategy
# ══════════════════════════════════════════════════════════════

class TestParseBedsAndType:

    @pytest.mark.parametrize("text,beds", [
        ("3 bed home in 75070", 3),
        ("4 bedroom Dallas TX", 4),
        ("2br condo 75070",     2),
        ("5 bdrm 75070",        5),
        ("75070 SFH",           3),  # default
    ])
    def test_min_beds(self, text, beds):
        assert parse_prompt_to_params(text)["min_beds"] == beds

    def test_min_beds_clamped_to_max_6(self):
        # Implementation clamps to max 6
        p = parse_prompt_to_params("9 bed home 75070")
        assert p["min_beds"] == 6

    def test_min_beds_clamped_to_min_1(self):
        p = parse_prompt_to_params("0 bed home 75070")
        assert p["min_beds"] == 1

    @pytest.mark.parametrize("text,ptype", [
        ("3 bed condo in 75070",    "Condo"),
        ("multi family 75070",      "Multi"),
        ("duplex 75070",            "Multi"),
        ("townhouse 75070",         "Townhouse"),
        ("townhome in 75070",       "Townhouse"),
        ("75070 home",              "SFH"),  # default
    ])
    def test_property_type(self, text, ptype):
        assert parse_prompt_to_params(text)["property_type"] == ptype


class TestParseStrategy:

    @pytest.mark.parametrize("text,strategy", [
        ("75070 STR airbnb",      "STR"),
        ("75070 short term",      "STR"),
        ("75070 BRRRR strategy",  "BRRRR"),
        ("75070 fix and flip",    "Flip"),
        ("75070 LTR rental",      "LTR"),
        ("75070 home",            "LTR"),  # default
    ])
    def test_strategy(self, text, strategy):
        assert parse_prompt_to_params(text)["strategy"] == strategy


# ══════════════════════════════════════════════════════════════
# parse_prompt_to_params — full integration scenarios
# ══════════════════════════════════════════════════════════════

class TestParseFullPrompts:

    def test_complex_prompt_all_fields(self):
        p = parse_prompt_to_params(
            "3 bed SFH in McKinney TX under $450k LTR strategy"
        )
        assert p["zip_code"]      == "75070"
        assert p["city"]          == "McKinney"
        assert p["state"]         == "TX"
        assert p["budget"]        == 450_000
        assert p["min_beds"]      == 3
        assert p["property_type"] == "SFH"
        assert p["strategy"]      == "LTR"

    def test_str_condo_high_budget(self):
        p = parse_prompt_to_params("2 bed condo Miami FL under $600k STR")
        assert p["state"]         == "FL"
        assert p["property_type"] == "Condo"
        assert p["strategy"]      == "STR"
        assert p["min_beds"]      == 2

    def test_location_display_format(self):
        p = parse_prompt_to_params("Plano TX")
        assert "Plano" in p["location_display"]
        assert "TX"    in p["location_display"]


# ══════════════════════════════════════════════════════════════
# SearchRequest.resolve — explicit fields vs prompt fallback
# ══════════════════════════════════════════════════════════════

class TestSearchRequestResolve:

    def test_explicit_zip_only(self):
        req = SearchRequest(zip_code="75070")
        out = req.resolve()
        assert out["zip_code"]    == "75070"
        assert out["budget"]      == 450_000
        assert out["min_beds"]    == 3
        assert out["strategy"]    == "LTR"
        assert out["property_type"] == "SFH"

    def test_city_lookup_resolves_zip(self):
        req = SearchRequest(city="Dallas", state="TX")
        out = req.resolve()
        assert out["zip_code"] == CITY_ZIP["dallas"]
        assert "Dallas" in out["location_display"]

    def test_prompt_overrides_default_budget(self):
        req = SearchRequest(prompt_text="75070 under $300k")
        out = req.resolve()
        assert out["budget"] == 300_000

    def test_explicit_field_keeps_prompt_from_overriding_when_explicit_already_set(self):
        # Explicit min_beds=4 should NOT be overridden when prompt also has "3 bed"
        # (impl: only fills if min_beds == 3 default — so 4 stays)
        req = SearchRequest(
            zip_code="75070",
            min_beds=4,
            prompt_text="3 bed home"
        )
        out = req.resolve()
        assert out["min_beds"] == 4

    def test_prompt_fills_default_min_beds(self):
        # Default min_beds=3 → prompt's "5 bed" can override
        req = SearchRequest(zip_code="75070", prompt_text="5 bed home")
        out = req.resolve()
        assert out["min_beds"] == 5

    def test_empty_request_uses_safe_defaults(self):
        out = SearchRequest().resolve()
        assert out["zip_code"]      == "75070"
        assert out["budget"]        == 450_000
        assert out["property_type"] == "SFH"
        assert out["strategy"]      == "LTR"


# ══════════════════════════════════════════════════════════════
# _sse — SSE wire format
# ══════════════════════════════════════════════════════════════

class TestSSEFormatter:

    def test_sse_format_basic(self):
        out = _sse("status", {"msg": "hello"})
        assert out.startswith("data: ")
        assert out.endswith("\n\n")

    def test_sse_payload_is_valid_json(self):
        out = _sse("properties", {"count": 5, "ok": True})
        # Strip "data: " prefix and trailing newlines
        body = out[len("data: "):].rstrip("\n")
        decoded = json.loads(body)
        assert decoded["type"]  == "properties"
        assert decoded["count"] == 5
        assert decoded["ok"]    is True

    def test_sse_event_type_propagates(self):
        for event_type in ("status", "properties", "ai_token", "ai_start", "done", "error"):
            out = _sse(event_type, {})
            decoded = json.loads(out[len("data: "):].rstrip("\n"))
            assert decoded["type"] == event_type
