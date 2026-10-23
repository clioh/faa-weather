#!/bin/bash
#
# SkyGlass Update Script
# Checks for updates and installs them from GitHub Releases. The backend's
# in-app updater (packages/backend/src/services/updater.ts) downloads the
# release itself and calls --apply-tarball. Flow and guarantees: docs/UPDATES.md
#
# Usage:
#   ./scripts/update.sh              # Check and prompt
#   ./scripts/update.sh --check      # Check only, exit with status
#   ./scripts/update.sh --apply      # Apply updates without prompting
#   ./scripts/update.sh --apply-tarball <file> [--sha256 HEX] [--version X] [--delay N]
#                                     # Install an already-downloaded release
#                                     # tarball (used by the backend updater)
#   ./scripts/update.sh --recover    # Roll back an interrupted update (run at
#                                     # boot and by the watchdog; no-op if none)
#   ./scripts/update.sh --upgrade-node [MAJOR]
#                                     # Move to a newer Node.js major (default:
#                                     # the minimum in package.json engines)
#
# Release updates never touch runtime state: node_modules, Python venvs,
# packages/presence/face_data (enrolled faces, .wifi_configured), data/
# (SQLite), logs/, config/config.yaml and .env files are excluded from both
# the copy and the backup/restore (see UPDATE_EXCLUDES). node_modules and the
# venv are only modified by npm/pip when the lockfile/requirements change, and
# are snapshotted (hardlinks) first so a rollback never needs the network.
#
# Crash safety: .update-state exists from just before services are stopped
# until the update has succeeded or been rolled back. If it is found with no
# live lock holder (power loss, SIGKILL), --recover restores the backup.
#
# Node.js upgrades (--upgrade-node, or automatically before a release whose
# package.json engines needs a newer major) are an update of their own: the
# same lock, state file, node_modules snapshots and health check; native
# modules are rebuilt, and a failure reinstalls the previous major and puts
# the snapshot back. Node comes from NodeSource apt packages (passwordless
# sudo, as on Raspberry Pi OS).
#
# Must stay compatible with bash 3.2 (macOS dev machines) and BSD tools.
#

set -eE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPDATE_LOG="$PROJECT_DIR/logs/update.log"
TEMP_DIR="$PROJECT_DIR/.update-temp"
BACKUP_DIR="$PROJECT_DIR/.backup"
BACKUP_MARKER="$BACKUP_DIR/.backup-complete"
STAGE_DIR="$PROJECT_DIR/.update-stage"
SNAP_DIR="$PROJECT_DIR/.update-snapshot"
LOCK_DIR="$PROJECT_DIR/.update-lock"
STATE_FILE="$PROJECT_DIR/.update-state"

HEALTH_URL="${SKYGLASS_HEALTH_URL:-http://localhost:3001/api/health}"
# Mirror UI root on the same host as the health endpoint
UI_URL="${SKYGLASS_UI_URL:-$(printf '%s' "$HEALTH_URL" | sed -E 's#^([A-Za-z]+://[^/]+).*#\1/#')}"
HEALTH_TIMEOUT="${SKYGLASS_HEALTH_TIMEOUT:-120}"           # s until first healthy answer
HEALTH_INTERVAL="${SKYGLASS_HEALTH_INTERVAL:-5}"           # s between checks
HEALTH_STABLE_CHECKS="${SKYGLASS_HEALTH_STABLE_CHECKS:-6}" # consecutive healthy checks
HEALTH_CURL_TIMEOUT="${SKYGLASS_HEALTH_CURL_TIMEOUT:-10}"
NPM_TIMEOUT="${SKYGLASS_NPM_TIMEOUT:-1800}"                # s; 0 = no limit
PIP_TIMEOUT="${SKYGLASS_PIP_TIMEOUT:-1800}"
DISK_MARGIN_MB="${SKYGLASS_UPDATE_DISK_MARGIN_MB:-200}"
MAX_RECOVER_ATTEMPTS="${SKYGLASS_MAX_RECOVER_ATTEMPTS:-3}"
# Command that installs a Node.js major given as $1 (tests); default NodeSource + apt
NODE_INSTALLER="${SKYGLASS_NODE_INSTALLER:-}"
VENV_REL="packages/presence/venv"

# Runtime state that an update must never overwrite, delete, back up or
# restore, plus the updater's own bookkeeping. Leading "/" anchors a pattern
# to the install root; patterns without it match at any depth. Keep in sync
# with packages/backend/src/services/updater.ts (which delegates to this script).
UPDATE_EXCLUDES=(
    --exclude=/.git/
    --exclude=/data/
    --exclude=/logs/
    --exclude=/config/config.yaml
    --exclude=/.update-temp/
    --exclude=/.update-stage/
    --exclude=/.update-lock/
    --exclude=/.update-snapshot/
    --exclude=/.update-state
    --exclude=/.update-state.tmp
    --exclude=/.backup/
    --exclude=/.backup-complete
    --exclude=node_modules/
    --exclude=venv/
    --exclude=.venv/
    --exclude=face_data/
    --exclude=__pycache__/
    --exclude=.env
    --exclude=.env.local
)

# GitHub repository (override with GITHUB_REPO env var)
GITHUB_REPO="${GITHUB_REPO:-clioh/skyglass}"

# Colors (terminal only; logs/update.log gets plain text)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

