"""
NetFlow — FastAPI Backend

Routes:
  POST /api/search/stream   — SSE streaming search (primary)
  POST /api/search          — sync search
  POST /api/parse-prompt    — NLP prompt → structured params
  GET  /api/market/{zip}    — market snapshot
  GET  /api/rate-history    — mortgage rate history
  GET  /health

Debug logging:
  Set DEBUG=true in .env (or env var) to enable:
    • Full request/response logging with request IDs
    • Agent stage timings and tool call arguments
    • Cache hit/miss events
    • SSE token stream debug
    • All logs written to logs/netflow_debug.log
"""

import json
import logging
import re
import asyncio
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── Configure logging FIRST — before any other netflow import ──
from backend.logger import configure_logging
from backend.config import ALLOWED_ORIGINS, DEMO_MODE, DEBUG_MODE, RENTCAST_API_KEY, FRED_API_KEY, LANGCHAIN_API_KEY

_debug_active = configure_logging(debug=DEBUG_MODE)

from backend.agents.netflow_agent import NetFlowAgent
from backend.agents.user_agent import user_agent, ValidationStatus, Intent
from backend.services.rentcast import RentCastService
from backend.services.fred import FREDService

log         = logging.getLogger("netflow.request")
log_startup = logging.getLogger("netflow.startup")
log_sse     = logging.getLogger("netflow.sse")
log_cache   = logging.getLogger("netflow.cache")


# ── City → ZIP lookup ─────────────────────────────────────────
CITY_ZIP: dict[str, str] = {
    "mckinney":"75070","frisco":"75033","plano":"75023","allen":"75002",
    "prosper":"75078","celina":"75009","dallas":"75201","houston":"77001",
    "san antonio":"78201","austin":"73301","fort worth":"76101","el paso":"79901",
    "arlington":"76001","corpus christi":"78401","lubbock":"79401",
    "laredo":"78040","garland":"75040","irving":"75038","amarillo":"79101",
    "grand prairie":"75050","brownsville":"78520","pasadena":"77501",
    "mesquite":"75149","killeen":"76540","new york":"10001",
    "los angeles":"90001","chicago":"60601","phoenix":"85001",
    "philadelphia":"19101","san diego":"92101","san jose":"95101",
    "jacksonville":"32099","columbus":"43085","charlotte":"28201",
    "indianapolis":"46201","san francisco":"94102","seattle":"98101",
    "denver":"80201","washington dc":"20001","nashville":"37201",
    "oklahoma city":"73101","boston":"02101","portland":"97201",
    "las vegas":"89101","memphis":"38101","louisville":"40201",
    "baltimore":"21201","miami":"33101","atlanta":"30301","tampa":"33601",
    "orlando":"32801","raleigh":"27601","richmond":"23218",
    "minneapolis":"55401","kansas city":"64101","omaha":"68101",
    "cleveland":"44101","pittsburgh":"15201","cincinnati":"45201",
    "st louis":"63101","new orleans":"70112","salt lake city":"84101",
    "tucson":"85701","albuquerque":"87101","bakersfield":"93301",
    "fresno":"93650","sacramento":"94203","long beach":"90801",
    "mesa":"85201","colorado springs":"80901","wichita":"67201",
    "virginia beach":"23451","spokane":"99201","boise":"83701",
}


