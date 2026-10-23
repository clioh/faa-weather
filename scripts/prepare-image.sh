#!/bin/bash
#
# SkyGlass golden image preparation (docs/KIT_CARDS.md)
#
# Run ON the reference Raspberry Pi, after `scripts/setup-pi.sh --yes` finished
# and the mirror was checked once. It turns that install into a card that can
# be cloned for kits: every per-unit and personal file is removed, SSH is
# turned off, the install user's password is locked, and the next boot of each
# clone gets a new machine-id, new SSH host keys and a root filesystem grown to
# its card. Then the Pi powers off; capture the card with
# `scripts/flash-sd.sh --capture` on another computer.
#
# Usage:
#   sudo ./scripts/prepare-image.sh --yes [--country US] [--hostname skyglass]
#                                   [--zero-free-space] [--no-poweroff] [--dry-run]
#
#   --yes               Required: this deletes the mirror's data, faces, saved WiFi
#                       networks and logs, and disables SSH on this Pi.
#   --country CC        WiFi country (ISO 3166 code, default US). Without one the
#                       radio stays rfkill-blocked on a fresh card and the
#                       SkyGlass-Setup hotspot never appears.
#   --hostname NAME     Hostname of every card (default skyglass, so skyglass.local).
#   --zero-free-space   Fill free space with zeros before powering off, so the
#                       captured image compresses far better (takes a while).
#   --no-poweroff       Stay on at the end (you then must not use the Pi before
#                       capturing: the next boot re-creates per-unit state).
#   --dry-run           Print what would be done; changes nothing.
#
# Not undoable. To keep using this Pi as a dev box afterwards, re-enable SSH from
# a keyboard (sudo raspi-config) and set a password (sudo passwd <user>).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
if [ ! -t 2 ]; then RED='' GREEN='' YELLOW='' BLUE='' NC=''; fi

log_info() { printf '%b[INFO]%b %s\n' "$GREEN" "$NC" "$*" >&2; }
log_warn() { printf '%b[WARN]%b %s\n' "$YELLOW" "$NC" "$*" >&2; }
log_step() { printf '%b[STEP]%b %s\n' "$BLUE" "$NC" "$*" >&2; }
die() { printf '%b[ERROR]%b %s\n' "$RED" "$NC" "$*" >&2; exit 1; }
usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//' >&2; }

ASSUME_YES=false
COUNTRY="US"
HOSTNAME_NEW="skyglass"
ZERO_FREE=false
POWEROFF=true
DRY_RUN=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        -y|--yes) ASSUME_YES=true; shift ;;
        --country) [ "$#" -ge 2 ] || die "--country needs a value"; COUNTRY="$2"; shift 2 ;;
        --hostname) [ "$#" -ge 2 ] || die "--hostname needs a value"; HOSTNAME_NEW="$2"; shift 2 ;;
        --zero-free-space) ZERO_FREE=true; shift ;;
        --no-poweroff) POWEROFF=false; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; die "Unknown argument: $1" ;;
    esac
done

