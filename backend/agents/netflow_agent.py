"""
NetFlow LangChain Agent — uses local Ollama (llama3) for scoring + summaries.

DEMO_MODE=false (default):
  - RentCast + FRED for live data (if keys set), mock data as fallback
  - Ollama/llama3 for AI scoring and market summary
  - Falls back to rule-based scoring if Ollama is unavailable

DEMO_MODE=true:
  - Mock data always, rule-based scoring, no Ollama calls
"""

import json
import os
from typing import AsyncIterator

from backend.config import (
    OLLAMA_BASE_URL, OLLAMA_MODEL, DEMO_MODE,
    LANGCHAIN_API_KEY, LANGCHAIN_PROJECT,
)

from langsmith import traceable
from pydantic import BaseModel, Field


# ── Output schema ─────────────────────────────────────────────

class ScoredProperty(BaseModel):
    rank:      int
    address:   str
    zip_code:  str
    price:     int
    est_rent:  int
    cap_rate:  float = Field(description="Net cap rate after 35% expense ratio")
    cash_flow: int   = Field(description="Monthly cash flow after PITI + expenses")
    grm:       float = Field(description="Gross Rent Multiplier")
    dom:       int   = Field(description="Days on market")
    ai_score:  int   = Field(ge=0, le=100)
    tags:      list[str]
    beds:      int
    baths:     float
    sqft:      int
    year_built: int  = 0
    lot_size:   int  = 0
    mls_id:     str  = ""
    map_query:  str  = ""
    photo_url:  str  = ""


# ── Compact prompts (token-optimised) ────────────────────────

SCORING_SYSTEM = """Score each property 0-100 for the given strategy.
Rules: cap_rate*30% + cash_flow*25% + grm*15% + dom*10% + strategy_fit*20%.
Bands: cap_rate >6=90-100,5-6=70-89,4-5=50-69,<4=0-49.
Cash_flow >400=excellent,200-400=good,0-200=marginal,<0=poor.
GRM <100=excellent,100-130=good,130-160=fair,>160=poor.
DOM <14=excellent,<30=good.
Strategy LTR=stable_CF, STR=high_yield, BRRRR=value-add, Flip=low_DOM.
Return ONLY a JSON array [{\"rank\":1,\"ai_score\":82,\"tags\":[\"Cash+\",\"Low DOM\"]},...]
One object per property, same order as input. No prose, no fences."""

SUMMARY_SYSTEM = "You are a concise real estate analyst. Max 90 words. Data-driven, specific."

SUMMARY_HUMAN = """ZIP {zip_code} | Budget ${budget:,} | Strategy {strategy_label} | Rate {mortgage_rate}%
Top pick: {top1_addr} — ${top1_price:,}, cap {top1_cap}%, CF ${top1_cf}/mo, score {top1_score}/100
Market avg: cap {avg_cap}%, CF ${avg_cf}/mo across {n_props} properties.
Write 2-3 sentences: market outlook + top recommendation with numbers."""


# ── Financial helpers ─────────────────────────────────────────

def _compute_financials(listing: dict, mortgage_rate: float) -> dict:
    price         = listing["price"]
    rent          = listing.get("est_rent", 0)
    expense_ratio = 0.35
    gross_annual  = rent * 12
    noi           = gross_annual * (1 - expense_ratio)
    cap_rate      = round((noi / price) * 100, 2) if price > 0 else 0.0
    down          = price * 0.20
    loan          = price - down
    r             = mortgage_rate / 100 / 12
    n             = 360
    pi            = loan * (r * (1+r)**n) / ((1+r)**n - 1) if r > 0 else loan / n
    piti          = pi + price * 0.015 / 12
    cash_flow     = int(rent - piti - rent * expense_ratio)
    grm           = round(price / gross_annual, 1) if gross_annual > 0 else 0.0
    return {**listing, "cap_rate": cap_rate, "cash_flow": cash_flow, "grm": grm}


