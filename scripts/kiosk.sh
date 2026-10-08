#!/bin/bash
#
# SkyGlass Kiosk Mode Launcher
# Starts Chromium in full-screen kiosk mode
#
# Usage: ./scripts/kiosk.sh [url]
#

set -e

# Default URL: the backend serves the built UI on port 3001 in production.
# Pass http://localhost if nginx is installed (scripts/install-nginx.sh).
URL="${1:-${SKYGLASS_URL:-http://localhost:3001}}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Disable screen blanking
disable_screen_blanking() {
    log_info "Disabling screen blanking..."
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
}

# Hide cursor
hide_cursor() {
    log_info "Hiding cursor..."
    if command -v unclutter &> /dev/null; then
        unclutter -idle 0.5 -root &
    else
        log_warn "unclutter not installed - cursor will be visible"
    fi
}

# Wait for backend to be ready
wait_for_backend() {
    log_info "Waiting for backend to be ready..."
    for i in {1..60}; do
        if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
            log_info "Backend is ready!"
            return 0
        fi
        sleep 1
    done
    log_warn "Backend not responding after 60 seconds, continuing anyway..."
}

# Clear Chromium crash flags (prevents "restore pages" dialog)
clear_crash_flags() {
    CHROME_PREFS="${HOME}/.config/chromium/Default/Preferences"
    if [ -f "$CHROME_PREFS" ]; then
        log_info "Clearing Chromium crash flags..."
        sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$CHROME_PREFS" 2>/dev/null || true
        sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$CHROME_PREFS" 2>/dev/null || true
    fi
}

# Launch Chromium in kiosk mode
launch_chromium() {
    log_info "Launching Chromium in kiosk mode..."
    log_info "URL: $URL"

    # Chromium flags for kiosk mode
    CHROME_FLAGS=(
        --kiosk
        --noerrdialogs
        --disable-infobars
        --disable-session-crashed-bubble
        --disable-restore-session-state
        --disable-translate
        --disable-features=TranslateUI
        --disable-component-update
        --check-for-update-interval=31536000
        --disable-pinch
        --overscroll-history-navigation=0
        --disable-features=TouchpadOverscrollHistoryNavigation
        --start-fullscreen
        --start-maximized
        --autoplay-policy=no-user-gesture-required
        --disable-backgrounding-occluded-windows
        --disable-renderer-backgrounding
    )

    # Detect browser
    if command -v chromium-browser &> /dev/null; then
        BROWSER="chromium-browser"
    elif command -v chromium &> /dev/null; then
        BROWSER="chromium"
    elif command -v google-chrome &> /dev/null; then
        BROWSER="google-chrome"
    else
        log_warn "No Chromium/Chrome browser found!"
        exit 1
    fi

    exec $BROWSER "${CHROME_FLAGS[@]}" "$URL"
}

# Main
main() {
    log_info "Starting SkyGlass in kiosk mode..."

    disable_screen_blanking
    hide_cursor
    clear_crash_flags
    wait_for_backend
    launch_chromium
}

main "$@"
