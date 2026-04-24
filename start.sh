#!/usr/bin/env bash
# NetFlow — one-click local startup (macOS / Linux)
# Usage: chmod +x start.sh && ./start.sh

set -e
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

OLLAMA_PID=""
BACKEND_PID=""
FRONTEND_PID=""

echo -e "${BLUE}"
echo "  ███╗   ██╗███████╗████████╗███████╗██╗      ██████╗ ██╗    ██╗"
echo "  ████╗  ██║██╔════╝╚══██╔══╝██╔════╝██║     ██╔═══██╗██║    ██║"
echo "  ██╔██╗ ██║█████╗     ██║   █████╗  ██║     ██║   ██║██║ █╗ ██║"
echo "  ██║╚██╗██║██╔══╝     ██║   ██╔══╝  ██║     ██║   ██║██║███╗██║"
echo "  ██║ ╚████║███████╗   ██║   ██║     ███████╗╚██████╔╝╚███╔███╔╝"
echo "  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ "
echo -e "${NC}  AI-powered real estate investment intelligence\n"

# ── Check .env ──────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}⚠  .env not found — creating from template...${NC}"
  if [ -f ".env.example" ]; then
    cp .env.example .env
  elif [ -f "backend/.env.template" ]; then
    cp backend/.env.template .env
  else
    cat > .env <<'EOF'
RENTCAST_API_KEY=
FRED_API_KEY=
LANGCHAIN_API_KEY=
LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=netflow-hackathon
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
DEMO_MODE=true
EOF
  fi
  echo -e "${YELLOW}   DEMO_MODE will be active (no real API calls).${NC}"
  echo -e "   Edit .env to add your RentCast + FRED keys for live data.\n"
fi

# ── Check dependencies ──────────────────────────────────────
for cmd in python3 node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}❌ '$cmd' not found. See DEPLOYMENT.md for install instructions.${NC}"
    exit 1
  fi
done

# ── Step 1: Ollama ──────────────────────────────────────────
echo -e "${BLUE}[1/3] Ollama (local LLM)${NC}"
OLLAMA_MODEL="$(grep -E '^OLLAMA_MODEL=' .env 2>/dev/null | tail -n 1 | cut -d= -f2-)"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3}"
if ! command -v ollama &>/dev/null; then
  echo -e "${YELLOW}  ⚠  Ollama not installed — AI will use rule-based scoring.${NC}"
  echo     "     Download from https://ollama.com when ready."
else
  if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Ollama already running on :11434${NC}"
  else
    if ! ollama list 2>/dev/null | grep -Fq "$OLLAMA_MODEL"; then
      echo -e "  📥 Pulling $OLLAMA_MODEL (first time only)..."
      ollama pull "$OLLAMA_MODEL"
    fi
    echo -e "  Starting Ollama server..."
    ollama serve &>/tmp/netflow-ollama.log &
    OLLAMA_PID=$!
    sleep 2
    echo -e "${GREEN}  ✓ Ollama running on :11434${NC}"
  fi
fi

# ── Step 2: Python backend ─────────────────────────────────
echo -e "${BLUE}[2/3] FastAPI backend${NC}"
if [ ! -d "venv" ]; then
  echo "  Creating Python virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate

echo "  Installing Python dependencies..."
pip install -e . -q          # installs backend as editable package
pip install -r backend/requirements.txt -q

# Copy root .env into backend so python-dotenv finds it
cp .env backend/.env

if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
  echo -e "${GREEN}  ✓ Backend already running on :8000${NC}"
else
  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &>/tmp/netflow-backend.log &
  BACKEND_PID=$!
  sleep 3
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Backend running on :8000${NC}"
  else
    echo -e "${RED}  ✗ Backend failed to start. Check /tmp/netflow-backend.log${NC}"
  fi
fi

# ── Step 3: Next.js frontend ───────────────────────────────
echo -e "${BLUE}[3/3] Next.js frontend${NC}"
cd frontend

if [ ! -d "node_modules" ]; then
  echo "  Installing Node dependencies (first time only)..."
  npm install
fi

# Ensure .env.local exists
if [ ! -f ".env.local" ]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
fi

if curl -sf http://localhost:3000 >/dev/null 2>&1; then
  echo -e "${GREEN}  ✓ Frontend already running on :3000${NC}"
  cd ..
else
  npm run dev &>/tmp/netflow-frontend.log &
  FRONTEND_PID=$!
  cd ..
  sleep 4
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        NetFlow is running! 🏘️             ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Frontend  →  ${BLUE}http://localhost:3000${NC}      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  API Docs  →  ${BLUE}http://localhost:8000/docs${NC} ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Ollama    →  ${BLUE}http://localhost:11434${NC}     ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Logs:  /tmp/netflow-{backend,frontend,ollama}.log"
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services.\n"

cleanup() {
  echo -e "\n${YELLOW}Stopping NetFlow...${NC}"
  for pid in "$BACKEND_PID" "$FRONTEND_PID" "$OLLAMA_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  deactivate 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
}

if [ -n "$BACKEND_PID$FRONTEND_PID$OLLAMA_PID" ]; then
  trap cleanup EXIT INT TERM
  wait
else
  deactivate 2>/dev/null || true
  echo -e "${GREEN}All services were already running; left untouched.${NC}"
fi