def _compact_for_llm(prop: dict) -> dict:
    """Only the 6 fields the LLM needs — cuts tokens ~70%."""
    return {
        "cap_rate":  prop.get("cap_rate", 0),
        "cash_flow": prop.get("cash_flow", 0),
        "grm":       prop.get("grm", 0),
        "dom":       prop.get("dom", 30),
        "beds":      prop.get("beds", 3),
        "price":     prop.get("price", 0),
    }


def _rule_based_score(prop: dict, strategy: str) -> tuple[int, list[str]]:
    score, tags = 0, []
    cr = prop.get("cap_rate", 0)
    if cr >= 6:   score += 30; tags.append(f"{cr}% cap")
    elif cr >= 5: score += 22
    elif cr >= 4: score += 12
    cf = prop.get("cash_flow", 0)
    if cf > 400:   score += 25; tags.append(f"${cf}/mo CF")
    elif cf > 200: score += 18
    elif cf > 0:   score += 8
    grm = prop.get("grm", 200)
    if grm < 100:   score += 15
    elif grm < 130: score += 10
    elif grm < 160: score += 5
    dom = prop.get("dom", 30)
    if dom < 14:   score += 10; tags.append("High demand")
    elif dom < 30: score += 6
    if   strategy == "LTR"   and cf > 200:                        score += 20
    elif strategy == "STR"   and prop.get("cap_rate", 0) > 5.5:  score += 20
    elif strategy == "BRRRR" and dom > 40: score += 15;           tags.append("Value-add")
    elif strategy == "Flip"  and dom < 20:                        score += 18
    else:                                                          score += 10
    if not tags:
        tags.append(f"{prop.get('beds',0)}bd/{prop.get('baths',0)}ba")
    return min(score, 100), tags


STRATEGY_LABELS = {
    "LTR":   "Long-term rental",
    "STR":   "Short-term rental",
    "BRRRR": "BRRRR",
    "Flip":  "Fix and flip",
}


# ── Agent ──────────────────────────────────────────────────────

