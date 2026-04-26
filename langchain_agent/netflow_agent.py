"""
NetFlow LangChain Agent
- Uses Ollama (Llama 3) for local inference ($0 API cost)
- LangSmith tracing via @traceable
- Scores and ranks properties, streams market summary
- Falls back to rule-based scoring when Ollama is unavailable
"""

import json
import math
from typing import AsyncIterator

from langsmith import traceable
from pydantic import BaseModel, Field

from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL, DEMO_MODE


# ── Output schema ────────────────────────────────────────────

class ScoredProperty(BaseModel):
    rank: int
    address: str
    zip_code: str
    price: int
    est_rent: int
    cap_rate: float = Field(description="Net cap rate after 35% expense ratio")
    cash_flow: int = Field(description="Monthly cash flow after PITI + expenses")
    grm: float = Field(description="Gross Rent Multiplier")
    dom: int = Field(description="Days on market")
    ai_score: int = Field(ge=0, le=100)
    tags: list[str]
    beds: int
    baths: float
    sqft: int


# ── Prompts ──────────────────────────────────────────────────

SCORING_SYSTEM = """You are NetFlow's investment scoring engine.
Score each property 0–100 for the given strategy.

Scoring rubric:
- Cap rate 30%   (>6% = 90–100, 5–6% = 70–89, 4–5% = 50–69, <4% = 0–49)
- Cash flow 25%  (>$400/mo = excellent, $200–400 = good, $0–200 = marginal, <$0 = poor)
- GRM 15%        (<100 = excellent, 100–130 = good, 130–160 = fair, >160 = poor)
- DOM 10%        (lower = higher demand; <14 days = excellent)
- Strategy fit 20% (LTR: stable CF; STR: high gross yield; BRRRR: value-add; Flip: price/sqft)

Return ONLY a JSON array. Each element must include all original fields plus:
  "ai_score": integer 0-100
  "tags": array of 2-4 short strings (property highlights)
No explanation, no markdown fences."""

SUMMARY_SYSTEM = """You are NetFlow, an AI real estate investment advisor.
Be concise, data-driven, and specific. No filler words."""

SUMMARY_HUMAN = """Market search to analyze:
ZIP: {zip_code}
Budget: ${budget:,}
Strategy: {strategy_label}
30yr Mortgage Rate (FRED): {mortgage_rate}%
Top 3 properties: {top_picks}

Write exactly 3–4 sentences covering:
1. Current market conditions in this submarket
2. Investment outlook for {strategy_label} at this budget
3. Top recommendation with specific numeric reasoning

Keep it under 120 words. Use real numbers from the data above."""


# ── Financial helpers ─────────────────────────────────────────

def _compute_financials(listing: dict, mortgage_rate: float) -> dict:
    price = listing["price"]
    rent = listing.get("est_rent", 0)
    expense_ratio = 0.35

    gross_annual = rent * 12
    noi = gross_annual * (1 - expense_ratio)
    cap_rate = round((noi / price) * 100, 2) if price > 0 else 0.0

    # Monthly mortgage P&I + tax/insurance estimate
    down = price * 0.20
    loan = price - down
    r = mortgage_rate / 100 / 12
    n = 360
    if r > 0:
        pi = loan * (r * (1 + r) ** n) / ((1 + r) ** n - 1)
    else:
        pi = loan / n
    piti = pi + price * 0.015 / 12

    cash_flow = int(rent - piti - rent * expense_ratio)
    grm = round(price / gross_annual, 1) if gross_annual > 0 else 0.0

    return {**listing, "cap_rate": cap_rate, "cash_flow": cash_flow, "grm": grm}


def _rule_based_score(prop: dict, strategy: str) -> tuple[int, list[str]]:
    """Fallback scoring when Ollama is unavailable."""
    score = 0
    tags = []

    # Cap rate (30 pts)
    cr = prop.get("cap_rate", 0)
    if cr >= 6:
        score += 30; tags.append(f"{cr}% cap rate")
    elif cr >= 5:
        score += 22
    elif cr >= 4:
        score += 12

    # Cash flow (25 pts)
    cf = prop.get("cash_flow", 0)
    if cf > 400:
        score += 25; tags.append(f"${cf}/mo CF")
    elif cf > 200:
        score += 18
    elif cf > 0:
        score += 8

    # GRM (15 pts)
    grm = prop.get("grm", 200)
    if grm < 100:
        score += 15
    elif grm < 130:
        score += 10
    elif grm < 160:
        score += 5

    # DOM (10 pts)
    dom = prop.get("dom", 30)
    if dom < 14:
        score += 10; tags.append("High demand")
    elif dom < 30:
        score += 6

    # Strategy fit (20 pts)
    if strategy == "LTR" and cf > 200:
        score += 20
    elif strategy == "STR" and prop.get("cap_rate", 0) > 5.5:
        score += 20
    elif strategy == "BRRRR" and dom > 40:
        score += 15; tags.append("Value-add")
    elif strategy == "Flip" and prop.get("dom", 0) < 20:
        score += 18
    else:
        score += 10

    if not tags:
        tags.append(f"{prop.get('beds', 0)}bd/{prop.get('baths', 0)}ba")

    return min(score, 100), tags


STRATEGY_LABELS = {
    "LTR": "Long-term rental",
    "STR": "Short-term rental",
    "BRRRR": "BRRRR (buy-rehab-rent-refinance-repeat)",
    "Flip": "Fix and flip",
}


# ── Agent class ───────────────────────────────────────────────

