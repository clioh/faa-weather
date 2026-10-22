#!/bin/bash
#
# SkyGlass Update Script
# Checks for updates and optionally applies them via GitHub Releases.
# The backend's in-app updater (packages/backend/src/services/updater.ts)
# downloads the release itself and calls --apply-tarball.
#
# Usage:
#   ./scripts/update.sh              # Check and prompt
#   ./scripts/update.sh --check      # Check only, exit with status
#   ./scripts/update.sh --apply      # Apply updates without prompting
#   ./scripts/update.sh --apply-tarball <file> [--version X] [--delay N]
#                                     # Install an already-downloaded release
#                                     # tarball (used by the backend updater)
#
# Release updates never touch runtime state: node_modules, Python venvs,
# packages/presence/face_data (enrolled faces, .wifi_configured), data/
# (SQLite), logs/, config/config.yaml and .env files are
# excluded from both the copy and the backup/restore (see UPDATE_EXCLUDES).
# Files from the tarball are copied over the install (rsync, no --delete);
# on any failure the previous install is restored from .backup and the
# services are restarted on the old version.
#

set -eE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPDATE_LOG="$PROJECT_DIR/logs/update.log"
TEMP_DIR="$PROJECT_DIR/.update-temp"
BACKUP_DIR="$PROJECT_DIR/.backup"
STAGE_DIR="$PROJECT_DIR/.update-stage"
LOCK_DIR="$PROJECT_DIR/.update-lock"
HEALTH_URL="${SKYGLASS_HEALTH_URL:-http://localhost:3001/api/health}"

# Runtime state that an update must never overwrite, delete, back up or
# restore. Leading "/" anchors a pattern to the install root; patterns
# without it match at any depth. Keep in sync with
# packages/backend/src/services/updater.ts (which delegates to this script).
UPDATE_EXCLUDES=(
    --exclude=/.git/
    --exclude=/data/
    --exclude=/logs/
    --exclude=/config/config.yaml
    --exclude=/.update-temp/
    --exclude=/.update-stage/
    --exclude=/.update-lock/
    --exclude=/.backup/
    --exclude=node_modules/
    --exclude=venv/
    --exclude=.venv/
    --exclude=face_data/
    --exclude=__pycache__/
    --exclude=.env
    --exclude=.env.local
)

# GitHub repository (override with GITHUB_REPO env var)
GITHUB_REPO="${GITHUB_REPO:-YOUR_USERNAME/SkyGlass}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo -e "$msg"
    mkdir -p "$(dirname "$UPDATE_LOG")"
    echo "$msg" >> "$UPDATE_LOG"
}

log_info() { log "${GREEN}[INFO]${NC} $1"; }
log_warn() { log "${YELLOW}[WARN]${NC} $1"; }
log_error() { log "${RED}[ERROR]${NC} $1"; }

cd "$PROJECT_DIR"

# Parse arguments
CHECK_ONLY=false
FORCE_APPLY=false
APPLY_TARBALL=""
TARBALL_VERSION=""
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
        --help|-h)
            echo "SkyGlass Update Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --check    Check for updates only (exit 0 if available, 1 if not)"
            echo "  --apply    Apply updates without prompting"
            echo "  --apply-tarball FILE  Install a downloaded release tarball"
            echo "  --version X           Version to record with --apply-tarball"
            echo "  --delay N             Wait N seconds before stopping services"
            echo "  --help     Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  GITHUB_REPO   GitHub repository (default: $GITHUB_REPO)"
            exit 0
            ;;
    esac
    shift
done

# Get current version
get_current_version() {
    if [ -f "$PROJECT_DIR/VERSION" ]; then
        cat "$PROJECT_DIR/VERSION"
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
# Shared release-install logic (used by --apply and --apply-tarball)
#

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$LOCK_DIR/pid"
    else
        local other
        other=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
        if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
            log_error "Another update is already running (pid $other)"
            exit 1
        fi
        log_warn "Removing stale update lock"
        echo $$ > "$LOCK_DIR/pid"
    fi
    trap 'rm -rf "$LOCK_DIR"' EXIT
}

pm2_available() {
    command -v pm2 &> /dev/null
}

stop_services() {
    pm2_available && pm2 stop all > /dev/null 2>&1 || true
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
}

