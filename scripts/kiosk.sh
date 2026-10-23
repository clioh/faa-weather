#!/bin/bash
#
# SkyGlass mirror display: Chromium full screen on the backend's mirror UI.
# Started by the desktop session from ~/.config/labwc/autostart, which
# scripts/setup-pi.sh writes. Restarts the browser if it exits or crashes.
#
# Usage: ./scripts/kiosk.sh            (SKYGLASS_URL overrides the address)

URL="${SKYGLASS_URL:-http://localhost:3001}"

# Raspberry Pi OS names the browser chromium (Trixie) or chromium-browser (Bookworm)
BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
    echo "kiosk: Chromium not found (apt install chromium)" >&2
    exit 1
fi

# The backend starts with the system, often after the desktop. Wait up to two
# minutes so the first page is the mirror, not a connection error.
for _ in $(seq 120); do
    curl -sf -o /dev/null "$URL/api/health" && break
    sleep 1
done

# --password-store=basic: no keyring unlock prompt on the Wayland desktop.
# ?kiosk=1 hides the mouse pointer (packages/frontend/src/main.tsx).
while true; do
    "$BROWSER" \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --no-first-run \
        --disable-session-crashed-bubble \
        --disable-features=Translate \
        --password-store=basic \
        --ozone-platform-hint=auto \
        "$URL/?kiosk=1"
    sleep 2
done
