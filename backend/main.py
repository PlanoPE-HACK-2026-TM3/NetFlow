"""
NetFlow — FastAPI Backend

Routes:
  POST /api/search/stream   — SSE streaming search (primary)
  POST /api/search          — sync search
  POST /api/parse-prompt    — NLP prompt → structured params
  GET  /api/market/{zip}    — market snapshot
  GET  /api/rate-history    — mortgage rate history
  GET  /health
"""

import json
import re
import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import ALLOWED_ORIGINS, DEMO_MODE
from backend.agents.netflow_agent import NetFlowAgent
from backend.services.rentcast import RentCastService
from backend.services.fred import FREDService


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
    mode = "DEMO (mock)" if DEMO_MODE else "LIVE (RentCast + FRED)"
    print(f"\n🏘️  NetFlow API — {mode}\n")
    yield


app = FastAPI(title="NetFlow API", version="1.0.0", lifespan=lifespan)
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
    return {"status": "ok", "service": "NetFlow API", "demo_mode": DEMO_MODE}


@app.post("/api/parse-prompt")
async def parse_prompt_endpoint(req: ParseRequest):
    return parse_prompt_to_params(req.prompt)


@app.post("/api/search/stream")
async def search_stream(req: SearchRequest):
    async def event_generator():
        try:
            p         = req.resolve()
            zip_code  = p["zip_code"]
            budget    = p["budget"]
            prop_type = p["property_type"]
            min_beds  = p["min_beds"]
            strategy  = p["strategy"]
            loc_disp  = p["location_display"]

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

            yield _sse("status", {"msg": "🤖 Running AI scoring..."})
            scored = await agent.score_and_rank(listings, mortgage_rate, strategy)

            yield _sse("properties", {
                "data":             [p.model_dump() for p in scored[:10]],
                "mortgage_rate":    mortgage_rate,
                "zip_code":         zip_code,
                "location_display": loc_disp,
                "demo_mode":        DEMO_MODE,
            })

            yield _sse("ai_start", {})
            async for token in agent.stream_market_summary(
                zip_code=zip_code, budget=budget, strategy=strategy,
                top_picks=scored[:3], mortgage_rate=mortgage_rate,
            ):
                yield _sse("ai_token", {"token": token})

            yield _sse("done", {})

        except Exception as exc:
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
        scored  = await agent.score_and_rank(listings, mortgage_rate, p["strategy"])
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


def _sse(event_type: str, payload: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **payload})}\n\n"
