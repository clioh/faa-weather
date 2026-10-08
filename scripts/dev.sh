#!/bin/bash
#
# SkyGlass Development Startup Script
# Starts all services for local development
#
# Usage: ./scripts/dev.sh [options]
#   --no-presence    Skip presence detector
#   --simulate       Use simulated presence detector
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
NO_PRESENCE=false
SIMULATE=false

for arg in "$@"; do
    case $arg in
        --no-presence)
            NO_PRESENCE=true
            shift
            ;;
        --simulate)
            SIMULATE=true
            shift
            ;;
    esac
done

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "  ____  _          ____ _                 "
echo " / ___|| | ___   _/ ___| | __ _ ___ ___  "
echo " \___ \| |/ / | | | |  _| |/ _\` / __/ __| "
echo "  ___) |   <| |_| | |_| | | (_| \__ \__ \ "
echo " |____/|_|\_\\__,  |\____|_|\__,_|___/___/ "
echo "              |___/                        "
echo -e "${NC}"
echo ""

cd "$PROJECT_DIR"

# Create logs directory
mkdir -p logs

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"
    pkill -P $$ 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}Starting backend server...${NC}"
(cd packages/backend && npm run dev 2>&1 | sed 's/^/[backend] /') &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in {1..30}; do
    if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend ready!${NC}"
        break
    fi
    sleep 1
done

# Start frontend
echo -e "${GREEN}Starting frontend dev server...${NC}"
(cd packages/frontend && npm run dev 2>&1 | sed 's/^/[frontend] /') &
FRONTEND_PID=$!

# Start presence detector
if [ "$NO_PRESENCE" = false ]; then
    sleep 2

    # Set up Python command (use venv if available)
    PRESENCE_DIR="$PROJECT_DIR/packages/presence"
    if [ -f "$PRESENCE_DIR/venv/bin/python" ]; then
        PYTHON="$PRESENCE_DIR/venv/bin/python"
    else
        PYTHON="python3"
        echo -e "${YELLOW}Note: Using system Python. For best results, run:${NC}"
        echo -e "${YELLOW}  cd packages/presence && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt${NC}"
    fi

    if [ "$SIMULATE" = true ]; then
        echo -e "${GREEN}Starting simulated presence detector...${NC}"
        (cd packages/presence && $PYTHON detector.py --simulate 2>&1 | sed 's/^/[presence] /') &
    else
        # Check if face is enrolled
        if [ -f "packages/presence/face_data/enrolled_face.pkl" ]; then
            echo -e "${GREEN}Starting presence detector...${NC}"
            (cd packages/presence && $PYTHON detector.py --preview 2>&1 | sed 's/^/[presence] /') &
        else
            echo -e "${YELLOW}No face enrolled! Run: npm run enroll${NC}"
            echo -e "${YELLOW}Starting in simulation mode...${NC}"
            (cd packages/presence && $PYTHON detector.py --simulate 2>&1 | sed 's/^/[presence] /') &
        fi
    fi
    PRESENCE_PID=$!
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:3001"
echo "  API Docs:  http://localhost:3001/api/health"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all processes
wait
