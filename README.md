# NETFLOW MVP

NETFLOW is a full-stack real-estate intelligence app with:
- property search
- AI investment/risk scoring
- portfolio tracking
- forecast chat assistant
- model performance tracking and feedback calibration
- LangSmith-compatible tracing plus local observability logs

## Architecture

- Frontend: React + Vite
- Backend: FastAPI
- Database: SQLite
- AI runtime: Ollama via LangChain (`langchain-ollama`)
- Tracing: LangSmith (optional) + local `inference_events` table

## What Is Implemented

### Core product flows

- Search properties by city/state or ZIP
- Analyze a property with:
	- `investment_score` (0-100)
	- `risk_score` (0-100)
	- `projected_12m_change_percent`
	- `recommendation` (`buy | hold | avoid`)
	- `confidence`
- Add/remove/list portfolio items
- Ask chat questions with portfolio context

### AI scoring behavior

- Primary path: Ollama model returns JSON analysis
- Fallback path: deterministic heuristic analysis if Ollama is unavailable
- Analysis is always returned (either model or fallback)

### Observability and model quality

- `GET /tracing/status` reports tracing config and whether LangSmith is effectively enabled
- `GET /observability/events` returns persisted inference logs (latency, provider, fallback usage)
- `POST /model/feedback` stores predicted vs actual outcomes
- `GET /model/performance` returns quality metrics:
	- MAE
	- RMSE
	- directional accuracy
	- average error
	- calibration shift

### Lightweight training/calibration

- `POST /analysis/property` applies a calibration shift derived from historical feedback rows
- This is online calibration, not full model weight fine-tuning

## Real Listing Data Status

- Default search mode is real data only (`allow_demo=false`)
- ZIP input is normalized via Zippopotam.us (example: `75080` -> `Richardson, TX 75080`)
- If upstream listing provider fails/blocks, backend returns a clear `503` with details
- Demo listings are opt-in only by sending `allow_demo=true`

Important:
- In this environment, HomeHarvest's upstream provider may be blocked intermittently (anti-bot behavior), so you can get a truthful provider error instead of fake inventory.

## Project Structure

- `backend/app/main.py`: API routes
- `backend/app/services/analysis.py`: AI + fallback scoring
- `backend/app/services/properties.py`: search, ZIP normalization, provider error handling
- `backend/app/services/llm.py`: LangChain/Ollama + LangSmith env wiring
- `backend/app/services/observability.py`: event logging and performance metrics
- `backend/app/models.py`: portfolio, inference events, feedback tables
- `frontend/src/App.jsx`: UI flows for search, analysis, portfolio, chat

## Setup

### Backend dependencies

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\backend"
& "c:/HOME/CODING/New folder/NETFLOWMVP/.venv/Scripts/pip.exe" install -r requirements.txt
```

### Frontend dependencies

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\frontend"
npm install
```

## Environment Configuration

Create `backend/.env` from `backend/.env.example`.

Recommended variables:
- `FRED_API_KEY=`
- `NEWS_API_KEY=`
- `LOCAL_LISTINGS_PATH=data/listings.csv`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=llama3.1:8b`
- `LANGSMITH_API_KEY=`
- `LANGSMITH_TRACING=false`
- `LANGSMITH_PROJECT=netflow-mvp`
- `LANGSMITH_ENDPOINT=https://api.smith.langchain.com`
- `DATABASE_URL=sqlite:///./netflow.db`

To enable LangSmith traces, set both:
- `LANGSMITH_API_KEY` (non-empty)
- `LANGSMITH_TRACING=true`

## Run

### Start backend

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\backend"
& "c:/HOME/CODING/New folder/NETFLOWMVP/.venv/Scripts/python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Start frontend

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\frontend"
npm run dev
```

## API Quick Check

### Health and tracing

- `GET /health`
- `GET /tracing/status`
- `GET /tracing/verify`
- `GET /providers/status`

### Property search by ZIP

```json
POST /properties/search
{
	"location": "75080",
	"limit": 8,
	"allow_demo": false
}
```

Expected behavior:
- returns local dataset listings first (free/offline path)
- then tries HomeHarvest as secondary source
- returns `503` with a clear provider message when blocked

To force reliable free/local listing data, populate `backend/data/listings.csv` with your listing export.

### Analysis scoring check

```json
POST /analysis/property
{
	"property": {
		"property_id": "sample-1",
		"address": "900 E Collins Blvd",
		"city": "Richardson",
		"state": "TX",
		"zip": "75080",
		"price": 525000,
		"beds": 3,
		"baths": 2,
		"sqft": 1850,
		"listing_url": "https://example.com/sample-1",
		"description": "Sample",
		"source": "manual"
	}
}
```

Response includes:
- `investment_score`
- `risk_score`
- `projected_12m_change_percent`
- `recommendation`
- `confidence`
- `rationale`

### Model feedback and performance

- `POST /model/feedback`
- `GET /model/performance`
- `GET /observability/events`

## Current Known Limitation

- Real listing retrieval depends on third-party anti-bot controls. This app now reports that state explicitly and does not silently replace real data with fake data unless you explicitly request demo mode.

## Automated User Test + Analytics Script

Run the end-to-end user journey test runner:

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\backend"
& "c:/HOME/CODING/New folder/NETFLOWMVP/.venv/Scripts/python.exe" scripts/run_user_tests.py
```

Optional against a running backend server:

```powershell
Set-Location "c:\HOME\CODING\New folder\NETFLOWMVP\backend"
& "c:/HOME/CODING/New folder/NETFLOWMVP/.venv/Scripts/python.exe" scripts/run_user_tests.py --base-url http://127.0.0.1:8000
```

Output:
- JSON report file at `backend/analytics/latest_user_test_report.json`
- Timestamped report at `backend/analytics/user_test_report-YYYYMMDD-HHMMSS.json`

The report includes:
- endpoint pass/fail and latency
- LangSmith enabled status
- LangChain invoke health
- Ollama reachability
- real listing count and provider error details
- AI score availability and chat response availability
- observability event count and model performance snapshot