wait_for_health() {
    pm2_available || return 0
    for _ in $(seq 1 60); do
        if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

install_dependencies() {
    local src="$1"
    cd "$PROJECT_DIR"
    log_info "Installing dependencies..."
    npm install --no-audit --no-fund
    if [ ! -d "$src/packages/backend/dist" ] || [ ! -d "$src/packages/frontend/dist" ]; then
        log_info "Release has no prebuilt dist/, building..."
        npm run build
    fi
    local venv_pip="$PROJECT_DIR/packages/presence/venv/bin/pip"
    local req="$PROJECT_DIR/packages/presence/requirements.txt"
    if [ -x "$venv_pip" ] && [ -f "$req" ] && \
        ! cmp -s "$req" "$BACKUP_DIR/packages/presence/requirements.txt"; then
        log_info "Python requirements changed, updating venv..."
        "$venv_pip" install -q -r "$req"
    fi
}

# Restore the pre-update install from $BACKUP_DIR and bring services back up.
rollback() {
    trap - ERR
    set +e
    log_error "Update failed - restoring previous version from backup..."
    stop_services
    if [ -d "$BACKUP_DIR" ]; then
        # --delete removes files the update added; excluded runtime state is
        # never deleted by rsync (no --delete-excluded).
        rsync -a --checksum --delete "${UPDATE_EXCLUDES[@]}" "$BACKUP_DIR/" "$PROJECT_DIR/"
        cd "$PROJECT_DIR"
        npm install --no-audit --no-fund > /dev/null 2>&1 \
            || log_warn "npm install during rollback failed"
        local venv_pip="$PROJECT_DIR/packages/presence/venv/bin/pip"
        if [ -x "$venv_pip" ] && [ -f "$PROJECT_DIR/packages/presence/requirements.txt" ]; then
            "$venv_pip" install -q -r "$PROJECT_DIR/packages/presence/requirements.txt" > /dev/null 2>&1 || true
        fi
    else
        log_error "No backup found at $BACKUP_DIR - cannot restore"
    fi
    start_services || log_error "Failed to restart services after rollback"
    rm -rf "$STAGE_DIR"
    log_error "Rolled back to v$(get_current_version)"
    exit 1
}

# apply_release_tarball <tarball> [version]
apply_release_tarball() {
    local tarball="$1"
    local version="$2"

    if ! command -v rsync &> /dev/null; then
        log_error "rsync is required to apply updates (sudo apt-get install -y rsync)"
        exit 1
    fi
    if [ ! -s "$tarball" ]; then
        log_error "Release tarball not found or empty: $tarball"
        exit 1
    fi

    acquire_lock

    log_info "Extracting update..."
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR"
    if ! tar -xzf "$tarball" -C "$STAGE_DIR"; then
        log_error "Failed to extract release"
        rm -rf "$STAGE_DIR"
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
    if [ ! -f "$src/package.json" ] || [ ! -d "$src/packages" ]; then
        log_error "Release tarball does not look like a SkyGlass release (no package.json/packages)"
        rm -rf "$STAGE_DIR"
        exit 1
    fi
    [ -z "$version" ] && [ -f "$src/VERSION" ] && version=$(cat "$src/VERSION")

    # Back up code (runtime state excluded - it is never touched)
    log_info "Creating backup..."
    rm -rf "$BACKUP_DIR"
    mkdir -p "$BACKUP_DIR"
    rsync -a "${UPDATE_EXCLUDES[@]}" "$PROJECT_DIR/" "$BACKUP_DIR/"

    if [ "${START_DELAY:-0}" -gt 0 ] 2>/dev/null; then
        # Give the backend time to answer the HTTP request that started us
        sleep "$START_DELAY"
    fi

    # From here on, any failure restores the backup
    trap rollback ERR

    log_info "Stopping services..."
    stop_services

    log_info "Applying update files..."
    rsync -a --checksum "${UPDATE_EXCLUDES[@]}" "$src/" "$PROJECT_DIR/"
    if [ -n "$version" ]; then
        echo "$version" > "$PROJECT_DIR/VERSION"
    fi

    install_dependencies "$src"

    log_info "Restarting services..."
    start_services
    if ! wait_for_health; then
        log_error "Backend did not become healthy at $HEALTH_URL"
        rollback
    fi

    trap - ERR
    rm -rf "$STAGE_DIR" "$TEMP_DIR"
    log_info "Update complete!"
    log_info "Now running: v$(get_current_version)"
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
    RELEASE_INFO=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" 2>/dev/null)

    if [ -z "$RELEASE_INFO" ] || echo "$RELEASE_INFO" | grep -q '"message".*"Not Found"'; then
        log_error "Failed to fetch release info. Check GITHUB_REPO setting."
        exit 1
    fi

    # Parse release info
    LATEST_VERSION=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name".*"\([^"]*\)".*/\1/' | sed 's/^v//')
    RELEASE_NAME=$(echo "$RELEASE_INFO" | grep '"name"' | head -1 | sed 's/.*"name".*"\([^"]*\)".*/\1/')

    # Find tarball asset
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

    # Apply update
    log_info "Downloading update..."

    # Clean up temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"

    # Download tarball
    TARBALL="$TEMP_DIR/release.tar.gz"
    curl -fL -o "$TARBALL" "$DOWNLOAD_URL" 2>/dev/null || {
        log_error "Failed to download release"
        rm -rf "$TEMP_DIR"
        exit 1
    }

    # Verify download
    if [ ! -s "$TARBALL" ]; then
        log_error "Downloaded file is empty"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    apply_release_tarball "$TARBALL" "$LATEST_VERSION"
    exit 0
}

#
# Main
#
if [ -n "$APPLY_TARBALL" ]; then
    apply_release_tarball "$APPLY_TARBALL" "$TARBALL_VERSION"
    exit 0
else
    update_via_releases
fi
