#!/usr/bin/env bash
# =============================================================================
# NetFlow — one-shot setup for macOS / Linux
#
# Restores dotfiles that macOS Archive Utility (and some Windows extractors)
# silently strip during zip extraction, then creates .env from the template.
#
# Run once after extracting the archive:
#   chmod +x setup.sh && ./setup.sh
# =============================================================================

set -e

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${BLUE}NetFlow setup${NC}"
echo "-------------"

# --- .env --------------------------------------------------------------------
if [ -f ".env" ]; then
  echo -e "${YELLOW}•${NC} .env already exists — leaving it alone."
else
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${GREEN}✓${NC} .env created from .env.example"
  elif [ -f "env.example" ]; then
    cp env.example .env
    echo -e "${GREEN}✓${NC} .env created from env.example"
  else
    echo "✗ Neither .env.example nor env.example found. Aborting." >&2
    exit 1
  fi
fi

# --- .dockerignore (root) ----------------------------------------------------
if [ ! -f ".dockerignore" ] && [ -f "dockerignore" ]; then
  cp dockerignore .dockerignore
  echo -e "${GREEN}✓${NC} .dockerignore restored"
elif [ -f ".dockerignore" ]; then
  echo -e "${YELLOW}•${NC} .dockerignore already present"
fi

# --- frontend/.dockerignore --------------------------------------------------
if [ ! -f "frontend/.dockerignore" ] && [ -f "frontend/dockerignore" ]; then
  cp frontend/dockerignore frontend/.dockerignore
  echo -e "${GREEN}✓${NC} frontend/.dockerignore restored"
elif [ -f "frontend/.dockerignore" ]; then
  echo -e "${YELLOW}•${NC} frontend/.dockerignore already present"
fi

echo
echo -e "${GREEN}Setup complete.${NC} Next:"
echo "  docker compose up --build -d"
echo "  docker compose logs -f        # follow progress (first run: ~10-20 min)"
echo "  open http://localhost:3000    # when backend shows 'healthy'"
