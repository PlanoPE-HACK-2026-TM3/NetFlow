# NetFlow — Developer Makefile
# Usage: make <target>

.PHONY: install backend frontend dev clean test eval-langsmith

# ── Setup ──────────────────────────────────────────────────────

install:
	@echo "🔧 Creating Python virtual environment..."
	python3 -m venv venv
	venv/bin/pip install --upgrade pip -q
	venv/bin/pip install -e . -q
	venv/bin/pip install -r backend/requirements.txt -q
	@echo "📦 Installing Node dependencies..."
	cd frontend && npm install
	@echo "✅ All dependencies installed."

# ── Run ────────────────────────────────────────────────────────

backend:
	@cp -f .env backend/.env 2>/dev/null || cp -f .env.example backend/.env
	venv/bin/uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev

ollama:
	ollama serve &
	ollama pull llama3

dev:
	@echo "Starting full stack (use Ctrl+C to stop all)..."
	@make -j3 ollama backend frontend

# ── Quality ────────────────────────────────────────────────────

lint-py:
	venv/bin/pip install ruff -q
	venv/bin/ruff check backend/

lint-ts:
	cd frontend && npm run type-check

test:
	@echo "Backend health check..."
	curl -sf http://localhost:8000/health | python3 -m json.tool
	@echo "\nFrontend check..."
	curl -sf http://localhost:3000 -o /dev/null && echo "✅ Frontend OK"

eval-langsmith:
	venv/bin/python backend/evals/run_langsmith_eval.py

# ── Clean ──────────────────────────────────────────────────────

clean:
	rm -rf venv/ frontend/node_modules/ frontend/.next/ *.egg-info/ __pycache__/
	find . -name "*.pyc" -delete
	@echo "🧹 Cleaned."
