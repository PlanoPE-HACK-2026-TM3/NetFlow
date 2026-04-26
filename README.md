# NetFlow

AI-powered real estate investment intelligence. NetFlow ingests free-text
or structured queries, fetches live listings and macro data, runs a
four-agent LLM pipeline locally (Ollama / llama3), and streams scored
investment recommendations back over Server-Sent Events.

This README is written for engineers who will operate, deploy, and
on-call for the system. Functional product docs live in
`Documentation/NetFlow_Functional_Documentation.docx`.

---

## 1. System overview

| Layer        | Tech                                                |
| ------------ | --------------------------------------------------- |
| Frontend     | Next.js 16, React 18, TypeScript, Tailwind          |
| Backend      | FastAPI (uvicorn), Python 3.11+                     |
| LLM          | Ollama running `llama3` (local, no external calls)  |
| LLM glue     | LangChain 0.3.7 + langchain-ollama 0.2.0            |
| External API | RentCast (listings, rents), FRED (mortgage rate)    |
| Tracing      | LangSmith (optional, gated by env var)              |
| Container    | Docker Compose with 4 services + 1 init sidecar     |

```
   ┌────────────┐       SSE         ┌────────────────────────────────┐
   │  Next.js   │ ────── HTTP ────► │  FastAPI :8000                 │
   │  :3000     │ ◄────────────────  │  - /api/search/stream (SSE)   │
   └────────────┘                   │  - /api/parse-prompt           │
                                    │  - /api/market/{zip}            │
                                    │  - /health, /api/observability  │
                                    └─────┬───────────────┬───────────┘
                                          │               │
                          ┌───────────────┘               └────────────┐
                          ▼                                            ▼
                  ┌──────────────┐                           ┌─────────────────┐
                  │   Agents     │  ── Ollama HTTP ──►       │  External APIs  │
                  │   pipeline   │     :11434                │  RentCast, FRED │
                  └──────────────┘                           └─────────────────┘
```

The full pipeline: **UserAgent → MarketAnalyst → RiskAdvisor → PropertyScorer → narrative summary**.
Every LLM stage has a deterministic rule-based fallback that runs silently when
Ollama is unreachable, so the system continues to return scored results during
LLM outages.

A higher-fidelity diagram lives at `Documentation/netflow_architecture_diagram.svg`
and a refreshed copy at `architecture_diagram.svg` (this branch).

---

## 2. Repository layout

```
.
├── backend/
│   ├── main.py                  FastAPI app, SSE handler, request resolver
│   ├── config.py                Env loading (LangSmith lru_cache fix)
│   ├── logger.py                Structured logging + debug log file rotation
│   ├── agents/
│   │   ├── user_agent.py        Input guard, sanitiser, intent classifier
│   │   └── netflow_agent.py     3-agent pipeline + orchestrator
│   ├── services/
│   │   ├── rentcast.py          RentCast wrapper + cache + mock fallback
│   │   ├── fred.py              FRED wrapper + cache + mock fallback
│   │   └── mock_data.py         Deterministic seeded mock generators
│   └── mcp/
│       └── server.py            MCP server for Claude Desktop
├── frontend/                    Next.js app (src/, app/, components/)
├── tests/                       pytest suite — see §6
├── docker-compose.yml           Production-style local stack
├── pyproject.toml               Editable install metadata
├── pytest.ini                   Test runner config
└── env.example                  Template for .env
```

---

## 3. Configuration

All config is environment-driven. Copy `env.example` to `.env` at the repo
root before running. `start.sh` and the backend Dockerfile both consume it.