_log() {
    local level="$1" color="$2" text="$3"
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "[$ts] ${color}[$level]${NC} $text"
    mkdir -p "$(dirname "$UPDATE_LOG")" 2>/dev/null || true
    echo "[$ts] [$level] $text" >> "$UPDATE_LOG" 2>/dev/null || true
}
log_info() { _log INFO "$GREEN" "$1"; }
log_warn() { _log WARN "$YELLOW" "$1"; }
log_error() { _log ERROR "$RED" "$1"; }

cd "$PROJECT_DIR"

# Parse arguments
CHECK_ONLY=false
FORCE_APPLY=false
RECOVER=false
APPLY_TARBALL=""
UPGRADE_NODE=false
UPGRADE_NODE_TO=""
TARBALL_VERSION=""
TARBALL_SHA256=""
START_DELAY=0

while [ $# -gt 0 ]; do
    arg="$1"
    case $arg in
        --apply-tarball)
            APPLY_TARBALL="${2:-}"
            shift
            ;;
        --version)
            TARBALL_VERSION="${2:-}"
            shift
            ;;
        --sha256)
            TARBALL_SHA256="${2:-}"
            shift
            ;;
        --delay)
            START_DELAY="${2:-0}"
            shift
            ;;
        --check)
            CHECK_ONLY=true
            ;;
        --apply)
            FORCE_APPLY=true
            ;;
        --recover)
            RECOVER=true
            ;;
        --upgrade-node)
            UPGRADE_NODE=true
            case "${2:-}" in
                [0-9]*) UPGRADE_NODE_TO="$2"; shift ;;
            esac
            ;;
        --help|-h)
            echo "SkyGlass Update Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --check               Check for updates only (exit 0 if available, 1 if not)"
            echo "  --apply               Download, verify and apply the latest release without prompting"
            echo "  --apply-tarball FILE  Install a downloaded release tarball"
            echo "  --sha256 HEX          Expected SHA-256 of the tarball (verified before anything changes)"
            echo "  --version X           Version to record with --apply-tarball"
            echo "  --delay N             Wait N seconds before stopping services"
            echo "  --recover             Roll back an interrupted update (no-op if there is none)"
            echo "  --upgrade-node [N]    Upgrade Node.js to major N (default: package.json engines)"
            echo "  --help                Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  GITHUB_REPO   GitHub repository (default: $GITHUB_REPO)"
            echo "  SKYGLASS_HEALTH_URL, SKYGLASS_UI_URL, SKYGLASS_HEALTH_TIMEOUT,"
            echo "  SKYGLASS_HEALTH_INTERVAL, SKYGLASS_HEALTH_STABLE_CHECKS,"
            echo "  SKYGLASS_NPM_TIMEOUT, SKYGLASS_PIP_TIMEOUT, SKYGLASS_UPDATE_DISK_MARGIN_MB"
            exit 0
            ;;
    esac
    shift
done

# Get current version
get_current_version() {
    if [ -f "$PROJECT_DIR/VERSION" ]; then
        head -1 "$PROJECT_DIR/VERSION"
    elif [ -f "$PROJECT_DIR/package.json" ]; then
        grep '"version"' "$PROJECT_DIR/package.json" | head -1 | sed 's/.*"version".*"\([^"]*\)".*/\1/'
    else
        echo "0.0.0"
    fi
}

# Compare semantic versions: returns 0 if $1 < $2, 1 otherwise
version_lt() {
    local v1="${1#v}"
    local v2="${2#v}"

    IFS='.' read -ra V1 <<< "$v1"
    IFS='.' read -ra V2 <<< "$v2"

    for i in 0 1 2; do
        local n1="${V1[$i]:-0}"
        local n2="${V2[$i]:-0}"
        if [ "$n1" -lt "$n2" ]; then
            return 0
        elif [ "$n1" -gt "$n2" ]; then
            return 1
        fi
    done
    return 1  # Equal, so not less than
}

#
# Lock (.update-lock/pid holds the bare decimal PID of the holder)
#
LOCK_HELD=false
LOCK_OTHER=""

# A pid counts as a live holder only if it is an update.sh process (a pid
# left over from before a reboot may since have been reused by something else)
lock_holder_alive() {
    local pid="$1"
    case "$pid" in ''|*[!0-9]*) return 1 ;; esac
    [ "$pid" = "$$" ] && return 1
    ps -p "$pid" -o command= 2>/dev/null | grep -q 'update\.sh'
}

acquire_lock() {
    local tries=0 other
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
        other=$(head -1 "$LOCK_DIR/pid" 2>/dev/null || true)
        if lock_holder_alive "$other"; then
            LOCK_OTHER="$other"
            return 1
        fi
        tries=$((tries + 1))
        if [ "$tries" -gt 3 ]; then
            LOCK_OTHER="${other:-unknown}"
            return 1
        fi
        log_warn "Removing stale update lock (pid ${other:-unknown} is not running)"
        rm -rf "$LOCK_DIR"
    done
    echo $$ > "$LOCK_DIR/pid.tmp" && mv -f "$LOCK_DIR/pid.tmp" "$LOCK_DIR/pid"
    LOCK_HELD=true
    trap on_exit EXIT
    return 0
}

