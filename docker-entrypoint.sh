#!/bin/bash
set -e

# SkyGlass Docker Entrypoint
# Handles starting different services based on command

case "$1" in
    start)
        echo "Starting SkyGlass services..."

        # Start backend (also serves the built frontend on the same port)
        cd /app/packages/backend
        node dist/server.js &
        BACKEND_PID=$!

        # Start presence detection if camera available
        if [ -e /dev/video0 ]; then
            echo "Camera detected, starting presence detection..."
            cd /app/packages/presence
            source venv/bin/activate
            python3 web_server.py --port ${PRESENCE_PORT:-5000} &
            PRESENCE_PID=$!
        else
            echo "No camera detected, skipping presence detection"
        fi

        echo "SkyGlass started!"
        echo "  Display + API: http://localhost:${PORT:-3001}"
        [ -n "$PRESENCE_PID" ] && echo "  Presence: http://localhost:${PRESENCE_PORT:-5000}"

        # Wait for any process to exit
        wait -n

        # Exit with status of process that exited first
        exit $?
        ;;

    backend)
        echo "Starting backend only..."
        cd /app/packages/backend
        exec node dist/server.js
        ;;

    frontend)
        # Deprecated: the frontend is served by the backend on ${PORT:-3001}
        echo "The frontend is served by the backend; starting backend..."
        cd /app/packages/backend
        exec node dist/server.js
        ;;

    presence)
        echo "Starting presence detection only..."
        cd /app/packages/presence
        source venv/bin/activate
        exec python3 web_server.py --port ${PRESENCE_PORT:-5000}
        ;;

    dev)
        echo "Starting in development mode..."
        cd /app
        exec npm run dev
        ;;

    test)
        echo "Running tests..."
        cd /app
        exec npm test
        ;;

    shell|bash)
        exec /bin/bash
        ;;

    *)
        exec "$@"
        ;;
esac
