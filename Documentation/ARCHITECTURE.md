# NetFlow — Architecture & Engineering Reference

> **Know your net. Grow your portfolio.**
> AI-powered real estate investment tool that ranks the top cash-flowing rental properties by ZIP code and budget.

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Repository Layout](#4-repository-layout)
5. [Backend](#5-backend)
   - [API Surface](#51-api-surface)
   - [Agent Pipeline](#52-agent-pipeline)
   - [Data Models](#53-data-models)
   - [Caching & Memory](#54-caching--memory)
   - [Observability](#55-observability)
6. [Frontend](#6-frontend)
7. [Security Model](#7-security-model)
8. [Token Economics & LLM Optimization](#8-token-economics--llm-optimization)
9. [Configuration](#9-configuration)
10. [Local Development](#10-local-development)
11. [Docker Deployment](#11-docker-deployment)
12. [Operational Runbook](#12-operational-runbook)
13. [Repository Hygiene](#13-repository-hygiene)
14. [Glossary](#14-glossary)

---

## 1. Overview

NetFlow takes a free-form prompt or structured query (ZIP, budget, beds, strategy) and returns the **top 10 investment-ready properties** ranked by AI-derived `ai_score`, with deterministic financial metrics (cap rate, cash flow, GRM), per-property risk profile, and a streaming market narrative.

| Property | Value |
|---|---|
| **Domain** | Single-family / multi-family rental investment analysis |
| **Strategies** | LTR (long-term), STR (short-term/Airbnb), BRRRR, Flip |
| **Output** | Ranked listings + per-property AI score (0–100), risk memo, confidence/groundedness/correctness signals |
| **Latency target** | < 4 s end-to-end (warm cache) |
| **LLM** | Local Ollama (`llama3.1:8b`); rule-based fallback at every stage |
| **Live data** | RentCast (listings + rent), FRED (mortgage rates) |
| **Observability** | LangSmith tracing + per-run feedback emission |

Key engineering principles enforced throughout the codebase:

- **Deterministic baseline** — every LLM stage has a rule-based fallback that produces functionally equivalent output, so the system is always responsive even when Ollama is offline.
- **Structural isolation** — raw user text never reaches an LLM; only typed `ValidatedRequest` fields do.
- **Token budget discipline** — compact JSON payloads, batched LLM calls, per-stage `num_predict` caps.
- **Cached at every layer** — TTL-keyed memory for market data, risk profiles, conversation context, RentCast lookups, and FRED rates.

---

## 2. System Architecture

```
                                    ┌──────────────────────────┐
                                    │   Next.js 16 SPA :3000   │
                                    │   (React, Tailwind)      │
                                    └──────────┬───────────────┘
                                               │ SSE / JSON
                                               ▼
                                    ┌──────────────────────────┐
                                    │   FastAPI :8000          │
                                    │   (uvicorn + sse-starlette)
                                    └──┬────────────────────┬──┘
                                       │                    │
                              ┌────────▼─────────┐  ┌───────▼────────┐
                              │   UserAgent      │  │  Service layer │
                              │   (6-stage guard)│  │  RentCast/FRED │
                              └────────┬─────────┘  └────────────────┘
                                       │ ValidatedRequest
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
      ┌───────────────┐       ┌────────────────┐        ┌──────────────┐
      │ MarketAnalyst │       │ PropertyScorer │        │ RiskAdvisor  │
      │  + MarketMem  │       │  + AgentCtx    │        │  + RiskCache │
      └───────┬───────┘       └────────┬───────┘        └──────┬───────┘
              │                        │                       │
              └────────────────────────┼───────────────────────┘
                                       ▼
                              ┌────────────────────┐
                              │   Ollama :11434    │
                              │   (llama3.1:8b)    │
                              └────────────────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │   LangSmith API    │
                              │   (traces + fb)    │
                              └────────────────────┘
```

The orchestration entry point is `NetFlowAgent.score_and_rank()` in [backend/agents/netflow_agent.py](../backend/agents/netflow_agent.py). The three sub-agents share an `AgentContext` dataclass (request-scoped session memory) that records tool calls, stage timings, token usage, and fallback flags.

---

## 3. Tech Stack

### Backend

| Component | Version | Notes |
|---|---|---|
| Python | 3.11+ | Tested on 3.11, 3.12 |
| FastAPI | 0.115.0 | Sync + async route handlers |
| uvicorn[standard] | 0.30.6 | uvloop, httptools |
| sse-starlette | 2.1.3 | Server-Sent Events |
| httpx | 0.27.2 | Async client; connection pooling |
| Pydantic | 2.8.2 | + pydantic-settings 2.5.2 |
| python-dotenv | 1.0.1 | Multi-file `.env` loader |
| langchain | 0.3.7 | LCEL chains |
| langchain-core | 0.3.15 | Prompt templates |
| langchain-ollama | 0.2.0 | Local LLM bridge |
| **langsmith** | **0.1.147** | **Pin — 0.2.x is incompatible with langchain 0.3.7** |
| tenacity | 8.5.0 | Retry: 3 × exp 1–4 s |

### Frontend

| Component | Version | Notes |
|---|---|---|
| Next.js | 16.2.3 | App Router |
| React / React-DOM | 18.3.1 | |
| TypeScript | 5.6.3 | Strict mode |
| Tailwind CSS | 3.4.13 | + custom CSS variables in `globals.css` |
| PostCSS | 8.4.47 | autoprefixer |
| npm install flag | `--legacy-peer-deps` | Required for the React 18 + Next 16 combo |

### Infrastructure

| Component | Notes |
|---|---|
| Docker Compose | v2+, 4 services |
| Ollama image | `ollama/ollama:latest` |
| LLM model | `llama3.1:8b` (~4.7 GB), pulled by `ollama-init` sidecar |
| Volumes | `ollama_data` named volume persists models |
| Network | Private bridge `netflow-net` |

### External APIs

| API | Use | Fallback |
|---|---|---|
| **FRED** (`MORTGAGE30US`) | 30-yr fixed mortgage rate | Static 7.25 % |
| **RentCast** (`/listings/sale`, `/avm/rent/long-term`) | Listings + rent estimates | Deterministic mock seeded from ZIP |
| **LangSmith** | Tracing + feedback | Silent skip if `LANGCHAIN_API_KEY` missing |
| **Ollama** | All LLM calls | Rule-based fallback per stage |

---

## 4. Repository Layout

```
NetFlow/
├── backend/                         # FastAPI server
│   ├── main.py                      # API routes, SSE, request handling
│   ├── config.py                    # Env-driven config + LangSmith bootstrap
│   ├── logger.py                    # Hierarchical logging setup
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── agents/
│   │   ├── netflow_agent.py         # 3-agent orchestrator (Market/Scorer/Risk)
│   │   └── user_agent.py            # 6-stage input validator + sanitiser
│   ├── services/
│   │   ├── fred.py                  # Mortgage-rate client (FRED)
│   │   ├── rentcast.py              # Listings + rent client (RentCast)
│   │   └── mock_data.py             # Deterministic fallbacks
│   └── mcp/
│       ├── server.py                # Model Context Protocol server
│       ├── README.md
│       └── claude_desktop_config.json
├── frontend/                        # Next.js 16 SPA
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── src/
│       ├── app/
│       │   ├── page.tsx             # Entry; SSE consumer; state owner
│       │   ├── layout.tsx
│       │   ├── globals.css          # Design tokens + tooltip system
│       │   ├── error.tsx / loading.tsx / not-found.tsx
│       ├── components/
│       │   ├── SearchPanel.tsx      # Form + NLP prompt parser
│       │   ├── PropertyGrid.tsx     # 10-card grid + feedback row
│       │   ├── PropertyChat.tsx     # Per-property grounded chat
│       │   ├── AIAnalysisCard.tsx   # Streaming market narrative
│       │   ├── AgentPanel.tsx       # Observability dashboard
│       │   ├── ComparisonCharts.tsx
│       │   └── MarketStats.tsx
│       └── lib/
│           ├── types.ts             # Shared TS interfaces
│           ├── db.ts                # IndexedDB user store
│           ├── logger.ts            # Client-side logger
│           └── spellCorrect.ts
├── Documentation/                   # This folder
├── logs/                            # Runtime logs (created on demand)
├── docker-compose.yml
├── env.example
├── start.sh / setup.sh / Makefile   # Native dev workflows
├── README.md
└── pyproject.toml
```

> Top-level `*.bkp`, `*_416`, `*_421`, `*_422`, `main.py_0420`, etc. are **iteration snapshots, not active code**. See [§13 Repository Hygiene](#13-repository-hygiene).

---

## 5. Backend

### 5.1 API Surface

All routes live in [backend/main.py](../backend/main.py).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/search/stream` | **Primary endpoint** — SSE-streamed property search |
| `POST` | `/api/search` | Synchronous JSON variant of search |
| `POST` | `/api/parse-prompt` | NLP parse: free text → structured `SearchParams` |
| `GET`  | `/api/market/{zip_code}` | Live market snapshot |
| `GET`  | `/api/rate-history?months=N` | FRED mortgage-rate history |
| `GET`  | `/health` | Liveness + dependency status |
| `GET`  | `/api/observability` | Pipeline metadata for dashboards |
| `GET`  | `/api/user-agent/audit?last_n=N` | UserAgent decision log |
| `GET`  | `/mcp/health` | MCP server status |
| `POST` | `/api/feedback` | Persist user thumbs up/down → LangSmith |
| `POST` | `/api/ollama-chat` | Server-side proxy to local Ollama |

#### SSE event vocabulary (`/api/search/stream`)

```
event: status        data: {"msg": "Fetching live data…"}
event: properties    data: {"data": [...], "mortgage_rate": 6.94, "run_id": "...", "request_id": "..."}
event: ai_start      data: {}
event: ai_token      data: {"token": "incremental chunk"}
event: done          data: {}
event: clarify       data: {"msg": "...", "suggested_prompt": "...", "intent": "unclear"}
event: error         data: {"msg": "...", "code": "...", "stage": "..."}
```

The frontend captures `run_id` from the `properties` event and forwards it in `/api/feedback` calls so user votes attach to the correct LangSmith run.

### 5.2 Agent Pipeline

Defined in [backend/agents/netflow_agent.py](../backend/agents/netflow_agent.py). Orchestration class: `NetFlowAgent`.

#### Sequence

```
1. UserAgent.process()        → ValidatedRequest                  (CPU-only, 0 tokens)
2. MarketAnalystAgent          → MarketContext                     (1 LLM call later for narrative)
3. compute_financials() ×N     → enriched listings                 (deterministic, 0 tokens)
4. RiskAdvisorAgent           → RiskProfile per property          (1 batched LLM call for HIGH-risk)
5. PropertyScorerAgent        → ScoredProperty list               (1 batched LLM call for scoring)
6. _rule_strategy_rerank()    → final ranked list                 (deterministic, 0 tokens)
7. emit_quality_feedback()    → LangSmith                         (out-of-band)
8. stream_market_summary()    → narrative tokens                  (1 streaming LLM call)
```

#### Agent 1 — `MarketAnalystAgent`

| Aspect | Detail |
|---|---|
| Inputs | ZIP, FRED service, RentCast service |
| Tools | `get_market_rate()`, `get_market_stats()` |
| Memory | `MarketMemory` — TTL 15 min per ZIP |
| LLM use | Stage 4 only — streaming 2-sentence narrative, capped at 64 tokens |
| Fallback | `_rule_summary()` produces equivalent text deterministically |
| Output | `MarketContext` dataclass |

#### Agent 2 — `PropertyScorerAgent`

| Aspect | Detail |
|---|---|
| Inputs | `AgentContext.enriched`, mortgage rate, strategy |
| Tools | `compute_financials()`, `_llm_score_batch()`, `_rule_strategy_rerank()` |
| Memory | Session-scoped `AgentContext` |
| LLM use | One batched call across all 10 properties; 4-field compact payload (`c`, `cf`, `g`, `d`) |
| `num_predict` cap | `min(220, 30 + N × 18)` |
| Fallback | `_rule_score_flat()` matches the LLM rubric exactly |
| Output | `list[ScoredProperty]` |

#### Agent 3 — `RiskAdvisorAgent`

| Aspect | Detail |
|---|---|
| Inputs | `AgentContext.enriched` |
| Tools | `compute_risk_score()`, `_generate_risk_memos()` |
| Memory | `RiskCache` — TTL 1 hr per ZIP |
| LLM use | **One batched call for all HIGH-risk properties** (numbered output parsed back per property) |
| `num_predict` cap | `min(400, 30 + N × 50)` |
| Fallback | `_rule_risk_memo()` returns deterministic memos |
| Output | `dict[address, RiskProfile]` |

#### `UserAgent` — entry validator

Lives in [backend/agents/user_agent.py](../backend/agents/user_agent.py). Six synchronous stages, all CPU-only:

| # | Stage | Action |
|---|---|---|
| 1 | Guard | length 3–500, null-byte check, rate limit, 25 injection regexes |
| 2 | Sanitise | strip HTML, NFC-normalise, drop control chars, collapse whitespace |
| 3 | Classify | regex → `Intent.{SEARCH, CHAT, MARKET, UNCLEAR, INVALID}` |
| 4 | Extract | ZIP, city/state, budget, beds, property type, strategy |
| 5 | Complete | reject NEEDS_INFO / CLARIFY with friendly prompt |
| 6 | Route | emit `ValidatedRequest` to downstream pipeline |

### 5.3 Data Models

#### Pydantic models

```python
# backend/agents/netflow_agent.py
class ScoredProperty(BaseModel):
    rank: int
    address: str; zip_code: str; price: int
    est_rent: int; cap_rate: float; cash_flow: int; grm: float
    beds: int; baths: float; sqft: int; year_built: int = 0
    dom: int
    ai_score: int                   # 0–100
    tags: list[str]                 # ≤ 2: "Cash+", "High cap", …
    strategy_note: str
    risk_level: str                 # "LOW" | "MEDIUM" | "HIGH"
    risk_factors: list[str]
    groundedness_score: int         # 0–100
    correctness_score:  int
    confidence_score:   int
```

```python
@dataclass
class MarketContext:
    zip_code: str
    mortgage_rate: float
    avg_rent: int
    vacancy_rate: float
    rent_growth: float
    avg_dom: int
    supply_trend: str               # "tight" | "stable" | "oversupply"
    retrieved_at: float

@dataclass
class RiskProfile:
    address: str
    overall_risk: str               # LOW | MEDIUM | HIGH
    score: int                      # 0–100, 0 = safest
    factors: list[str]
    mitigations: list[str]
    memo: str

@dataclass
class AgentContext:
    zip_code: str; budget: int; strategy: str
    listings: list[dict]
    market_ctx: MarketContext | None
    enriched: list[dict]
    scored: list[dict]
    risk_profiles: dict[str, RiskProfile]
    tool_trace: list[ToolCall]
    stage_times: dict[str, float]
    token_usage: dict[str, int]
    fallback_used: dict[str, bool]
    errors: list[str]
    llm_available: bool
```

#### API request bodies

```python
# backend/main.py
class SearchRequest(BaseModel):
    zip_code: str = ""
    location: str = ""
    prompt_text: str = ""           # free-form NLP path
    budget: int = 450_000
    property_type: str = "SFH"
    min_beds: int = 3
    strategy: str = "LTR"
    session_id: str = ""

class UserFeedbackRequest(BaseModel):
    run_id: str
    vote: str                       # "up" | "down"
    rank: int | None = None
    address: str | None = None
    score: int | None = None
    comment: str | None = None
    feedback_id: str | None = None  # stable for idempotent overwrites

class OllamaChatRequest(BaseModel):
    messages: list[dict]
    system: str
    model: str = ""
```

### 5.4 Caching & Memory

| Layer | TTL | Scope | Purpose |
|---|---|---|---|
| `MarketMemory` | 15 min | per ZIP | Reuse FRED rate + RentCast stats |
| `RiskCache` | 1 hr | per ZIP | Cross-request risk consistency |
| `ConversationMemory` | n/a | per address (5 turns) | PropertyChat grounding |
| RentCast rent cache | 15 min | per `(addr, beds, baths)` | Avoid duplicate AVM lookups |
| FRED rate cache | 1 hr | global | Weekly-updating data |
| Frontend result cache | 15 min | per `(zip, budget, type, beds, strategy)` | Skip backend round-trip |

### 5.5 Observability

#### Logging

Hierarchical loggers under root `netflow`:

```
netflow                   → request lifecycle
netflow.startup           → init / config
netflow.request           → per-route timing
netflow.agent             → orchestrator
netflow.agent.market      → MarketAnalystAgent
netflow.agent.scorer      → PropertyScorerAgent
netflow.agent.risk        → RiskAdvisorAgent
netflow.agent.user        → UserAgent
netflow.cache             → MarketMemory / RiskCache
netflow.sse               → SSE event stream
netflow.mcp               → MCP server
```

- `INFO_MODE` (default) → `logs/netflow.log` (10 MB × 5 backups)
- `DEBUG_MODE` → `logs/netflow_debug.log` (50 MB × 3 backups)
- Each request gets a UUID prefix attached to all log lines.

#### LangSmith feedback

`emit_quality_feedback_to_langsmith()` posts the following keys per run:

| Key | Range | Definition |
|---|---|---|
| `groundedness` | 0–1 | Anchoring of conclusions in retrieved listing facts and deterministic financials |
| `correctness` | 0–1 | Agreement between LLM-adjusted scores and the deterministic rubric baseline |
| `confidence` | 0–1 | Composite trust = 0.4·grounded + 0.35·correct + 0.25·(100 − risk_penalty) |
| `token_usage_estimate` | dict | `prompt_tokens / completion_tokens / total_tokens / per_stage` |

Failure mode: alias retry (`groundedness` → `quality_groundedness`, etc.) on schema conflict. All publish failures are logged-and-swallowed; the pipeline never crashes on observability errors.

#### `/api/observability` payload

Returns a single JSON document describing agents, pipeline stages, memory, tools, security layer, infrastructure status, and reliability metadata — used by the frontend `AgentPanel` and external dashboards.

---

## 6. Frontend

### Entry & state ownership

[frontend/src/app/page.tsx](../frontend/src/app/page.tsx) is the sole client component:

- Owns `SearchParams`, `SearchResult`, `selectedProperty`, `favorites`, `theme`.
- Opens `EventSource` to `/api/search/stream`, dispatches incremental events to state.
- Captures `run_id` from the SSE `properties` event and propagates it to `<PropertyGrid runId={…} />`.
- Persists favourites in IndexedDB via [frontend/src/lib/db.ts](../frontend/src/lib/db.ts).

### Components

| Component | Purpose |
|---|---|
| `SearchPanel` | ZIP/budget/beds/strategy form + NLP prompt parser; localStorage cache |
| `PropertyGrid` | 10-card grid; per-card feedback row (Conf pill + 👍 👎 💬 + 280-char comment); tooltips with `tip-left/right/center` variants |
| `PropertyChat` | Per-property chat grounded by `ConversationMemory` |
| `AIAnalysisCard` | Streaming 2-sentence market narrative |
| `AgentPanel` | Live observability — stage timings, cache hits, token usage, fallback flags |
| `ComparisonCharts` | Cap-rate / cash-flow / GRM distributions across the 10 picks |
| `MarketStats` | Avg rent · vacancy · DOM · rate snapshot |

### Shared types

[frontend/src/lib/types.ts](../frontend/src/lib/types.ts):

```ts
interface SearchParams {
  zip_code: string;
  budget: number;
  property_type: "SFH" | "Multi" | "Condo" | "Townhouse";
  min_beds: number;
  strategy:  "LTR" | "STR" | "BRRRR" | "Flip";
}

interface Property {
  rank: number; address: string; zip_code: string;
  price: number; est_rent: number;
  cap_rate: number; cash_flow: number; grm: number; dom: number;
  beds: number; baths: number; sqft: number; year_built?: number;
  ai_score: number;
  groundedness_score?: number;
  correctness_score?:  number;
  confidence_score?:   number;
  tags: string[];
  risk_level?: string;
  risk_factors?: string[];
}

interface SearchResult {
  properties: Property[];
  mortgage_rate: number;
  market_summary?: string;
  zip_code: string;
  location_display: string;
  request_id?: string;
  run_id?: string;
}
```

### Styling

Design tokens live in [frontend/src/app/globals.css](../frontend/src/app/globals.css):

- Color tokens: `--bg-base`, `--bg-card`, `--bg-raise`, `--bd`, `--t1/2/3`, `--pri/-hi/-lo`, `--grn`, `--amb`, `--red`, `--gold`.
- Radii: `--r-sm` 8 px, `--r-md` 12 px, `--r-lg` 16 px.
- Theme switch via `[data-theme="light"]` attribute on `<html>`.
- Tooltip system: `.tip-wrap` + `.tip-box` with `.tip-left` / `.tip-right` variants for edge alignment (used by Conf pill and metric pills).

---

## 7. Security Model

Defense in depth across four layers:

1. **Input Guard (UserAgent Stage 1)**
   - Hard length limits (3–500 chars).
   - 25 pre-compiled injection regexes covering: LLM jailbreak ("ignore previous instructions", DAN, persona override), prompt-extraction, system-prompt injection, SQL injection, shell injection (`$()`, backticks, `&&`, `nc`, `curl http`), Python code injection (`__import__`, `exec`, `eval`, `os.system`), HTML/XSS (`<script>`, `javascript:`), null bytes & encoding tricks, conversation-boundary injection (`<|im_start|>`, `[INST]`), data exfiltration phrases, harmful content keywords.
   - Token-bucket rate limit: **10 requests / 60 s** per session.
   - Match → immediate rejection with typed code (`JAILBREAK_IGNORE`, `SQL_INJECT`, `XSS_HTML`, …); **no LLM call ever made**.

2. **Sanitiser (UserAgent Stage 2)**
   - HTML-tag stripping, NFC unicode normalisation, control-char removal, whitespace collapsing.

3. **Structural isolation**
   - Raw text is never used in prompt templates. Downstream code references typed fields on `ValidatedRequest` only.

4. **Transport hardening**
   - All `httpx` calls verify TLS certs.
   - Per-service timeouts: RentCast 8 s, FRED 10 s, Ollama 60 s.
   - API keys loaded from `.env`, never echoed in responses or logs.
   - Tenacity retry: 3 attempts, exponential backoff 1–4 s on connection errors only (not on auth failures).

---

## 8. Token Economics & LLM Optimization

Per a 10-property search with 3 HIGH-risk listings, **post-optimization** estimates:

| Stage | Calls | System | User | Output | Total |
|---|---:|---:|---:|---:|---:|
| Scorer (batched) | 1 | ~55 | ~150 | ~140 | **~345** |
| Risk memos (batched) | 1 | ~40 | ~210 | ~165 | **~415** |
| Market narrative (streaming) | 1 | ~17 | ~95 | ≤ 64 | **~176** |
| **Total per search** | **3 calls** | | | | **~936 tokens** |

### Optimizations applied

- **Compressed system prompts** — scoring rubric is encoded in `_rule_based_score_fn` (the fallback), so the LLM only needs the JSON shape and tag IDs (~55 tok vs ~125 tok before).
- **Batched risk memos** — one LLM call producing N numbered memos parsed by `_parse_numbered_memos()` instead of N parallel calls. Saves (N−1) system-prompt copies plus round-trip overhead.
- **Tight `num_predict` ceilings** — per-stage `llm.bind(num_predict=…)` enforces a hard token cap so the model can't run away.
- **Compact JSON keys** — scorer payload uses `c/cf/g/d` (4 chars) and `s/t` (2 chars) for output. Parser accepts both short and long keys for backwards compatibility.
- **Pre-built `ChatPromptTemplate` instances** — `_PROMPT_SCORING`, `_PROMPT_RISK_MEMO_BATCH`, `_PROMPT_MARKET_SUMMARY` are module-level constants, not rebuilt per request.
- **Cached LangSmith client** — `_shared_langsmith_client()` singleton avoids per-feedback HTTP-client construction.
- **No re-enrichment** — `compute_financials()` runs once before risk + scorer share the enriched list via `AgentContext`.

### Cost defense before LLM

- **UserAgent kills ~all malicious prompts** (Stage 1, 0 tokens).
- **NEEDS_INFO / CLARIFY paths return without invoking LLM** (Stage 5).
- **Memory hits skip LLM entirely** (warm `MarketMemory` / `RiskCache`).

---

## 9. Configuration

All variables come from `.env` (root) and/or `backend/.env`. See [env.example](../env.example).

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_MODE` | `true` | Use mock data; skips RentCast/FRED |
| `USE_OLLAMA_OVERRIDE` | `false` | Allow Ollama even when `DEMO_MODE=true` |
| `DEBUG` | `false` | Enable DEBUG-level logging to `logs/netflow_debug.log` |
| `RENTCAST_API_KEY` | `""` | Live listings + rent estimates |
| `FRED_API_KEY` | `""` | Live mortgage-rate data |
| `LANGCHAIN_API_KEY` | `""` | Enable LangSmith tracing & feedback |
| `LANGCHAIN_PROJECT` | `netflow-hackathon` | LangSmith project name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Docker overrides to `http://ollama:11434` |
| `OLLAMA_MODEL` | `llama3.1:8b` | Local LLM model tag |
| `HOST` | `0.0.0.0` | FastAPI bind |
| `PORT` | `8000` | FastAPI port |
| `ALLOWED_ORIGINS` | `http://localhost:3000,…` | Comma-separated CORS list |

> **LangSmith bootstrap caveat:** the `langsmith` package caches env reads via `@lru_cache`. [backend/config.py](../backend/config.py) loads `.env`, sets `os.environ`, then explicitly calls `langsmith.utils.get_env_var.cache_clear()` before any langsmith import. Do not reorder these steps.

---

## 10. Local Development

### Prerequisites

- Python 3.11 or 3.12
- Node.js 18+
- [Ollama](https://ollama.com) installed and on `PATH`
- ~15 GB free disk (the llama3.1:8b model is ~4.7 GB)
- 8 GB free RAM

### One-command start

```bash
chmod +x start.sh
./start.sh
```

[start.sh](../start.sh) does the following:

1. Creates `.env` from `env.example` if missing.
2. Starts `ollama serve` (background) and pulls `llama3.1:8b` if not cached.
3. Creates `venv/`, installs `backend/requirements.txt`.
4. Copies root `.env` → `backend/.env`.
5. Launches `uvicorn backend.main:app --port 8000`.
6. Runs `npm install --legacy-peer-deps` in `frontend/`, starts `next dev` on port 3000.

### Makefile shortcuts

```bash
make install     # venv + Python + Node deps
make ollama      # pull llama3.1:8b
make backend     # uvicorn on :8000
make frontend    # next dev on :3000
make dev         # all three in parallel
```

---

## 11. Docker Deployment

```bash
./setup.sh                 # creates .env interactively
docker compose up --build -d
```

[docker-compose.yml](../docker-compose.yml) defines four services started in this order:

```
ollama         (health: GET /api/tags)
   ↓
ollama-init    (one-shot; pulls llama3.1:8b on first run)
   ↓
backend        (depends on ollama-init complete)
   ↓
frontend       (depends on backend healthy)
```

Endpoints:
- Frontend → http://localhost:3000
- API      → http://localhost:8000
- API docs → http://localhost:8000/docs

Compose-only env overrides:
- `OLLAMA_BASE_URL=http://ollama:11434` (internal DNS).
- `NEXT_PUBLIC_API_URL=http://localhost:8000` (baked into the client bundle at build time).

---

## 12. Operational Runbook

### Health checks

```bash
curl -s http://localhost:8000/health | jq
curl -s http://localhost:8000/mcp/health | jq
curl -s http://localhost:8000/api/observability | jq '.pipeline'
```

### Tail logs

```bash
tail -f logs/netflow.log
DEBUG=true ./start.sh         # for verbose logs/netflow_debug.log
```

### Common failure modes

| Symptom | Likely cause | Resolution |
|---|---|---|
| `Pipeline done | … fallback={'scorer': True}` | Ollama offline or wrong model | `ollama list`; verify `OLLAMA_MODEL` matches a pulled tag |
| LangSmith feedback warning `LANGCHAIN_API_KEY missing` | env var not loaded | Confirm `backend/.env` exists; restart backend |
| Tokens always reported as 0 | reading wrong dict keys | The pipeline now sums per-stage counters; should not recur after current build |
| Search returns 422 on `/api/search/stream` | `prompt_text` rejected by UserAgent | Check `/api/user-agent/audit?last_n=20` for the rejection code |
| Empty SSE stream | rate limit (10/60 s/session) | Wait 60 s or use a fresh `session_id` |
| `address already in use :8000` | stale uvicorn / killed badly | `lsof -i :8000` then `kill -9 <pid>` |

### Key request IDs

Every request emits a UUID prefix in logs (`netflow.request`). The same id is returned in `request_id` (JSON) and `run_id` (LangSmith parent run) fields, so a single search can be traced end-to-end across logs, the LangSmith UI, and the user-feedback table.

---

## 13. Repository Hygiene

The following files are **iteration snapshots, not code** — none of them are imported or built. They can be safely removed once an archive is taken.

### Backend snapshots
```
backend/main.py_0221
backend/main.py_0420
backend/main.py.bkp
backend/main.py.bkpbkp
backend/agents/netflow_agent.py.bkp
backend/services/fred.py.bkp
backend/services/rentcast.py.bkp
```

### Frontend snapshots
```
frontend/src/SearchPanel.tsx_422
frontend/src/PropertyGrid.tsx_422
frontend/src/PropertyChat.tsx_422
frontend/src/AIAnalysisCard.tsx_422
frontend/src/page.tsx_422
frontend/src/globals.css_422
frontend/src/app/page.tsx_1
frontend/src/app/page.tsx_416
frontend/src/app/page.tsx.bkp
frontend/src/app/globals.css_416
frontend/src/app/globals.css_422
frontend/src/components/AIAnalysisCard.tsx_416
frontend/src/components/ComparisonCharts.tsx_416
frontend/src/components/SearchPanel.tsx_416
frontend/src/components/SearchPanel.tsx.bkp
frontend/src/components/PropertyGrid.tsx_416
frontend/src/components/PropertyGrid.tsx_422
frontend/src/components/PropertyGrid.tsx.bkp
frontend/src/components/PropertyChat.tsx_421
frontend/src/lib/types.ts.bkp
```

### Generated / runtime
```
netflow_backend.egg-info/   # setuptools artefact
logs/                       # runtime log destination
venv/                       # native dev only; not in Docker
```

---

## 14. Glossary

| Term | Definition |
|---|---|
| **Cap rate** | NOI ÷ price × 100. Target ≥ 6 % for strong investments. |
| **NOI** | Net Operating Income = annual rent × 0.65 (assumes 35 % opex). |
| **Cash flow** | Monthly rent − PITI − 35 % operating expenses. |
| **GRM** | Gross Rent Multiplier = price ÷ annual rent. < 100 excellent, > 130 fair. |
| **DOM** | Days on Market — proxy for seller motivation. |
| **PITI** | Principal + Interest + Taxes + Insurance (monthly). |
| **CoC return** | Cash-on-Cash = annual cash flow ÷ down payment × 100. |
| **LTR / STR** | Long-Term Rental / Short-Term Rental (Airbnb/VRBO). |
| **BRRRR** | Buy, Rehab, Rent, Refinance, Repeat. |
| **AVM** | Automated Valuation Model — RentCast's rent estimate endpoint. |
| **SSE** | Server-Sent Events — one-way HTTP streaming used for `/api/search/stream`. |
| **MCP** | Model Context Protocol — Claude Desktop integration in [backend/mcp/](../backend/mcp/). |
| **Groundedness** | Degree to which output is anchored in retrieved data, not free-form assumptions. |
| **Correctness** | Agreement with the deterministic scoring rubric. |
| **Confidence** | Composite trust signal = 0.4·grounded + 0.35·correct + 0.25·(100 − risk). |

---

*Last updated for the current snapshot of the repository. Keep this document version-controlled alongside the code.*
