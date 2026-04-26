"""
Unit tests for in-process agent memory in backend/agents/netflow_agent.py:

- MarketMemory: TTL 15 min, per-ZIP MarketContext.
- RiskCache: TTL 1 hr, per-ZIP dict[address → RiskProfile].
- ConversationMemory: bounded-window chat history per address.

We monkey-patch each class's TTL where needed to avoid time.sleep,
and we monkey-patch time.time() via fixtures rather than waiting.
"""

import time
import pytest

from backend.agents.netflow_agent import (
    MarketMemory,
    MarketContext,
    RiskCache,
    RiskProfile,
    ConversationMemory,
)


# ══════════════════════════════════════════════════════════════
# MarketMemory
# ══════════════════════════════════════════════════════════════

class TestMarketMemory:

    def test_miss_when_empty(self):
        assert MarketMemory.get("75070") is None

    def test_hit_after_set(self):
        ctx = MarketContext(
            zip_code      = "75070",
            mortgage_rate = 7.0,
            avg_rent      = 2400,
            vacancy_rate  = 5.0,
        )
        MarketMemory.set(ctx)
        retrieved = MarketMemory.get("75070")
        assert retrieved is ctx
        assert retrieved.mortgage_rate == 7.0

    def test_invalidate(self):
        MarketMemory.set(MarketContext(zip_code="75070", mortgage_rate=7.0))
        assert MarketMemory.get("75070") is not None
        MarketMemory.invalidate("75070")
        assert MarketMemory.get("75070") is None

    def test_different_zips_isolated(self):
        a = MarketContext(zip_code="75070", mortgage_rate=7.0)
        b = MarketContext(zip_code="90210", mortgage_rate=7.5)
        MarketMemory.set(a)
        MarketMemory.set(b)
        assert MarketMemory.get("75070").mortgage_rate == 7.0
        assert MarketMemory.get("90210").mortgage_rate == 7.5

    def test_ttl_expiry(self, monkeypatch):
        ctx = MarketContext(zip_code="75070", mortgage_rate=7.0)
        # Force the entry's retrieved_at into the past
        ctx.retrieved_at = time.time() - (MarketMemory.TTL + 60)
        MarketMemory._store["75070"] = ctx
        # Past TTL → MISS
        assert MarketMemory.get("75070") is None


# ══════════════════════════════════════════════════════════════
# RiskCache
# ══════════════════════════════════════════════════════════════

class TestRiskCache:

    def _make_profile(self, addr: str = "1 Test Ln") -> RiskProfile:
        return RiskProfile(
            address      = addr,
            overall_risk = "LOW",
            score        = 10,
            factors      = [],
            mitigations  = [],
        )

    def test_miss_when_empty(self):
        assert RiskCache.get("75070") is None

    def test_hit_after_set(self):
        p = self._make_profile()
        RiskCache.set("75070", {"1 Test Ln": p})
        retrieved = RiskCache.get("75070")
        assert retrieved is not None
        assert retrieved["1 Test Ln"].score == 10

    def test_ttl_expiry(self, monkeypatch):
        p = self._make_profile()
        # Insert with a stale timestamp directly
        RiskCache._store["75070"] = (
            time.time() - (RiskCache.TTL + 60),
            {"1 Test Ln": p},
        )
        assert RiskCache.get("75070") is None

    def test_per_zip_isolation(self):
        RiskCache.set("75070", {"a": self._make_profile("a")})
        RiskCache.set("90210", {"b": self._make_profile("b")})
        assert "a" in RiskCache.get("75070")
        assert "b" in RiskCache.get("90210")
        assert "a" not in RiskCache.get("90210")


# ══════════════════════════════════════════════════════════════
# ConversationMemory
# ══════════════════════════════════════════════════════════════

class TestConversationMemory:

    def test_empty_address_returns_empty_list(self):
        assert ConversationMemory.get("nope") == []

    def test_add_and_retrieve(self):
        ConversationMemory.add("1 Main St", "user",      "What's the cap rate?")
        ConversationMemory.add("1 Main St", "assistant", "About 6.2%.")
        history = ConversationMemory.get("1 Main St")
        assert len(history) == 2
        assert history[0]["role"]    == "user"
        assert history[1]["role"]    == "assistant"
        assert history[1]["content"] == "About 6.2%."

    def test_window_bounded_to_max_turns(self):
        # MAX_TURNS = 5, each turn = user + assistant → cap at 10 entries
        for i in range(15):
            ConversationMemory.add("1 Main St", "user",      f"q{i}")
            ConversationMemory.add("1 Main St", "assistant", f"a{i}")

        history = ConversationMemory.get("1 Main St")
        assert len(history) <= ConversationMemory.MAX_TURNS * 2
        # Most recent turns retained → last user msg is q14, not q0
        last_user = [h for h in history if h["role"] == "user"][-1]
        assert last_user["content"] == "q14"

    def test_per_address_isolation(self):
        ConversationMemory.add("addr-A", "user", "alpha")
        ConversationMemory.add("addr-B", "user", "bravo")
        assert ConversationMemory.get("addr-A")[0]["content"] == "alpha"
        assert ConversationMemory.get("addr-B")[0]["content"] == "bravo"

    def test_clear(self):
        ConversationMemory.add("addr-X", "user", "hello")
        assert len(ConversationMemory.get("addr-X")) == 1
        ConversationMemory.clear("addr-X")
        assert ConversationMemory.get("addr-X") == []

    def test_clear_unknown_address_no_error(self):
        # Should not raise
        ConversationMemory.clear("never-seen")
