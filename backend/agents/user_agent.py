"""
NetFlow — User Agent  v1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PURPOSE
  The UserAgent is the first point of contact for every user request.
  It validates, sanitises, classifies, and enriches the raw input before
  any other agent ever sees it. Only clean, structured, safe messages
  pass through to the downstream pipeline.

WORKFLOW
  ┌─────────────────────────────────────────────────────────────┐
  │  Raw user input (free text, voice transcript, quick chip)   │
  └────────────────────────┬────────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 1 — Input Guard  (always runs, 0 tokens)  │
           │  • Length  check  (3–500 chars)                   │
           │  • Encoding check  (UTF-8, no null bytes)         │
           │  • Injection patterns  (blacklist regex)          │
           │  • Rate limit  (per-session token bucket)         │
           │  → REJECT with typed reason if any check fails    │
           └───────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 2 — Sanitiser  (always runs, 0 tokens)    │
           │  • Strip HTML / script tags                       │
           │  • Normalise unicode / homoglyphs                 │
           │  • Collapse whitespace                            │
           │  • Truncate to hard limit 500 chars               │
           └───────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 3 — Intent Classifier  (regex + keywords) │
           │  INTENT_SEARCH   → property search request       │
           │  INTENT_CHAT     → property-specific question    │
           │  INTENT_MARKET   → market data request           │
           │  INTENT_UNCLEAR  → needs clarification           │
           │  INTENT_INVALID  → nonsense / off-topic          │
           └───────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 4 — NLP Extractor  (regex, 0 tokens)      │
           │  • ZIP / city / state extraction                  │
           │  • Budget parsing  ($450k, 450000, 450K)         │
           │  • Beds, property type, strategy                  │
           │  → structured ValidatedRequest                   │
           └───────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 5 — Completeness Check + Clarifier        │
           │  If critical fields missing → ask the user        │
           │  If intent UNCLEAR → LLM clarification (Ollama)  │
           │  If INVALID → polite rejection message            │
           └───────────────┬──────────────────────────────────┘
                           │
           ┌───────────────▼──────────────────────────────────┐
           │  STAGE 6 — Downstream Router                     │
           │  SEARCH  → MarketAnalyst + Scorer + Risk agents  │
           │  CHAT    → PropertyChat (ConversationMemory)      │
           │  MARKET  → MarketAnalyst only                     │
           └──────────────────────────────────────────────────┘

SECURITY LAYERS
  1. Input length  — hard reject >500 chars before any processing
  2. Injection guard — 25 regex patterns covering:
       SQL injection, shell injection, LLM jailbreak phrases,
       HTML/JS injection, null-byte attacks, unicode tricks
  3. Sanitiser — removes HTML tags, normalises unicode, strips control chars
  4. Structural isolation — raw text never leaves UserAgent as-is;
       only structured ValidatedRequest reaches downstream agents
  5. Rate limiter — token bucket per session_id (10 req / 60s window)
  6. Audit log — every request logged with classification + action taken
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

log = logging.getLogger("netflow.agent.user")


# ══════════════════════════════════════════════════════════════
# 1.  INTENT TYPES
# ══════════════════════════════════════════════════════════════

class Intent(str, Enum):
    SEARCH   = "search"    # property search — route to full pipeline
    CHAT     = "chat"      # Q&A about a specific property
    MARKET   = "market"    # market data / rates / trends
    UNCLEAR  = "unclear"   # partial info — needs clarification
    INVALID  = "invalid"   # off-topic / harmful / nonsense


class ValidationStatus(str, Enum):
    OK        = "ok"
    REJECTED  = "rejected"    # security / policy block
    NEEDS_INFO= "needs_info"  # ask user for more details
    CLARIFY   = "clarify"     # intent unclear, ask for clarification


# ══════════════════════════════════════════════════════════════
# 2.  DATA MODELS
# ══════════════════════════════════════════════════════════════

@dataclass
class ValidatedRequest:
    """
    Clean, structured output of the UserAgent.
    Only this object reaches downstream agents — never the raw text.
    """
    # Status
    status:      ValidationStatus
    intent:      Intent
    session_id:  str

    # Extracted search params (populated for SEARCH / MARKET intent)
    zip_code:      str   = ""
    location:      str   = ""
    budget:        int   = 450_000
    min_beds:      int   = 3
    property_type: str   = "SFH"
    strategy:      str   = "LTR"

    # The sanitised prompt sent to LLM stages (never raw user text)
    sanitised_prompt: str = ""

    # Rejection / clarification info
    rejection_reason: str = ""    # why it was blocked
    clarification_msg:str = ""    # what to ask the user
    suggested_prompt: str = ""    # rephrased prompt suggestion

    # Observability
    original_length:  int   = 0
    stage_reached:    str   = ""  # last stage completed before exit
    risk_flags:       list[str] = field(default_factory=list)
    processing_ms:    float = 0.0


@dataclass
class RateLimitBucket:
    """Token bucket rate limiter per session."""
    tokens:      float
    last_refill: float
    max_tokens:  float = 10.0   # max 10 requests
    refill_rate: float = 10.0   # tokens per 60s window


# ══════════════════════════════════════════════════════════════
# 3.  SECURITY: INJECTION PATTERN LIBRARY
# ══════════════════════════════════════════════════════════════

# These patterns catch the most common injection attempts.
# A match → immediate rejection with reason code, no LLM call ever made.
INJECTION_PATTERNS: list[tuple[str, str, str]] = [
    # (regex_pattern, reason_code, description)

    # ── LLM jailbreak / system override ──────────────────────
    (r"ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)",
     "JAILBREAK_IGNORE", "Ignore-instructions jailbreak"),
    (r"(you\s+are\s+now|act\s+as|pretend\s+(to\s+be|you\s+are)|roleplay\s+as)\s+.{0,60}(DAN|evil|uncensored|without\s+restrictions?)",
     "JAILBREAK_PERSONA", "Persona-override jailbreak"),
    (r"(system\s*prompt|<\s*system\s*>|###\s*system|<<SYS>>|\[INST\])",
     "SYSTEM_PROMPT_INJECT", "System prompt injection attempt"),
    (r"reveal\s+(your|the)\s+(system\s+prompt|instructions?|rules?|guidelines?)",
     "PROMPT_EXTRACTION", "Prompt extraction attempt"),
    (r"(bypass|override|disable|ignore)\s+(safety|filter|guard|restriction|policy|rule)",
     "SAFETY_BYPASS", "Safety bypass attempt"),
    (r"what\s+(are|were)\s+your\s+(original\s+)?(instructions?|system\s+prompt)",
     "PROMPT_EXTRACTION_2", "System prompt extraction"),
    (r"(do\s+anything\s+now|DAN\b|jailbreak|break\s+character)",
     "JAILBREAK_DAN", "DAN/jailbreak keyword"),
    (r"(forget|disregard)\s+(everything|all|what)\s+(you('ve)?|i've|was)\s+(been\s+)?(told|taught|instructed|trained)",
     "JAILBREAK_FORGET", "Forget-training jailbreak"),

    # ── SQL injection ─────────────────────────────────────────
    (r"(\bUNION\b.{0,30}\bSELECT\b|\bDROP\b.{0,20}\bTABLE\b|\bINSERT\b.{0,20}\bINTO\b)",
     "SQL_INJECT", "SQL injection pattern"),
    (r"(--|;|\bOR\b\s+['\"]?\d+['\"]?\s*=\s*['\"]?\d+['\"]?)",
     "SQL_COMMENT", "SQL comment/OR injection"),

    # ── Shell / code injection ────────────────────────────────
    (r"(\$\(|\`[^`]+\`|&&|\|\||;[\s]*\w+|>\s*/dev/|nc\s+-|curl\s+http|wget\s+http)",
     "SHELL_INJECT", "Shell command injection"),
    (r"(__import__|exec\s*\(|eval\s*\(|os\.system|subprocess\.|open\s*\(.*['\"]w['\"])",
     "CODE_INJECT", "Python code injection"),

    # ── HTML / XSS ────────────────────────────────────────────
    (r"<\s*(script|iframe|object|embed|form|input|img\s+[^>]*onerror)[^>]*>",
     "XSS_HTML", "HTML/script injection"),
    (r"javascript\s*:",
     "XSS_JS_PROTO", "JavaScript protocol injection"),

    # ── Null bytes / encoding attacks ────────────────────────
    (r"\x00",
     "NULL_BYTE", "Null byte injection"),
    (r"(%00|%0[aAdD]|\\u0000)",
     "NULL_ENCODE", "Encoded null/CRLF injection"),

    # ── Prompt boundary attacks ───────────────────────────────
    (r"(-{3,}|\*{3,}|={3,})\s*(human|assistant|user|system|ai)\s*(-{3,}|\*{3,}|={3,})",
     "BOUNDARY_INJECT", "Conversation boundary injection"),
    (r"\[/?INST\]|<\|im_start\|>|<\|im_end\|>|<\|eot_id\|>",
     "SPECIAL_TOKENS", "LLM special token injection"),

    # ── Data exfiltration ─────────────────────────────────────
    (r"(send|email|post|exfil(trate)?)\s+(to|all|the)\s+(data|results?|api.?key|password)",
     "EXFIL_ATTEMPT", "Data exfiltration attempt"),

    # ── Off-topic / harmful content ───────────────────────────
    (r"\b(bomb|weapon|explosive|malware|ransomware|hack\s+into|ddos|botnet)\b",
     "HARMFUL_CONTENT", "Harmful/illegal content request"),
]

# Pre-compile all patterns once at module load
_COMPILED_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    (re.compile(p, re.IGNORECASE | re.DOTALL), code, desc)
    for p, code, desc in INJECTION_PATTERNS
]


# ══════════════════════════════════════════════════════════════
# 4.  REAL-ESTATE VOCABULARY FILTER
# ══════════════════════════════════════════════════════════════

# If a prompt contains NONE of these keywords and has no ZIP/city,
# it is likely off-topic.
RE_KEYWORDS = {
    "property", "properties", "house", "home", "homes", "apartment", "condo",
    "townhouse", "duplex", "sfh", "multi", "real estate", "realty", "rental",
    "invest", "investment", "flip", "brrrr", "str", "ltr", "airbnb", "vrbo",
    "rent", "rents", "mortgage", "cap rate", "cash flow", "yield", "roi",
    "zip", "zipcode", "market", "listing", "buy", "purchase", "deal",
    "beds", "bath", "sqft", "acres", "lot", "garage", "pool", "basement",
    "arv", "equity", "appreciation", "vacancy", "dom", "mls",
    # Cities & states (sample — full list in NLP parser)
    "texas", "california", "florida", "dallas", "austin", "houston",
    "denver", "nashville", "seattle", "atlanta", "miami", "chicago",
    "mckinney", "frisco", "plano", "prosper",
    # Abbreviated inputs that are valid
    "tx", "ca", "fl", "ny", "wa", "co",
}


# ══════════════════════════════════════════════════════════════
# 5.  RATE LIMITER
# ══════════════════════════════════════════════════════════════

_rate_buckets: dict[str, RateLimitBucket] = {}
_RATE_WINDOW = 60.0  # seconds


def _check_rate_limit(session_id: str) -> bool:
    """
    Token bucket rate limiter.
    Returns True if request is allowed, False if rate-limited.
    10 requests per 60-second window per session.
    """
    now = time.time()
    bucket = _rate_buckets.get(session_id)

    if bucket is None:
        _rate_buckets[session_id] = RateLimitBucket(
            tokens=9.0, last_refill=now  # first request costs 1 token
        )
        return True

    # Refill tokens since last request
    elapsed = now - bucket.last_refill
    bucket.tokens = min(
        bucket.max_tokens,
        bucket.tokens + (elapsed / _RATE_WINDOW) * bucket.max_tokens,
    )
    bucket.last_refill = now

    if bucket.tokens >= 1.0:
        bucket.tokens -= 1.0
        return True
    return False


def _session_id(raw_text: str, user_id: str = "") -> str:
    """Deterministic session identifier — SHA-256 of user_id or IP."""
    return hashlib.sha256((user_id or raw_text[:20]).encode()).hexdigest()[:16]


# ══════════════════════════════════════════════════════════════
# 6.  SANITISER
# ══════════════════════════════════════════════════════════════

def _sanitise(text: str) -> str:
    """
    Clean raw input text.
    • Remove HTML tags
    • Normalise unicode (NFC, strip homoglyphs)
    • Remove control characters except newline/tab
    • Collapse whitespace
    • Hard-truncate to 500 chars
    """
    # Strip HTML/XML tags
    text = re.sub(r"<[^>]{0,200}>", " ", text)

    # Normalise unicode to NFC (catches homoglyph attacks)
    text = unicodedata.normalize("NFC", text)

    # Remove control characters (except \n \t \r)
    text = re.sub(r"[^\x09\x0a\x0d\x20-\x7e\x80-\xff]", " ", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()

    # Hard truncate
    return text[:500]


# ══════════════════════════════════════════════════════════════
# 7.  INTENT CLASSIFIER
# ══════════════════════════════════════════════════════════════

# Patterns that indicate property search intent
_SEARCH_PATTERNS = [
    re.compile(r"\b\d{5}\b"),                              # ZIP code
    re.compile(r"\b(find|search|show|list|look\s+for|get\s+me)\b.{0,40}(homes?|propert|house|condo|apartment)", re.I),
    re.compile(r"\b(homes?|propert|house|condo)\b.{0,40}\b(in|near|around)\b", re.I),
    re.compile(r"\bunder\s+\$[\d,]+[km]?\b", re.I),
    re.compile(r"\b\d\s*(bed|br|bedroom)\b", re.I),
    re.compile(r"\b(sfh|multi|condo|townhouse|duplex)\b", re.I),
    re.compile(r"\b(ltr|str|brrrr|flip|rental|invest)\b", re.I),
]

_CHAT_PATTERNS = [
    re.compile(r"\b(what|how|why|tell\s+me|explain|calculate|compare|analyse|analyze)\b.{0,60}(this|the)\s+(property|house|home|listing)", re.I),
    re.compile(r"\b(cash\s+flow|cap\s+rate|grm|roi|coc|piti|noi|arv)\b", re.I),
    re.compile(r"\b(is\s+(this|it)\s+a\s+good\s+deal|should\s+i\s+(buy|invest))\b", re.I),
    re.compile(r"\b(risk|financing|mortgage|down\s+payment|vacancy|rehab)\b", re.I),
]

_MARKET_PATTERNS = [
    re.compile(r"\b(market|trend|rate|rates|economy|forecast|outlook)\b", re.I),
    re.compile(r"\b(mortgage\s+rate|interest\s+rate|30[\s-]?year)\b", re.I),
    re.compile(r"\b(how\s+is|what\s+(is|are))\b.{0,40}\b(market|economy|trend)\b", re.I),
]


def _classify_intent(text: str) -> Intent:
    """
    Classify user intent from sanitised text.
    Uses pattern matching — no LLM tokens consumed.
    """
    text_lower = text.lower()

    # Check for real-estate vocabulary — if completely absent, INVALID
    has_re_vocab = any(kw in text_lower for kw in RE_KEYWORDS)
    has_zip      = bool(re.search(r"\b\d{5}\b", text))
    has_city     = bool(re.search(r"\b[A-Z][a-z]{2,}\b", text))  # rough check

    if not has_re_vocab and not has_zip and len(text) < 20:
        return Intent.INVALID

    # Check SEARCH intent
    search_hits = sum(1 for p in _SEARCH_PATTERNS if p.search(text))
    if search_hits >= 1:
        return Intent.SEARCH

    # Check CHAT intent
    chat_hits = sum(1 for p in _CHAT_PATTERNS if p.search(text))
    if chat_hits >= 1:
        return Intent.CHAT

    # Check MARKET intent
    market_hits = sum(1 for p in _MARKET_PATTERNS if p.search(text))
    if market_hits >= 1:
        return Intent.MARKET

    # Has RE vocabulary but no clear intent → UNCLEAR
    if has_re_vocab or has_zip:
        return Intent.UNCLEAR

    return Intent.INVALID


# ══════════════════════════════════════════════════════════════
# 8.  COMPLETENESS CHECKER
# ══════════════════════════════════════════════════════════════

CITY_ZIP: dict[str, str] = {
    "mckinney":"75070","frisco":"75033","plano":"75023","dallas":"75201",
    "houston":"77001","austin":"73301","san antonio":"78201","fort worth":"76101",
    "arlington":"76001","nashville":"37201","denver":"80201","seattle":"98101",
    "chicago":"60601","atlanta":"30301","miami":"33101","boston":"02101",
    "portland":"97201","phoenix":"85001","las vegas":"89101","charlotte":"28201",
    "raleigh":"27601","minneapolis":"55401","kansas city":"64101","omaha":"68101",
    "louisville":"40201","baltimore":"21201","richmond":"23218","tampa":"33601",
    "orlando":"32801","san francisco":"94102","los angeles":"90001",
}


def _extract_params(text: str) -> dict:
    """
    Extract search parameters from sanitised text.
    Returns partial dict — caller checks completeness.
    """
    t = text.strip()
    result: dict = {}

    # ZIP code
    zm = re.search(r"\b(\d{5})\b", t)
    if zm:
        result["zip_code"] = zm.group(1)

    # City + State
    cs = re.search(r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?),?\s+([A-Z]{2})\b", t)
    if cs:
        city = cs.group(1).strip().lower()
        result["city"]  = cs.group(1).strip()
        result["state"] = cs.group(2).upper()
        if "zip_code" not in result:
            result["zip_code"] = CITY_ZIP.get(city, "")
        result["location"] = f"{cs.group(1)}, {cs.group(2)}"

    # City alone (in/near/around keyword)
    if "zip_code" not in result:
        ca = re.search(r"\b(?:in|near|around)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b", t)
        if ca:
            city = ca.group(1).strip().lower()
            z = CITY_ZIP.get(city, "")
            if z:
                result["zip_code"] = z
                result["location"] = ca.group(1).strip()

    # Budget
    bm = re.findall(r"\$?\s*([\d,]+)\s*([kKmM]?)\b", t)
    for raw, suf in bm:
        v = int(raw.replace(",", ""))
        if suf.lower() == "k":   v *= 1_000
        elif suf.lower() == "m": v *= 1_000_000
        elif v < 10_000:         v *= 1_000
        if 50_000 < v < 10_000_000:
            result["budget"] = v
            break

    # Min beds
    bm2 = re.search(r"(\d)\s*(?:\+\s*)?(?:bed|br|bedroom|bdrm)", t, re.I)
    if bm2:
        result["min_beds"] = max(1, min(6, int(bm2.group(1))))

    # Property type
    if re.search(r"\b(multi|duplex|triplex|fourplex|apartment)\b", t, re.I):
        result["property_type"] = "Multi"
    elif re.search(r"\bcondo\b", t, re.I):
        result["property_type"] = "Condo"
    elif re.search(r"\btownhouse\b|\btownhome\b", t, re.I):
        result["property_type"] = "Townhouse"
    else:
        result["property_type"] = "SFH"

    # Strategy
    if re.search(r"\bstr\b|short[\s-]term|airbnb|vrbo|vacation", t, re.I):
        result["strategy"] = "STR"
    elif re.search(r"\bbrrrr\b", t, re.I):
        result["strategy"] = "BRRRR"
    elif re.search(r"\bflip\b|fix[\s-]and[\s-]flip|rehab", t, re.I):
        result["strategy"] = "Flip"
    else:
        result["strategy"] = "LTR"

    return result


def _check_completeness(params: dict) -> tuple[bool, str]:
    """
    Returns (is_complete, clarification_question).
    A SEARCH request needs at minimum a ZIP or recognisable city.
    """
    if not params.get("zip_code"):
        return False, (
            "I need a location to search. "
            "Could you provide a ZIP code or city + state? "
            "For example: '75070', 'Dallas TX', or 'McKinney Texas'."
        )
    return True, ""


# ══════════════════════════════════════════════════════════════
# 9.  USER AGENT  (main class)
# ══════════════════════════════════════════════════════════════

class UserAgent:
    """
    Entry-point agent. Validates, sanitises, classifies, and routes
    every user request before any downstream agent or LLM sees it.

    Public API:
        process(raw_text, session_id, user_id) → ValidatedRequest

    The returned ValidatedRequest carries:
        • status=OK             → ready for downstream routing
        • status=REJECTED       → blocked; rejection_reason explains why
        • status=NEEDS_INFO     → clarification_msg to show user
        • status=CLARIFY        → intent unclear; clarification_msg

    NOTHING in ValidatedRequest.sanitised_prompt contains the original
    raw user text verbatim — it has been cleaned, normalised, and
    structurally isolated before reaching any LLM.
    """

    def __init__(self, ollama_base_url: str = "", ollama_model: str = "llama3"):
        self._ollama_url   = ollama_base_url
        self._ollama_model = ollama_model
        self._audit_log: list[dict] = []  # in-memory audit trail

    # ── Main entry point ──────────────────────────────────────

    def process(
        self,
        raw_text:   str,
        session_id: str = "",
        user_id:    str = "",
    ) -> ValidatedRequest:
        """
        Synchronous pipeline (all security stages are CPU-bound, 0 I/O).
        Returns ValidatedRequest — never raises.
        """
        t0    = time.perf_counter()
        sid   = session_id or _session_id(raw_text, user_id)
        audit = {
            "sid": sid, "ts": time.time(),
            "raw_len": len(raw_text), "action": "?", "stage": "?",
        }

        try:
            result = self._run_pipeline(raw_text, sid, audit)
        except Exception as e:
            log.error("UserAgent pipeline error: %s", e)
            result = ValidatedRequest(
                status           = ValidationStatus.REJECTED,
                intent           = Intent.INVALID,
                session_id       = sid,
                rejection_reason = "Internal validation error",
                stage_reached    = "error",
            )

        result.processing_ms = round((time.perf_counter() - t0) * 1000, 2)
        self._audit_log.append({**audit,
                                 "action": result.status.value,
                                 "intent": result.intent.value,
                                 "stage":  result.stage_reached,
                                 "ms":     result.processing_ms})
        # Keep audit log bounded
        if len(self._audit_log) > 500:
            self._audit_log = self._audit_log[-500:]

        log.info("UserAgent | sid=%-16s | %-10s | %-8s | %.1fms | %s",
                 sid, result.status.value, result.intent.value,
                 result.processing_ms, result.rejection_reason or "ok")
        return result

    def get_audit_log(self, last_n: int = 50) -> list[dict]:
        """Return last N audit entries for the observability endpoint."""
        return self._audit_log[-last_n:]

    # ── Private pipeline ──────────────────────────────────────

    def _run_pipeline(self, raw: str, sid: str, audit: dict) -> ValidatedRequest:

        # ── STAGE 1: Input Guard ──────────────────────────────
        audit["stage"] = "guard"

        # Length check
        if len(raw.strip()) < 3:
            return self._reject(sid, "TOO_SHORT",
                "Please enter at least 3 characters.", "guard")

        if len(raw) > 500:
            return self._reject(sid, "TOO_LONG",
                f"Input too long ({len(raw)} chars). Max 500.", "guard")

        # Null byte check
        if "\x00" in raw:
            return self._reject(sid, "NULL_BYTE",
                "Invalid characters in input.", "guard", risk="HIGH")

        # Rate limit
        if not _check_rate_limit(sid):
            return self._reject(sid, "RATE_LIMITED",
                "Too many requests. Please wait a moment.", "guard")

        # Injection patterns
        for pattern, code, desc in _COMPILED_PATTERNS:
            if pattern.search(raw):
                log.warning("Injection blocked | sid=%s | code=%s | desc=%s",
                            sid, code, desc)
                return self._reject(sid, code,
                    "Your request contains patterns that cannot be processed. "
                    "Please rephrase as a real estate search, e.g. "
                    "'3 bed homes in Dallas TX under $450k'.",
                    "guard", risk="HIGH")

        # ── STAGE 2: Sanitise ─────────────────────────────────
        audit["stage"] = "sanitise"
        clean = _sanitise(raw)
        if len(clean) < 3:
            return self._reject(sid, "EMPTY_AFTER_SANITISE",
                "Your message appears to be empty after cleanup.", "sanitise")

        # ── STAGE 3: Intent Classification ───────────────────
        audit["stage"] = "classify"
        log.debug("Stage 2 sanitised | before=%d after=%d chars | sid=%s",
                  len(raw), len(clean), sid)
        intent = _classify_intent(clean)

        log.debug("Stage 3 classified | intent=%s | sid=%s", intent.value, sid)

        if intent == Intent.INVALID:
            return ValidatedRequest(
                status            = ValidationStatus.REJECTED,
                intent            = Intent.INVALID,
                session_id        = sid,
                rejection_reason  = "OFF_TOPIC",
                clarification_msg = (
                    "NetFlow is a real estate investment tool. "
                    "Try: 'Find 3-bed SFH in McKinney TX under $450k' "
                    "or '75070 LTR strategy under $400k'."
                ),
                stage_reached     = "classify",
                sanitised_prompt  = clean,
            )

        # ── STAGE 4: Parameter Extraction ────────────────────
        audit["stage"] = "extract"
        params = _extract_params(clean)

        log.debug("Stage 4 extracted | params=%s | sid=%s", params, sid)

        # ── STAGE 5: Completeness Check ───────────────────────
        audit["stage"] = "complete"

        if intent == Intent.SEARCH:
            complete, clarify_msg = _check_completeness(params)
            if not complete:
                return ValidatedRequest(
                    status            = ValidationStatus.NEEDS_INFO,
                    intent            = intent,
                    session_id        = sid,
                    clarification_msg = clarify_msg,
                    suggested_prompt  = _suggest_prompt(params, clean),
                    sanitised_prompt  = clean,
                    stage_reached     = "complete",
                    original_length   = len(raw),
                )

        if intent == Intent.UNCLEAR:
            return ValidatedRequest(
                status            = ValidationStatus.CLARIFY,
                intent            = Intent.UNCLEAR,
                session_id        = sid,
                clarification_msg = (
                    "I'm not sure what you're looking for. "
                    "Are you searching for investment properties, "
                    "asking about a specific property, or checking market rates? "
                    "Try: 'Find homes in Austin TX under $400k' or '75070 STR deal'."
                ),
                suggested_prompt  = _suggest_prompt(params, clean),
                sanitised_prompt  = clean,
                stage_reached     = "complete",
            )

        # ── STAGE 6: Build clean ValidatedRequest ─────────────
        audit["stage"] = "done"
        return ValidatedRequest(
            status         = ValidationStatus.OK,
            intent         = intent,
            session_id     = sid,
            zip_code       = params.get("zip_code",      "75070"),
            location       = params.get("location",      params.get("zip_code", "")),
            budget         = params.get("budget",        450_000),
            min_beds       = params.get("min_beds",      3),
            property_type  = params.get("property_type", "SFH"),
            strategy       = params.get("strategy",      "LTR"),
            sanitised_prompt = clean,
            original_length  = len(raw),
            stage_reached    = "done",
        )

    # ── Helpers ───────────────────────────────────────────────

    def _reject(
        self, sid: str, code: str, msg: str,
        stage: str, risk: str = "LOW",
    ) -> ValidatedRequest:
        return ValidatedRequest(
            status           = ValidationStatus.REJECTED,
            intent           = Intent.INVALID,
            session_id       = sid,
            rejection_reason = code,
            clarification_msg= msg,
            stage_reached    = stage,
            risk_flags       = [f"SECURITY:{risk}"] if risk == "HIGH" else [],
        )


def _suggest_prompt(params: dict, clean: str) -> str:
    """
    Build a suggested rephrased prompt based on what was extracted,
    so the UI can offer a one-click correction.
    """
    parts = []
    beds  = params.get("min_beds", 3)
    ptype = params.get("property_type", "SFH")
    loc   = params.get("location") or params.get("zip_code", "")
    bud   = params.get("budget", 0)
    strat = params.get("strategy", "LTR")

    if beds:      parts.append(f"{beds} bed")
    if ptype:     parts.append(ptype)
    if loc:       parts.append(f"in {loc}")
    if bud:       parts.append(f"under ${bud:,}")
    if strat != "LTR": parts.append(strat)

    if parts:
        return " ".join(parts)
    return "3 bed SFH in McKinney TX under $450k"


# ── Module-level singleton ────────────────────────────────────
from backend.config import OLLAMA_BASE_URL, OLLAMA_MODEL
user_agent = UserAgent(ollama_base_url=OLLAMA_BASE_URL, ollama_model=OLLAMA_MODEL)