release_lock() {
    if [ "$LOCK_HELD" = true ]; then
        if [ "$(head -1 "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
            rm -rf "$LOCK_DIR"
        fi
        LOCK_HELD=false
    fi
}

on_exit() {
    if [ "$LOCK_HELD" = true ]; then
        rm -rf "$STAGE_DIR"
        # Snapshots are only needed while an update is in flight
        [ -f "$STATE_FILE" ] || rm -rf "$SNAP_DIR"
    fi
    release_lock
}

#
# State file (.update-state): key=value lines, written atomically
#
STATE_PHASE=""
STATE_VERSION=""
STATE_FROM=""
STATE_STARTED=""
STATE_ATTEMPTS=0
# "node" for a Node.js upgrade (STATE_NODE_FROM = the major to go back to)
STATE_KIND=""
STATE_NODE_FROM=""

state_get() {
    sed -n "s/^$1=//p" "$STATE_FILE" 2>/dev/null | head -1
}

load_state() {
    STATE_PHASE="$(state_get phase)"
    STATE_VERSION="$(state_get version)"
    STATE_FROM="$(state_get from)"
    STATE_STARTED="$(state_get started)"
    STATE_ATTEMPTS="$(state_get attempts)"
    case "$STATE_ATTEMPTS" in ''|*[!0-9]*) STATE_ATTEMPTS=0 ;; esac
    STATE_KIND="$(state_get kind)"
    STATE_NODE_FROM="$(state_get node_from)"
}

write_state() {
    local tmp="$STATE_FILE.tmp"
    {
        echo "phase=$1"
        echo "version=$STATE_VERSION"
        echo "from=$STATE_FROM"
        echo "pid=$$"
        echo "started=$STATE_STARTED"
        echo "attempts=$STATE_ATTEMPTS"
        echo "kind=$STATE_KIND"
        echo "node_from=$STATE_NODE_FROM"
    } > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
    sync 2>/dev/null || true
}

clear_state() {
    rm -f "$STATE_FILE" "$STATE_FILE.tmp"
    sync 2>/dev/null || true
}

#
# Child processes: run in the background and `wait`, so trapped signals are
# handled immediately (bash defers traps while a foreground command runs),
# with an optional time limit.
#
CHILD_PID=""
KILLER_PID=""

run_child() {
    local limit="$1"
    shift
    "$@" &
    CHILD_PID=$!
    KILLER_PID=""
    if [ "${limit:-0}" -gt 0 ] 2>/dev/null; then
        (
            sleep "$limit"
            kill -TERM "$CHILD_PID" 2>/dev/null || exit 0
            sleep 10
            kill -KILL "$CHILD_PID" 2>/dev/null
        ) > /dev/null 2>&1 &
        KILLER_PID=$!
    fi
    local rc=0
    wait "$CHILD_PID" || rc=$?
    [ -n "$KILLER_PID" ] && kill "$KILLER_PID" 2>/dev/null
    CHILD_PID=""
    KILLER_PID=""
    return $rc
}

kill_children() {
    [ -n "$KILLER_PID" ] && kill "$KILLER_PID" 2>/dev/null
    if [ -n "$CHILD_PID" ]; then
        kill -TERM "$CHILD_PID" 2>/dev/null
        local i=0
        while kill -0 "$CHILD_PID" 2>/dev/null && [ $i -lt 20 ]; do
            sleep 0.5 2>/dev/null || sleep 1
            i=$((i + 1))
        done
        kill -KILL "$CHILD_PID" 2>/dev/null
        wait "$CHILD_PID" 2>/dev/null
    fi
    CHILD_PID=""
    KILLER_PID=""
    return 0
}

#
# Services
#
pm2_available() {
    command -v pm2 > /dev/null 2>&1
}

stop_services() {
    if pm2_available; then
        pm2 stop all > /dev/null 2>&1 || true
    fi
    return 0
}

start_services() {
    if pm2_available; then
        local pm2_config="$PROJECT_DIR/config/pm2.config.cjs"
        # startOrRestart picks up apps/env added by the new config
        pm2 startOrRestart "$pm2_config" --update-env > /dev/null 2>&1 \
            || pm2 restart all --update-env > /dev/null 2>&1 \
            || return 1
        pm2 save > /dev/null 2>&1 || true
    fi
    return 0
}

# 0 = healthy, 1 = /api/health failing, 2 = mirror UI not served
probe_once() {
    curl -sf -m "$HEALTH_CURL_TIMEOUT" "$HEALTH_URL" > /dev/null 2>&1 || return 1
    local body
    body=$(curl -sf -m "$HEALTH_CURL_TIMEOUT" "$UI_URL" 2>/dev/null) || return 2
    printf '%s' "$body" | grep -qiE '<html|<!doctype' || return 2
    return 0
}

probe_reason() {
    if [ "$1" = 2 ]; then
        echo "mirror UI not served at $UI_URL"
    else
        echo "backend not healthy at $HEALTH_URL"
    fi
}

HEALTH_FAIL_REASON=""

# Wait for the first healthy answer (up to HEALTH_TIMEOUT seconds)
wait_for_first_health() {
    local per="$HEALTH_INTERVAL"
    [ "$per" -ge 1 ] 2>/dev/null || per=1
    local attempts=$(( (HEALTH_TIMEOUT + per - 1) / per ))
    [ "$attempts" -ge 1 ] || attempts=1
    local i=0 rc=1
    while [ $i -lt $attempts ]; do
        i=$((i + 1))
        rc=0
        probe_once || rc=$?
        [ $rc -eq 0 ] && return 0
        [ $i -lt $attempts ] && sleep "$HEALTH_INTERVAL"
    done
    HEALTH_FAIL_REASON="$(probe_reason $rc) within ${HEALTH_TIMEOUT}s"
    return 1
}

