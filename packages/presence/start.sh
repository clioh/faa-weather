#!/bin/bash
#
# SkyGlass Presence Server Startup Script
#
# Usage:
#   ./start.sh              # Production mode (Gunicorn)
#   ./start.sh --dev        # Development mode (Flask)
#   ./start.sh --detector   # Run face detector only
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default settings
PORT="${PORT:-5000}"
HOST="${HOST:-0.0.0.0}"
CAMERA_INDEX="${CAMERA_INDEX:-0}"
MODE="production"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev|--development)
            MODE="development"
            shift
            ;;
        --detector)
            MODE="detector"
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --camera)
            CAMERA_INDEX="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Activate virtual environment if it exists
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Export environment variables
export PORT
export HOST
export CAMERA_INDEX

echo ""
echo "=============================================="
echo "  SkyGlass Presence Server"
echo "=============================================="
echo ""
echo "  Mode:   $MODE"
echo "  Port:   $PORT"
echo "  Camera: $CAMERA_INDEX"
echo ""

case $MODE in
    production)
        echo "Starting Gunicorn..."
        exec gunicorn -c gunicorn.conf.py wsgi:app
        ;;
    development)
        echo "Starting Flask development server..."
        exec python web_server.py --port "$PORT" --camera "$CAMERA_INDEX"
        ;;
    detector)
        echo "Starting face detector..."
        exec python detector.py --camera "$CAMERA_INDEX" --preview
        ;;
esac