| Var                  | Required | Default                  | Notes                                        |
| -------------------- | -------- | ------------------------ | -------------------------------------------- |
| `RENTCAST_API_KEY`   | no       | empty                    | Empty → mock listings & rents                |
| `FRED_API_KEY`       | no       | empty                    | Empty → mock 7.2% mortgage rate              |
| `OLLAMA_BASE_URL`    | no       | `http://localhost:11434` | Use container DNS name in compose            |
| `OLLAMA_MODEL`       | no       | `llama3`                 | Any model `ollama list` shows                |
| `DEMO_MODE`          | no       | `false`                  | `true` forces mock data + rule-based scoring |
| `DEBUG`              | no       | `false`                  | Verbose logs to `logs/netflow_debug.log`     |
| `LANGCHAIN_API_KEY`  | no       | empty                    | Empty → tracing off (no errors)              |
| `LANGCHAIN_PROJECT`  | no       | `netflow-hackathon`      | LangSmith project name                       |
| `HOST`, `PORT`       | no       | `0.0.0.0`, `8000`        | Backend bind address                         |
| `ALLOWED_ORIGINS`    | no       | localhost:3000, vercel   | Comma-separated CORS list                    |

**Deployment modes:**

- **Demo** — no API keys, no Ollama. All paths use mock data and
  rule-based scoring. Useful for CI and offline demos.
- **Hybrid** — API keys present, Ollama down. Live data, rule-based
  scoring fallback. Logged as a warning at startup.
- **Live** — API keys present, Ollama up. Full LLM pipeline.

The startup banner reports which mode the service entered. See the
`netflow.startup` logger for the same information in JSON form.

---

## 4. Running the stack

### 4.1 Docker Compose (recommended)

```bash
cp env.example .env       # add your API keys here, optional
docker compose up --build
```

Boot order is enforced via healthchecks:

```
ollama  →  ollama-init  →  backend  →  frontend
```

`ollama-init` is a one-shot sidecar that pulls llama3 (~4.7 GB) on first
boot and exits. The model lives in the `ollama_data` named volume so
restarts skip the re-pull.

URLs once up:

- Frontend: <http://localhost:3000>
- API:      <http://localhost:8000>
- Docs:     <http://localhost:8000/docs>
- Health:   <http://localhost:8000/health>

### 4.2 Local Python (no Docker)

