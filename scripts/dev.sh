#!/bin/bash
#
# SkyGlass Development Startup Script
# Starts all services for local development
#
# Usage: ./scripts/dev.sh [options]
#   --no-presence    Skip presence detector
#   --simulate       Skip the camera detector; drive presence with
#                    "npm run setup:dev -- presence on|off" instead
#   --no-admin       Skip the presence/admin server (port 5000). It is only
#                    needed for camera-based face enrollment.
#
# Setup state (airport, location, enrollment) is driven separately:
#   npm run setup:dev -- status | walkthrough | complete | reset
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
NO_PRESENCE=false
SIMULATE=false
NO_ADMIN=false

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
        --no-admin)
            NO_ADMIN=true
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
(cd packages/backend && SKYGLASS_LICENSE="${SKYGLASS_LICENSE:-off}" npm run dev 2>&1 | sed 's/^/[backend] /') &
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

# Set up Python command (use venv if available)
PRESENCE_DIR="$PROJECT_DIR/packages/presence"
if [ -f "$PRESENCE_DIR/venv/bin/python" ]; then
    PYTHON="$PRESENCE_DIR/venv/bin/python"
else
    PYTHON="python3"
    echo -e "${YELLOW}Note: Using system Python. For best results, run:${NC}"
    echo -e "${YELLOW}  npm run setup:dev -- deps${NC}"
fi

# Start presence/admin server (camera capture for registration on :5000)
if [ "$NO_ADMIN" = false ]; then
    echo -e "${GREEN}Starting presence server (admin portal) on :5000...${NC}"
    (cd packages/presence && $PYTHON web_server.py --port "${ADMIN_PORT:-5000}" --camera "${CAMERA_INDEX:-0}" 2>&1 | sed 's/^/[admin] /') &
    ADMIN_PID=$!
fi

# Start presence detector
if [ "$NO_PRESENCE" = false ]; then
    sleep 2

    if [ "$SIMULATE" = true ]; then
        # detector.py --simulate is an interactive prompt, which cannot run as
        # a background job here. Drive presence from another terminal instead.
        echo -e "${YELLOW}Simulated presence: run 'npm run setup:dev -- presence on|off' in another terminal.${NC}"
    else
        # The detector waits for registrations and picks them up while running.
        echo -e "${GREEN}Starting presence detector (camera)...${NC}"
        (cd packages/presence && $PYTHON detector.py --preview 2>&1 | sed 's/^/[presence] /') &
        PRESENCE_PID=$!
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services started!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:3001"
echo "  Admin:     http://localhost:5000/admin (needs: cd packages/presence && venv/bin/python set_admin_password.py)"
echo "  Health:    http://localhost:3001/api/health"
echo ""
echo "  Setup pipeline:  npm run setup:dev -- status | walkthrough | complete | reset"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all processes
wait