# Healthy, then still healthy on HEALTH_STABLE_CHECKS consecutive checks
# HEALTH_INTERVAL apart (catches crash loops after a first good start)
wait_for_stable_health() {
    if ! pm2_available; then
        log_warn "pm2 not installed (dev machine?): skipping the post-update health check"
        return 0
    fi
    wait_for_first_health || return 1
    log_info "Backend is up; checking it stays healthy ($HEALTH_STABLE_CHECKS checks, ${HEALTH_INTERVAL}s apart)..."
    local n=1 rc
    while [ $n -lt "$HEALTH_STABLE_CHECKS" ]; do
        sleep "$HEALTH_INTERVAL"
        rc=0
        probe_once || rc=$?
        if [ $rc -ne 0 ]; then
            HEALTH_FAIL_REASON="$(probe_reason $rc) after a first successful start (crash loop?)"
            return 1
        fi
        n=$((n + 1))
    done
    return 0
}

#
# Node.js
#
node_major() {
    node -v 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p'
}

# Minimum Node.js major in a package.json's engines ("node": ">=24.0.0" -> 24)
required_node_major() {
    [ -f "$1" ] || return 0
    sed -n 's/.*"node"[[:space:]]*:[[:space:]]*"[^0-9"]*\([0-9][0-9]*\).*/\1/p' "$1" | head -1
}

# Install Node.js major $1 from NodeSource (also downgrades, for a rollback)
install_node_major() {
    local major="$1"
    if [ -n "$NODE_INSTALLER" ]; then
        "$NODE_INSTALLER" "$major"
        return
    fi
    # Kept with the snapshots: removed once the upgrade or rollback is done
    local setup="$SNAP_DIR/nodesource_setup_$major.sh"
    mkdir -p "$SNAP_DIR"
    curl -fsSL -m 120 -o "$setup" "https://deb.nodesource.com/setup_${major}.x" || return 1
    sudo -n -E bash "$setup" >> "$UPDATE_LOG" 2>&1 || return 1
    local ver
    ver=$(apt-cache madison nodejs 2>/dev/null | awk -v m="$major." 'index($3, m) == 1 {print $3; exit}')
    [ -n "$ver" ] || return 1
    sudo -n apt-get install -y --allow-downgrades "nodejs=$ver" >> "$UPDATE_LOG" 2>&1
}

# PM2's daemon keeps running on the Node.js it started with; restart it
refresh_pm2() {
    if pm2_available; then
        pm2 update > /dev/null 2>&1 || true
    fi
    return 0
}

#
# Integrity, disk and filesystem helpers
#
sha256_of() {
    if command -v sha256sum > /dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum > /dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        return 1
    fi
}

verify_sha256() {
    local file="$1" expected
    expected=$(printf '%s' "$2" | tr 'A-F' 'a-f')
    if ! printf '%s' "$expected" | grep -qE '^[0-9a-f]{64}$'; then
        log_error "Invalid --sha256 value: '$2'"
        return 1
    fi
    local actual
    if ! actual=$(sha256_of "$file") || [ -z "$actual" ]; then
        log_error "No sha256sum/shasum available to verify the release"
        return 1
    fi
    if [ "$actual" != "$expected" ]; then
        log_error "Checksum mismatch for $(basename "$file"): expected $expected, got $actual - refusing to install"
        return 1
    fi
    log_info "Checksum verified ($actual)"
}

free_kb() {
    df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}'
}

size_kb() {
    du -sk "$1" 2>/dev/null | awk '{print $1}'
}

hardlinks_supported() {
    local probe="$PROJECT_DIR/.update-hltest.$$"
    if ln "$PROJECT_DIR/package.json" "$probe" 2>/dev/null; then
        rm -f "$probe"
        return 0
    fi
    return 1
}

