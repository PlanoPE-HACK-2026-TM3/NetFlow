"""
NetFlow — centralised configuration

IMPORTANT — LangSmith lru_cache behaviour:
langsmith.utils.get_env_var() is decorated with @functools.lru_cache.
This means it caches env var lookups the FIRST time it is called.
If langsmith is imported anywhere before os.environ is populated,
every subsequent call to get_env_var() returns the cached None,
and tracing silently never activates.

The fix applied here:
  1. Load .env files into os.environ FIRST (before any langsmith import)
  2. Set all four required vars explicitly into os.environ
  3. Import langsmith.utils and call get_env_var.cache_clear() to bust the cache
  4. netflow_agent.py imports THIS module before importing langsmith
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# ── Step 1: Load .env files BEFORE any langsmith import ──────
# Load backend/.env first (priority), then root .env as fallback.
# start.sh copies root .env → backend/.env automatically.
load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")

# ── External APIs ────────────────────────────────────────────
RENTCAST_API_KEY:  str = os.getenv("RENTCAST_API_KEY", "")
FRED_API_KEY:      str = os.getenv("FRED_API_KEY", "")

# ── LangSmith ────────────────────────────────────────────────
LANGCHAIN_API_KEY: str = os.getenv("LANGCHAIN_API_KEY", "")
LANGCHAIN_PROJECT: str = os.getenv("LANGCHAIN_PROJECT", "netflow-hackathon")

# ── Ollama ───────────────────────────────────────────────────
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL: str    = os.getenv("OLLAMA_MODEL", "llama3")

# ── Demo / fallback mode ─────────────────────────────────────
# DEMO_MODE=true  → mock data, rule-based scoring (no Ollama, no APIs)
# DEMO_MODE=false → live RentCast + FRED data; Ollama always used for AI scoring
#                   Falls back to mock data gracefully if API keys absent
DEMO_MODE:  bool = os.getenv("DEMO_MODE",  "false").lower() == "true"
DEBUG_MODE: bool = os.getenv("DEBUG",      "false").lower() in ("true","1","yes")
USE_OLLAMA_OVERRIDE: bool = os.getenv("USE_OLLAMA_OVERRIDE", "false").lower() == "true"

# Whether live APIs are available (informational — used for status messages)
LIVE_DATA: bool = bool(RENTCAST_API_KEY and FRED_API_KEY)

# ── Server ───────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))
ALLOWED_ORIGINS: list[str] = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,https://netflow.vercel.app",
).split(",")

# ── Step 2: Write all four LangSmith vars into os.environ ────
if LANGCHAIN_API_KEY:
    os.environ["LANGCHAIN_API_KEY"]    = LANGCHAIN_API_KEY
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"]    = LANGCHAIN_PROJECT
    os.environ["LANGCHAIN_ENDPOINT"]   = "https://api.smith.langchain.com"
    os.environ["LANGSMITH_TRACING_V2"] = "true"   # langsmith also checks LANGSMITH_ prefix
    os.environ["LANGSMITH_API_KEY"]    = LANGCHAIN_API_KEY
    os.environ["LANGSMITH_PROJECT"]    = LANGCHAIN_PROJECT
    os.environ["LANGSMITH_ENDPOINT"]   = "https://api.smith.langchain.com"
else:
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ["LANGSMITH_TRACING_V2"] = "false"

# ── Step 3: Bust the lru_cache so langsmith re-reads os.environ ──
# get_env_var() uses @lru_cache — if langsmith was already imported
# (e.g. by FastAPI internals), the cache holds stale None values.
# cache_clear() forces a fresh os.environ lookup on next call.
try:
    import langsmith.utils as _ls_utils
    _ls_utils.get_env_var.cache_clear()
    _ls_utils.get_tracer_project.cache_clear()
except Exception:
    pass  # langsmith not installed — tracing simply won't run
