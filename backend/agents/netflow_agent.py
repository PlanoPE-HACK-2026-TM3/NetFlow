"""
NetFlow — AI Agent System  v3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ARCHITECTURE  ─  Three distinct agents, each with a clear purpose:

  ┌─────────────────────────────────────────────────────────────┐
  │  ORCHESTRATOR  (NetFlowOrchestrator)                        │
  │  Routes intent → selects pipeline → coordinates sub-agents  │
  └────────────────────┬────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌───────────┐  ┌──────────────┐
  │ MARKET   │  │ PROPERTY  │  │ RISK         │
  │ ANALYST  │  │ SCORER    │  │ ADVISOR      │
  │ Agent    │  │ Agent     │  │ Agent        │
  └──────────┘  └───────────┘  └──────────────┘

AGENT 1 — Market Analyst
  Tools:  get_market_rate(), get_comparable_rents(), get_market_stats()
  Memory: 5-turn sliding window per ZIP (avoids re-fetching same market data)
  LLM use: Generate actionable market narrative from live data context
  Output: MarketContext (rate, trend, avg_rent, vacancy, growth)

AGENT 2 — Property Scorer
  Tools:  score_property(), compute_financials(), apply_strategy_lens()
  Memory: Accumulates property scores in session for relative comparison
  LLM use: Batch-score 10 properties in ONE call (compact 6-field payload)
           Then: strategy-specific reranking with qualitative reasoning
  Output: List[ScoredProperty] with tags, strategy_note, risk_flags

AGENT 3 — Risk Advisor
  Tools:  flag_market_risk(), flag_property_risk(), compute_risk_score()
  Memory: Stores risk profiles per ZIP for cross-request consistency
  LLM use: Generate property-specific risk memo (used in PropertyChat grounding)
  Output: RiskProfile per property (overall_risk, factors, mitigation)

DECISION LOGIC
  • Orchestrator checks Ollama availability once; gates all LLM paths
  • Each tool call is logged with timing → AgentContext.tool_trace
  • Retry on connection error: tenacity 3× exponential 1–4s
  • Fallback at every stage: identical deterministic rubric, silent
  • Prompt injection defence: raw user text NEVER reaches any LLM
  • Token budget: Stage 1 ≈350 tok, Stage 2 ≈250 tok, Stage 3 ≈200 tok

MEMORY / RETRIEVAL
  • MarketMemory: TTL-keyed dict; same ZIP within 15min → skip re-fetch
  • ConversationMemory: per-property sliding window for PropertyChat (5 turns)
  • SessionContext: request-scoped dataclass accumulates all intermediate results
  • RiskCache: cross-request risk profiles per ZIP (1hr TTL)

OBSERVABILITY
  • AgentContext.tool_trace: every tool call with name, args, duration, status
  • stage_times: per-stage latency
  • token_usage: estimated per stage
  • All public methods decorated @traceable → LangSmith span tree
"""

from __future__ import annotations

import ast
import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

import httpx
from pydantic import BaseModel, Field
from tenacity import (
    retry, stop_after_attempt,
    wait_exponential, retry_if_exception_type,
)

from backend.config import (
    OLLAMA_BASE_URL, OLLAMA_MODEL, DEMO_MODE,
    LANGCHAIN_API_KEY, USE_OLLAMA_OVERRIDE,
)

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator

try:
    from langsmith import Client as LangSmithClient
    from langsmith.run_helpers import get_current_run_tree
    _LS_FEEDBACK_AVAILABLE = True
except Exception:
    LangSmithClient = None
    get_current_run_tree = None
    _LS_FEEDBACK_AVAILABLE = False

try:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser
    from langchain_ollama import ChatOllama
    _LC_AVAILABLE = True
except ImportError:
    _LC_AVAILABLE = False

log         = logging.getLogger("netflow.agent")
log_market  = logging.getLogger("netflow.agent.market")
log_scorer  = logging.getLogger("netflow.agent.scorer")
log_risk    = logging.getLogger("netflow.agent.risk")
log_cache   = logging.getLogger("netflow.cache")


# ══════════════════════════════════════════════════════════════
# 1.  CORE DATA MODELS
# ══════════════════════════════════════════════════════════════

class ScoredProperty(BaseModel):
    rank:          int
    address:       str
    zip_code:      str
    price:         int
    est_rent:      int
    cap_rate:      float = Field(description="Net cap rate after 35% expense ratio")
    cash_flow:     int   = Field(description="Monthly cash flow after PITI + expenses")
    grm:           float = Field(description="Gross Rent Multiplier")
    dom:           int   = Field(description="Days on market")
    ai_score:      int   = Field(ge=0, le=100)
    tags:          list[str]
    beds:          int
    baths:         float
    sqft:          int
    year_built:    int   = 0
    lot_size:      int   = 0
    mls_id:        str   = ""
    map_query:     str   = ""
    photo_url:     str   = ""
    # Rich agent outputs (new in v3)
    strategy_note: str   = ""   # why this property fits the strategy
    risk_level:    str   = ""   # LOW / MEDIUM / HIGH
    risk_factors:  list[str] = Field(default_factory=list)
    groundedness_score: int = Field(default=0, ge=0, le=100)
    correctness_score:  int = Field(default=0, ge=0, le=100)
    confidence_score:   int = Field(default=0, ge=0, le=100)


@dataclass
class ToolCall:
    """Single tool invocation record — stored in AgentContext.tool_trace."""
    name:     str
    args:     dict
    result:   object
    duration: float          # seconds
    status:   str = "ok"     # ok | fallback | error


@dataclass
class MarketContext:
    """Output of Market Analyst Agent — rich market data for a ZIP."""
    zip_code:      str
    mortgage_rate: float
    avg_rent:      int   = 0
    vacancy_rate:  float = 0.0
    rent_growth:   float = 0.0
    avg_dom:       int   = 30
    supply_trend:  str   = "stable"   # tight | stable | oversupply
    retrieved_at:  float = field(default_factory=time.time)


@dataclass
class RiskProfile:
    """Output of Risk Advisor Agent per property."""
    address:      str
    overall_risk: str              # LOW | MEDIUM | HIGH
    score:        int              # 0=lowest risk, 100=highest
    factors:      list[str]        # human-readable risk factors
    mitigations:  list[str]        # suggested mitigations
    memo:         str = ""         # LLM-generated 2-sentence risk memo


@dataclass
class AgentContext:
    """
    Request-scoped session context.
    Passed through all agents; accumulates every intermediate result
    so later stages have full visibility into earlier decisions.
    """
    # ── Inputs ────────────────────────────────────────────────
    zip_code:      str
    budget:        int
    strategy:      str
    listings:      list[dict] = field(default_factory=list)

    # ── Intermediate state ────────────────────────────────────
    market_ctx:    MarketContext | None = None
    enriched:      list[dict]           = field(default_factory=list)
    scored:        list[dict]           = field(default_factory=list)
    risk_profiles: dict[str, RiskProfile] = field(default_factory=dict)

    # ── Observability ─────────────────────────────────────────
    tool_trace:    list[ToolCall]       = field(default_factory=list)
    stage_times:   dict[str, float]    = field(default_factory=dict)
    token_usage:   dict[str, int]      = field(default_factory=dict)
    fallback_used: dict[str, bool]     = field(default_factory=dict)
    errors:        list[str]           = field(default_factory=list)
    llm_available: bool = True

    def record_tool(self, name: str, args: dict, result: object,
                    duration: float, status: str = "ok") -> None:
        self.tool_trace.append(ToolCall(name, args, result, duration, status))
        log.debug("TOOL %-30s  %.3fs  [%s]", name, duration, status)

    def to_trace_summary(self) -> dict:
        return {
            "stages":    self.stage_times,
            "tokens":    self.token_usage,
            "fallback":  self.fallback_used,
            "tools":     [{"name":t.name,"dur":t.duration,"status":t.status}
                          for t in self.tool_trace],
            "errors":    self.errors,
        }


