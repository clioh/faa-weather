#!/bin/bash
#
# SkyGlass Boot Mode Detection
#
# This script runs at boot and determines whether to start:
# 1. Normal operation mode (the mirror is online)
# 2. WiFi Provisioning mode (no network): the SkyGlass-Setup hotspot
#    (skyglass-provision.service)
#
# The decision is made on real connectivity: a NetworkManager wifi or
# ethernet link that is connected and has an IPv4 address (not the setup
# hotspot). face_data/.wifi_configured is a hint: with it we wait longer for
# the network (the router may still be booting after a power cut); without it
# we wait briefly. Either way, still offline after the wait means the hotspot,
# so a mirror moved to a new network can be set up again from the phone. With
# a saved network, wifi_provisioning.py keeps retrying it every few minutes
# while no phone uses the hotspot and switches back to normal mode when it
# returns. A mirror that is already on WiFi without the flag (set in
# Raspberry Pi Imager or with nmcli) gets the flag written. On Ethernet the
# mirror runs normally but the flag is not written.
#
# Usage: Called by systemd (skyglass-boot.service, as root) at boot, and again
# by wifi_provisioning.py after it joined the home network.
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
PM2_CONFIG="$PROJECT_DIR/config/pm2.config.cjs"

# Lists the PM2 apps stopped while the hotspot is up; watchdog_service.py
# doesn't restart them while it exists (/run is cleared at every boot).
PROVISIONING_MARKER="${SKYGLASS_PROVISIONING_MARKER:-/run/skyglass/provisioning}"
# The camera detector has nothing to do during WiFi setup. The backend keeps
# running: it serves the hotspot instructions on the mirror (ProvisioningScreen
# on :3001, which kiosk.sh waits for). The admin server (:5000) stays up too.
PROVISIONING_STOPPED_APPS="skyglass-detector"
PROVISIONING_RUNNING_APPS="skyglass-backend skyglass-admin"

# NetworkManager profile of the setup hotspot (packages/presence/nm_wifi.py)
HOTSPOT_PROFILE="skyglass-setup"

# Seconds to wait for a network before deciding
WAIT_CONFIGURED="${SKYGLASS_WAIT_CONFIGURED:-90}"
WAIT_UNCONFIGURED="${SKYGLASS_WAIT_UNCONFIGURED:-30}"

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

# Prints "<type> <device> <ipv4>" of a connected wifi/ethernet link other
# than the setup hotspot; fails if there is none.
nm_online() {
    local dev type state conn addr
    while IFS=: read -r dev type state; do
        case "$state" in
            connected*) ;;
            *) continue ;;
        esac
        case "$type" in
            wifi|ethernet) ;;
            *) continue ;;
        esac
        conn="$(nmcli -g GENERAL.CONNECTION device show "$dev" 2>/dev/null || true)"
        [ "$conn" = "$HOTSPOT_PROFILE" ] && continue
        addr="$(nmcli -g IP4.ADDRESS device show "$dev" 2>/dev/null | head -n 1 || true)"
        addr="${addr%% |*}"
        addr="${addr%%/*}"
        if [ -n "$addr" ]; then
            echo "$type $dev $addr"
            return 0
        fi
    done < <(nmcli -t -f DEVICE,TYPE,STATE device status 2>/dev/null || true)
    return 1
}

# Same without NetworkManager: any global IPv4 address except the hotspot's
ip_online() {
    local found
    found="$(ip -4 -o addr show scope global 2>/dev/null \
        | awk '$2 != "lo" && $4 !~ /^10\.42\.0\.1\// {
            split($4, a, "/"); print ($2 ~ /^wl/ ? "wifi" : "ethernet") " " $2 " " a[1]; exit }')"
    [ -n "$found" ] && echo "$found"
}

online() {
    if command -v nmcli > /dev/null 2>&1; then
        nm_online
    else
        ip_online
    fi
}