```bash
pip install -e .
pip install -r backend/requirements.txt
ollama serve &                 # in another shell
ollama pull llama3
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 5. API surface

### Endpoints

| Method | Path                       | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| POST   | `/api/search/stream`       | **Primary.** SSE-streamed scored properties + narrative |
| POST   | `/api/search`              | Synchronous version (no streaming)                 |
| POST   | `/api/parse-prompt`        | NLP regex parse → structured `SearchRequest`       |
| GET    | `/api/market/{zip}`        | Snapshot of market stats for a ZIP                 |
| GET    | `/api/rate-history`        | 12-month mortgage rate history                     |
| POST   | `/api/ollama-chat`         | Validated chat proxy to local Ollama               |
| POST   | `/api/feedback`            | HITL up/down vote on a scored property             |
| GET    | `/api/feedback/summary`    | Aggregate HITL stats                               |
| GET    | `/api/observability`       | Pipeline metadata (stages, tools, cache, infra)    |
| GET    | `/api/user-agent/audit`    | Last N validation decisions                        |
| GET    | `/health`                  | Liveness + dependency snapshot                     |
| GET    | `/mcp/health`              | MCP tool registry status                           |

### SSE event protocol (`/api/search/stream`)

Frame format: `data: {<json>}\n\n` where the JSON body has a `type` field:

| Event type   | Emitted when                                            |
| ------------ | ------------------------------------------------------- |
| `status`     | Stage transition human-readable message                 |
| `clarify`    | UserAgent needs more info before search proceeds        |
| `error`      | Validation rejected, no listings, or upstream failure   |
| `properties` | Scored property batch is ready                          |
| `ai_start`   | Narrative streaming about to begin                      |
| `ai_token`   | Token chunk from the narrative summary (5-token batches) |
| `done`       | Stream complete                                         |

---

## 6. Testing

Test suite lives in `tests/`. Designed to run fully offline — no network,
no Ollama, no API keys required.

```bash
pip install -r tests/requirements-test.txt
python -m pytest tests/ --cov=backend
```

**Current state:** 169 passing, 3 xfailed. The xfails document real
defects in the codebase — they will flip to passing once the bugs are
fixed (see §6.2).

```
tests/
├── conftest.py               Forces DEMO_MODE before any backend import,
│                             resets in-process caches between tests.
├── test_main_parser.py       parse_prompt_to_params, SearchRequest, SSE
├── test_user_agent.py        Sanitiser, classifier, extractor, rate limit,
│                             injection patterns, end-to-end pipeline
├── test_mock_data.py         Determinism, range checks, schema
├── test_financial_calcs.py   compute_financials, compact_for_llm,
│                             compute_risk_score (4-tuple, banding)
├── test_services.py          RentCast & FRED — DEMO_MODE path + monkey-
│                             patched live path that exercises caches
├── test_memory_caches.py     MarketMemory, RiskCache, ConversationMemory
└── pytest.ini                asyncio_mode=auto, strict markers
```

### 6.1 Coverage breakdown

```
backend/services/mock_data.py     100%
backend/agents/user_agent.py       95%   ← security gateway, well-covered
backend/logger.py                  86%
backend/config.py                  71%
backend/services/fred.py           63%
backend/services/rentcast.py       59%
backend/main.py                    50%   ← endpoints uncovered (need TestClient)
backend/agents/netflow_agent.py    44%   ← needs Ollama-mocked integration tests
backend/mcp/server.py               0%   ← out of scope for this suite
```

### 6.2 Defects surfaced by the suite

| ID          | Location                                  | Severity | Fix                                                          |
| ----------- | ----------------------------------------- | -------- | ------------------------------------------------------------ |
| `NETFLOW-1` | `compute_financials` (netflow_agent.py:322) | medium   | Guard `coc_return` with `if price > 0` — currently raises `ZeroDivisionError` |
| `NETFLOW-2` | budget regex in `_extract_params` and `parse_prompt_to_params` | medium | Anchor to `\d[\d,]*` so a lone comma can't match — currently `ValueError: invalid literal for int(): ''` on inputs like `"Dallas, TX under $400k"` |
| `NETFLOW-3` | `_classify_intent` ordering               | low      | Pattern order means `"mortgage"` always routes to `CHAT` even when user asks about market rates |

Each xfail in the test suite carries the fix recommendation in its `reason`
parameter, so the team knows exactly what to change.

### 6.3 Recommended next-pass coverage targets

- `backend/main.py` — add `httpx.AsyncClient` + FastAPI `TestClient` based
  tests for each endpoint (currently only the parser is unit-tested).
- `backend/agents/netflow_agent.py` — add an Ollama-mocked integration
  test that runs `score_and_rank` end-to-end with a stubbed `_LC_AVAILABLE`
  path to drive coverage from 44% → 80%+.
- `backend/mcp/server.py` — add tests for `prompt_guard` and the tool
  dispatch table.

---

## 7. Operational notes

### 7.1 Reliability — the fallback ladder

Every LLM stage and external API call has a deterministic backup. The
service is designed to remain useful when components fail:

```
LLM scoring (Ollama)         →  rule-based scoring with same rubric
Strategy reranking           →  stable sort on cap_rate * cash_flow
Risk memo generation (Ollama) → templated memo from factors + mitigations
Narrative summary (Ollama)   →  template summary
RentCast listings            →  mock_listings (seeded by ZIP)
RentCast rent estimates      →  mock_rent_estimate (price-based)
RentCast market stats        →  mock_market_stats (seeded by ZIP)
FRED mortgage rate           →  7.2% constant
```

`tenacity` retries connection-level failures three times with exponential
backoff (1–4 s) before falling back. Timeouts: RentCast 8 s, FRED 6 s,
Ollama 60 s, Ollama health-check 2 s.

### 7.2 Caching

| Cache                    | Scope    | TTL    | Purpose                                          |
| ------------------------ | -------- | ------ | ------------------------------------------------ |
| `_rate_cache`            | process  | 1 h    | FRED is published weekly — no need to re-fetch   |
| `_history_cache`         | process  | 1 h    | Same series, by months bucket                    |
| `_rent_cache`            | process  | 15 min | Per-address rent estimate                        |
| `_market_cache`          | process  | 15 min | Per-ZIP market stats                             |
| `MarketMemory`           | process  | 15 min | MarketContext per ZIP for the agent pipeline     |
| `RiskCache`              | process  | 1 h    | Per-ZIP risk profiles for cross-request consistency |
| `ConversationMemory`     | process  | none   | Sliding 5-turn window per property               |

All caches are in-process. There is no Redis or shared cache layer, so
horizontal scale-out will lose cache locality — every replica re-fetches.
This is acceptable for the current single-instance deployment but would
need to be revisited before going multi-replica.

### 7.3 Observability

- **Structured logs** to `logs/netflow_debug.log` when `DEBUG=true`.
  Loggers: `netflow.request`, `netflow.startup`, `netflow.sse`,
  `netflow.cache`, `netflow.agent`, `netflow.agent.market`,
  `netflow.agent.scorer`, `netflow.agent.risk`, `netflow.agent.user`.
- **LangSmith** traces every call decorated `@traceable` (set
  `LANGCHAIN_API_KEY`).
- **Per-request IDs** — middleware tags every request with an 8-char ID
  threaded through to all log records.
- **`/api/observability`** returns a JSON snapshot of pipeline state,
  cache TTLs, infrastructure status, and security posture.

### 7.4 Security

The UserAgent (`backend/agents/user_agent.py`) is the single
chokepoint that every user-supplied string passes through before
reaching any LLM:

1. Length guard (3–500 chars).
2. 25 compiled injection-pattern regexes — SQL, shell, prompt-extraction,
   jailbreak phrases, null bytes, special LLM tokens.
3. Sanitiser — strip HTML, NFC-normalise, drop control chars, collapse
   whitespace, hard-truncate.
4. Intent classifier — only requests classified `SEARCH`, `CHAT`, or
   `MARKET` proceed; everything else returns a polite rejection.
5. Token-bucket rate limiter — 10 req / 60 s window per session.
6. Audit log — last 500 validation decisions retained in process.

Raw user text **never** reaches an LLM. Only the structured
`ValidatedRequest` does, with parameters extracted by regex.

### 7.5 Runbook — common failures

| Symptom                                            | Likely cause                              | First action                                    |
| -------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `/health` reports `ollama: offline`                | Ollama container dead or not pulled       | `docker logs netflow-ollama`; restart           |
| All scores look identical or rule-based            | LLM gate fell to rule-based fallback      | Same as above — Ollama health check is failing  |
| 503 from `/api/ollama-chat`                        | Ollama unreachable                        | Check `OLLAMA_BASE_URL`; in compose use `http://ollama:11434` |
| Listings always look the same for different ZIPs   | RENTCAST_API_KEY missing → mock fallback  | Set the key in `.env`; restart backend          |
| Mortgage rate stuck at 7.2%                        | FRED_API_KEY missing                      | Set the key; rate cache TTL is 1 h              |
| 429 / `RATE_LIMITED` rejection                     | UserAgent token bucket exhausted          | Wait 60 s; or scale `RateLimitBucket.refill_rate` |
| Frontend `NetworkError` on search                  | CORS or backend down                      | Check `ALLOWED_ORIGINS`; `curl /health`         |
| Tests fail with `int('')` ValueError               | Existing defect `NETFLOW-2` (see §6.2)    | Apply regex fix from xfail message              |

### 7.6 Resource footprint

- Backend: ~150 MB RAM idle, ~300 MB under load.
- Ollama (llama3): ~4.7 GB on disk, ~6 GB RAM during inference.
- Frontend (Next.js prod build): ~80 MB RAM.

---

## 8. Contributing

1. Branch from `netflow-naren`.
2. Run `python -m pytest tests/ --cov=backend` locally and confirm no
   regression in pass count or coverage.
3. If you fix `NETFLOW-1`, `NETFLOW-2`, or `NETFLOW-3`, remove the
   `@pytest.mark.xfail` decorator on the matching test and confirm it
   passes.
4. For any new agent, add a test in `tests/test_<name>.py` and update
   the coverage table in §6.1.

---

## 9. License & attribution

Hackathon project — NetFlow team, PlanoPE 2026. Internal use.