# ══════════════════════════════════════════════════════════════
# 2.  AGENT MEMORY  (in-process, TTL-keyed)
# ══════════════════════════════════════════════════════════════

class MarketMemory:
    """
    Market Analyst memory — caches MarketContext per ZIP.
    Same ZIP within TTL → skip re-fetching external APIs.
    Implements a simple retrieval step: lookup → hit/miss → tool call.
    """
    _store: dict[str, MarketContext] = {}
    TTL = 900   # 15 min — aligns with RentCast cache

    @classmethod
    def get(cls, zip_code: str) -> MarketContext | None:
        ctx = cls._store.get(zip_code)
        if ctx and (time.time() - ctx.retrieved_at) < cls.TTL:
            age = round(time.time() - ctx.retrieved_at, 1)
            log_cache.debug("MarketMemory HIT | zip=%s age=%.1fs", zip_code, age)
            return ctx
        log_cache.debug("MarketMemory MISS | zip=%s", zip_code)
        return None

    @classmethod
    def set(cls, ctx: MarketContext) -> None:
        cls._store[ctx.zip_code] = ctx

    @classmethod
    def invalidate(cls, zip_code: str) -> None:
        cls._store.pop(zip_code, None)


class RiskCache:
    """
    Risk Advisor memory — caches RiskProfile per ZIP (1hr TTL).
    Cross-request: same ZIP same strategy → consistent risk scores.
    """
    _store: dict[str, tuple[float, dict[str, RiskProfile]]] = {}
    TTL = 3600  # 1 hr

    @classmethod
    def get(cls, zip_code: str) -> dict[str, RiskProfile] | None:
        entry = cls._store.get(zip_code)
        if entry and (time.time() - entry[0]) < cls.TTL:
            log_cache.debug("RiskCache HIT | zip=%s profiles=%d", zip_code, len(entry[1]))
            return entry[1]
        log_cache.debug("RiskCache MISS | zip=%s", zip_code)
        return None

    @classmethod
    def set(cls, zip_code: str, profiles: dict[str, RiskProfile]) -> None:
        cls._store[zip_code] = (time.time(), profiles)


class ConversationMemory:
    """
    PropertyChat sliding window memory — keeps last N turns per property address.
    Used to build the grounded system prompt with recent conversation context.
    Prevents the LLM from contradicting itself across turns.
    """
    _store: dict[str, list[dict]] = {}
    MAX_TURNS = 5

    @classmethod
    def get(cls, address: str) -> list[dict]:
        return cls._store.get(address, [])

    @classmethod
    def add(cls, address: str, role: str, content: str) -> None:
        history = cls._store.setdefault(address, [])
        history.append({"role": role, "content": content})
        if len(history) > cls.MAX_TURNS * 2:  # each turn = user + assistant
            cls._store[address] = history[-(cls.MAX_TURNS * 2):]

    @classmethod
    def clear(cls, address: str) -> None:
        cls._store.pop(address, None)


# ══════════════════════════════════════════════════════════════
# 3.  TOOL REGISTRY
#     Every external call is a named tool with timing + fallback.
#     Tools are the primitives; agents compose them.
# ══════════════════════════════════════════════════════════════

def _tool(name: str):
    """Decorator: wraps a coroutine as a named agent tool with timing."""
    def decorator(fn):
        async def wrapper(ctx: AgentContext, *args, **kwargs):
            t0 = time.perf_counter()
            try:
                result = await fn(ctx, *args, **kwargs)
                ctx.record_tool(name, kwargs, result, time.perf_counter()-t0)
                return result
            except Exception as e:
                ctx.record_tool(name, kwargs, str(e), time.perf_counter()-t0, "error")
                raise
        wrapper.__name__ = fn.__name__
        return wrapper
    return decorator


# ── Financial tools (deterministic, 0 tokens) ─────────────────

def compute_financials(listing: dict, mortgage_rate: float) -> dict:
    price         = listing["price"]
    rent          = listing.get("est_rent", 0)
    noi           = rent * 12 * 0.65
    cap_rate      = round((noi / price) * 100, 2) if price > 0 else 0.0
    down          = price * 0.20
    loan          = price - down
    r             = mortgage_rate / 100 / 12
    pn            = (1 + r) ** 360
    pi            = loan * (r * pn) / (pn - 1) if r > 0 else loan / 360
    piti          = pi + price * 0.015 / 12
    cash_flow     = int(rent - piti - rent * 0.35)
    grm           = round(price / (rent*12), 1) if rent > 0 else 0.0
    coc           = round(((rent - piti - rent*0.35)*12) / (price*0.20)*100, 1)
    break_even    = int(piti * 1.15)
    return {
        **listing,
        "cap_rate":    cap_rate,
        "cash_flow":   cash_flow,
        "grm":         grm,
        "coc_return":  coc,
        "break_even":  break_even,
        "piti":        int(piti),
        "noi_annual":  int(noi),
    }


def compact_for_llm(prop: dict) -> dict:
    """4-field ultra-compact payload — minimal fields needed by scorer rubric."""
    return {
        "c":  round(prop.get("cap_rate",  0), 2),
        "cf": int(prop.get("cash_flow", 0)),
        "g":  round(prop.get("grm",      0), 1),
        "d":  int(prop.get("dom",        30)),
    }


SCORER_TAGS = [
    "Cash+", "High cap", "Hot deal", "Value-add", "Low DOM", "High yield", "Neg CF"
]


def _decode_llm_tags(raw_tags: object) -> list[str]:
    """Accept tag IDs or strings from LLM and normalize to canonical tag labels."""
    if not isinstance(raw_tags, list):
        return []

    tags: list[str] = []
    for item in raw_tags:
        if isinstance(item, int) and 0 <= item < len(SCORER_TAGS):
            tags.append(SCORER_TAGS[item])
            continue

        if isinstance(item, str):
            if item.isdigit():
                idx = int(item)
                if 0 <= idx < len(SCORER_TAGS):
                    tags.append(SCORER_TAGS[idx])
                    continue
            tags.append(item)

    # Preserve order, dedupe, max 2
    seen = set()
    out: list[str] = []
    for t in tags:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 2:
            break
    return out


# ── Risk tools ────────────────────────────────────────────────

