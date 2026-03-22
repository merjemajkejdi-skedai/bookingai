#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — install deps, seed DB, and start both servers
# Run once: chmod +x start.sh && ./start.sh
# ---------------------------------------------------------------------------
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  BookingAI — Local Dev Startup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check Node
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node $(node -v)"

# Backend
echo -e "\n${YELLOW}▶ Setting up backend...${NC}"
cd backend
npm install --silent
echo -e "${GREEN}✓${NC} Backend deps installed"
npm run db:seed
echo -e "${GREEN}✓${NC} Database seeded with demo data"

# Frontend
echo -e "\n${YELLOW}▶ Setting up frontend...${NC}"
cd ../frontend
npm install --silent
echo -e "${GREEN}✓${NC} Frontend deps installed"

# Start both
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 Starting servers...${NC}"
echo -e "   Backend  → http://localhost:3001"
echo -e "   Frontend → http://localhost:5173"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Run both in parallel, forward output with labels
cd ..
(cd backend  && npm run dev 2>&1 | sed 's/^/[backend]  /') &
(cd frontend && npm run dev 2>&1 | sed 's/^/[frontend] /') &

wait