# Wait for a network connection; prints what was found
check_network() {
    local wait="$WAIT_UNCONFIGURED" waited=0 found
    [ -f "$PROVISIONING_FLAG" ] && wait="$WAIT_CONFIGURED"

    # Let NetworkManager finish activating saved connections first
    if command -v nm-online > /dev/null 2>&1; then
        nm-online -s -q -t 30 > /dev/null 2>&1 || true
    fi

    while true; do
        if found="$(online)"; then
            NETWORK="$found"
            return 0
        fi
        [ "$waited" -ge "$wait" ] && return 1
        [ "$waited" -eq 0 ] && log "Waiting up to ${wait}s for a network connection..."
        sleep 2
        waited=$((waited + 2))
    done
}

# Online over WiFi without the flag: WiFi was set up some other way
# (Raspberry Pi Imager, nmcli over SSH). Record it so the phone app skips its
# WiFi step and later boots never start the hotspot. Ethernet doesn't count:
# unplugged, the mirror would have no network and no way to set one up.
mark_configured() {
    [ -f "$PROVISIONING_FLAG" ] && return 0
    [ "${NETWORK%% *}" = "wifi" ] || return 0
    mkdir -p "$(dirname "$PROVISIONING_FLAG")"
    echo "$NETWORK" > "$PROVISIONING_FLAG"
    chown "$INSTALL_USER": "$PROVISIONING_FLAG" 2>/dev/null || true
    log "Already online without SkyGlass WiFi setup; marked WiFi as configured"
}

# Start WiFi provisioning mode
start_provisioning() {
    log "Starting WiFi provisioning mode..."

    # Tell the watchdog first, then stop only what has to stop
    mkdir -p "$(dirname "$PROVISIONING_MARKER")"
    printf '%s\n' $PROVISIONING_STOPPED_APPS > "$PROVISIONING_MARKER"
    local app
    for app in $PROVISIONING_STOPPED_APPS; do
        pm2_as_user stop "$app" > /dev/null 2>&1 || true
    done
    for app in $PROVISIONING_RUNNING_APPS; do
        pm2_as_user startOrRestart "$PM2_CONFIG" --only "$app" > /dev/null 2>&1 || true
    done

    # Start provisioning service (hotspot + setup API on 10.42.0.1:80)
    systemctl start skyglass-provision.service

    # A unit installed before the saved-network retry existed refuses to start
    # while face_data/.wifi_configured exists (ConditionPathExists); update.sh
    # doesn't reinstall units. Without the hotspot, run normally as before.
    if [ "$(systemctl show -p ConditionResult --value skyglass-provision.service 2>/dev/null)" = "no" ]; then
        log "skyglass-provision.service skipped by an old ConditionPathExists; reinstall it from"
        log "config/systemd/ (scripts/setup-pi.sh does) to get the hotspot fallback. Normal mode instead."
        start_normal
        return
    fi

    log "Provisioning mode active"
    log "Connect to WiFi: SkyGlass-Setup"
}

# Start normal operation mode
start_normal() {
    log "Starting normal operation mode..."

    # Make sure provisioning is stopped
    systemctl stop skyglass-provision.service 2>/dev/null || true
    rm -f "$PROVISIONING_MARKER"

    # Start (or restart) the PM2 apps as the install user
    cd "$PROJECT_DIR"
    pm2_as_user startOrRestart "$PM2_CONFIG" > /dev/null 2>&1 || true

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

    NETWORK=""
    if check_network; then
        log "Network connected: $NETWORK"
        mark_configured
        start_normal
    elif [ -f "$PROVISIONING_FLAG" ]; then
        # Set up before, but the saved network isn't there: the router is
        # still booting (power cut) or the mirror moved. The hotspot lets the
        # phone set a new network; wifi_provisioning.py retries the saved one
        # every few minutes while no phone is connected and comes back here
        # when it works.
        log "No network after ${WAIT_CONFIGURED}s although WiFi was set up before"
        log "Starting the hotspot; the saved network is retried every few minutes"
        start_provisioning
    else
        log "No network and WiFi never set up"
        start_provisioning
    fi

    log "Boot mode detection complete"
}

main "$@"
