# syntax=docker/dockerfile:1.7
# =============================================================================
# NetFlow Backend — FastAPI + LangChain
# Multi-stage build: builder compiles wheels, runtime stays slim.
# =============================================================================

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# System deps needed to compile a few wheels (httptools, uvloop, etc.).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy only what's needed to resolve & install Python deps first,
# so the layer cache survives source-code edits.
COPY pyproject.toml /build/
COPY backend/requirements.txt /build/backend/requirements.txt
# Minimal package skeleton so `pip install -e .` can see the `backend` package.
COPY backend/__init__.py /build/backend/__init__.py

RUN pip install --upgrade pip \
 && pip install -e . \
 && pip install -r backend/requirements.txt

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH="/usr/local/bin:$PATH"

# curl is used for the container HEALTHCHECK below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Pull in the site-packages and console scripts from the builder stage.
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Run as a non-root user.
RUN useradd --create-home --shell /bin/bash --uid 1001 netflow
WORKDIR /app

# Copy the real source now (fast layer since deps are already cached above).
COPY --chown=netflow:netflow pyproject.toml /app/pyproject.toml
COPY --chown=netflow:netflow backend /app/backend

# Pre-create the logs/ directory with the right ownership. backend/logger.py
# writes to <repo-root>/logs which, given WORKDIR=/app, resolves to /app/logs.
# Without this, the non-root user can't mkdir it and the app crashes at import.
RUN mkdir -p /app/logs && chown netflow:netflow /app/logs

USER netflow

EXPOSE 8000

# The app reads DEMO_MODE / OLLAMA_BASE_URL / RENTCAST_API_KEY / FRED_API_KEY
# / LANGCHAIN_API_KEY from the environment — docker-compose injects these.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
