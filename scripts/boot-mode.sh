#!/bin/bash
#
# SkyGlass Boot Mode Detection
#
# This script runs at boot and determines whether to start:
# 1. WiFi Provisioning mode (if no WiFi configured)
# 2. Normal operation mode (if WiFi is working)
#
# Usage: Called by systemd at boot
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROVISIONING_FLAG="$PROJECT_DIR/packages/presence/face_data/.wifi_configured"
LOG_FILE="$PROJECT_DIR/logs/boot-mode.log"

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

    # Stop normal services if they're running
    systemctl stop skyglass-backend.service 2>/dev/null || true
    systemctl stop skyglass-admin.service 2>/dev/null || true
    systemctl stop skyglass-detector.service 2>/dev/null || true
    pm2 stop all 2>/dev/null || true

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

    # Start PM2 services
    cd "$PROJECT_DIR"
    sudo -u pi pm2 start config/pm2.config.cjs 2>/dev/null || true

    # Or start systemd services if configured
    # systemctl start skyglass-backend.service 2>/dev/null || true
    # systemctl start skyglass-admin.service 2>/dev/null || true

    log "Normal mode active"
}

# Main logic
main() {
    log "=========================================="
    log "SkyGlass Boot Mode Detection"
    log "=========================================="

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