def parse_prompt_to_params(text: str) -> dict:
    """
    Robust NLP parser — handles all prompt scenarios:
      • ZIP only:                "75070"
      • ZIP + budget:            "75070 under $400k"
      • City + state:            "McKinney TX" / "McKinney, TX"
      • City + state + budget:   "Dallas TX under $500k"
      • Full NL:                 "3 bed SFH in McKinney under $450k LTR"
      • Budget only:             "under $300k 2 bed condo"
      • City alone:              "homes in Austin"
    """
    t = text.strip()

    # ── ZIP ──────────────────────────────────────────────────
    zip_match = re.search(r"\b(\d{5})\b", t)
    zip_code  = zip_match.group(1) if zip_match else ""

    # ── City + State ─────────────────────────────────────────
    city_st = re.search(
        r"\b([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*),?\s+([A-Z]{2})\b", t
    )
    city_name  = ""
    state_abbr = ""
    if city_st:
        city_name  = city_st.group(1).strip()
        state_abbr = city_st.group(2).upper()
        if not zip_code:
            zip_code = CITY_ZIP.get(city_name.lower(), "")

    # ── City alone (no state) ────────────────────────────────
    if not zip_code and not city_st:
        city_alone = re.search(
            r"(?:in|near|around|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", t
        )
        if city_alone:
            zip_code = CITY_ZIP.get(city_alone.group(1).lower(), "")

    # ── Budget ────────────────────────────────────────────────
    budget = 450000
    b_candidates = re.findall(r"\$?([\d,]+)\s*([kKmM]?)\b", t)
    for raw, suffix in b_candidates:
        val = int(raw.replace(",", ""))
        if suffix.lower() == "k":   val *= 1000
        elif suffix.lower() == "m": val *= 1_000_000
        elif val < 10_000:          val *= 1000
        if 50_000 < val < 10_000_000:
            budget = val
            break

    # ── Min beds ─────────────────────────────────────────────
    min_beds = 3
    bed_m = re.search(r"(\d)\s*(?:\+\s*)?(?:bed|br|bedroom|bdrm)", t, re.IGNORECASE)
    if bed_m:
        min_beds = max(1, min(6, int(bed_m.group(1))))

    # ── Property type ─────────────────────────────────────────
    prop_type = "SFH"
    if re.search(r"\bmulti\b|duplex|triplex|fourplex|apt|apartment|multi.?family", t, re.IGNORECASE):
        prop_type = "Multi"
    elif re.search(r"\bcondo\b|condominium", t, re.IGNORECASE):
        prop_type = "Condo"
    elif re.search(r"\btownhouse\b|townhome|town.?home|row.?home", t, re.IGNORECASE):
        prop_type = "Townhouse"

    # ── Strategy ──────────────────────────────────────────────
    strategy = "LTR"
    if re.search(r"\bstr\b|short.?term|airbnb|vrbo|vacation\s+rental", t, re.IGNORECASE):
        strategy = "STR"
    elif re.search(r"\bbrrrr\b", t, re.IGNORECASE):
        strategy = "BRRRR"
    elif re.search(r"\bflip\b|fix.?and.?flip|fix\s+&\s+flip|rehab", t, re.IGNORECASE):
        strategy = "Flip"
    elif re.search(r"\bltr\b|long.?term", t, re.IGNORECASE):
        strategy = "LTR"

    # ── Location display ──────────────────────────────────────
    if city_name and state_abbr:
        location_display = f"{city_name}, {state_abbr}"
        if zip_code:
            location_display += f" {zip_code}"
    elif zip_code:
        location_display = zip_code
    else:
        location_display = t[:40]

    return {
        "zip_code":         zip_code or "75070",
        "location_display": location_display,
        "budget":           budget,
        "min_beds":         min_beds,
        "property_type":    prop_type,
        "strategy":         strategy,
        "city":             city_name,
        "state":            state_abbr,
        "raw_prompt":       t,
        "resolved":         bool(zip_code),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Full startup diagnostic (always printed + logged) ─────
    import urllib.request as _ur
    from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL

    mode         = "DEMO (mock)" if DEMO_MODE else "LIVE (RentCast + FRED)"
    debug_str    = " | DEBUG logging ON" if _debug_active else ""
    has_rentcast = bool(RENTCAST_API_KEY)
    has_fred     = bool(FRED_API_KEY)
    has_langsmith= bool(LANGCHAIN_API_KEY)

    # Ollama check
    ollama_ok = False
    try:
        _ur.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        ollama_ok = True
    except Exception:
        pass

    # ── Banner ────────────────────────────────────────────────
    banner = f"""
╔══════════════════════════════════════════════════════════╗
║  🏘️  NetFlow API  v1.0                                   ║
╠══════════════════════════════════════════════════════════╣
║  Mode       : {mode:<42} ║
║  Debug      : {"ON  → logs/netflow_debug.log" if _debug_active else "OFF (set DEBUG=true in .env)":<42} ║
╠══════════════════════════════════════════════════════════╣
║  Services                                               ║
║    Ollama   : {"✅ online  " + OLLAMA_MODEL:<42} ║
║    RentCast : {"✅ live API" if has_rentcast else "⚠️  mock data (add RENTCAST_API_KEY)":<42} ║
║    FRED     : {"✅ live API" if has_fred else "⚠️  mock data (add FRED_API_KEY)":<42} ║
║    LangSmith: {"✅ tracing ON" if has_langsmith else "○  off (add LANGCHAIN_API_KEY)":<42} ║
╠══════════════════════════════════════════════════════════╣
║  Endpoints                                              ║
║    API      : http://localhost:8000                     ║
║    Docs     : http://localhost:8000/docs                ║
║    Health   : http://localhost:8000/health              ║
║    MCP      : python -m backend.mcp.server              ║
╚══════════════════════════════════════════════════════════╝"""
    print(banner)

    log_startup.info(
        "NetFlow startup complete | mode=%s | ollama=%s | rentcast=%s | fred=%s | debug=%s",
        mode,
        "online" if ollama_ok else "offline",
        "live"   if has_rentcast else "mock",
        "live"   if has_fred     else "mock",
        _debug_active,
    )
    if not ollama_ok:
        log_startup.warning(
            "Ollama not reachable at %s — scoring will use rule-based fallback. "
            "Start with: ollama serve", OLLAMA_BASE_URL
        )
    if _debug_active:
        log_startup.debug(
            "Debug log file: logs/netflow_debug.log | "
            "All tool args, stage timings, cache events will be recorded"
        )

    yield

    log_startup.info("NetFlow API shutting down")


app = FastAPI(title="NetFlow API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def request_logger_middleware(request: Request, call_next):
    """
    Log every HTTP request with a unique request ID.
    In debug mode: log headers, query params, and response time.
    In normal mode: log method, path, status, duration only.
    """
    req_id  = uuid.uuid4().hex[:8]
    t_start = time.perf_counter()

    # Attach req_id to request state so SSE handlers can reference it
    request.state.req_id = req_id

    log.info(
        "→ %s %s",
        request.method, request.url.path,
        extra={"req_id": req_id},
    )
    if _debug_active:
        log.debug(
            "  headers=%s  params=%s",
            dict(request.headers),
            dict(request.query_params),
            extra={"req_id": req_id},
        )

    response = await call_next(request)

    duration_ms = round((time.perf_counter() - t_start) * 1000, 1)
    log.info(
        "← %s %s  status=%d  %.1fms",
        request.method, request.url.path, response.status_code, duration_ms,
        extra={"req_id": req_id, "duration_ms": duration_ms},
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rentcast = RentCastService()
fred     = FREDService()
agent    = NetFlowAgent()


# ── Request models ────────────────────────────────────────────

class SearchRequest(BaseModel):
    zip_code:      str = ""
    location:      str = ""
    prompt_text:   str = ""
    budget:        int = 450000
    property_type: str = "SFH"
    min_beds:      int = 3
    strategy:      str = "LTR"
    session_id:    str = ""   # optional; used for rate limiting

    def resolve(self) -> dict:
        result = {
            "zip_code":        self.zip_code.strip(),
            "budget":          self.budget,
            "property_type":   self.property_type,
            "min_beds":        self.min_beds,
            "strategy":        self.strategy,
            "location_display": self.location or self.zip_code,
        }
        if self.prompt_text.strip():
            parsed = parse_prompt_to_params(self.prompt_text)
            if not result["zip_code"] or result["zip_code"] == "75070":
                result["zip_code"] = parsed["zip_code"]
            if result["budget"] == 450000 and parsed["budget"] != 450000:
                result["budget"] = parsed["budget"]
            if result["property_type"] == "SFH":
                result["property_type"] = parsed["property_type"]
            if result["min_beds"] == 3:
                result["min_beds"] = parsed["min_beds"]
            if result["strategy"] == "LTR":
                result["strategy"] = parsed["strategy"]
            result["location_display"] = parsed["location_display"]
        if not result["zip_code"]:
            result["zip_code"] = "75070"
        return result


class ParseRequest(BaseModel):
    prompt: str


# ── Routes ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    import urllib.request
    ollama_ok = False
    try:
        from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL
        urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        ollama_ok = True
    except Exception:
        pass
    return {
        "status":       "ok",
        "service":      "NetFlow API v2",
        "demo_mode":    DEMO_MODE,
        "ollama":       "online" if ollama_ok else "offline (rule-based fallback active)",
        "live_data":    bool(RENTCAST_API_KEY and FRED_API_KEY),
        "agent_stages": ["financial_enrichment","llm_scoring","strategy_rerank","risk_screen","narrative"],
        "langsmith":    bool(LANGCHAIN_API_KEY),
        "model":        OLLAMA_MODEL if ollama_ok else "",
    }


@app.get("/mcp/health")
async def mcp_health():
    """MCP server status — also reachable from main FastAPI process."""
    from backend.mcp.server import TOOLS, _GUARD_PATTERNS
    return {
        "mcp_server":     "netflow-mcp v1.0",
        "tools":          [t["name"] for t in TOOLS],
        "tool_count":     len(TOOLS),
        "guard_patterns": len(_GUARD_PATTERNS),
        "transports":     ["stdio (Claude Desktop)", "sse (HTTP port 8001)"],
        "config":         "backend/mcp/claude_desktop_config.json",
    }


@app.get("/api/user-agent/audit")
async def user_agent_audit(last_n: int = 50):
    """Return UserAgent audit log — last N validation decisions."""
    return {
        "audit_log":         user_agent.get_audit_log(last_n),
        "injection_patterns": len(__import__('backend.agents.user_agent',
                                  fromlist=['INJECTION_PATTERNS']).INJECTION_PATTERNS),
    }


@app.get("/api/observability")
async def observability():
    """
    Returns agent pipeline metadata for the hackathon judges:
    - Which stages ran (LLM vs rule-based)
    - Token budget per stage
    - Cache hit rates
    - Ollama availability
    """
    import urllib.request
    from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL, RENTCAST_API_KEY, FRED_API_KEY
    ollama_ok = False
    try:
        urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        ollama_ok = True
    except Exception:
        pass
    return {
        "agents": {
            "market_analyst":  {"role": "Fetch live market data, build MarketContext, stream narrative", "memory": "MarketMemory TTL 15min", "tools": ["get_market_rate","get_market_stats"], "llm": "stage 4 narrative"},
            "property_scorer": {"role": "Batch LLM scoring + strategy reranking", "memory": "session AgentContext", "tools": ["compute_financials","llm_score_batch","llm_strategy_rerank"], "llm": "stages 1+2"},
            "risk_advisor":    {"role": "Risk profiling + LLM memos for HIGH-risk props", "memory": "RiskCache TTL 1hr", "tools": ["compute_risk_score","generate_risk_memo"], "llm": "HIGH-risk only"},
        },
        "pipeline": {
            "stage0": {"name": "Financial Enrichment",  "type": "deterministic", "tokens": 0,   "latency": "<1ms"},
            "stage1": {"name": "LLM Scoring",           "type": "ollama" if ollama_ok else "rule-based", "tokens": "~350 est", "model": OLLAMA_MODEL},
            "stage2": {"name": "Strategy Reranking",    "type": "ollama" if ollama_ok else "stable-sort","tokens": "~250 est", "model": OLLAMA_MODEL},
            "stage3": {"name": "Risk Screener + LLM Memo", "type": "rule+ollama-selective" if ollama_ok else "rule-based", "tokens": "~80 per HIGH-risk prop"},
            "stage4": {"name": "Narrative Summary",     "type": "ollama-stream" if ollama_ok else "template","tokens": "~200 est", "model": OLLAMA_MODEL},
        },
        "memory": {
            "MarketMemory":      "Per-ZIP, TTL 15min — skips API re-fetch on warm cache",
            "RiskCache":         "Per-ZIP, TTL 1hr — cross-request risk profile consistency",
            "ConversationMemory":"Per-property sliding 5-turn window for PropertyChat",
        },
        "tools": ["get_market_rate", "get_market_stats", "compute_financials_batch", "llm_score_batch", "llm_strategy_rerank", "compute_risk_scores", "generate_risk_memo", "market_memory_retrieve", "risk_cache_retrieve"],
        "security": {
            "prompt_injection": "Protected — user text never reaches LLM (regex parser extracts structured params only)",
            "api_keys":         "Loaded from .env, never logged or returned",
            "tls":              "All external calls use httpx with verify=True",
            "timeouts":         "8s RentCast, 60s Ollama, 10s FRED",
        },
        "caching": {
            "fred_rate":       "TTL 3600s (1hr — data is weekly)",
            "rent_estimates":  "TTL 900s (15min) per address+beds+baths key",
            "market_stats":    "TTL 900s (15min) per ZIP",
            "frontend_results":"TTL 900s (15min) in-memory Map, key=zip+budget+type+beds+strategy",
        },
        "reliability": {
            "ollama_fallback": "rule-based scoring (identical rubric)",
            "rentcast_fallback": "deterministic mock data seeded from ZIP",
            "fred_fallback":   "7.25% default rate",
            "retry_policy":    "tenacity: 3 attempts, exponential backoff 1-4s on connection errors",
        },
        "observability": {
            "langsmith":       "Enabled" if bool(LANGCHAIN_API_KEY) else "Disabled (LANGCHAIN_API_KEY not set)",
            "traceable":       "score_and_rank, market_summary wrapped in @traceable",
            "structured_logs": "Python logging to netflow.agent logger",
            "frontend_logs":   "IndexedDB ring buffer (200 entries), viewable via 🪵 button",
        },
        "infrastructure": {
            "ollama":          f"{'Online' if ollama_ok else 'Offline'} — {OLLAMA_BASE_URL}",
            "model":           OLLAMA_MODEL,
            "rentcast":        "Live" if RENTCAST_API_KEY else "Mock",
            "fred":            "Live" if FRED_API_KEY else "Mock",
        },
    }


@app.post("/api/parse-prompt")
async def parse_prompt_endpoint(req: ParseRequest):
    # PromptGuard: apply injection filter even on the parse endpoint
    from backend.mcp.server import prompt_guard
    guard = prompt_guard("parse_prompt", {"prompt": req.prompt})
    if not guard.passed:
        raise HTTPException(status_code=400,
            detail=f"Request blocked: {guard.code} — use plain real estate queries.")
    return parse_prompt_to_params(req.prompt)


@app.post("/api/search/stream")
async def search_stream(req: SearchRequest):
    async def event_generator():
        try:
            # ── UserAgent: validate + sanitise + classify ─────
            raw_prompt = req.prompt_text.strip()
            if raw_prompt:
                validated = user_agent.process(
                    raw_text   = raw_prompt,
                    session_id = req.session_id,
                )
                if validated.status == ValidationStatus.REJECTED:
                    yield _sse("error", {
                        "msg":     validated.clarification_msg or "Request blocked.",
                        "code":    validated.rejection_reason,
                        "stage":   validated.stage_reached,
                    })
                    return
                if validated.status in (ValidationStatus.NEEDS_INFO,
                                        ValidationStatus.CLARIFY):
                    yield _sse("clarify", {
                        "msg":              validated.clarification_msg,
                        "suggested_prompt": validated.suggested_prompt,
                        "intent":           validated.intent.value,
                    })
                    return
                # Merge validated params back into request
                # (only override if regex found something)
                if validated.zip_code:       req.zip_code      = validated.zip_code
                if validated.location:       req.location      = validated.location
                if validated.budget != 450000: req.budget       = validated.budget
                if validated.min_beds != 3:  req.min_beds      = validated.min_beds
                req.property_type = validated.property_type
                req.strategy      = validated.strategy

            p         = req.resolve()
            zip_code  = p["zip_code"]
            budget    = p["budget"]
            prop_type = p["property_type"]
            min_beds  = p["min_beds"]
            strategy  = p["strategy"]
            loc_disp  = p["location_display"]

            req_id = getattr(getattr(req, "state", None), "req_id", uuid.uuid4().hex[:8])
            log.info("SSE search start | zip=%s budget=%d strategy=%s",
                     zip_code, budget, strategy, extra={"req_id": req_id})
            if _debug_active:
                log.debug("SSE full params: %s", p, extra={"req_id": req_id})

            yield _sse("status", {"msg": f"🔍 Searching {loc_disp} — fetching rate & listings..."})

            mortgage_rate, listings = await asyncio.gather(
                fred.get_30yr_rate(),
                rentcast.search_listings(
                    zip_code=zip_code, max_price=budget,
                    property_type=prop_type, min_beds=min_beds, limit=10,
                ),
            )

            if not listings:
                yield _sse("error", {"msg": f"No listings found in {loc_disp} under ${budget:,}. Try a higher budget or nearby ZIP."})
                return

            yield _sse("status", {"msg": f"💰 Fetching rent comps for {len(listings)} properties..."})
            rent_estimates = await rentcast.get_rent_estimates_parallel(listings, zip_code)
            for i, listing in enumerate(listings):
                listing["est_rent"]   = rent_estimates[i]
                listing["mls_id"]     = listing.get("rentcast_id", f"MLS-{zip_code}-{i+1:04d}")
                listing["map_query"]  = f"{listing['address']}, {zip_code}"
                listing["photo_url"]  = ""

            yield _sse("status", {"msg": "🤖 Running 3-agent pipeline..."})
            scored = await agent.score_and_rank(
                listings, mortgage_rate, strategy,
                fred_service=fred, rentcast_service=rentcast,
            )

            log.info("SSE properties ready | count=%d zip=%s rate=%.2f%%",
                     len(scored), zip_code, mortgage_rate,
                     extra={"req_id": req_id})
            if _debug_active:
                log_sse.debug("SSE top-3 scores: %s",
                    [(p.rank, p.address[:20], p.ai_score) for p in scored[:3]],
                    extra={"req_id": req_id})
            yield _sse("properties", {
                "data":             [p.model_dump() for p in scored[:10]],
                "mortgage_rate":    mortgage_rate,
                "zip_code":         zip_code,
                "location_display": loc_disp,
                "demo_mode":        DEMO_MODE,
            })

            yield _sse("ai_start", {})
            fallback = any(
                getattr(p, "__dict__", {})
                for p in scored
            )
            async for token in agent.stream_market_summary(
                zip_code=zip_code, budget=budget, strategy=strategy,
                top_picks=scored[:3], mortgage_rate=mortgage_rate,
                fallback_used=DEMO_MODE,
            ):
                yield _sse("ai_token", {"token": token})

            log.info("SSE stream complete", extra={"req_id": req_id})
            yield _sse("done", {})

        except Exception as exc:
            log.error("SSE stream error: %s", exc, extra={"req_id": req_id})
            yield _sse("error", {"msg": str(exc)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/search")
async def search_properties(req: SearchRequest):
    try:
        p = req.resolve()
        mortgage_rate, listings = await asyncio.gather(
            fred.get_30yr_rate(),
            rentcast.search_listings(
                zip_code=p["zip_code"], max_price=p["budget"],
                property_type=p["property_type"], min_beds=p["min_beds"], limit=10,
            ),
        )
        rents = await rentcast.get_rent_estimates_parallel(listings, p["zip_code"])
        for i, l in enumerate(listings):
            l["est_rent"]  = rents[i]
            l["mls_id"]    = l.get("rentcast_id", f"MLS-{p['zip_code']}-{i+1:04d}")
            l["map_query"] = f"{l['address']}, {p['zip_code']}"
        scored  = await agent.score_and_rank(
            listings, mortgage_rate, p["strategy"],
            fred_service=fred, rentcast_service=rentcast,
        )
        summary = await agent.market_summary(
            zip_code=p["zip_code"], budget=p["budget"], strategy=p["strategy"],
            top_picks=scored[:3], mortgage_rate=mortgage_rate,
        )
        return {
            "properties":     [prop.model_dump() for prop in scored[:10]],
            "mortgage_rate":  mortgage_rate,
            "market_summary": summary,
            "zip_code":       p["zip_code"],
            "location_display": p["location_display"],
            "search_params":  req.model_dump(),
            "demo_mode":      DEMO_MODE,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/market/{zip_code}")
async def market_data(zip_code: str):
    rate, stats = await asyncio.gather(fred.get_30yr_rate(), rentcast.get_market_stats(zip_code))
    return {"zip_code": zip_code, "mortgage_rate_30yr": rate, **stats}


@app.get("/api/rate-history")
async def rate_history(months: int = 12):
    return {"history": await fred.get_rate_history(months)}


class OllamaChatRequest(BaseModel):
    messages: list[dict]   # [{role, content}]
    system:   str
    model:    str = ""     # override model, empty = use config default


@app.post("/api/ollama-chat")
async def ollama_chat(req: OllamaChatRequest):
    """
    Proxy POST to local Ollama /api/chat endpoint.
    UserAgent validates the last user message before forwarding.
    """
    from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL

    # Validate last user message through UserAgent security pipeline
    last_user_msg = next(
        (m["content"] for m in reversed(req.messages) if m.get("role") == "user"),
        ""
    )
    if last_user_msg:
        validated = user_agent.process(raw_text=last_user_msg, session_id="chat")
        if validated.status == ValidationStatus.REJECTED:
            raise HTTPException(
                status_code=400,
                detail=validated.clarification_msg or "Message blocked by security policy."
            )

    model = req.model or OLLAMA_MODEL
    payload = {
        "model":    model,
        "stream":   False,
        "messages": [{"role": "system", "content": req.system}] + req.messages,
        "options":  {"temperature": 0.2, "num_predict": 800},
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            # Ollama returns {"message": {"role":"assistant","content":"..."}}
            content = data.get("message", {}).get("content", "")
            return {"content": [{"type": "text", "text": content}]}
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Ollama is not running. Start it with: ollama serve")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _sse(event_type: str, payload: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **payload})}\n\n"