def compute_risk_score(prop: dict) -> tuple[int, list[str], list[str]]:
    """
    Deterministic risk scoring.  Returns (score 0-100, factors, mitigations).
    Score 0 = safest. Accumulates penalty points per risk factor.
    """
    score, factors, mitigations = 0, [], []

    if prop.get("cash_flow", 0) < 0:
        score += 30; factors.append("Negative cash flow")
        mitigations.append("Negotiate price down or increase rent before closing")
    elif prop.get("cash_flow", 0) < 100:
        score += 15; factors.append("Marginal cash flow")
        mitigations.append("Consider 25% down payment to reduce PITI")

    cr = prop.get("cap_rate", 0)
    if cr < 4:
        score += 25; factors.append(f"Low cap rate ({cr}%)")
        mitigations.append("Target ≥6% cap — evaluate operating expense reduction")
    elif cr < 5:
        score += 10; factors.append(f"Below-avg cap rate ({cr}%)")

    dom = prop.get("dom", 0)
    if dom > 90:
        score += 20; factors.append(f"Very high DOM ({dom} days)")
        mitigations.append("Investigate why property sits — inspect for deferred maintenance")
    elif dom > 60:
        score += 10; factors.append(f"High DOM ({dom} days)")

    grm = prop.get("grm", 0)
    if grm > 180:
        score += 15; factors.append(f"Very high GRM ({grm}×)")
        mitigations.append("Rent-to-price ratio is poor; negotiate harder or skip")
    elif grm > 150:
        score += 8; factors.append(f"Elevated GRM ({grm}×)")

    yr = prop.get("year_built", 0)
    if yr and yr < 1960:
        score += 15; factors.append(f"Old construction ({yr})")
        mitigations.append("Budget $15–25k for deferred maintenance; inspect electrical/plumbing")
    elif yr and yr < 1980:
        score += 5; factors.append(f"Aging construction ({yr})")

    risk_level = "LOW" if score < 20 else "MEDIUM" if score < 45 else "HIGH"
    return min(score, 100), factors, mitigations, risk_level


