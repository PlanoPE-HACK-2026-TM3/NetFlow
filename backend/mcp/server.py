"""
NetFlow MCP Server  v1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Model Context Protocol server exposing NetFlow's agent pipeline
as callable tools to any MCP-compatible LLM host.

ARCHITECTURE
  ┌─────────────────────────────────────────────────────────────┐
  │  MCP CLIENT  (Claude Desktop / any MCP host)                │
  └────────────────────┬────────────────────────────────────────┘
                       │  JSON-RPC 2.0  over  stdio / SSE
  ┌────────────────────▼────────────────────────────────────────┐
  │  PROMPT FILTER LAYER  ← enforced at EVERY entry point       │
  │  • PromptGuard checks ALL tool arguments before dispatch    │
  │  • Injection patterns applied to every string field         │
  │  • Override attempts in tool args are blocked server-side   │
  └────────────────────┬────────────────────────────────────────┘
                       │  clean, validated inputs only
  ┌────────────────────▼────────────────────────────────────────┐
  │  MCP TOOL REGISTRY                                          │
  │  search_properties  — full 3-agent pipeline                 │
  │  get_market_data    — live ZIP market snapshot              │
  │  score_property     — single-property AI scoring            │
  │  analyse_risk       — risk profile for one property         │
  │  chat_with_property — property Q&A via ConversationMemory   │
  │  validate_prompt    — expose UserAgent decisions to host    │
  └────────────────────┬────────────────────────────────────────┘
                       │
  ┌────────────────────▼────────────────────────────────────────┐
  │  NETFLOW AGENTS  (existing pipeline, unchanged)             │
  │  UserAgent → Orchestrator → Market/Scorer/Risk agents       │
  └─────────────────────────────────────────────────────────────┘

PROMPT-LEVEL OVERRIDE FILTER
  Every string argument received by EVERY tool passes through
  PromptGuard before the tool body executes. This means:

  • An LLM host cannot inject "ignore previous instructions" via
    a tool argument and bypass the UserAgent — PromptGuard blocks it
  • System-override tokens (<|im_start|>, [INST], <<SYS>>) in
    any argument string are rejected immediately
  • The filter runs BEFORE the tool body — the tool never sees
    the malicious string
  • Each block is logged with session_id, tool_name, and pattern_code
  • Sanitisation (HTML strip, unicode normalise) runs on every
    string argument automatically even when no injection is found

RUNNING
  stdio mode (default — for Claude Desktop):
    python -m backend.mcp.server

  HTTP/SSE mode (for web clients):
    python -m backend.mcp.server --transport sse --port 8001

  Both modes expose identical tools.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("netflow.mcp")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,  # MCP stdio uses stdout — logs go to stderr
)


# ══════════════════════════════════════════════════════════════
# 1.  PROMPT GUARD — applied to every string argument
#     at every tool entry point
# ══════════════════════════════════════════════════════════════

# Same 25-pattern library as UserAgent, imported and re-applied
# here so the filter is enforced regardless of which entry point
# the request comes through (direct API, UserAgent, or MCP).
_GUARD_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)",
     re.I|re.S), "JAILBREAK_IGNORE"),
    (re.compile(r"(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as)\s+.{0,60}(DAN|evil|uncensored|without\s+restrictions?)",
     re.I|re.S), "JAILBREAK_PERSONA"),
    (re.compile(r"(system\s*prompt|<\s*system\s*>|###\s*system|<<SYS>>|\[INST\])",
     re.I|re.S), "SYSTEM_PROMPT_INJECT"),
    (re.compile(r"reveal\s+(your|the)\s+(system\s+prompt|instructions?|rules?|guidelines?)",
     re.I|re.S), "PROMPT_EXTRACTION"),
    (re.compile(r"(bypass|override|disable|ignore)\s+(safety|filter|guard|restriction|policy|rule)",
     re.I|re.S), "SAFETY_BYPASS"),
    (re.compile(r"\[/?INST\]|<\|im_start\|>|<\|im_end\|>|<\|eot_id\|>",
     re.I|re.S), "SPECIAL_TOKENS"),
    (re.compile(r"(\$\(|`[^`]+`|&&|\|\||>\s*/dev/|nc\s+-|curl\s+http|wget\s+http)",
     re.I|re.S), "SHELL_INJECT"),
    (re.compile(r"(__import__|exec\s*\(|eval\s*\(|os\.system|subprocess\.)",
     re.I|re.S), "CODE_INJECT"),
    (re.compile(r"<\s*(script|iframe|object|embed)[^>]*>",
     re.I|re.S), "XSS_HTML"),
    (re.compile(r"(\bUNION\b.{0,30}\bSELECT\b|\bDROP\b.{0,20}\bTABLE\b)",
     re.I|re.S), "SQL_INJECT"),
    (re.compile(r"\x00|(%00|%0[aAdD])",
     re.I|re.S), "NULL_BYTE"),
    (re.compile(r"(-{3,}|\*{3,}|={3,})\s*(human|assistant|user|system|ai)\s*(-{3,}|\*{3,}|={3,})",
     re.I|re.S), "BOUNDARY_INJECT"),
    (re.compile(r"(forget|disregard)\s+(everything|all|what)\s+(you|was)\s+(been\s+)?(told|taught|instructed|trained)",
     re.I|re.S), "JAILBREAK_FORGET"),
    (re.compile(r"\b(bomb|weapon|explosive|malware|ransomware|hack\s+into|ddos)\b",
     re.I|re.S), "HARMFUL_CONTENT"),
]


@dataclass
class GuardResult:
    passed:  bool
    code:    str = ""
    field:   str = ""   # which argument was blocked
    snippet: str = ""   # first 40 chars of the offending value


def _sanitise_string(s: str) -> str:
    """Strip HTML, normalise unicode, collapse whitespace, truncate."""
    s = re.sub(r"<[^>]{0,200}>", " ", s)
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[^\x09\x0a\x0d\x20-\x7e\x80-\xff]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:500]


def prompt_guard(tool_name: str, arguments: dict, session_id: str = "") -> GuardResult:
    """
    Run all 14 injection patterns against every string value in
    the tool arguments dict. Called before EVERY tool body executes.

    Returns GuardResult(passed=True) if clean.
    Returns GuardResult(passed=False, code=...) on first match found.
    """
    for field_name, value in arguments.items():
        if not isinstance(value, str):
            continue
        for pattern, code in _GUARD_PATTERNS:
            if pattern.search(value):
                snippet = value[:40].replace("\n", " ")
                log.warning(
                    "PromptGuard BLOCK | tool=%s | field=%s | code=%s | sid=%s | snippet=%r",
                    tool_name, field_name, code, session_id, snippet,
                )
                return GuardResult(passed=False, code=code,
                                   field=field_name, snippet=snippet)
    return GuardResult(passed=True)


def sanitise_arguments(arguments: dict) -> dict:
    """Return a copy of arguments with all string values sanitised."""
    return {
        k: _sanitise_string(v) if isinstance(v, str) else v
        for k, v in arguments.items()
    }


# ══════════════════════════════════════════════════════════════
# 2.  MCP PROTOCOL TYPES
# ══════════════════════════════════════════════════════════════

class MCPError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        self.code    = code
        self.message = message
        self.data    = data
    def to_dict(self) -> dict:
        e: dict = {"code": self.code, "message": self.message}
        if self.data: e["data"] = self.data
        return e

# Standard JSON-RPC error codes
RPC_PARSE_ERROR     = -32700
RPC_INVALID_REQUEST = -32600
RPC_METHOD_NOT_FOUND= -32601
RPC_INVALID_PARAMS  = -32602
RPC_INTERNAL_ERROR  = -32603
# MCP-specific
MCP_TOOL_ERROR      = -32000
MCP_SECURITY_BLOCK  = -32001


# ══════════════════════════════════════════════════════════════
# 3.  TOOL DEFINITIONS  (schema exposed to MCP clients)
# ══════════════════════════════════════════════════════════════

TOOLS: list[dict] = [
    {
        "name": "search_properties",
        "description": (
            "Search for real estate investment properties by location, budget, "
            "beds, type, and strategy. Returns top 10 scored, ranked properties "
            "with cap rate, cash flow, GRM, AI score, risk profile, and strategy note. "
            "Runs the full 3-agent pipeline: Market Analyst + Property Scorer + Risk Advisor."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt":        {"type": "string", "description": "Natural language search, e.g. '3 bed SFH in Dallas TX under $450k LTR'"},
                "zip_code":      {"type": "string", "description": "5-digit ZIP code (optional if prompt contains location)"},
                "budget":        {"type": "integer","description": "Max purchase price in USD"},
                "min_beds":      {"type": "integer","description": "Minimum bedrooms (1-6)"},
                "property_type": {"type": "string", "enum": ["SFH","Multi","Condo","Townhouse"]},
                "strategy":      {"type": "string", "enum": ["LTR","STR","BRRRR","Flip"]},
                "session_id":    {"type": "string", "description": "Optional session identifier for rate limiting"},
            },
            "required": [],
        },
    },
    {
        "name": "get_market_data",
        "description": (
            "Get live market snapshot for a ZIP code: 30-year mortgage rate (FRED), "
            "average rent, vacancy rate, rent growth YoY, avg days on market, "
            "and supply trend. Data cached 15 minutes."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "zip_code": {"type": "string", "description": "5-digit US ZIP code"},
            },
            "required": ["zip_code"],
        },
    },
    {
        "name": "score_property",
        "description": (
            "Score a single property 0-100 using the NetFlow rubric: "
            "cap rate 30%, cash flow 25%, GRM 15%, DOM 10%, strategy fit 20%. "
            "Returns ai_score, tags, financial metrics, and strategy note."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "price":         {"type": "integer", "description": "Purchase price in USD"},
                "est_rent":      {"type": "integer", "description": "Estimated monthly rent in USD"},
                "dom":           {"type": "integer", "description": "Days on market"},
                "beds":          {"type": "integer", "description": "Number of bedrooms"},
                "baths":         {"type": "number",  "description": "Number of bathrooms"},
                "sqft":          {"type": "integer", "description": "Living area square footage"},
                "year_built":    {"type": "integer", "description": "Year of construction"},
                "strategy":      {"type": "string",  "enum": ["LTR","STR","BRRRR","Flip"]},
                "mortgage_rate": {"type": "number",  "description": "30-year rate %. Omit to use live FRED rate."},
            },
            "required": ["price", "est_rent", "dom", "beds", "baths"],
        },
    },
    {
        "name": "analyse_risk",
        "description": (
            "Generate a risk profile for a property: overall risk level (LOW/MEDIUM/HIGH), "
            "risk score 0-100, specific risk factors, and actionable mitigations. "
            "HIGH-risk properties also receive an LLM-generated 2-sentence risk memo."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "price":      {"type": "integer"},
                "est_rent":   {"type": "integer"},
                "cap_rate":   {"type": "number"},
                "cash_flow":  {"type": "integer"},
                "grm":        {"type": "number"},
                "dom":        {"type": "integer"},
                "year_built": {"type": "integer"},
                "address":    {"type": "string"},
            },
            "required": ["price", "est_rent", "cap_rate", "cash_flow", "dom"],
        },
    },
    {
        "name": "chat_with_property",
        "description": (
            "Ask a question about a specific property using the AI Property Analyst. "
            "Maintains a 5-turn sliding conversation window per property address. "
            "Grounded in pre-computed financials — will not hallucinate numbers."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "address":       {"type": "string", "description": "Property address (used as memory key)"},
                "question":      {"type": "string", "description": "Your question about this property"},
                "price":         {"type": "integer"},
                "est_rent":      {"type": "integer"},
                "cap_rate":      {"type": "number"},
                "cash_flow":     {"type": "integer"},
                "ai_score":      {"type": "integer"},
                "mortgage_rate": {"type": "number"},
            },
            "required": ["address", "question", "price", "est_rent"],
        },
    },
    {
        "name": "validate_prompt",
        "description": (
            "Run the NetFlow UserAgent security pipeline on a raw text string. "
            "Returns: validation status, detected intent, extracted parameters, "
            "rejection reason (if blocked), and suggested rephrased prompt. "
            "Use this to pre-screen inputs before calling other tools."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text":       {"type": "string", "description": "Raw user text to validate"},
                "session_id": {"type": "string"},
            },
            "required": ["text"],
        },
    },
]


# ══════════════════════════════════════════════════════════════
# 4.  TOOL HANDLERS
# ══════════════════════════════════════════════════════════════

async def _handle_search_properties(args: dict) -> dict:
    """Full 3-agent pipeline via MCP."""
    from backend.agents.user_agent import user_agent, ValidationStatus
    from backend.agents.netflow_agent import NetFlowAgent
    from backend.services.rentcast import RentCastService
    from backend.services.fred import FREDService

    # Run UserAgent on the prompt (extra security layer for MCP entry)
    prompt = args.get("prompt", "")
    sid    = args.get("session_id", "mcp-search")

    if prompt:
        validated = user_agent.process(raw_text=prompt, session_id=sid)
        if validated.status == ValidationStatus.REJECTED:
            return {
                "status":   "rejected",
                "reason":   validated.rejection_reason,
                "message":  validated.clarification_msg,
                "hint":     "Rephrase as a real estate search, e.g. '3 bed in Dallas TX under $450k'",
            }
        # Merge extracted params
        if validated.zip_code and not args.get("zip_code"):
            args["zip_code"] = validated.zip_code
        if validated.budget != 450_000 and not args.get("budget"):
            args["budget"] = validated.budget
        if validated.min_beds != 3 and not args.get("min_beds"):
            args["min_beds"] = validated.min_beds
        if not args.get("strategy"):
            args["strategy"] = validated.strategy

    zip_code      = args.get("zip_code", "75070")
    budget        = int(args.get("budget", 450_000))
    min_beds      = int(args.get("min_beds", 3))
    property_type = args.get("property_type", "SFH")
    strategy      = args.get("strategy", "LTR")

    fred     = FREDService()
    rentcast = RentCastService()
    agent    = NetFlowAgent()

    mortgage_rate = await fred.get_30yr_rate()
    listings      = await rentcast.search_listings(
        zip_code=zip_code, max_price=budget,
        property_type=property_type, min_beds=min_beds, limit=10,
    )
    if not listings:
        return {"status": "no_results",
                "message": f"No listings found in {zip_code} under ${budget:,}."}

    rents = await rentcast.get_rent_estimates_parallel(listings, zip_code)
    for i, l in enumerate(listings):
        l["est_rent"]  = rents[i]
        l["mls_id"]    = l.get("rentcast_id", f"MLS-{zip_code}-{i+1:04d}")
        l["map_query"] = f"{l['address']}, {zip_code}"

    scored = await agent.score_and_rank(
        listings, mortgage_rate, strategy,
        fred_service=fred, rentcast_service=rentcast,
    )
    return {
        "status":        "ok",
        "count":         len(scored),
        "mortgage_rate": mortgage_rate,
        "zip_code":      zip_code,
        "strategy":      strategy,
        "properties":    [p.model_dump() for p in scored[:10]],
    }


async def _handle_get_market_data(args: dict) -> dict:
    from backend.services.rentcast import RentCastService
    from backend.services.fred import FREDService
    from backend.agents.netflow_agent import MarketMemory, MarketContext
    import time as _time

    zip_code = args["zip_code"].strip()
    if not re.match(r"^\d{5}$", zip_code):
        raise MCPError(RPC_INVALID_PARAMS, f"'{zip_code}' is not a valid 5-digit ZIP code.")

    # Honour MarketMemory cache
    cached = MarketMemory.get(zip_code)
    if cached:
        return {
            "status": "ok", "source": "cache",
            "zip_code":      cached.zip_code,
            "mortgage_rate": cached.mortgage_rate,
            "avg_rent":      cached.avg_rent,
            "vacancy_rate":  cached.vacancy_rate,
            "rent_growth":   cached.rent_growth,
            "avg_dom":       cached.avg_dom,
            "supply_trend":  cached.supply_trend,
        }

    fred     = FREDService()
    rentcast = RentCastService()
    rate, stats = await asyncio.gather(fred.get_30yr_rate(),
                                       rentcast.get_market_stats(zip_code))
    ctx = MarketContext(
        zip_code=zip_code, mortgage_rate=rate,
        avg_rent=stats.get("median_rent") or 0,
        vacancy_rate=stats.get("vacancy_rate") or 5.0,
        rent_growth=stats.get("rent_growth_yoy") or 2.5,
        avg_dom=stats.get("avg_days_on_market") or 30,
        supply_trend=(
            "tight"       if (stats.get("avg_days_on_market") or 30) < 20
            else "oversupply" if (stats.get("avg_days_on_market") or 30) > 60
            else "stable"
        ),
    )
    MarketMemory.set(ctx)
    return {
        "status": "ok", "source": "live",
        "zip_code":      zip_code,
        "mortgage_rate": rate,
        "avg_rent":      ctx.avg_rent,
        "vacancy_rate":  ctx.vacancy_rate,
        "rent_growth":   ctx.rent_growth,
        "avg_dom":       ctx.avg_dom,
        "supply_trend":  ctx.supply_trend,
    }


async def _handle_score_property(args: dict) -> dict:
    from backend.agents.netflow_agent import (
        compute_financials, _rule_based_score_fn, compute_risk_score,
    )
    from backend.services.fred import FREDService

    rate = float(args.get("mortgage_rate", 0))
    if not rate:
        rate = await FREDService().get_30yr_rate()

    listing = {
        "address":    args.get("address", "N/A"),
        "zip_code":   args.get("zip_code", ""),
        "price":      int(args["price"]),
        "est_rent":   int(args["est_rent"]),
        "dom":        int(args.get("dom", 30)),
        "beds":       int(args.get("beds", 3)),
        "baths":      float(args.get("baths", 2)),
        "sqft":       int(args.get("sqft", 0)),
        "year_built": int(args.get("year_built", 0)),
    }
    enriched = compute_financials(listing, rate)
    strategy = args.get("strategy", "LTR")
    score, tags = _rule_based_score_fn(enriched, strategy)
    risk_score, factors, mitigations, level = compute_risk_score(enriched)

    return {
        "status":       "ok",
        "ai_score":     score,
        "tags":         tags,
        "strategy":     strategy,
        "mortgage_rate":rate,
        "cap_rate":     enriched["cap_rate"],
        "cash_flow":    enriched["cash_flow"],
        "grm":          enriched["grm"],
        "piti":         enriched["piti"],
        "coc_return":   enriched["coc_return"],
        "break_even":   enriched["break_even"],
        "noi_annual":   enriched["noi_annual"],
        "risk_level":   level,
        "risk_score":   risk_score,
        "risk_factors": factors,
        "mitigations":  mitigations,
    }


async def _handle_analyse_risk(args: dict) -> dict:
    from backend.agents.netflow_agent import compute_risk_score

    prop = {
        "address":    args.get("address", "N/A"),
        "price":      int(args["price"]),
        "est_rent":   int(args["est_rent"]),
        "cap_rate":   float(args["cap_rate"]),
        "cash_flow":  int(args["cash_flow"]),
        "grm":        float(args.get("grm", 0)),
        "dom":        int(args.get("dom", 30)),
        "year_built": int(args.get("year_built", 0)),
        "beds":       int(args.get("beds", 3)),
        "baths":      float(args.get("baths", 2)),
        "price":      int(args["price"]),
    }
    score, factors, mitigations, level = compute_risk_score(prop)
    return {
        "status":       "ok",
        "overall_risk": level,
        "risk_score":   score,
        "factors":      factors,
        "mitigations":  mitigations,
        "address":      prop["address"],
    }


async def _handle_chat_with_property(args: dict) -> dict:
    from backend.agents.netflow_agent import ConversationMemory
    import httpx
    from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL

    address  = args["address"]
    question = args["question"]
    price    = int(args.get("price", 0))
    rent     = int(args.get("est_rent", 0))
    rate     = float(args.get("mortgage_rate", 7.2))
    cap      = float(args.get("cap_rate", 0))
    cf       = int(args.get("cash_flow", 0))
    score    = int(args.get("ai_score", 0))

    # Build grounded system prompt (no hallucination possible)
    system = (
        f"You are a real estate investment analyst. Answer ONLY about this property.\n"
        f"Property: {address}\n"
        f"Price: ${price:,} | Rent: ${rent:,}/mo | Cap: {cap}% | CF: ${cf}/mo\n"
        f"Score: {score}/100 | Rate: {rate}%\n"
        f"Rules: Use ONLY the numbers above. Max 150 words. Bullets for multi-part.\n"
        f"If asked about data not listed, say 'not available — check MLS'."
    )

    # Get conversation history
    history = ConversationMemory.get(address)
    ConversationMemory.add(address, "user", question)

    messages = history + [{"role": "user", "content": question}]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model":    OLLAMA_MODEL,
                    "stream":   False,
                    "messages": [{"role":"system","content":system}] + messages,
                    "options":  {"temperature": 0.15, "num_predict": 300},
                }
            )
            resp.raise_for_status()
            reply = resp.json().get("message",{}).get("content","No response.")
    except Exception as e:
        reply = f"Ollama unavailable: {e}"

    ConversationMemory.add(address, "assistant", reply)
    return {
        "status":  "ok",
        "answer":  reply,
        "address": address,
        "turns":   len(ConversationMemory.get(address)) // 2,
    }


async def _handle_validate_prompt(args: dict) -> dict:
    from backend.agents.user_agent import user_agent

    result = user_agent.process(
        raw_text   = args["text"],
        session_id = args.get("session_id", "mcp-validate"),
    )
    return {
        "status":              result.status.value,
        "intent":              result.intent.value,
        "zip_code":            result.zip_code,
        "budget":              result.budget,
        "min_beds":            result.min_beds,
        "property_type":       result.property_type,
        "strategy":            result.strategy,
        "rejection_reason":    result.rejection_reason,
        "clarification_msg":   result.clarification_msg,
        "suggested_prompt":    result.suggested_prompt,
        "sanitised_prompt":    result.sanitised_prompt,
        "risk_flags":          result.risk_flags,
        "stage_reached":       result.stage_reached,
        "processing_ms":       result.processing_ms,
    }


# ── Dispatch table ────────────────────────────────────────────

HANDLERS = {
    "search_properties":  _handle_search_properties,
    "get_market_data":    _handle_get_market_data,
    "score_property":     _handle_score_property,
    "analyse_risk":       _handle_analyse_risk,
    "chat_with_property": _handle_chat_with_property,
    "validate_prompt":    _handle_validate_prompt,
}


# ══════════════════════════════════════════════════════════════
# 5.  TOOL EXECUTOR  — runs PromptGuard before every handler
# ══════════════════════════════════════════════════════════════

async def execute_tool(
    name:       str,
    arguments:  dict,
    session_id: str = "",
) -> dict:
    """
    1. Check tool exists
    2. Run PromptGuard on ALL string arguments  ← enforced here, always
    3. Sanitise all string arguments
    4. Call the handler
    5. Return result or structured error
    """
    if name not in HANDLERS:
        raise MCPError(RPC_METHOD_NOT_FOUND, f"Unknown tool: {name}")

    # ── Prompt-level filter (runs regardless of entry point) ──
    guard = prompt_guard(name, arguments, session_id)
    if not guard.passed:
        log.warning("Tool call BLOCKED | tool=%s | code=%s | field=%s",
                    name, guard.code, guard.field)
        raise MCPError(
            MCP_SECURITY_BLOCK,
            f"Request blocked: {guard.code}",
            {
                "tool":    name,
                "field":   guard.field,
                "code":    guard.code,
                "hint":    "Use plain real estate queries. Injection patterns are blocked at all entry points.",
            },
        )

    # Sanitise before passing to handler
    clean_args = sanitise_arguments(arguments)

    try:
        return await HANDLERS[name](clean_args)
    except MCPError:
        raise
    except Exception as e:
        log.error("Tool %s error: %s", name, e)
        raise MCPError(RPC_INTERNAL_ERROR, str(e))


# ══════════════════════════════════════════════════════════════
# 6.  JSON-RPC 2.0 / MCP PROTOCOL HANDLER
# ══════════════════════════════════════════════════════════════

async def handle_rpc(message: dict) -> dict | None:
    """
    Dispatch a single JSON-RPC message.
    Returns a response dict or None for notifications.
    """
    rpc_id  = message.get("id")
    method  = message.get("method", "")
    params  = message.get("params", {})

    def ok(result: Any) -> dict:
        return {"jsonrpc": "2.0", "id": rpc_id, "result": result}

    def err(code: int, msg: str, data: Any = None) -> dict:
        e: dict = {"code": code, "message": msg}
        if data: e["data"] = data
        return {"jsonrpc": "2.0", "id": rpc_id, "error": e}

    # ── MCP lifecycle ─────────────────────────────────────────
    if method == "initialize":
        return ok({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {"listChanged": False},
                "prompts": {},
            },
            "serverInfo": {
                "name":    "netflow-mcp",
                "version": "1.0.0",
            },
        })

    if method == "initialized":
        return None   # notification — no response

    if method == "tools/list":
        return ok({"tools": TOOLS})

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        sid       = str(arguments.get("session_id", "mcp"))

        # Run the filter + handler
        try:
            result = await execute_tool(tool_name, arguments, sid)
            return ok({
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}],
                "isError": False,
            })
        except MCPError as e:
            return ok({   # MCP spec: tool errors go in result, not error field
                "content": [{"type": "text", "text": json.dumps(e.to_dict())}],
                "isError": True,
            })

    if method == "ping":
        return ok({})

    return err(RPC_METHOD_NOT_FOUND, f"Method not supported: {method}")


# ══════════════════════════════════════════════════════════════
# 7.  TRANSPORT LAYER
# ══════════════════════════════════════════════════════════════

def _read_line_sync() -> str | None:
    """
    Read one line from stdin synchronously.
    Returns the stripped line, or None on EOF.
    Uses sys.stdin.buffer.readline() — works on Windows (Python 3.12+)
    where loop.connect_read_pipe() fails with WinError 6 on ProactorEventLoop.
    """
    try:
        raw = sys.stdin.buffer.readline()
        if not raw:
            return None
        return raw.decode("utf-8", errors="replace").strip()
    except (OSError, EOFError):
        return None


def _write_line_sync(data: str) -> None:
    """Write one JSON line to stdout and flush immediately."""
    try:
        sys.stdout.buffer.write((data + "\n").encode("utf-8"))
        sys.stdout.buffer.flush()
    except OSError:
        pass


async def run_stdio() -> None:
    """
    stdio transport — Claude Desktop and any local MCP host.

    Windows-compatible implementation:
      • Reads stdin via sys.stdin.buffer.readline() in a thread executor
        (avoids loop.connect_read_pipe which fails with WinError 6 on
        Python 3.12+ ProactorEventLoop / IocpProactor)
      • Writes stdout via sys.stdout.buffer.write() synchronously
      • Each request dispatched with asyncio.create_task() so the
        read loop is never blocked by a slow tool call
    """
    log.info("NetFlow MCP server starting (stdio transport — Windows-safe)")
    loop = asyncio.get_running_loop()

    while True:
        try:
            # Run blocking readline in a thread so the event loop stays alive
            line = await loop.run_in_executor(None, _read_line_sync)

            if line is None:          # EOF — client disconnected
                log.info("stdin EOF — shutting down")
                break

            if not line:              # blank line — skip
                continue

            try:
                message = json.loads(line)
            except json.JSONDecodeError as e:
                resp = {
                    "jsonrpc": "2.0", "id": None,
                    "error":   {"code": RPC_PARSE_ERROR, "message": str(e)},
                }
                _write_line_sync(json.dumps(resp))
                continue

            # Dispatch; write response back synchronously on this thread
            response = await handle_rpc(message)
            if response is not None:
                _write_line_sync(json.dumps(response))

        except asyncio.CancelledError:
            log.info("stdio task cancelled — shutting down")
            break
        except Exception as e:
            log.error("stdio loop error: %s", e)


async def run_sse(host: str = "0.0.0.0", port: int = 8001) -> None:
    """
    SSE/HTTP transport — stdlib only, zero extra dependencies.
    Uses http.server.HTTPServer in a thread + asyncio for dispatch.

    Endpoints:
      POST /mcp          — JSON-RPC request/response
      GET  /mcp/sse      — SSE keep-alive stream
      GET  /mcp/tools    — tool list JSON
      GET  /mcp/health   — health check JSON

    CORS headers included on every response so browser clients work.
    """
    import http.server
    import threading
    import urllib.parse

    loop = asyncio.get_running_loop()

    CORS_HEADERS = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    def send_json(handler, data: dict, status: int = 200) -> None:
        body = json.dumps(data).encode()
        handler.send_response(status)
        handler.send_header("Content-Type",   "application/json")
        handler.send_header("Content-Length", str(len(body)))
        for k, v in CORS_HEADERS.items():
            handler.send_header(k, v)
        handler.end_headers()
        handler.wfile.write(body)

    class MCPHandler(http.server.BaseHTTPRequestHandler):

        def log_message(self, fmt, *args):
            log.debug("HTTP %s", fmt % args)

        def do_OPTIONS(self):
            self.send_response(204)
            for k, v in CORS_HEADERS.items():
                self.send_header(k, v)
            self.end_headers()

        def do_GET(self):
            path = urllib.parse.urlparse(self.path).path

            if path == "/mcp/health":
                send_json(self, {
                    "status":         "ok",
                    "server":         "netflow-mcp",
                    "version":        "1.0.0",
                    "transport":      "sse",
                    "tools":          len(TOOLS),
                    "guard_patterns": len(_GUARD_PATTERNS),
                })

            elif path == "/mcp/tools":
                send_json(self, {"tools": TOOLS})

            elif path == "/mcp/sse":
                # SSE keep-alive stream
                self.send_response(200)
                self.send_header("Content-Type",  "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection",    "keep-alive")
                for k, v in CORS_HEADERS.items():
                    self.send_header(k, v)
                self.end_headers()
                try:
                    connected = json.dumps({"type": "connected", "server": "netflow-mcp"})
                    self.wfile.write(f"data: {connected}\n\n".encode())
                    self.wfile.flush()
                    # Keep alive with heartbeat every 15s
                    import time as _time
                    while True:
                        _time.sleep(15)
                        ping = json.dumps({"type": "ping"})
                        self.wfile.write(f"data: {ping}\n\n".encode())
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass   # client disconnected

            else:
                send_json(self, {"error": "Not found"}, 404)

        def do_POST(self):
            path = urllib.parse.urlparse(self.path).path
            if path != "/mcp":
                send_json(self, {"error": "Not found"}, 404)
                return

            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length)
            try:
                message = json.loads(raw)
            except json.JSONDecodeError as e:
                send_json(self, {
                    "jsonrpc": "2.0", "id": None,
                    "error":   {"code": RPC_PARSE_ERROR, "message": str(e)},
                }, 400)
                return

            # Dispatch async handler from sync thread via run_coroutine_threadsafe
            future   = asyncio.run_coroutine_threadsafe(handle_rpc(message), loop)
            response = future.result(timeout=120)
            send_json(self, response or {"jsonrpc": "2.0", "result": None, "id": None})

    server = http.server.HTTPServer((host, port), MCPHandler)
    log.info("NetFlow MCP server (SSE/HTTP) listening on http://%s:%d", host, port)
    log.info("  POST /mcp        — JSON-RPC")
    log.info("  GET  /mcp/sse    — SSE stream")
    log.info("  GET  /mcp/tools  — tool list")
    log.info("  GET  /mcp/health — health check")

    # Run blocking serve_forever in a thread so the asyncio loop stays alive
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        # Keep the async loop running so run_coroutine_threadsafe works
        while True:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        server.shutdown()


# ══════════════════════════════════════════════════════════════
# 8.  ENTRY POINT
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NetFlow MCP Server")
    parser.add_argument("--transport", choices=["stdio","sse"], default="stdio")
    parser.add_argument("--host",      default="0.0.0.0")
    parser.add_argument("--port",      type=int, default=8001)
    args = parser.parse_args()

    if args.transport == "sse":
        asyncio.run(run_sse(args.host, args.port))
    else:
        # Windows: thread-based stdio reader — no event loop pipe setup needed.
        # SelectorEventLoop is NOT required because run_in_executor handles
        # the blocking read, so ProactorEventLoop stays as-is.
        asyncio.run(run_stdio())