COUNTRY="$(printf '%s' "$COUNTRY" | tr '[:lower:]' '[:upper:]')"
[[ "$COUNTRY" =~ ^[A-Z]{2}$ ]] || die "--country must be a two-letter code (e.g. US, GB, DE)"
[[ "$HOSTNAME_NEW" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "Invalid hostname: $HOSTNAME_NEW"

# ------------------------------------------------------------ checks

# Overridable for tests only
PI_MODEL_FILE="${SKYGLASS_PI_MODEL_FILE:-/proc/device-tree/model}"
SYSTEMD_DIR="${SKYGLASS_SYSTEMD_DIR:-/etc/systemd/system}"

[ -r "$PI_MODEL_FILE" ] && tr -d '\0' < "$PI_MODEL_FILE" | grep -q "Raspberry Pi" \
    || die "Not a Raspberry Pi: run this on the reference Pi, never on your computer"
[ -f "$PROJECT_DIR/packages/backend/dist/server.js" ] && [ -f "$PROJECT_DIR/packages/frontend/dist/index.html" ] \
    && [ -x "$PROJECT_DIR/packages/presence/venv/bin/python" ] && [ -f "$SYSTEMD_DIR/skyglass-boot.service" ] \
    || die "No finished SkyGlass install at $PROJECT_DIR (run scripts/setup-pi.sh --yes first)"
if [ "$ASSUME_YES" != true ]; then
    usage
    die "Refusing to run without --yes: this wipes the mirror's data and disables SSH"
fi
[ "$DRY_RUN" = true ] || [ "$(id -u)" -eq 0 ] || die "Run as root: sudo $0 --yes"

INSTALL_USER="${SKYGLASS_USER:-$(stat -c %U "$PROJECT_DIR")}"
[ "$INSTALL_USER" != "root" ] || die "The install directory belongs to root; expected the install user"
[[ "$INSTALL_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "Unexpected install user name: $INSTALL_USER"
INSTALL_HOME="$(getent passwd "$INSTALL_USER" 2> /dev/null | cut -d: -f6 || true)"
[ -n "$INSTALL_HOME" ] || INSTALL_HOME="$(eval echo "~$INSTALL_USER")"
[ -n "$INSTALL_HOME" ] && [ -d "$INSTALL_HOME" ] || die "No home directory for $INSTALL_USER"

BOOT_DIR=/boot/firmware
[ -d "$BOOT_DIR" ] || BOOT_DIR=/boot

# ------------------------------------------------------------ helpers

quote_cmd() {
    local out="" arg
    for arg in "$@"; do out="$out $(printf '%q' "$arg")"; done
    printf '%s' "${out# }"
}

# run <cmd...>: runs it, or prints it under --dry-run
run() {
    if [ "$DRY_RUN" = true ]; then
        printf 'DRY-RUN: %s\n' "$(quote_cmd "$@")" >&2
        return 0
    fi
    "$@"
}

# try <cmd...>: like run, failures only warn
try() {
    run "$@" || log_warn "Failed (continuing): $(quote_cmd "$@")"
}

# remove <path...>: rm -rf each existing path
remove() {
    local p
    for p in "$@"; do
        if [ -e "$p" ] || [ -L "$p" ]; then run rm -rf -- "$p"; fi
    done
}

# empty_dir <dir> [keep-name]: delete everything inside (dotfiles too), keep the dir
empty_dir() {
    [ -d "$1" ] || return 0
    if [ -n "${2:-}" ]; then
        run find "$1" -mindepth 1 -maxdepth 1 ! -name "$2" -exec rm -rf -- {} +
    else
        run find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    fi
}

# ------------------------------------------------------------ steps

stop_everything() {
    log_step "Stopping SkyGlass and the kiosk..."
    # The watchdog restarts PM2 apps; stopping it disarms /dev/watchdog (magic close)
    try systemctl stop skyglass-watchdog.service skyglass-provision.service
    run pkill -u "$INSTALL_USER" -f "scripts/kiosk.sh" || true
    run pkill -u "$INSTALL_USER" -f chromium || true
    # Stops every app and the daemon (no dump is saved)
    try sudo -u "$INSTALL_USER" -H pm2 kill
}

set_radio_and_name() {
    log_step "WiFi country $COUNTRY, hostname $HOSTNAME_NEW..."
    command -v raspi-config > /dev/null || [ "$DRY_RUN" = true ] || die "raspi-config not found"
    # Also unblocks rfkill and saves that state for the next boot
    run raspi-config nonint do_wifi_country "$COUNTRY"
    run raspi-config nonint do_hostname "$HOSTNAME_NEW"
}

wipe_skyglass_state() {
    log_step "Removing per-unit SkyGlass state..."
    # data/: SQLite DB (mirror id and name, settings, layouts, license state),
    # paired-devices.json, internal-token, admin-password, admin-session-secret,
    # update-config.json, calendar-accounts.json, todos, photos, flight schedule,
    # camera-claim.json (docs/SECURITY.md, docs/LICENSING.md, docs/WIDGETS.md)
    empty_dir "$PROJECT_DIR/data" .gitkeep
    run chmod 700 "$PROJECT_DIR/data"
    run chown "$INSTALL_USER": "$PROJECT_DIR/data"
    # Enrolled faces and .wifi_configured
    empty_dir "$PROJECT_DIR/packages/presence/face_data"
    # config.yaml from setup-pi.sh: while it exists, the pre-flashed
    # orientation file is ignored and the Orientation step counts as done
    remove "$PROJECT_DIR/config/config.yaml"
    empty_dir "$PROJECT_DIR/logs"
    remove "$PROJECT_DIR"/.update-* "$PROJECT_DIR/.backup" "$PROJECT_DIR/.backup-complete"
    # Key file pickup marker (license manager), PM2 logs, pids and saved
    # process list (boot-mode.sh starts the apps at every boot)
    remove "$INSTALL_HOME/.skyglass"
    remove "$INSTALL_HOME/.pm2/logs" "$INSTALL_HOME/.pm2/pids" "$INSTALL_HOME/.pm2/pm2.log" \
        "$INSTALL_HOME"/.pm2/dump.pm2*
}

wipe_personal_state() {
    log_step "Removing shell history, SSH keys, caches and the browser profile..."
    local home
    for home in "$INSTALL_HOME" /root; do
        remove "$home/.bash_history" "$home/.python_history" "$home/.node_repl_history" \
            "$home/.lesshst" "$home/.wget-hsts" "$home/.viminfo" "$home/.sudo_as_admin_successful" \
            "$home/.ssh" "$home/.cache" "$home/.npm" "$home/.local/share/recently-used.xbel" \
            "$home/.config/chromium" "$home/.config/com.raspberrypi.connect"
    done
    # Raspberry Pi Imager customisation left on the boot partition (user and
    # password hash, WiFi passphrase, SSH keys) and any per-unit file
    remove "$BOOT_DIR/firstrun.sh" "$BOOT_DIR/user-data" "$BOOT_DIR/network-config" \
        "$BOOT_DIR/meta-data" "$BOOT_DIR/custom.toml" "$BOOT_DIR/userconf.txt" "$BOOT_DIR/userconf" \
        "$BOOT_DIR/wpa_supplicant.conf" "$BOOT_DIR/ssh" "$BOOT_DIR/ssh.txt" \
        "$BOOT_DIR/skyglass-license.txt" "$BOOT_DIR/skyglass-orientation.txt"
    # cloud-init (Trixie images written by Imager) already ran; never again on a clone
    if [ -d /etc/cloud ]; then run touch /etc/cloud/cloud-init.disabled; fi
}

wipe_network_state() {
    log_step "Forgetting every saved network..."
    empty_dir /etc/NetworkManager/system-connections
    remove /etc/NetworkManager/dnsmasq-shared.d/skyglass-captive.conf
    # Leases, seen BSSIDs, and the per-host secret behind stable IPv6/MAC ids
    remove /var/lib/NetworkManager/secret_key /var/lib/NetworkManager/seen-bssids \
        /var/lib/NetworkManager/timestamps /var/lib/NetworkManager/*.lease \
        /var/lib/dhcp/*.leases
}

install_firstboot() {
    log_step "Arming the first-boot unit (host keys, root filesystem resize)..."
    run cp "$PROJECT_DIR/config/systemd/skyglass-firstboot.service" "$SYSTEMD_DIR/"
    run systemctl daemon-reload
    run systemctl enable skyglass-firstboot.service
    run touch /etc/skyglass-firstboot
}

reset_identity() {
    log_step "Resetting machine-id and SSH host keys..."
    # Empty (not missing): systemd writes a new id at the next boot
    run truncate -s 0 /etc/machine-id
    if [ -f /var/lib/dbus/machine-id ] && [ ! -L /var/lib/dbus/machine-id ]; then
        run rm -f /var/lib/dbus/machine-id
        run ln -s /etc/machine-id /var/lib/dbus/machine-id
    fi
    remove /etc/ssh/ssh_host_*
    remove /var/lib/systemd/random-seed
}

lock_access() {
    log_step "Disabling SSH and locking passwords..."
    try systemctl disable --now ssh.service
    try systemctl disable --now ssh.socket
    # Desktop autologin (the kiosk) doesn't need a password; nobody can log in
    run passwd -l "$INSTALL_USER"
    run passwd -l root
}

clean_system() {
    log_step "Cleaning logs, temp files and caches..."
    try apt-get clean
    remove /var/lib/apt/lists
    run mkdir -p /var/lib/apt/lists/partial
    try journalctl --rotate
    try journalctl --vacuum-time=1s
    run find /var/log -type f \( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \) -delete
    run find /var/log -type f -exec truncate -s 0 {} +
    # /tmp is cleared at every boot (tmpfs on Trixie, tmpfiles on Bookworm)
    empty_dir /var/tmp
}

zero_free_space() {
    [ "$ZERO_FREE" = true ] || return 0
    log_step "Zeroing free space (several minutes)..."
    # dd stops with "No space left on device"; that's the point
    run dd if=/dev/zero of=/skyglass-zero.fill bs=4194304 status=progress || true
    run rm -f /skyglass-zero.fill
}

print_checklist() {
    cat >&2 << EOF

========================================
  Golden image ready
========================================

  Hostname $HOSTNAME_NEW, WiFi country $COUNTRY. Removed: data/, faces,
  config.yaml, logs, saved WiFi, machine-id, SSH host keys, histories.
  SSH is disabled and $INSTALL_USER's password is locked.

  Next, on another computer (docs/KIT_CARDS.md):
    1. Take this card out once the Pi is off. Do NOT boot it again:
       the first boot re-creates per-unit state.
    2. ./scripts/flash-sd.sh --capture --device <disk> --out skyglass-golden.img
    3. ./scripts/flash-sd.sh --image skyglass-golden.img.xz --device <disk> \\
         --license-key-file <file> [--orientation portrait-cw]
    4. Boot a test card: SkyGlass-Setup appears, one automatic reboot
       (resize), no SSH.

EOF
}

main() {
    [ "$DRY_RUN" = true ] && log_info "Dry run: nothing is changed"
    log_info "Install: $PROJECT_DIR (user $INSTALL_USER)"
    stop_everything
    set_radio_and_name
    wipe_skyglass_state
    wipe_personal_state
    wipe_network_state
    clean_system
    install_firstboot
    reset_identity
    lock_access
    zero_free_space
    run sync
    print_checklist
    if [ "$POWEROFF" = true ]; then
        log_info "Powering off..."
        run systemctl poweroff
    fi
}

main