# Paths (relative to the install) of the node_modules dirs npm may modify
node_modules_dirs() {
    [ -d "$PROJECT_DIR/node_modules" ] && echo "node_modules"
    local d
    for d in "$PROJECT_DIR"/packages/*/node_modules; do
        [ -d "$d" ] && echo "${d#$PROJECT_DIR/}"
    done
    return 0
}

# Snapshot <rel> into $SNAP_DIR/files/<rel> as a hardlink tree (cheap; npm
# and pip replace files rather than rewriting them), falling back to a copy.
snapshot_path() {
    local rel="$1"
    local src="$PROJECT_DIR/$rel" dst="$SNAP_DIR/files/$rel"
    mkdir -p "$(dirname "$dst")"
    rm -rf "$dst.tmp" "$dst"
    if ! cp -al "$src" "$dst.tmp" 2>/dev/null; then
        rm -rf "$dst.tmp"
        cp -a "$src" "$dst.tmp" || { rm -rf "$dst.tmp"; return 1; }
    fi
    mv "$dst.tmp" "$dst" || return 1
    echo "$rel" >> "$SNAP_DIR/list"
}

# Put snapshots back in place by rename (no network). Idempotent: an entry
# whose snapshot is gone was already restored.
restore_snapshots() {
    [ -f "$SNAP_DIR/list" ] || return 0
    local rel snap live trash rc=0 n=0
    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        snap="$SNAP_DIR/files/$rel"
        live="$PROJECT_DIR/$rel"
        if [ -e "$snap" ]; then
            if [ -e "$live" ] || [ -L "$live" ]; then
                n=$((n + 1))
                trash="$SNAP_DIR/trash/$n.$$"
                mkdir -p "$SNAP_DIR/trash"
                mv "$live" "$trash" || { rc=1; continue; }
            fi
            mkdir -p "$(dirname "$live")"
            if mv "$snap" "$live"; then
                log_info "Restored $rel from pre-update snapshot"
            else
                rc=1
            fi
        fi
    done < "$SNAP_DIR/list"
    rm -rf "$SNAP_DIR/trash"
    return $rc
}

#
# Rollback: restore code from $BACKUP_DIR and node_modules/venv from
# snapshots, then always restart services. Safe to run repeatedly.
# Returns 0 if the previous version was restored.
#
ROLLING_BACK=false

do_rollback() {
    local reason="$1"
    trap '' TERM INT HUP
    trap - ERR
    set +e
    ROLLING_BACK=true
    kill_children

    if [ -f "$STATE_FILE" ]; then
        load_state
        STATE_ATTEMPTS=$((STATE_ATTEMPTS + 1))
        write_state rolling_back
    fi

    local target
    target=$(head -1 "$BACKUP_MARKER" 2>/dev/null)
    log_error "Rolling back ($reason): restoring previous version${target:+ v$target}..."
    stop_services

    local ok=true msg="" rc
    if [ "$STATE_KIND" = node ]; then
        : # a Node.js upgrade changes no code
    elif [ -f "$BACKUP_MARKER" ]; then
        # --delete removes files the update added; excluded runtime state is
        # never deleted (no --delete-excluded).
        rsync -a --checksum --delete "${UPDATE_EXCLUDES[@]}" "$BACKUP_DIR/" "$PROJECT_DIR/"
        rc=$?
        if [ $rc -ne 0 ]; then
            ok=false
            msg="restoring code from $BACKUP_DIR failed (rsync exit $rc)"
        fi
    else
        ok=false
        msg="backup at $BACKUP_DIR is missing or incomplete, code was NOT restored"
    fi
    if ! restore_snapshots; then
        ok=false
        msg="${msg:+$msg; }restoring node_modules/venv snapshots failed"
    fi
    if [ "$STATE_KIND" = node ] && [ -n "$STATE_NODE_FROM" ] && [ "$(node_major)" != "$STATE_NODE_FROM" ]; then
        log_info "Reinstalling Node.js $STATE_NODE_FROM..."
        if run_child "$NPM_TIMEOUT" install_node_major "$STATE_NODE_FROM" && [ "$(node_major)" = "$STATE_NODE_FROM" ]; then
            log_info "Node.js back on $(node -v)"
        else
            ok=false
            msg="${msg:+$msg; }reinstalling Node.js $STATE_NODE_FROM failed (network?)"
        fi
    fi
    [ "$STATE_KIND" = node ] && refresh_pm2

    log_info "Restarting services..."
    start_services || log_error "Failed to restart services after rollback"

    local health=""
    if pm2_available; then
        if wait_for_first_health; then
            health=" (backend healthy)"
        else
            health=" but $HEALTH_FAIL_REASON"
        fi
    fi

    rm -rf "$STAGE_DIR"
    if [ "$ok" = true ]; then
        log_warn "Rolled back to v$(get_current_version)${STATE_KIND:+ on Node.js $(node -v 2>/dev/null)}$health"
        clear_state
        rm -rf "$SNAP_DIR"
        return 0
    fi
    log_error "ROLLBACK FAILED: $msg; services restarted$health"
    if [ -f "$STATE_FILE" ] && [ "$STATE_ATTEMPTS" -ge "$MAX_RECOVER_ATTEMPTS" ]; then
        log_error "Giving up after $STATE_ATTEMPTS rollback attempts; clearing $STATE_FILE (manual repair needed: reinstall the release)"
        clear_state
    elif [ -f "$STATE_FILE" ]; then
        log_error "Keeping $STATE_FILE so --recover retries (attempt $STATE_ATTEMPTS of $MAX_RECOVER_ATTEMPTS)"
    fi
    return 1
}

fail() {
    [ "$ROLLING_BACK" = true ] && exit 1
    do_rollback "$1"
    exit 1
}

on_signal() {
    [ "$ROLLING_BACK" = true ] && return 0
    log_error "Received SIG$1 during the update"
    do_rollback "interrupted by SIG$1"
    exit 1
}

on_error() {
    # set -E makes $(...) subshells inherit this trap: there, just fail the
    # substitution (the caller handles it) instead of rolling back in a copy
    # of the shell
    [ "${BASH_SUBSHELL:-0}" -gt 0 ] && exit 1
    [ "$ROLLING_BACK" = true ] && return 0
    do_rollback "command failed at line $1"
    exit 1
}

# Before the point of no return a signal just aborts (nothing changed yet)
abort_signal() {
    log_warn "Received SIG$1 before any change was made; update aborted"
    exit 1
}

#
# --recover: roll back an interrupted update (power loss, SIGKILL)
#
recover() {
    [ -f "$STATE_FILE" ] || exit 0
    if ! acquire_lock; then
        log_warn "Not recovering: an update is in progress (pid $LOCK_OTHER holds $LOCK_DIR)"
        exit 1
    fi
    if [ ! -f "$STATE_FILE" ]; then
        log_info "Nothing to recover"
        exit 0
    fi
    load_state
    if [ "$STATE_KIND" = node ]; then
        log_warn "Found an interrupted Node.js upgrade (from Node.js ${STATE_NODE_FROM:-?}, phase ${STATE_PHASE:-unknown}, started $STATE_STARTED); rolling back"
    else
        log_warn "Found an interrupted update (v${STATE_FROM:-?} -> v${STATE_VERSION:-?}, phase ${STATE_PHASE:-unknown}, started $STATE_STARTED); rolling back"
    fi
    if do_rollback "recovering an interrupted update"; then
        exit 0
    fi
    exit 1
}

#
# Node.js upgrade. The caller holds the lock and has no interrupted update.
# Returns 0 when Node.js is at (or above) major $1; a failure after services
# were stopped rolls back and exits.
#
node_upgrade_txn() {
    local target="$1" from_major
    from_major=$(node_major)
    if [ -z "$from_major" ]; then
        log_error "node not found on PATH; nothing was changed"
        exit 1
    fi
    if [ "$from_major" -ge "$target" ]; then
        log_info "Node.js $(node -v) already satisfies major $target"
        return 0
    fi
    if [ -z "$NODE_INSTALLER" ]; then
        if ! command -v apt-get > /dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
            log_error "Upgrading Node.js needs apt and passwordless sudo; nothing was changed"
            exit 1
        fi
    fi

    rm -rf "$SNAP_DIR"
    mkdir -p "$SNAP_DIR"
    : > "$SNAP_DIR/list"
    local rel
    for rel in $(node_modules_dirs); do
        if ! snapshot_path "$rel"; then
            log_error "Could not snapshot $rel; nothing was changed"
            exit 1
        fi
    done
    sync 2>/dev/null || true

    STATE_KIND=node
    STATE_NODE_FROM="$from_major"
    STATE_VERSION="node-$target"
    STATE_FROM="$(get_current_version)"
    STATE_STARTED="$(date +%s)"
    STATE_ATTEMPTS=0
    write_state node_upgrading
    trap 'on_signal TERM' TERM
    trap 'on_signal INT' INT
    trap 'on_signal HUP' HUP
    trap 'on_error $LINENO' ERR

    log_info "Upgrading Node.js $(node -v) -> $target..."
    stop_services
    run_child "$NPM_TIMEOUT" install_node_major "$target" \
        || fail "Installing Node.js $target failed (exit $?; network?)"
    hash -r
    [ "$(node_major)" = "$target" ] || fail "Node.js $target did not install (node -v: $(node -v 2>&1))"
    log_info "Rebuilding native modules for Node.js $(node -v)..."
    run_child "$NPM_TIMEOUT" npm rebuild --no-audit --no-fund \
        || fail "npm rebuild failed (exit $?)"
    refresh_pm2
    start_services || fail "Failed to start services"
    wait_for_stable_health || fail "Health check failed: $HEALTH_FAIL_REASON"

    trap - ERR TERM INT HUP
    clear_state
    rm -rf "$SNAP_DIR"
    STATE_KIND=""
    STATE_NODE_FROM=""
    log_info "Node.js upgraded to $(node -v)"
}

# --upgrade-node [MAJOR]
upgrade_node() {
    local target="${UPGRADE_NODE_TO:-$(required_node_major "$PROJECT_DIR/package.json")}"
    if [ -z "$target" ]; then
        log_error "No Node.js major given and none in package.json engines"
        exit 1
    fi
    trap 'abort_signal TERM' TERM
    trap 'abort_signal INT' INT
    trap 'abort_signal HUP' HUP
    if ! acquire_lock; then
        log_error "Another update is already running (pid $LOCK_OTHER)"
        exit 1
    fi
    if [ -f "$STATE_FILE" ]; then
        log_warn "An earlier update was interrupted; recovering it before anything else"
        do_rollback "earlier update was interrupted"
        log_error "Recovered the interrupted update; not upgrading Node.js now, please retry"
        exit 1
    fi
    node_upgrade_txn "$target"
}

#
# Shared release-install logic (used by --apply and --apply-tarball)
#
# apply_release_tarball <tarball> [version] [sha256]
apply_release_tarball() {
    local tarball="$1"
    local version="$2"
    local sha="$3"

    if ! command -v rsync > /dev/null 2>&1; then
        log_error "rsync is required to apply updates (sudo apt-get install -y rsync)"
        exit 1
    fi
    if [ ! -s "$tarball" ]; then
        log_error "Release tarball not found or empty: $tarball"
        exit 1
    fi

    # 1. Integrity, before anything else
    if [ -n "$sha" ]; then
        verify_sha256 "$tarball" "$sha" || exit 1
    else
        log_warn "No --sha256 given; installing $tarball without a checksum check"
    fi

    trap 'abort_signal TERM' TERM
    trap 'abort_signal INT' INT
    trap 'abort_signal HUP' HUP

    if ! acquire_lock; then
        log_error "Another update is already running (pid $LOCK_OTHER)"
        exit 1
    fi

    # An earlier update was interrupted: finish that rollback first
    if [ -f "$STATE_FILE" ]; then
        log_warn "An earlier update was interrupted; recovering it before anything else"
        if do_rollback "earlier update was interrupted"; then
            log_error "Recovered the interrupted update; not installing now, please retry"
        fi
        exit 1
    fi

    # 2. Stage and preflight (nothing in the install is touched yet)
    log_info "Extracting update..."
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR"
    if ! tar -xzf "$tarball" -C "$STAGE_DIR" 2>> "$UPDATE_LOG"; then
        log_error "Failed to extract release (corrupt or truncated tarball); nothing was changed"
        exit 1
    fi

    # Accept tarballs with or without a single top-level directory
    local src="$STAGE_DIR"
    if [ ! -f "$src/package.json" ]; then
        local entries
        entries=$(find "$STAGE_DIR" -mindepth 1 -maxdepth 1)
        if [ "$(echo "$entries" | wc -l)" -eq 1 ] && [ -f "$entries/package.json" ]; then
            src="$entries"
        fi
    fi
    local f missing=""
    for f in package.json packages/backend/dist/server.js packages/frontend/dist/index.html config/pm2.config.cjs; do
        [ -f "$src/$f" ] || missing="$missing $f"
    done
    if [ -n "$missing" ]; then
        log_error "Release tarball is incomplete (missing:$missing); nothing was changed"
        exit 1
    fi
    [ -z "$version" ] && [ -f "$src/VERSION" ] && version=$(head -1 "$src/VERSION")

    local needs_npm=false needs_pip=false
    if [ ! -f "$src/package-lock.json" ] || [ ! -d "$PROJECT_DIR/node_modules" ] \
        || ! cmp -s "$src/package-lock.json" "$PROJECT_DIR/package-lock.json"; then
        needs_npm=true
    fi
    if [ -x "$PROJECT_DIR/$VENV_REL/bin/pip" ] && [ -f "$src/packages/presence/requirements.txt" ] \
        && ! cmp -s "$src/packages/presence/requirements.txt" "$PROJECT_DIR/packages/presence/requirements.txt"; then
        needs_pip=true
    fi

    # A release that needs a newer Node.js: upgrade Node first (its own
    # update, health-checked on the current release), then install
    local need_node
    need_node=$(required_node_major "$src/package.json")
    if [ -n "$need_node" ] && [ "$(node_major)" ] && [ "$(node_major)" -lt "$need_node" ]; then
        log_info "v${version:-?} needs Node.js $need_node (installed: $(node -v)); upgrading Node.js first"
        node_upgrade_txn "$need_node"
        trap 'abort_signal TERM' TERM
        trap 'abort_signal INT' INT
        trap 'abort_signal HUP' HUP
    fi

    # Free space: backup + new files ~ 2x the release, plus a margin (plus
    # full copies of node_modules/venv if hardlinks are unavailable)
    local staged_kb need_kb avail_kb
    staged_kb=$(size_kb "$src")
    need_kb=$(( 2 * ${staged_kb:-0} + DISK_MARGIN_MB * 1024 ))
    if { [ "$needs_npm" = true ] || [ "$needs_pip" = true ]; } && ! hardlinks_supported; then
        local rel
        for rel in $(node_modules_dirs) $VENV_REL; do
            [ -e "$PROJECT_DIR/$rel" ] && need_kb=$(( need_kb + $(size_kb "$PROJECT_DIR/$rel") ))
        done
    fi
    avail_kb=$(free_kb "$PROJECT_DIR")
    if [ -z "$avail_kb" ] || [ "$avail_kb" -lt "$need_kb" ]; then
        log_error "Not enough free disk space: need $((need_kb / 1024)) MB, have $(( ${avail_kb:-0} / 1024 )) MB; nothing was changed"
        exit 1
    fi

    # 3. Backup of the code (runtime state excluded - it is never touched)
    local from_version
    from_version=$(get_current_version)
    log_info "Creating backup of v$from_version..."
    rm -rf "$BACKUP_DIR" "$SNAP_DIR"
    mkdir -p "$BACKUP_DIR"
    if ! rsync -a "${UPDATE_EXCLUDES[@]}" "$PROJECT_DIR/" "$BACKUP_DIR/"; then
        log_error "Backup failed; nothing was changed"
        rm -rf "$BACKUP_DIR"
        exit 1
    fi
    echo "$from_version" > "$BACKUP_MARKER"

    # 4. Snapshots of what npm/pip will modify
    mkdir -p "$SNAP_DIR"
    : > "$SNAP_DIR/list"
    if [ "$needs_npm" = true ]; then
        local rel
        for rel in $(node_modules_dirs); do
            if ! snapshot_path "$rel"; then
                log_error "Could not snapshot $rel; nothing was changed"
                exit 1
            fi
        done
    fi
    if [ "$needs_pip" = true ]; then
        if ! snapshot_path "$VENV_REL"; then
            log_error "Could not snapshot $VENV_REL; nothing was changed"
            exit 1
        fi
    fi
    sync 2>/dev/null || true

    if [ "${START_DELAY:-0}" -gt 0 ] 2>/dev/null; then
        # Give the backend time to answer the HTTP request that started us
        sleep "$START_DELAY"
    fi

    # 5. Point of no return: record the update, then any failure, signal or
    # crash (via --recover) restores the backup
    STATE_KIND=""
    STATE_NODE_FROM=""
    STATE_VERSION="${version:-unknown}"
    STATE_FROM="$from_version"
    STATE_STARTED="$(date +%s)"
    STATE_ATTEMPTS=0
    write_state applying
    trap 'on_signal TERM' TERM
    trap 'on_signal INT' INT
    trap 'on_signal HUP' HUP
    trap 'on_error $LINENO' ERR

    log_info "Installing v${version:-?} over v$from_version"
    log_info "Stopping services..."
    stop_services

    log_info "Applying update files..."
    run_child 0 rsync -a --checksum "${UPDATE_EXCLUDES[@]}" "$src/" "$PROJECT_DIR/" \
        || fail "Copying the update files failed"
    if [ -n "$version" ]; then
        echo "$version" > "$PROJECT_DIR/VERSION.tmp" && mv -f "$PROJECT_DIR/VERSION.tmp" "$PROJECT_DIR/VERSION" \
            || fail "Writing VERSION failed"
    fi

    if [ "$needs_npm" = true ]; then
        log_info "package-lock.json changed; installing dependencies..."
        run_child "$NPM_TIMEOUT" npm install --no-audit --no-fund \
            || fail "npm install failed (exit $?; network?)"
    else
        log_info "package-lock.json unchanged; skipping npm install"
    fi
    if [ "$needs_pip" = true ]; then
        log_info "Python requirements changed; updating venv..."
        run_child "$PIP_TIMEOUT" "$PROJECT_DIR/$VENV_REL/bin/pip" install -q -r "$PROJECT_DIR/packages/presence/requirements.txt" \
            || fail "pip install failed (exit $?)"
    fi

    # 6. Restart and require a stable, healthy backend serving the UI
    log_info "Restarting services..."
    start_services || fail "Failed to start services"
    wait_for_stable_health || fail "Health check failed: $HEALTH_FAIL_REASON"

    trap - ERR TERM INT HUP
    clear_state
    rm -rf "$STAGE_DIR" "$TEMP_DIR" "$SNAP_DIR"
    log_info "Update complete! Now running v$(get_current_version)"
}

#
# GitHub Releases-based updates
#
update_via_releases() {
    log_info "Checking for updates via GitHub Releases..."

    CURRENT_VERSION=$(get_current_version)
    log_info "Current version: $CURRENT_VERSION"

    # Fetch latest release info
    log_info "Fetching release info from $GITHUB_REPO..."
    RELEASE_INFO=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null || true)

    if [ -z "$RELEASE_INFO" ] || echo "$RELEASE_INFO" | grep -q '"message".*"Not Found"'; then
        log_error "Failed to fetch release info. Check GITHUB_REPO setting."
        exit 1
    fi

    # Parse release info
    LATEST_VERSION=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name".*"\([^"]*\)".*/\1/' | sed 's/^v//')
    RELEASE_NAME=$(echo "$RELEASE_INFO" | grep '"name"' | head -1 | sed 's/.*"name".*"\([^"]*\)".*/\1/')

    # Find tarball asset (its checksum is published as <asset>.sha256)
    DOWNLOAD_URL=$(echo "$RELEASE_INFO" | grep '"browser_download_url"' | grep '\.tar\.gz"' | head -1 | sed 's/.*"\(https[^"]*\.tar\.gz\)".*/\1/')

    if [ -z "$LATEST_VERSION" ]; then
        log_error "Could not determine latest version"
        exit 1
    fi

    log_info "Latest version: $LATEST_VERSION"

    # Compare versions
    if ! version_lt "$CURRENT_VERSION" "$LATEST_VERSION"; then
        log_info "Already up to date! (v$CURRENT_VERSION)"
        if [ "$CHECK_ONLY" = true ]; then
            exit 1  # No updates available
        fi
        exit 0
    fi

    # Updates available
    log_info "Update available: $CURRENT_VERSION → $LATEST_VERSION"
    echo ""
    echo -e "${BLUE}Release: ${NC}$RELEASE_NAME"
    echo ""

    # If check only, exit with success
    if [ "$CHECK_ONLY" = true ]; then
        echo "v$LATEST_VERSION available"
        exit 0
    fi

    # Unless --apply was given, prompt user
    if [ "$FORCE_APPLY" = false ]; then
        read -p "Apply update to v$LATEST_VERSION? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Update cancelled"
            exit 0
        fi
    fi

    if [ -z "$DOWNLOAD_URL" ]; then
        log_error "No download URL found in release. Is the release properly configured?"
        exit 1
    fi

    log_info "Downloading update..."
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"

    TARBALL="$TEMP_DIR/release.tar.gz"
    if ! curl -fsL -o "$TARBALL" "$DOWNLOAD_URL" 2>/dev/null || [ ! -s "$TARBALL" ]; then
        log_error "Failed to download release"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    local expected=""
    if curl -fsL -o "$TEMP_DIR/release.sha256" "$DOWNLOAD_URL.sha256" 2>/dev/null; then
        expected=$(awk 'NR==1 {print $1}' "$TEMP_DIR/release.sha256")
    fi
    if [ -z "$expected" ]; then
        log_error "No checksum published for this release ($DOWNLOAD_URL.sha256); refusing to install"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    apply_release_tarball "$TARBALL" "$LATEST_VERSION" "$expected"
    rm -rf "$TEMP_DIR"
    exit 0
}

#
# Main
#
if [ "$RECOVER" = true ]; then
    recover
elif [ "$UPGRADE_NODE" = true ]; then
    upgrade_node
    exit 0
elif [ -n "$APPLY_TARBALL" ]; then
    apply_release_tarball "$APPLY_TARBALL" "$TARBALL_VERSION" "$TARBALL_SHA256"
    exit 0
else
    update_via_releases
fi