def compute_quality_scores(
    prop: dict,
    strategy: str,
    risk_score: int | None = None,
) -> tuple[int, int, int]:
    """
    Derive lightweight trust signals for UI and traces.

    groundedness: how much of the output is anchored in concrete listing/financial data
    correctness: how closely the final score aligns with the deterministic scoring rubric
    confidence: blended trust signal using groundedness, correctness, and risk
    """
    required_fields = [
        "price", "est_rent", "cap_rate", "cash_flow", "grm",
        "dom", "beds", "baths", "sqft",
    ]
    optional_fields = ["year_built", "lot_size"]

    present_required = sum(
        1 for field in required_fields
        if prop.get(field) not in (None, "", 0)
    )
    present_optional = sum(
        1 for field in optional_fields
        if prop.get(field) not in (None, "", 0)
    )
    groundedness = int(round(
        70 * (present_required / len(required_fields)) +
        30 * (present_optional / len(optional_fields))
    ))

    baseline_score, _ = _rule_based_score_fn(prop, strategy)
    score_delta = abs(int(prop.get("ai_score", baseline_score)) - baseline_score)
    correctness = max(45, 100 - min(55, score_delta * 3))

    if prop.get("cash_flow", 0) < 0 and prop.get("ai_score", 0) > 70:
        correctness = max(25, correctness - 20)
    if prop.get("cap_rate", 0) < 4 and prop.get("ai_score", 0) > 75:
        correctness = max(25, correctness - 15)

    risk_penalty = min(40, max(0, risk_score or 0) // 2)
    confidence = int(round(0.4 * groundedness + 0.35 * correctness + 0.25 * (100 - risk_penalty)))
    confidence = max(0, min(100, confidence))

    return groundedness, correctness, confidence


def _metric_distribution(values: list[float]) -> dict[str, float]:
    """Return compact percentile stats for observability payloads."""
    if not values:
        return {"min": 0.0, "p50": 0.0, "p90": 0.0, "max": 0.0}
    s = sorted(values)

    def _pct(p: float) -> float:
        idx = min(len(s) - 1, max(0, int(round((len(s) - 1) * p))))
        return round(float(s[idx]), 2)

    return {
        "min": round(float(s[0]), 2),
        "p50": _pct(0.50),
        "p90": _pct(0.90),
        "max": round(float(s[-1]), 2),
    }


def estimate_demo_tokens(num_properties: int, tool_calls: int) -> dict[str, int]:
    """
    Deterministic token estimate for DEMO/rule-fallback mode.
    Used for observability dashboards when no provider-reported usage exists.
    """
    # Calibrated to reflect compact prompts/payloads while staying realistic.
    prompt_tokens = int(90 + num_properties * 16 + tool_calls * 4)
    completion_tokens = int(40 + num_properties * 10)
    total_tokens = prompt_tokens + completion_tokens
    return {
        "estimated_prompt_tokens": prompt_tokens,
        "estimated_completion_tokens": completion_tokens,
        "estimated_total_tokens": total_tokens,
    }


def emit_quality_feedback_to_langsmith(
    scored: list[ScoredProperty],
    strategy: str,
    demo_mode: bool,
    llm_available: bool,
    run_id: str | None = None,
    request_id: str | None = None,
    stage_times: dict[str, float] | None = None,
    token_usage: dict[str, int] | None = None,
    fallback_used: dict[str, bool] | None = None,
) -> None:
    """
    Publish aggregate trust metrics to LangSmith feedback on the current run.
    This keeps evaluator signals in observability instead of user-facing UI.
    """
    if not scored:
        log.debug("LangSmith feedback skipped: empty scored list")
        return
    if not _LS_FEEDBACK_AVAILABLE:
        log.warning("LangSmith feedback skipped: langsmith client unavailable")
        return
    if not LANGCHAIN_API_KEY:
        log.warning("LangSmith feedback skipped: LANGCHAIN_API_KEY missing")
        return
    try:
        run_ids: list[str] = []

        parent_run_id = (run_id or "").strip()
        if parent_run_id:
            run_ids.append(parent_run_id)

        run_tree = get_current_run_tree() if get_current_run_tree else None
        current_run_id = str(getattr(run_tree, "id", "") or "").strip()
        if current_run_id and current_run_id not in run_ids:
            run_ids.append(current_run_id)

        if not run_ids:
            log.warning("LangSmith feedback skipped: no run_id available")
            return

        n = len(scored)
        avg_grounded = round(sum(p.groundedness_score for p in scored) / n, 2)
        avg_correct = round(sum(p.correctness_score for p in scored) / n, 2)
        avg_conf = round(sum(p.confidence_score for p in scored) / n, 2)
        dist_grounded = _metric_distribution([p.groundedness_score for p in scored])
        dist_correct = _metric_distribution([p.correctness_score for p in scored])
        dist_conf = _metric_distribution([p.confidence_score for p in scored])

        client = LangSmithClient()

        sent = 0

        def _send_feedback(**kwargs) -> None:
            """Send one feedback item to all resolved run IDs without blocking on failure."""
            nonlocal sent
            key = kwargs.get("key", "unknown")
            for rid in run_ids:
                try:
                    client.create_feedback(run_id=rid, **kwargs)
                    sent += 1
                except Exception as item_exc:
                    log.warning(
                        "LangSmith feedback item failed | run_id=%s | key=%s | err=%s",
                        rid,
                        key,
                        item_exc,
                    )

        common = {
            "source_info": {
                "request_id": request_id or "",
                "strategy": strategy,
                "demo_mode": demo_mode,
                "llm_available": llm_available,
                "sample_size": n,
                "stage_times": stage_times or {},
                "token_usage": token_usage or {},
                "fallback_used": fallback_used or {},
            }
        }

        def _score_0_1(percent: float) -> float:
            # LangSmith feedback API accepts score precision up to 4 decimals.
            return round(float(percent) / 100.0, 4)

        _send_feedback(
            key="groundedness",
            score=_score_0_1(avg_grounded),
            value={
                "avg_percent": avg_grounded,
                "definition": (
                    "Degree to which conclusions are explicitly supported by retrieved listing facts "
                    "and deterministic financial calculations (not free-form assumptions)."
                ),
                "interpretation": {
                    "high_80_100": "Strong evidence grounding; low hallucination risk.",
                    "mid_60_79": "Mostly grounded with minor inferred reasoning.",
                    "low_0_59": "Weak grounding; review data coverage and prompts.",
                },
                "distribution": dist_grounded,
            },
            comment=(
                f"Average groundedness across {n} properties. "
                "Measures factual anchoring to observed inputs and computed metrics."
            ),
            **common,
        )
        _send_feedback(
            key="correctness",
            score=_score_0_1(avg_correct),
            value={
                "avg_percent": avg_correct,
                "definition": (
                    "Consistency between model/reranked outcomes and the deterministic rubric baseline "
                    "plus financial sanity checks (cash flow, cap-rate, risk constraints)."
                ),
                "interpretation": {
                    "high_80_100": "Outputs agree with baseline and constraints.",
                    "mid_60_79": "Acceptable deviation for qualitative ranking adjustments.",
                    "low_0_59": "Material divergence; investigate scoring logic or prompt drift.",
                },
                "distribution": dist_correct,
            },
            comment=(
                f"Average correctness across {n} properties. "
                "Captures agreement with deterministic scoring expectations."
            ),
            **common,
        )
        _send_feedback(
            key="confidence",
            score=_score_0_1(avg_conf),
            value={
                "avg_percent": avg_conf,
                "definition": (
                    "Calibrated trust indicator combining groundedness, correctness, and risk penalty. "
                    "This is a pipeline reliability signal, not a probability of return."
                ),
                "interpretation": {
                    "high_80_100": "High trust in pipeline output quality for this run.",
                    "mid_60_79": "Moderate trust; acceptable with human review.",
                    "low_0_59": "Low trust; verify data quality and fallback conditions.",
                },
                "distribution": dist_conf,
            },
            comment=(
                f"Average confidence across {n} properties. "
                "Composite reliability score for the run-level decision output."
            ),
            **common,
        )

        if token_usage:
            _send_feedback(
                key="token_usage_estimate",
                value={
                    "mode": "estimated_demo" if demo_mode else "estimated",
                    "prompt_tokens": int(token_usage.get("estimated_prompt_tokens", 0)),
                    "completion_tokens": int(token_usage.get("estimated_completion_tokens", 0)),
                    "total_tokens": int(token_usage.get("estimated_total_tokens", 0)),
                },
                comment="Estimated token usage for this run (demo fallback, not provider-reported).",
                **common,
            )

        log.info(
            "LangSmith feedback sent | run_ids=%s | items=%d | strategy=%s | request_id=%s",
            run_ids,
            sent,
            strategy,
            request_id,
        )
    except Exception as exc:
        log.warning("LangSmith feedback publish skipped: %s", exc)


# ══════════════════════════════════════════════════════════════
# 4.  LLM PROMPT TEMPLATES
# ══════════════════════════════════════════════════════════════

# Agent 2 — Scorer: compact batch scoring
SCORING_SYSTEM = """Score properties 0-100. c*30 + cf*25 + g*15 + d*10 + strategy*20.
c: >6→90, 5-6→75, 4-5→55, <4→30.  cf: >400→100, 200-400→75, 0-200→40, <0→0.  g: <100→100, 100-130→70, 130-160→40, >160→10.  d: <14→100, <30→65, <60→30, ≥60→0.
Strategy: LTR cf>200 +8, STR c>5.5 +8, BRRRR d>40 +8, Flip d<20 +8.
Tag IDs: 0=Cash+,1=High cap,2=Hot deal,3=Value-add,4=Low DOM,5=High yield,6=Neg CF.
Return ONLY valid JSON, same order, each object with keys score and t where t is a list of tag IDs. No explanation/markdown."""

SCORING_HUMAN = "Strategy: {strategy} | Mortgage rate: {rate}%\nProperties:\n{data}"

# Strategy reranking is rule-based (see _rule_strategy_rerank).
# No LLM call needed — deterministic adjustments are faster and more reliable
# with local llama3 than trying to parse structured JSON reranking output.
STRATEGY_LABELS_LONG = {
    "LTR":   "Long-term rental (stable income)",
    "STR":   "Short-term rental — Airbnb/VRBO",
    "BRRRR": "BRRRR — buy, rehab, rent, refi, repeat",
    "Flip":  "Fix and flip",
}

# Agent 3 — Risk advisor: property risk memo
RISK_MEMO_SYSTEM = """\
2-sentence risk memo for real estate investor. Be specific, use numbers, max 50 words. Plain text only.\
"""

RISK_MEMO_HUMAN = """\
{address} | ${price:,} | {beds}bd | {year_built} | cap {cap_rate}% | CF ${cash_flow}/mo | GRM {grm}x | DOM {dom}d | Risk: {risk_level}
Factors: {factors} | Mitigations: {mitigations}\
"""

# Agent 1 — Market Analyst: narrative
MARKET_SUMMARY_SYSTEM = "Concise real estate market summary, max 60 words. Numbers only, no filler."

MARKET_SUMMARY_HUMAN = """\
ZIP {zip_code} | {strategy_label} | Rate {mortgage_rate}% | Budget ${budget:,}
Top: {top1_addr} ${top1_price:,} cap {top1_cap}% CF ${top1_cf}/mo score {top1_score}
Avg cap {avg_cap}% CF ${avg_cf}/mo | Rent ${avg_rent}/mo DOM {avg_dom}d
2 sentences: outlook + top pick.\
"""

STRATEGY_LABELS = {
    "LTR":   "Long-term rental",
    "STR":   "Short-term rental (Airbnb)",
    "BRRRR": "BRRRR",
    "Flip":  "Fix and flip",
}


# ══════════════════════════════════════════════════════════════
# 5.  AGENT 1 — MARKET ANALYST
#     Tools: get_market_rate(), get_market_stats()
#     Memory: MarketMemory (TTL-keyed retrieval)
#     LLM: narrative summary (Stage 4)
# ══════════════════════════════════════════════════════════════

class MarketAnalystAgent:
    """
    Responsible for: fetching live market data, building MarketContext,
    generating the streaming market narrative.

    Workflow:
      1. Retrieve from MarketMemory → hit: return cached, skip tools
      2. Miss: call tools (FRED rate + RentCast market stats) in parallel
      3. Build MarketContext; store in memory
      4. Later: stream narrative via LLM (Stage 4)
    """

    async def build_market_context(
        self,
        ctx: AgentContext,
        fred_service,
        rentcast_service,
    ) -> MarketContext:
        # ── RETRIEVAL: check memory before calling APIs ────────
        cached = MarketMemory.get(ctx.zip_code)
        if cached:
            log.info("MarketMemory HIT for %s", ctx.zip_code)
            ctx.record_tool("market_memory_retrieve",
                            {"zip": ctx.zip_code},
                            "HIT", 0.0, "ok")
            ctx.fallback_used["market_memory"] = False
            return cached

        # ── TOOL CALLS: parallel API fetch ────────────────────
        t0 = time.perf_counter()

        rate_task  = fred_service.get_30yr_rate()
        stats_task = rentcast_service.get_market_stats(ctx.zip_code)
        mortgage_rate, stats = await asyncio.gather(rate_task, stats_task)

        ctx.record_tool("get_market_rate",  {"source": "FRED"},
                        mortgage_rate, time.perf_counter()-t0)
        ctx.record_tool("get_market_stats", {"zip": ctx.zip_code},
                        stats, time.perf_counter()-t0)
        log_market.debug(
            "Market fetch done | zip=%s rate=%.2f avg_rent=%s dom=%s trend=%s",
            ctx.zip_code, mortgage_rate,
            stats.get("median_rent","?"),
            stats.get("avg_days_on_market","?"),
            stats.get("supply_trend","?"),
        )

        # ── BUILD MarketContext ────────────────────────────────
        market = MarketContext(
            zip_code      = ctx.zip_code,
            mortgage_rate = mortgage_rate,
            avg_rent      = stats.get("median_rent") or 0,
            vacancy_rate  = stats.get("vacancy_rate") or 5.0,
            rent_growth   = stats.get("rent_growth_yoy") or 2.5,
            avg_dom       = stats.get("avg_days_on_market") or 30,
            supply_trend  = (
                "tight"       if (stats.get("avg_days_on_market") or 30) < 20
                else "oversupply" if (stats.get("avg_days_on_market") or 30) > 60
                else "stable"
            ),
        )

        # ── STORE in memory for next request ──────────────────
        MarketMemory.set(market)
        return market

    async def stream_narrative(
        self,
        ctx: AgentContext,
        budget: int,
        strategy: str,
        top_picks: list[ScoredProperty],
        llm,
        pipeline_note: str = "Ollama llama3",
    ) -> AsyncIterator[str]:
        """Stage 4: Streaming narrative, grounded in live market data."""
        top  = top_picks[0] if top_picks else None
        mc   = ctx.market_ctx
        avgs = {
            "avg_cap": round(sum(p.cap_rate  for p in top_picks)/len(top_picks), 1) if top_picks else 0,
            "avg_cf":  round(sum(p.cash_flow for p in top_picks)/len(top_picks))    if top_picks else 0,
        }

        template_vars = {
            "zip_code":       ctx.zip_code,
            "budget":         budget,
            "strategy":       strategy,
            "strategy_label": STRATEGY_LABELS.get(strategy, strategy),
            "mortgage_rate":  mc.mortgage_rate if mc else 7.2,
            "top1_addr":      top.address   if top else "N/A",
            "top1_price":     top.price     if top else 0,
            "top1_cap":       top.cap_rate  if top else 0,
            "top1_cf":        top.cash_flow if top else 0,
            "top1_score":     top.ai_score  if top else 0,
            "avg_rent":       mc.avg_rent   if mc else 0,
            "avg_dom":        mc.avg_dom    if mc else 30,
            "vacancy":        mc.vacancy_rate if mc else 5.0,
            "rent_growth":    mc.rent_growth  if mc else 2.5,
            "pipeline_note":  pipeline_note,
            **avgs,
            "n_props":        len(top_picks),
        }

        try:
            prompt = ChatPromptTemplate.from_messages([
                ("system", MARKET_SUMMARY_SYSTEM),
                ("human",  MARKET_SUMMARY_HUMAN),
            ])
            # Cap summary at 72 tokens — 2 short sentences fit comfortably
            summary_llm = llm.bind(num_predict=72, temperature=0.1)
            chain = prompt | summary_llm | StrOutputParser()
            char_count = 0
            async for chunk in chain.astream(template_vars):
                char_count += len(chunk)
                yield chunk
            # ~0.75 chars/token rough estimate for tracking
            ctx.token_usage["market_summary"] = int(char_count / 0.75) + 55
        except Exception as e:
            log.warning("Narrative LLM failed: %s", e)
            for word in _rule_summary(ctx, budget, strategy, top_picks).split(" "):
                yield word + " "
                await asyncio.sleep(0.03)


# ══════════════════════════════════════════════════════════════
# 6.  AGENT 2 — PROPERTY SCORER
#     Tools: compute_financials(), score_batch(), strategy_rerank()
#     Memory: session-scoped AgentContext.enriched / .scored
#     LLM: batch scoring (1 call / 10 props) + strategy reranking
# ══════════════════════════════════════════════════════════════

class PropertyScorerAgent:
    """
    Responsible for: enriching listings with financials, batch LLM scoring,
    strategy-aware reranking, and building the final ScoredProperty list.

    Workflow:
      1. enrich()   → compute_financials() for all 10 listings (deterministic)
      2. score()    → ONE Ollama call with compact 6-field payload
      3. rerank()   → SECOND Ollama call with strategy lens
      4. assemble() → merge all data into ScoredProperty models
    """

    async def run(
        self,
        ctx: AgentContext,
        mortgage_rate: float,
        llm,
    ) -> list[ScoredProperty]:

        # ── Step 1: Financial enrichment (deterministic tool) ──
        t0 = time.perf_counter()
        for i, listing in enumerate(ctx.listings):
            enriched = compute_financials(listing, mortgage_rate)
            enriched["_idx"] = i  # positional key for LLM matching
            ctx.enriched.append(enriched)
        ctx.stage_times["enrich"] = round(time.perf_counter()-t0, 3)
        ctx.record_tool("compute_financials_batch",
                        {"count": len(ctx.listings), "rate": mortgage_rate},
                        "ok", ctx.stage_times["enrich"])

        if DEMO_MODE or not ctx.llm_available:
            ctx.fallback_used["scorer"] = True
            return self._rule_score_all(ctx)

        # ── Step 2: LLM batch scoring ──────────────────────────
        t1 = time.perf_counter()
        scored_raw = await self._llm_score_batch(ctx, mortgage_rate, llm)
        ctx.stage_times["llm_score"] = round(time.perf_counter()-t1, 3)

        # ── Step 3: Strategy reranking (rule-based, deterministic) ──
        t2 = time.perf_counter()
        reranked = self._rule_strategy_rerank(ctx, scored_raw)
        ctx.stage_times["strategy_rerank"] = round(time.perf_counter()-t2, 3)

        # ── Step 4: Assemble final models ──────────────────────
        ctx.scored = reranked
        return self._assemble(ctx)

    async def _llm_score_batch(
        self, ctx: AgentContext, rate: float, llm
    ) -> list[dict]:
        """
        One LLM call, all 10 properties.
        Compact 6-field input keeps prompt ≈ 300 tokens.
        """
        compact  = [compact_for_llm(p) for p in ctx.enriched]
        prompt   = ChatPromptTemplate.from_messages([
            ("system", SCORING_SYSTEM),
            ("human",  SCORING_HUMAN),
        ])
        scorer_llm = llm.bind(num_predict=260, temperature=0.1)
        chain = prompt | scorer_llm | StrOutputParser()

        try:
            raw_text = await chain.ainvoke({
                "strategy": ctx.strategy,
                "rate":     rate,
                "data":     json.dumps(compact, separators=(",", ":")),
            })
            
            # Try to parse as JSON, handling unquoted keys gracefully
            try:
                raw = json.loads(raw_text)
            except json.JSONDecodeError:
                # Try using ast.literal_eval for Python-like syntax
                raw = ast.literal_eval(raw_text)
            
            # Prompt ≈ 60 tokens + 4 fields×10 props×~2 tokens each = ~140.
            # Completion ≈ 2 fields×10 items×~2 tokens each = ~40.
            ctx.token_usage["llm_score"] = len(compact) * 18 + 80
            log_scorer.debug(
                "LLM batch score | n=%d strategy=%s est_tokens=%d",
                len(compact), ctx.strategy, ctx.token_usage["llm_score"],
            )

            # Validate: raw must be a list of dicts
            if not isinstance(raw, list):
                raise ValueError(f"LLM returned {type(raw).__name__} not list")

            results = []
            for i, prop in enumerate(ctx.enriched):
                # Positional match — same order as input, no "idx" needed
                info = raw[i] if i < len(raw) else {}
                if not isinstance(info, dict):
                    info = {}
                # Support short and long formats for backward compatibility.
                score_val = info.get("score", info.get("s", info.get("ai_score", 50)))
                tags_val = info.get("t", info.get("tags", []))
                results.append({
                    **prop,
                    "ai_score": max(0, min(100, int(score_val))),
                    "tags":     _decode_llm_tags(tags_val),
                })

            # Guarantee 10 items if LLM returned fewer
            while len(results) < len(ctx.enriched):
                j = len(results)
                s, t = _rule_based_score_fn(ctx.enriched[j], ctx.strategy)
                results.append({**ctx.enriched[j], "ai_score": s, "tags": t})

            ctx.record_tool("llm_score_batch",
                            {"strategy": ctx.strategy, "n": len(compact)},
                            f"{len(results)} scored", 0.0)
            return results

        except Exception as e:
            log.warning("LLM batch score failed: %s", e)
            ctx.errors.append(f"llm_score: {e}")
            ctx.fallback_used["llm_score"] = True
            return self._rule_score_flat(ctx)

    def _rule_strategy_rerank(
        self, ctx: AgentContext, scored: list[dict]
    ) -> list[dict]:
        """
        Rule-based strategy reranking — deterministic, zero tokens, instant.
        Applies strategy-specific score adjustments then sorts.

        LTR:   +6 if cash_flow > 300  (strong income stability)
               -5 if dom > 60          (possible problem property)
        STR:   +6 if cap_rate > 6      (high yield)
               -5 if grm > 150         (overpriced for rental income)
        BRRRR: +6 if dom > 45          (motivated seller)
               +4 if cap_rate < 4.5    (below market = value-add potential)
        Flip:  +6 if dom < 15          (fast market = quick resale)
               -5 if year_built < 1970 (hidden renovation cost risk)
        """
        strategy = ctx.strategy
        for p in scored:
            adj  = 0
            note = ""
            cf   = p.get("cash_flow", 0)
            cr   = p.get("cap_rate",  0)
            dom  = p.get("dom",       30)
            grm  = p.get("grm",       130)
            yr   = p.get("year_built", 2000)

            if strategy == "LTR":
                if cf > 300:  adj += 6;  note = "Excellent LTR cash flow"
                if dom > 60:  adj -= 5;  note = note or "High DOM — investigate"
            elif strategy == "STR":
                if cr > 6:    adj += 6;  note = "High yield for STR"
                if grm > 150: adj -= 5;  note = note or "GRM too high for STR"
            elif strategy == "BRRRR":
                if dom > 45:  adj += 6;  note = "Motivated seller — BRRRR upside"
                if cr < 4.5:  adj += 4;  note = note or "Below-market — add value"
            elif strategy == "Flip":
                if dom < 15:  adj += 6;  note = "Fast market — ideal flip"
                if yr and yr < 1970:
                    adj -= 5; note = note or "Pre-1970 — renovation risk"

            p["ai_score"]      = max(0, min(100, p.get("ai_score", 50) + adj))
            p["strategy_note"] = note

        ctx.record_tool("rule_strategy_rerank",
                        {"strategy": strategy}, "ok", 0.0)
        return sorted(scored, key=lambda x: x.get("ai_score", 0), reverse=True)

    def _rule_score_all(self, ctx: AgentContext) -> list[ScoredProperty]:
        flat = self._rule_score_flat(ctx)
        ctx.scored = flat
        return self._assemble(ctx)

    def _rule_score_flat(self, ctx: AgentContext) -> list[dict]:
        results = []
        for prop in ctx.enriched:
            s, t = _rule_based_score_fn(prop, ctx.strategy)
            results.append({**prop, "ai_score": s, "tags": t, "strategy_note": "",
                            "_idx": prop.get("_idx", 0)})
        return results

    def _assemble(self, ctx: AgentContext) -> list[ScoredProperty]:
        """
        Safely build ScoredProperty models from scored dicts.
        Only passes fields declared in ScoredProperty.model_fields.
        Strips internal bookkeeping keys (_idx, coc_return, break_even,
        piti, noi_annual) before construction.
        """
        # Fields allowed by the Pydantic model (excludes rank — set explicitly)
        ALLOWED = set(ScoredProperty.model_fields.keys()) - {"rank", "tags",
                   "strategy_note", "risk_level", "risk_factors",
                   "groundedness_score", "correctness_score", "confidence_score"}

        results = []
        for i, prop in enumerate(ctx.scored):
            risk       = ctx.risk_profiles.get(prop.get("address", ""))
            risk_score = risk.score if risk else 0
            risk_flags = risk.factors[:1] if risk else []
            all_tags   = (prop.get("tags") or [])[:2] + risk_flags
            groundedness, correctness, confidence = compute_quality_scores(
                prop, ctx.strategy, risk_score=risk_score
            )
            try:
                safe = {k: v for k, v in prop.items() if k in ALLOWED}
                sp = ScoredProperty(
                    rank          = i + 1,
                    tags          = all_tags,
                    strategy_note = prop.get("strategy_note", ""),
                    risk_level    = risk.overall_risk if risk else "",
                    risk_factors  = risk.factors if risk else [],
                    groundedness_score = groundedness,
                    correctness_score  = correctness,
                    confidence_score   = confidence,
                    **safe,
                )
            except Exception as e:
                log.warning("ScoredProperty build failed for rank %d: %s", i+1, e)
                s, t = _rule_based_score_fn(prop, ctx.strategy)
                safe = {k: v for k, v in prop.items() if k in ALLOWED}
                sp = ScoredProperty(
                    rank         = i + 1,
                    tags         = t[:2] + risk_flags,
                    ai_score     = s,
                    strategy_note= "",
                    risk_level   = risk.overall_risk if risk else "",
                    risk_factors = risk.factors if risk else [],
                    groundedness_score = groundedness,
                    correctness_score  = correctness,
                    confidence_score   = confidence,
                    **{k: v for k, v in safe.items() if k != "ai_score"},
                )
            results.append(sp)
        return results


# ══════════════════════════════════════════════════════════════
# 7.  AGENT 3 — RISK ADVISOR
#     Tools: compute_risk_score(), generate_risk_memo()
#     Memory: RiskCache (1hr TTL, cross-request)
#     LLM: 2-sentence risk memo per HIGH-risk property
# ══════════════════════════════════════════════════════════════

class RiskAdvisorAgent:
    """
    Responsible for: generating risk profiles for all 10 properties,
    caching them per ZIP, and writing LLM memos for HIGH-risk properties.

    Decision logic:
      • HIGH risk (score ≥ 45) → LLM generates concise risk memo
      • MEDIUM / LOW risk → rule-based memo (no LLM tokens spent)
      • Cached profiles reused for same ZIP within 1hr
    """

    async def run(
        self,
        ctx: AgentContext,
        llm,
    ) -> dict[str, RiskProfile]:

        # ── RETRIEVAL: check cross-request cache ──────────────
        cached = RiskCache.get(ctx.zip_code)
        if cached:
            log.info("RiskCache HIT for %s", ctx.zip_code)
            ctx.record_tool("risk_cache_retrieve",
                            {"zip": ctx.zip_code}, "HIT", 0.0)
            return cached

        t0 = time.perf_counter()
        profiles: dict[str, RiskProfile] = {}

        # ── Compute risk score for every property ──────────────
        high_risk_props = []
        for prop in ctx.enriched:
            score, factors, mitigations, level = compute_risk_score(prop)
            profile = RiskProfile(
                address      = prop.get("address", ""),
                overall_risk = level,
                score        = score,
                factors      = factors,
                mitigations  = mitigations,
                memo         = _rule_risk_memo(factors, mitigations),
            )
            profiles[prop["address"]] = profile
            # Use LLM for high-risk memos unless in DEMO mode without override
            if level == "HIGH" and ctx.llm_available and ((not DEMO_MODE) or USE_OLLAMA_OVERRIDE):
                high_risk_props.append((prop, profile))

        ctx.record_tool("compute_risk_scores",
                        {"n": len(ctx.enriched)},
                        f"{len(high_risk_props)} HIGH risk",
                        time.perf_counter()-t0)
        log_risk.debug(
            "Risk screening done | n=%d high=%d medium=%d low=%d",
            len(ctx.enriched),
            len(high_risk_props),
            sum(1 for p in profiles.values() if p.overall_risk=="MEDIUM"),
            sum(1 for p in profiles.values() if p.overall_risk=="LOW"),
        )

        # ── LLM memos for HIGH-risk properties only ────────────
        if high_risk_props and llm:
            await self._generate_risk_memos(high_risk_props, llm, ctx)

        # ── STORE in cross-request cache ──────────────────────
        RiskCache.set(ctx.zip_code, profiles)
        ctx.risk_profiles = profiles
        return profiles

    async def _generate_risk_memos(
        self,
        items: list[tuple[dict, RiskProfile]],
        llm,
        ctx: AgentContext,
    ) -> None:
        """Generate concise LLM risk memos for HIGH-risk properties."""
        prompt = ChatPromptTemplate.from_messages([
            ("system", RISK_MEMO_SYSTEM),
            ("human",  RISK_MEMO_HUMAN),
        ])
        # 50 words max per memo ≈ 55 completion tokens; prompt ~40
        risk_llm = llm.bind(num_predict=55, temperature=0.1)
        chain = prompt | risk_llm | StrOutputParser()

        async def _gen_one(prop: dict, profile: RiskProfile) -> None:
            try:
                memo = await chain.ainvoke({
                    "address":    prop.get("address", ""),
                    "price":      prop.get("price",   0),
                    "beds":       prop.get("beds",    0),
                    "year_built": prop.get("year_built", "N/A"),
                    "cap_rate":   prop.get("cap_rate",  0),
                    "cash_flow":  prop.get("cash_flow", 0),
                    "grm":        prop.get("grm",       0),
                    "dom":        prop.get("dom",       0),
                    "risk_score": profile.score,
                    "risk_level": profile.overall_risk,
                    "factors":    ", ".join(profile.factors) or "None identified",
                    "mitigations":"; ".join(profile.mitigations) or "None",
                })
                profile.memo = memo.strip()
                # ~55 completion + ~40 prompt per HIGH-risk property
                ctx.token_usage["risk_memos"] = ctx.token_usage.get("risk_memos", 0) + 95
                ctx.record_tool("generate_risk_memo",
                                {"address": prop.get("address","")},
                                "ok", 0.0)
            except Exception as e:
                log.warning("Risk memo LLM failed for %s: %s",
                            prop.get("address",""), e)

        await asyncio.gather(*[_gen_one(p, r) for p, r in items])


# ══════════════════════════════════════════════════════════════
# 8.  ORCHESTRATOR  (public interface)
# ══════════════════════════════════════════════════════════════

class NetFlowAgent:
    """
    Top-level orchestrator.  The only class imported by main.py.

    Coordinates the three sub-agents in the correct order and
    gates LLM usage based on Ollama availability.

    public API (unchanged from v2):
      score_and_rank(listings, mortgage_rate, strategy) → list[ScoredProperty]
      stream_market_summary(...)                         → AsyncIterator[str]
      market_summary(...)                                → str
    """

    def __init__(self):
        self._llm            = None
        self._market_agent   = MarketAnalystAgent()
        self._scorer_agent   = PropertyScorerAgent()
        self._risk_agent     = RiskAdvisorAgent()
        self._ollama_ts: float = 0.0
        self._ollama_ok: bool  = False

    # ── LLM client — lazy init, shared across agents ──────────

    def _get_llm(self):
        if self._llm is None:
            self._llm = ChatOllama(
                model       = OLLAMA_MODEL,
                temperature = 0.1,
                base_url    = OLLAMA_BASE_URL,
                # Global ceiling; per-stage tighter caps are applied via llm.bind(...)
                num_predict = 220,
            )
        return self._llm

    async def _check_ollama(self) -> bool:
        """Async Ollama health check with 10s TTL — never blocks the event loop."""
        now = time.time()
        if now - self._ollama_ts < 10.0:
            return self._ollama_ok
        try:
            async with httpx.AsyncClient(timeout=2.0) as c:
                await c.get(f"{OLLAMA_BASE_URL}/api/tags")
            self._ollama_ok = True
        except Exception:
            self._ollama_ok = False
        self._ollama_ts = now
        return self._ollama_ok

    # ── Main pipeline ─────────────────────────────────────────

    async def score_and_rank(
        self,
        listings:      list[dict],
        mortgage_rate: float,
        strategy:      str,
        fred_service   = None,
        rentcast_service = None,
        trace_run_id: str | None = None,
        request_id: str | None = None,
    ) -> list[ScoredProperty]:
        """
        Full agent pipeline:
          1. Build AgentContext (session memory)
          2. Market Analyst → MarketContext (with memory retrieval)
          3. Risk Advisor   → RiskProfiles per property (with cache)
          4. Property Scorer → LLM scoring + strategy reranking
        Returns list[ScoredProperty] ready for SSE serialisation.
        """
        ctx = AgentContext(
            zip_code  = listings[0].get("zip_code","") if listings else "",
            budget    = 0,
            strategy  = strategy,
            listings  = listings,
        )

        # ── Gate: check LLM availability once (async, TTL-cached) ─
        # Allow Ollama override even in DEMO mode if USE_OLLAMA_OVERRIDE=true
        should_check_llm = (not DEMO_MODE) or USE_OLLAMA_OVERRIDE
        ctx.llm_available = should_check_llm and await self._check_ollama()
        if not ctx.llm_available:
            log.warning("Ollama offline — all LLM stages will use rule-based fallback")

        llm = self._get_llm() if ctx.llm_available else None

        # ── Agent 1: Market context ────────────────────────────
        t0 = time.perf_counter()
        if fred_service and rentcast_service:
            ctx.market_ctx = await self._market_agent.build_market_context(
                ctx, fred_service, rentcast_service
            )
            # Use live rate from market context
            mortgage_rate = ctx.market_ctx.mortgage_rate
        ctx.stage_times["market_analyst"] = round(time.perf_counter()-t0, 3)

        # ── Agent 3: Risk profiling (runs before scorer so profiles
        #             can be embedded in ScoredProperty.risk_factors) ──
        t1 = time.perf_counter()
        # Need enriched first for risk scoring
        for i, listing in enumerate(listings):
            enriched = compute_financials(listing, mortgage_rate)
            enriched["_idx"] = i
            ctx.enriched.append(enriched)

        await self._risk_agent.run(ctx, llm)
        ctx.stage_times["risk_advisor"] = round(time.perf_counter()-t1, 3)

        # ── Agent 2: Scoring (uses pre-enriched ctx.enriched) ──
        t2 = time.perf_counter()
        # Reset enriched so scorer doesn't double-enrich
        scorer_ctx = AgentContext(
            zip_code      = ctx.zip_code,
            budget        = ctx.budget,
            strategy      = ctx.strategy,
            listings      = ctx.listings,
            enriched      = ctx.enriched,      # pass pre-computed
            risk_profiles = ctx.risk_profiles,  # pass risk data
            llm_available = ctx.llm_available,
            market_ctx    = ctx.market_ctx,
        )
        # Use enriched already computed
        scorer_ctx.tool_trace  = ctx.tool_trace
        scorer_ctx.stage_times = ctx.stage_times
        scorer_ctx.token_usage = ctx.token_usage
        scorer_ctx.fallback_used = ctx.fallback_used
        scorer_ctx.errors      = ctx.errors

        # Skip re-enrichment in scorer (already done above)
        # Use LLM unless in DEMO mode without override
        if ctx.llm_available and ((not DEMO_MODE) or USE_OLLAMA_OVERRIDE):
            scored_raw            = await self._scorer_agent._llm_score_batch(scorer_ctx, mortgage_rate, llm)
            reranked              = self._scorer_agent._rule_strategy_rerank(scorer_ctx, scored_raw)
            scorer_ctx.scored     = reranked
        else:
            scorer_ctx.fallback_used["scorer"] = True
            scorer_ctx.scored = self._scorer_agent._rule_score_flat(scorer_ctx)

        final = self._scorer_agent._assemble(scorer_ctx)
        ctx.stage_times["property_scorer"] = round(time.perf_counter()-t2, 3)

        # ── Log full pipeline trace ────────────────────────────
        total = sum(ctx.stage_times.values())

        # In DEMO/fallback paths there is no provider token usage; expose deterministic estimates.
        if not ctx.token_usage:
            ctx.token_usage.update(estimate_demo_tokens(len(listings), len(ctx.tool_trace)))

        token_total = sum(
            v for k, v in ctx.token_usage.items()
            if isinstance(v, int) and k != "estimated_prompt_tokens" and k != "estimated_completion_tokens"
        )
        log.info(
            "Pipeline done | %d props | %.2fs | tools=%d | fallback=%s | tokens=%s | total_est=%d",
            len(final), total, len(ctx.tool_trace),
            ctx.fallback_used, ctx.token_usage, token_total,
        )

        emit_quality_feedback_to_langsmith(
            scored=final,
            strategy=strategy,
            demo_mode=DEMO_MODE,
            llm_available=ctx.llm_available,
            run_id=trace_run_id,
            request_id=request_id,
            stage_times=ctx.stage_times,
            token_usage=ctx.token_usage,
            fallback_used=ctx.fallback_used,
        )
        return final

    async def stream_market_summary(
        self,
        zip_code:      str,
        budget:        int,
        strategy:      str,
        top_picks:     list[ScoredProperty],
        mortgage_rate: float,
        fallback_used: bool = False,
    ) -> AsyncIterator[str]:
        if DEMO_MODE:
            mc = MarketMemory.get(zip_code)
            ctx = AgentContext(zip_code=zip_code, budget=budget,
                               strategy=strategy, market_ctx=mc)
            for word in _rule_summary(ctx, budget, strategy, top_picks).split(" "):
                yield word + " "
                await asyncio.sleep(0.03)
            return

        pipeline_note = "Rule-based fallback" if fallback_used else "Ollama llama3 — 3-agent pipeline"
        mc  = MarketMemory.get(zip_code)
        llm_available = await self._check_ollama()
        ctx = AgentContext(zip_code=zip_code, budget=budget,
                           strategy=strategy, market_ctx=mc,
                           llm_available=llm_available)
        llm = self._get_llm() if llm_available else None

        if not llm_available:
            for word in _rule_summary(ctx, budget, strategy, top_picks).split(" "):
                yield word + " "
                await asyncio.sleep(0.03)
            return

        async for chunk in self._market_agent.stream_narrative(
            ctx, budget, strategy, top_picks, llm, pipeline_note
        ):
            yield chunk

    async def market_summary(
        self,
        zip_code:      str,
        budget:        int,
        strategy:      str,
        top_picks:     list[ScoredProperty],
        mortgage_rate: float,
        fallback_used: bool = False,
    ) -> str:
        chunks = []
        async for chunk in self.stream_market_summary(
            zip_code, budget, strategy, top_picks, mortgage_rate, fallback_used
        ):
            chunks.append(chunk)
        return "".join(chunks)


# ══════════════════════════════════════════════════════════════
# 9.  SHARED FALLBACK HELPERS
# ══════════════════════════════════════════════════════════════

def _rule_based_score_fn(prop: dict, strategy: str) -> tuple[int, list[str]]:
    """Deterministic rubric — matches SCORING_SYSTEM prompt exactly."""
    score, tags = 0, []
    cr = prop.get("cap_rate", 0)
    if cr >= 6:   score += 30; tags.append("High cap")
    elif cr >= 5: score += 22
    elif cr >= 4: score += 12

    cf = prop.get("cash_flow", 0)
    if cf > 400:   score += 25; tags.append("Cash+")
    elif cf > 200: score += 18
    elif cf > 0:   score += 8

    grm = prop.get("grm", 200)
    if grm < 100:   score += 15
    elif grm < 130: score += 10
    elif grm < 160: score += 5

    dom = prop.get("dom", 30)
    if dom < 14:   score += 10; tags.append("Hot deal")
    elif dom < 30: score += 6

    strat_map = {
        "LTR":   (cf > 200,  8, "Stable CF"),
        "STR":   (cr > 5.5,  8, "High yield"),
        "BRRRR": (dom > 40,  8, "Value-add"),
        "Flip":  (dom < 20,  8, "Fast market"),
    }
    cond, bonus, label = strat_map.get(strategy, (True, 5, ""))
    if cond: score += bonus; tags.append(label) if label else None
    else:    score += 5

    if not tags:
        tags.append(f"{prop.get('beds',0)}bd/{prop.get('baths',0)}ba")
    return min(score, 100), tags[:2]


def _rule_risk_memo(factors: list[str], mitigations: list[str]) -> str:
    if not factors:
        return "No significant risk factors identified. Standard due diligence applies."
    f_str = " and ".join(factors[:2])
    m_str = mitigations[0] if mitigations else "Conduct thorough inspection."
    return f"Key concerns: {f_str}. Recommended action: {m_str}."


def _rule_summary(
    ctx: AgentContext,
    budget: int,
    strategy: str,
    top_picks: list[ScoredProperty],
) -> str:
    if not top_picks: return "No properties found. Try a higher budget or different filters."
    top   = top_picks[0]
    label = STRATEGY_LABELS.get(strategy, strategy)
    avg_c = round(sum(p.cap_rate  for p in top_picks)/len(top_picks), 1)
    avg_f = round(sum(p.cash_flow for p in top_picks)/len(top_picks))
    mc    = ctx.market_ctx
    rate  = mc.mortgage_rate if mc else 7.2
    rent  = f", avg market rent ${mc.avg_rent:,}/mo" if mc and mc.avg_rent else ""
    return (
        f"{ctx.zip_code} shows {label} potential: avg cap {avg_c}%, "
        f"avg cash flow ${avg_f}/mo at {rate}%{rent}. "
        f"Top pick: {top.address} at ${top.price:,} — "
        f"{top.cap_rate}% cap, ${top.cash_flow}/mo CF, score {top.ai_score}/100. "
        f"Risk watch: {top.risk_factors[0] if top.risk_factors else 'None identified'}."
    )