class NetFlowAgent:
    def __init__(self):
        self._llm = None  # lazy-init so startup doesn't fail if Ollama is down

    def _get_llm(self):
        if self._llm is None:
            from langchain_ollama import ChatOllama
            self._llm = ChatOllama(
                model=OLLAMA_MODEL,
                temperature=0.2,
                base_url=OLLAMA_BASE_URL,
            )
        return self._llm

    @traceable(name="netflow.score_and_rank")
    async def score_and_rank(
        self,
        listings: list[dict],
        mortgage_rate: float,
        strategy: str,
    ) -> list[ScoredProperty]:
        enriched = [_compute_financials(l, mortgage_rate) for l in listings]

        if DEMO_MODE:
            return self._rule_score(enriched, strategy)

        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import JsonOutputParser

            prompt = ChatPromptTemplate.from_messages([
                ("system", SCORING_SYSTEM),
                ("human", "Strategy: {strategy}\nMortgage rate: {mortgage_rate}%\n\nProperties:\n{properties_json}\n\nReturn JSON array."),
            ])
            chain = prompt | self._get_llm() | JsonOutputParser()
            scored_raw = await chain.ainvoke({
                "strategy": strategy,
                "mortgage_rate": mortgage_rate,
                "properties_json": json.dumps(enriched, indent=2),
            })

            results = []
            for i, item in enumerate(scored_raw):
                if i >= len(enriched):
                    break
                base = {**enriched[i], "ai_score": item.get("ai_score", 50), "tags": item.get("tags", [])}
                try:
                    results.append(ScoredProperty(rank=i + 1, **base))
                except Exception:
                    score, tags = _rule_based_score(enriched[i], strategy)
                    results.append(ScoredProperty(rank=i + 1, **{**enriched[i], "ai_score": score, "tags": tags}))

        except Exception:
            # Ollama unavailable — fall back to rule-based
            return self._rule_score(enriched, strategy)

        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results):
            r.rank = i + 1
        return results

    def _rule_score(self, enriched: list[dict], strategy: str) -> list[ScoredProperty]:
        results = []
        for i, prop in enumerate(enriched):
            score, tags = _rule_based_score(prop, strategy)
            results.append(ScoredProperty(rank=i + 1, **{**prop, "ai_score": score, "tags": tags}))
        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results):
            r.rank = i + 1
        return results

    @traceable(name="netflow.market_summary")
    async def market_summary(
        self,
        zip_code: str,
        budget: int,
        strategy: str,
        top_picks: list[ScoredProperty],
        mortgage_rate: float,
    ) -> str:
        if DEMO_MODE:
            return _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import StrOutputParser

            prompt = ChatPromptTemplate.from_messages([
                ("system", SUMMARY_SYSTEM),
                ("human", SUMMARY_HUMAN),
            ])
            chain = prompt | self._get_llm() | StrOutputParser()
            return await chain.ainvoke(_summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate))
        except Exception:
            return _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)

    @traceable(name="netflow.stream_market_summary")
    async def stream_market_summary(
        self,
        zip_code: str,
        budget: int,
        strategy: str,
        top_picks: list[ScoredProperty],
        mortgage_rate: float,
    ) -> AsyncIterator[str]:
        if DEMO_MODE:
            text = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            # Fake streaming token-by-token for consistent UX
            import asyncio
            for word in text.split(" "):
                yield word + " "
                await asyncio.sleep(0.04)
            return

        try:
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_core.output_parsers import StrOutputParser

            prompt = ChatPromptTemplate.from_messages([
                ("system", SUMMARY_SYSTEM),
                ("human", SUMMARY_HUMAN),
            ])
            chain = prompt | self._get_llm() | StrOutputParser()
            async for chunk in chain.astream(_summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate)):
                yield chunk
        except Exception:
            import asyncio
            text = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            for word in text.split(" "):
                yield word + " "
                await asyncio.sleep(0.04)


# ── Helpers ───────────────────────────────────────────────────

def _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate) -> dict:
    top_str = "; ".join(
        f"{p.address} at ${p.price:,} (cap {p.cap_rate}%, CF ${p.cash_flow}/mo)"
        for p in top_picks
    )
    return {
        "zip_code": zip_code,
        "budget": budget,
        "strategy": strategy,
        "strategy_label": STRATEGY_LABELS.get(strategy, strategy),
        "mortgage_rate": mortgage_rate,
        "top_picks": top_str,
    }


def _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate) -> str:
    if not top_picks:
        return "No properties found for this search. Try increasing your budget or adjusting filters."
    top = top_picks[0]
    label = STRATEGY_LABELS.get(strategy, strategy)
    avg_cap = round(sum(p.cap_rate for p in top_picks) / len(top_picks), 1)
    avg_cf = round(sum(p.cash_flow for p in top_picks) / len(top_picks))
    return (
        f"The {zip_code} submarket shows solid fundamentals for {label} investment, "
        f"with top properties averaging a {avg_cap}% cap rate and ${avg_cf}/mo cash flow "
        f"at the current 30-year rate of {mortgage_rate}%. "
        f"Your top pick — {top.address} at ${top.price:,} — delivers a "
        f"{top.cap_rate}% cap rate and ${top.cash_flow}/mo cash flow, "
        f"with an estimated rent of ${top.est_rent:,}/mo. "
        f"At this budget of ${budget:,}, {label} remains the strongest strategy "
        f"given current financing costs and local rent growth trends."
    )