class NetFlowAgent:
    def __init__(self):
        self._llm = None

    def _get_llm(self):
        """Lazy-init Ollama client. Always uses local llama3."""
        if self._llm is None:
            from langchain_ollama import ChatOllama
            self._llm = ChatOllama(
                model=OLLAMA_MODEL,
                temperature=0.1,
                base_url=OLLAMA_BASE_URL,
                num_predict=600,
            )
        return self._llm

    def _ollama_available(self) -> bool:
        """Quick sync check if Ollama is reachable."""
        import urllib.request
        try:
            urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
            return True
        except Exception:
            return False

    @traceable(name="netflow.score_and_rank")
    async def score_and_rank(
        self, listings: list[dict], mortgage_rate: float, strategy: str
    ) -> list[ScoredProperty]:
        enriched = [_compute_financials(l, mortgage_rate) for l in listings]

        # DEMO_MODE → rule-based only, skip Ollama
        if DEMO_MODE:
            return self._rule_score(enriched, strategy)

        # Live mode → try Ollama, fall back to rule-based
        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import JsonOutputParser

            compact = [_compact_for_llm(p) for p in enriched]
            prompt  = ChatPromptTemplate.from_messages([
                ("system", SCORING_SYSTEM),
                ("human", "Strategy:{strategy} Rate:{rate}%\n{data}"),
            ])
            chain      = prompt | self._get_llm() | JsonOutputParser()
            scored_raw = await chain.ainvoke({
                "strategy": strategy,
                "rate":     mortgage_rate,
                "data":     json.dumps(compact),
            })

            results = []
            for i, item in enumerate(scored_raw):
                if i >= len(enriched): break
                base = {
                    **enriched[i],
                    "ai_score": int(item.get("ai_score", 50)),
                    "tags":     item.get("tags", []),
                }
                try:    results.append(ScoredProperty(rank=i+1, **base))
                except Exception:
                    s, t = _rule_based_score(enriched[i], strategy)
                    results.append(ScoredProperty(rank=i+1, **{**enriched[i],"ai_score":s,"tags":t}))

        except Exception:
            # Ollama down or timed out — silent fallback
            return self._rule_score(enriched, strategy)

        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results): r.rank = i + 1
        return results

    def _rule_score(self, enriched: list[dict], strategy: str) -> list[ScoredProperty]:
        results = []
        for i, prop in enumerate(enriched):
            s, t = _rule_based_score(prop, strategy)
            results.append(ScoredProperty(rank=i+1, **{**prop, "ai_score": s, "tags": t}))
        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results): r.rank = i + 1
        return results

    @traceable(name="netflow.market_summary")
    async def market_summary(
        self, zip_code: str, budget: int, strategy: str,
        top_picks: list[ScoredProperty], mortgage_rate: float
    ) -> str:
        if DEMO_MODE:
            return _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import StrOutputParser
            prompt = ChatPromptTemplate.from_messages([
                ("system", SUMMARY_SYSTEM), ("human", SUMMARY_HUMAN),
            ])
            chain = prompt | self._get_llm() | StrOutputParser()
            return await chain.ainvoke(
                _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate)
            )
        except Exception:
            return _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)

    @traceable(name="netflow.stream_market_summary")
    async def stream_market_summary(
        self, zip_code: str, budget: int, strategy: str,
        top_picks: list[ScoredProperty], mortgage_rate: float
    ) -> AsyncIterator[str]:
        if DEMO_MODE:
            import asyncio
            for word in _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate).split(" "):
                yield word + " "
                await asyncio.sleep(0.03)
            return
        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import StrOutputParser
            prompt = ChatPromptTemplate.from_messages([
                ("system", SUMMARY_SYSTEM), ("human", SUMMARY_HUMAN),
            ])
            chain = prompt | self._get_llm() | StrOutputParser()
            async for chunk in chain.astream(
                _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate)
            ):
                yield chunk
        except Exception:
            import asyncio
            for word in _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate).split(" "):
                yield word + " "
                await asyncio.sleep(0.03)


# ── Helpers ───────────────────────────────────────────────────

def _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate) -> dict:
    top     = top_picks[0] if top_picks else None
    avg_cap = round(sum(p.cap_rate  for p in top_picks) / len(top_picks), 1) if top_picks else 0
    avg_cf  = round(sum(p.cash_flow for p in top_picks) / len(top_picks))    if top_picks else 0
    return {
        "zip_code":       zip_code,
        "budget":         budget,
        "strategy":       strategy,
        "strategy_label": STRATEGY_LABELS.get(strategy, strategy),
        "mortgage_rate":  mortgage_rate,
        "top1_addr":      top.address   if top else "N/A",
        "top1_price":     top.price     if top else 0,
        "top1_cap":       top.cap_rate  if top else 0,
        "top1_cf":        top.cash_flow if top else 0,
        "top1_score":     top.ai_score  if top else 0,
        "avg_cap":        avg_cap,
        "avg_cf":         avg_cf,
        "n_props":        len(top_picks),
    }


def _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate) -> str:
    if not top_picks:
        return "No properties found. Try a higher budget or different filters."
    top   = top_picks[0]
    label = STRATEGY_LABELS.get(strategy, strategy)
    avg_cap = round(sum(p.cap_rate  for p in top_picks) / len(top_picks), 1)
    avg_cf  = round(sum(p.cash_flow for p in top_picks) / len(top_picks))
    return (
        f"{zip_code} shows {label} potential: avg cap rate {avg_cap}%, "
        f"avg cash flow ${avg_cf}/mo at FRED rate {mortgage_rate}%. "
        f"Top pick {top.address} at ${top.price:,} — "
        f"{top.cap_rate}% cap, ${top.cash_flow}/mo cash flow, AI score {top.ai_score}/100."
    )
