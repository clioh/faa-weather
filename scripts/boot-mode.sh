#!/bin/bash
#
# SkyGlass Boot Mode Detection
#
# This script runs at boot and determines whether to start:
# 1. WiFi Provisioning mode (if no WiFi configured)
# 2. Normal operation mode (if WiFi is working)
#
# Usage: Called by systemd (skyglass-boot.service, as root) at boot.
# The SkyGlass apps run under the install user's PM2 daemon
# (config/pm2.config.cjs); SKYGLASS_USER overrides the user, which otherwise
# defaults to the owner of the install directory.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROVISIONING_FLAG="$PROJECT_DIR/packages/presence/face_data/.wifi_configured"
LOG_FILE="$PROJECT_DIR/logs/boot-mode.log"
INSTALL_USER="${SKYGLASS_USER:-$(stat -c %U "$PROJECT_DIR")}"

# Run pm2 as the install user (root's PM2 daemon would be a different one)
pm2_as_user() {
    sudo -u "$INSTALL_USER" -H pm2 "$@"
}

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

# Check if WiFi is configured and connected
check_wifi() {
    # Method 1: Check our provisioning flag
    if [ ! -f "$PROVISIONING_FLAG" ]; then
        return 1
    fi

    # Method 2: Check if we have an IP address on wlan0
    local ip=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    if [ -z "$ip" ]; then
        # Wait a bit for DHCP
        log "Waiting for WiFi connection..."
        for i in {1..30}; do
            sleep 1
            ip=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
            if [ -n "$ip" ]; then
                log "WiFi connected: $ip"
                return 0
            fi
        done
        return 1
    fi

    log "WiFi connected: $ip"
    return 0
}

# Start WiFi provisioning mode
start_provisioning() {
    log "Starting WiFi provisioning mode..."

    # Stop the PM2 apps while the provisioning hotspot is up
    pm2_as_user stop all > /dev/null 2>&1 || true

    # Start provisioning service
    systemctl start skyglass-provision.service

    log "Provisioning mode active"
    log "Connect to WiFi: SkyGlass-Setup"
}

# Start normal operation mode
start_normal() {
    log "Starting normal operation mode..."

    # Make sure provisioning is stopped
    systemctl stop skyglass-provision.service 2>/dev/null || true

    # Start (or restart) the PM2 apps as the install user
    cd "$PROJECT_DIR"
    pm2_as_user startOrRestart "$PROJECT_DIR/config/pm2.config.cjs" > /dev/null 2>&1 || true

    log "Normal mode active"
}

# Roll back an update that was interrupted by power loss or a crash before
# any SkyGlass app starts (scripts/update.sh --recover; docs/UPDATES.md).
# Runs as the install user so restored files keep their owner. A no-op when
# there is no .update-state. PM2's own resurrect unit may already have started
# the apps on the half-installed tree; --recover stops them first.
recover_interrupted_update() {
    [ -f "$PROJECT_DIR/.update-state" ] || return 0
    log "Interrupted update found, running update.sh --recover..."
    if sudo -u "$INSTALL_USER" -H bash "$PROJECT_DIR/scripts/update.sh" --recover >> "$LOG_FILE" 2>&1; then
        log "Update recovery finished (see logs/update.log)"
    else
        log "Update recovery FAILED (see logs/update.log)"
    fi
}

# Main logic
main() {
    log "=========================================="
    log "SkyGlass Boot Mode Detection"
    log "=========================================="

    recover_interrupted_update || true

    if check_wifi; then
        log "WiFi is configured and connected"
        start_normal
    else
        log "WiFi not configured or not connected"
        start_provisioning
    fi

    log "Boot mode detection complete"
}

main "$@"
