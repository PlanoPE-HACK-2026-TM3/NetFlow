# NETFLOW Backend Explanation

This file explains the backend structure in a simple way for someone new to Python.

## What this backend does

The backend is a web server that serves data and analysis for the NetFlow application. It exposes routes (API endpoints) like:

- `/health` — simple health check
- `/tracing/status` — checks local tracing / model config
- `/properties/search` — search for properties
- `/rates/mortgage` — returns the current mortgage rate
- `/news/housing` — returns recent housing news
- `/analysis/property` — analyzes a property and returns investment/risk predictions
- `/portfolio` — read/write portfolio items
- `/chat` — returns a short portfolio forecast answer
- `/observability/events` — recent inference logs
- `/model/performance` — model feedback metrics
- `/model/feedback` — accept user feedback on a prediction

The backend is built with:

- `FastAPI` — Python web framework for creating APIs
- `SQLAlchemy` — database toolkit used for storing portfolio items, inference logs, and feedback
- `Pydantic` / `pydantic-settings` — data validation and configuration settings
- `langchain-ollama` / `ollama` — local LLM integration for property analysis and chat
- `httpx` — HTTP client for external APIs

## Key files and what they do

### `app/main.py`

This is the main application entry point.

- `app = FastAPI(...)` creates the API server.
- `app.add_middleware(...)` enables browser access from the frontend origin.
- `Base.metadata.create_all(bind=engine)` creates database tables if they do not exist.
- Each `@app.get` or `@app.post` function defines one API route.
- Route functions call service functions from `app/services/`.
- The `Depends(get_db)` argument opens a database session for routes that need it.

### `app/config.py`

This file reads configuration values from environment variables or `.env`.

- `Settings` defines default values for things like database URL, local listings path, and Ollama settings.
- `settings = Settings()` creates a shared config object used across the backend.

Common settings:

- `database_url`: where the SQLite database file lives
- `local_listings_path`: local CSV path used for property search
- `ollama_base_url`: local Ollama API server address
- `ollama_model`: model name used by Ollama
- `fred_api_key`: optional key to fetch real mortgage rates
- `news_api_key`: optional key to fetch real news

### `app/database.py`

This file sets up SQLAlchemy.

- `engine` connects to the database.
- `SessionLocal` creates database sessions.
- `Base` is the SQLAlchemy base class used by models.
- `get_db()` yields a session and ensures it is closed after use.

### `app/models.py`

This file defines the database tables as Python classes.

- `PortfolioItem` stores one saved property in the user portfolio.
- `InferenceEvent` stores logs for analysis/chat requests.
- `PredictionFeedback` stores manual feedback about predictions.

Each class has columns like `id`, `price`, `created_at`, and other metadata.

### `app/schemas.py`

This file defines the data shapes that the API accepts and returns.

- `BaseModel` classes are used to validate input and output.
- Example: `PropertyOut` ensures every property has `price`, `city`, and `state`.
- `PropertySearchRequest` validates search parameters.
- `ChatResponse` defines the chat answer format.

Schemas are separate from database models. They are used to make sure the API receives and returns valid JSON.

## How the backend is organized into services

The `app/services/` folder contains the business logic. Each service has a focused responsibility.

### `app/services/llm.py`

This file handles calls to the local LLM via Ollama.

- `get_chat_model()` builds an Ollama chat client with model and base URL from `settings`.
- `generate_text(...)` sends text prompts to the LLM and returns the text answer.
- `generate_json(...)` expects the model to return JSON, then parses it.

If the local LLM is unavailable, code will usually catch the error and use a fallback.

### `app/services/analysis.py`

This file analyzes a property.

- `analyze_property(...)` sends a prompt to the LLM asking for investment/risk output.
- It expects valid JSON like `investment_score`, `risk_score`, `recommendation`, etc.
- If the LLM call fails, it falls back to `_heuristic_analysis(...)`.

### `app/services/chat.py`

This file builds the `/chat` response.

- `build_chat_response(...)` creates a prompt with the user message, portfolio, mortgage rate, and recent analyses.
- It tries `generate_text(...)` from the LLM.
- If that fails, it returns a fallback answer with summary values like mortgage rate and average risk.

### `app/services/local_listings.py`

This service reads a local CSV file of listings.

- `_listings_path()` resolves the path to `data/listings.csv`.
- `_load_rows()` reads CSV rows safely.
- `search_local_listings(...)` looks for matching city/state/zip rows and converts them to `PropertyOut` objects.

This gives a local-first property search path without needing external scraping.

### `app/services/properties.py`

This service manages property search requests.

