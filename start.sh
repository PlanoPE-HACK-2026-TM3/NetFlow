#!/usr/bin/env bash
# NetFlow — one-click local startup (macOS / Linux)
# Usage: chmod +x start.sh && ./start.sh

set -e
BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

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
  elif [ -f "env.example" ]; then
    cp env.example .env
  else
    echo -e "${RED}❌ Neither .env.example nor env.example found.${NC}"
    exit 1
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
if ! command -v ollama &>/dev/null; then
  echo -e "${YELLOW}  ⚠  Ollama not installed — AI will use rule-based scoring.${NC}"
  echo     "     Download from https://ollama.com when ready."
else
  if ! ollama list 2>/dev/null | grep -q "llama3"; then
    echo -e "  📥 Pulling llama3 (~4.7 GB, first time only)..."
    ollama pull llama3
  fi
  echo -e "  Starting Ollama server..."
  ollama serve &>/tmp/netflow-ollama.log &
  OLLAMA_PID=$!
  sleep 2
  echo -e "${GREEN}  ✓ Ollama running on :11434${NC}"
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

uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 &>/tmp/netflow-backend.log &
BACKEND_PID=$!
sleep 3

# Quick health check
if curl -sf http://localhost:8000/health > /dev/null; then
  echo -e "${GREEN}  ✓ Backend running on :8000${NC}"
else
  echo -e "${RED}  ✗ Backend failed to start. Check /tmp/netflow-backend.log${NC}"
fi

# ── Step 3: Next.js frontend ───────────────────────────────
echo -e "${BLUE}[3/3] Next.js frontend${NC}"
cd frontend

if [ ! -d "node_modules" ]; then
  echo "  Installing Node dependencies (first time only)..."
  npm install --legacy-peer-deps
fi

# Ensure .env.local exists
if [ ! -f ".env.local" ]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
fi

npm run dev &>/tmp/netflow-frontend.log &
FRONTEND_PID=$!
cd ..
sleep 4

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
  kill $BACKEND_PID $FRONTEND_PID ${OLLAMA_PID:-} 2>/dev/null || true
  deactivate 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
}
trap cleanup EXIT INT TERM
wait