- `search_properties(...)` first tries local listings.
- If local listings are empty, it tries `homeharvest.scrape_property`.
- If that fails and `allow_demo` is true, it returns demo property data.
- If all fail, it raises `PropertySearchProviderError`.

### `app/services/fred.py`

This service fetches mortgage rates.

- If `FRED_API_KEY` is missing, it returns a default 6.75% rate.
- If the API key is present, it fetches the real rate from FRED.

### `app/services/news.py`

This service fetches housing news.

- If `NEWS_API_KEY` is missing, it returns demo headlines.
- If the key is present, it fetches real news from NewsAPI.org.

### `app/services/observability.py`

This file stores logs and metrics.

- `log_inference_event(...)` writes analysis/chat metadata to the database.
- `add_prediction_feedback(...)` saves user feedback about model predictions.
- `get_calibration_shift(...)` computes a small correction from feedback.
- `get_model_performance(...)` computes metrics like MAE, RMSE, and directional accuracy.

### `app/services/tracing.py`

This service checks whether Ollama and tracing are working.

- It calls the Ollama `/api/tags` endpoint to see if the local model exists.
- It also tries a quick LLM call to confirm the model can be invoked.

## How a request flows through the backend

Example: `POST /analysis/property`

1. Frontend sends JSON with a `property` object.
2. `app/main.py` receives the request and validates it with `AnalysisRequest`.
3. The route calls `get_mortgage_rate()` and `get_housing_news(...)`.
4. The route calls `analyze_property(...)` in `app/services/analysis.py`.
5. That service calls the local LLM via `app/services/llm.py`.
6. The response is converted into `AnalysisOut` and returned.
7. The route logs the event with `log_inference_event(...)`.

Example: `POST /chat`

1. Frontend sends a chat message.
2. The route loads portfolio items from the database.
3. It analyzes up to 5 portfolio properties.
4. It builds a chat prompt and calls `build_chat_response(...)`.
5. The answer is returned to the frontend.

## Route-to-service mapping

This section shows which backend files are most responsible for each route.

- `/health` -> `app/main.py`
- `/tracing/status` -> `app/main.py`, `app/services/local_listings.py`
- `/tracing/verify` -> `app/main.py`, `app/services/tracing.py`, `app/services/llm.py`
- `/properties/search` -> `app/main.py`, `app/services/properties.py`, `app/services/local_listings.py`
- `/rates/mortgage` -> `app/main.py`, `app/services/fred.py`
- `/news/housing` -> `app/main.py`, `app/services/news.py`
- `/analysis/property` -> `app/main.py`, `app/services/analysis.py`, `app/services/llm.py`, `app/services/observability.py`
- `/portfolio` -> `app/main.py`, `app/models.py`, `app/database.py`
- `/chat` -> `app/main.py`, `app/services/chat.py`, `app/services/analysis.py`, `app/services/llm.py`, `app/services/observability.py`
- `/observability/events` -> `app/main.py`, `app/services/observability.py`, `app/models.py`
- `/model/performance` -> `app/main.py`, `app/services/observability.py`
- `/model/feedback` -> `app/main.py`, `app/services/observability.py`, `app/models.py`

## How the database is used

- The database is SQLite and stored in `netflow.db` by default.
- `PortfolioItem` stores saved properties.
- `InferenceEvent` stores logs of every analysis/chat request.
- `PredictionFeedback` stores user feedback about model predictions.

When the backend starts, it creates the tables if they do not already exist.

## Configuration and environment

The backend uses a `.env` file or environment variables.

The example values are in `backend/.env.example`.

Important values:

- `DATABASE_URL=sqlite:///./netflow.db`
- `LOCAL_LISTINGS_PATH=data/listings.csv`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=llama3.1:8b`
- `FRED_API_KEY`, `NEWS_API_KEY` are optional
- `LANGSMITH_API_KEY`, `LANGSMITH_TRACING` are optional for tracing

## Running the backend

From `backend/` you can run:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then visit:

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/docs` for FastAPI interactive docs

## Important Python concepts used here

- `async def` means the function is asynchronous. It is used for I/O calls like HTTP requests.
- `await` means "wait for this async operation".
- `@app.get(...)` and `@app.post(...)` create HTTP endpoints.
- `BaseModel` classes from Pydantic validate incoming and outgoing JSON.
- `SessionLocal` and `get_db()` manage database connections.
- `try/except` catches errors and often triggers a fallback path.

## Summary

The backend is a FastAPI application that:

- validates user input with schemas
- reads configuration from `.env`
- stores data in SQLite using SQLAlchemy
- fetches mortgage, news, and property data from services
- analyzes properties with a local LLM or a fallback heuristic
- logs model and inference events for monitoring

If you want, I can also add a short diagram or a mapping from route names to service files.
