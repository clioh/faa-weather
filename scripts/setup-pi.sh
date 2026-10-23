#!/bin/bash
#
# SkyGlass Raspberry Pi Setup Script
# Run this on a fresh Raspberry Pi OS installation
#
# Usage: curl -sSL https://raw.githubusercontent.com/.../setup-pi.sh | bash
#    or: ./scripts/setup-pi.sh
#    or: ./scripts/setup-pi.sh --yes     # non-interactive (used by first boot)
#
# When run from inside ~/SkyGlass the repository is installed in place; the
# script never deletes the directory it is running from.
#

set -e

ASSUME_YES=false
for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=true ;;
    esac
done

echo "========================================"
echo "  SkyGlass - Raspberry Pi Setup"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# confirm "<prompt>" <default y|n>  -> returns 0 for yes
confirm() {
    local prompt="$1" default="$2"
    if [ "$ASSUME_YES" = true ]; then
        [ "$default" = "y" ]
        return
    fi
    read -p "$prompt " -r REPLY
    if [ -z "$REPLY" ]; then
        [ "$default" = "y" ]
        return
    fi
    [[ $REPLY =~ ^[Yy] ]]
}

# apt_has <package> -> 0 if apt can install it
apt_has() {
    apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [0-9]'
}

# Resolve a directory to its canonical physical path (empty if missing)
canonical_dir() {
    (cd "$1" 2>/dev/null && pwd -P) || true
}

# Check if running on Raspberry Pi
check_pi() {
    if [ ! -f /proc/device-tree/model ]; then
        log_warn "Not running on Raspberry Pi - some features may not work"
        return
    fi

    PI_MODEL=$(cat /proc/device-tree/model)
    log_info "Detected: $PI_MODEL"
}

# Update system packages
update_system() {
    log_info "Updating system packages..."
    sudo apt-get update
    sudo apt-get upgrade -y
    # rsync is required by scripts/update.sh to apply release updates
    sudo apt-get install -y rsync curl
}

# Node.js major the mirror runs on (keep in sync with engines in package.json;
# existing installs move up with scripts/update.sh --upgrade-node)
NODE_MAJOR=24
# Set when this run replaced an older Node.js (native modules need a rebuild)
NODE_UPGRADED=false

install_node() {
    log_info "Installing Node.js $NODE_MAJOR..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        log_info "Node.js already installed: $NODE_VERSION"

        local major="${NODE_VERSION#v}"
        major="${major%%.*}"
        if [ "$major" -ge "$NODE_MAJOR" ] 2>/dev/null; then
            log_info "Node.js version is compatible"
            return
        fi
        NODE_UPGRADED=true
    fi

    # Install Node.js via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs

    log_info "Node.js installed: $(node -v)"
    log_info "npm installed: $(npm -v)"
}

# Install Python and the build dependencies of the presence venv.
# OpenCV comes from the opencv-python wheel, which bundles its own codecs and
# only needs libGL from the system; dlib (face_recognition) compiles against
# cmake, BLAS/LAPACK and the image libraries below. Every package name here
# exists on Raspberry Pi OS Bookworm and Trixie.
install_python() {
    log_info "Installing Python 3 and dependencies..."

    sudo apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        cmake \
        build-essential \
        libopenblas-dev \
        liblapack-dev \
        libjpeg-dev \
        libpng-dev \
        libgl1

    log_info "Python installed: $(python3 --version)"
}

# Install Pi camera support
install_camera() {
    log_info "Installing camera support..."

    # Ribbon cameras are detected at boot (camera_auto_detect=1 in
    # config.txt); there is nothing to enable.
    sudo apt-get install -y \
        rpicam-apps \
        python3-picamera2 \
        python3-libcamera

    log_info "Camera support installed. List cameras with: rpicam-hello --list-cameras"
}

# Install display power control: HDMI-CEC for TVs, and switching the HDMI
# output off (Wayland: wlr-randr, X11: xset) for monitors without CEC.
# packages/backend/src/services/display.ts picks whichever works.
install_display_control() {
    log_info "Installing display power control..."

    sudo apt-get install -y cec-utils wlr-randr x11-xserver-utils

    log_info "Display control installed. Test CEC with: echo 'pow 0' | cec-client -s -d 1"
}

# Install mDNS/Avahi for network discovery
install_mdns() {
    log_info "Installing mDNS/Avahi for network discovery..."

    sudo apt-get install -y avahi-daemon avahi-utils

    # Enable and start avahi-daemon
    sudo systemctl enable avahi-daemon
    sudo systemctl start avahi-daemon

    log_info "mDNS installed. Mirror will be discoverable as $(hostname).local"
}

# Install WiFi provisioning dependencies
install_wifi_provisioning() {
    log_info "Installing WiFi provisioning dependencies..."

    # Install hostapd (creates access point) and dnsmasq (DHCP/DNS)
    sudo apt-get install -y hostapd dnsmasq

    # Stop and disable them from auto-starting (we control them manually)
    sudo systemctl stop hostapd 2>/dev/null || true
    sudo systemctl stop dnsmasq 2>/dev/null || true
    sudo systemctl disable hostapd 2>/dev/null || true
    sudo systemctl disable dnsmasq 2>/dev/null || true

    # Unmask hostapd (it's masked by default on some systems)
    sudo systemctl unmask hostapd 2>/dev/null || true

    log_info "WiFi provisioning dependencies installed"
}

# Enable hardware watchdog
enable_watchdog() {
    log_info "Configuring hardware watchdog..."

    # Bookworm moved the boot config to /boot/firmware (/boot/config.txt is
    # then only a pointer stub)
    local boot_config=""
    if [ -f /boot/firmware/config.txt ]; then
        boot_config=/boot/firmware/config.txt
    elif [ -f /boot/config.txt ]; then
        boot_config=/boot/config.txt
    else
        log_warn "Not a Raspberry Pi - skipping hardware watchdog"
        return
    fi

    # Enable watchdog in boot config
    if grep -q "dtparam=watchdog=on" "$boot_config"; then
        log_info "Hardware watchdog already enabled"
    else
        log_info "Enabling hardware watchdog in $boot_config..."
        echo "" | sudo tee -a "$boot_config"
        echo "# Enable hardware watchdog for reliability" | sudo tee -a "$boot_config"
        echo "dtparam=watchdog=on" | sudo tee -a "$boot_config"
        WATCHDOG_ENABLED=true
    fi

    # Load the watchdog module
    if ! lsmod | grep -q bcm2835_wdt; then
        sudo modprobe bcm2835_wdt 2>/dev/null || true
    fi

    log_info "Hardware watchdog configured"
    if [ "$WATCHDOG_ENABLED" = true ]; then
        log_warn "Reboot required to activate hardware watchdog"
    fi
}

# Install Chromium and the labwc desktop for kiosk mode. Raspberry Pi OS
# desktop images already include both.
install_chromium() {
    log_info "Installing Chromium browser..."

    if command -v chromium &> /dev/null || command -v chromium-browser &> /dev/null; then
        log_info "Chromium already installed"
    elif apt_has chromium; then
        sudo apt-get install -y chromium
    else
        sudo apt-get install -y chromium-browser
    fi
    sudo apt-get install -y labwc
}

# Install PM2 for process management
install_pm2() {
    log_info "Installing PM2 process manager..."

    sudo npm install -g pm2
    # A running PM2 daemon keeps the Node.js it started with
    [ "$NODE_UPGRADED" = true ] && { pm2 update > /dev/null 2>&1 || true; }

    # Set up PM2 to start on boot
    pm2 startup systemd -u $USER --hp $HOME

    log_info "PM2 installed: $(pm2 -v)"
}

# Clone and set up SkyGlass
setup_skyglass() {
    log_info "Setting up SkyGlass..."

    INSTALL_DIR="${HOME}/SkyGlass"

    # Where this script lives (if run from a checkout / extracted release)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
    REPO_DIR="$(dirname "$SCRIPT_DIR")"

    if [ -d "$INSTALL_DIR" ] && [ "$(canonical_dir "$INSTALL_DIR")" = "$(canonical_dir "$REPO_DIR")" ]; then
        # Running from inside the install dir (e.g. first-boot setup):
        # install in place, never remove the directory we are running from.
        log_info "Installing in place at $INSTALL_DIR"
    elif [ -d "$INSTALL_DIR" ]; then
        log_warn "SkyGlass directory already exists at $INSTALL_DIR"
        # Default is to keep the existing install (also with --yes)
        if confirm "Remove and reinstall from $REPO_DIR? (y/N)" n; then
            case "$SCRIPT_DIR/" in
                "$(canonical_dir "$INSTALL_DIR")"/*)
                    log_error "Refusing to remove $INSTALL_DIR: it contains this script"
                    exit 1
                    ;;
            esac
            if [ ! -f "$REPO_DIR/package.json" ]; then
                log_error "Cannot reinstall: $REPO_DIR is not a SkyGlass checkout"
                exit 1
            fi
            rm -rf "$INSTALL_DIR"
            log_info "Copying from local repository..."
            cp -r "$REPO_DIR" "$INSTALL_DIR"
        else
            log_info "Keeping existing installation (dependencies will be refreshed)"
        fi
    elif [ -f "$REPO_DIR/package.json" ]; then
        log_info "Copying from local repository..."
        cp -r "$REPO_DIR" "$INSTALL_DIR"
    else
        log_error "Please clone the repository first or run from within it"
        exit 1
    fi

    cd "$INSTALL_DIR"

    # Create logs/data directories
    log_info "Creating logs directory..."
    mkdir -p logs data
    # data/ holds secrets (internal-token, admin-password, session key; see
    # docs/SECURITY.md): owner-only.
    chmod 700 data

    # Install npm dependencies
    log_info "Installing npm dependencies..."
    npm install
    if [ "$NODE_UPGRADED" = true ]; then
        # node_modules from the old Node.js: recompile native modules (better-sqlite3)
        log_info "Rebuilding native modules for $(node -v)..."
        npm rebuild
    fi

    # Build backend + frontend (the backend serves packages/frontend/dist
    # on port 3001 in production)
    log_info "Building project..."
    npm run build
    if [ ! -f packages/frontend/dist/index.html ] || [ ! -f packages/backend/dist/server.js ]; then
        log_error "Build did not produce packages/frontend/dist and packages/backend/dist"
        exit 1
    fi

    # Set up Python virtual environment (packages already in it are kept).
    # --system-site-packages exposes apt's python3-picamera2/python3-libcamera,
    # which Raspberry Pi cameras need and pip cannot install; packages installed
    # in the venv take precedence. Re-running venv on an existing one only
    # updates this setting.
    log_info "Setting up Python virtual environment..."
    cd packages/presence
    python3 -m venv --system-site-packages venv
    venv/bin/pip install --upgrade pip
    venv/bin/pip install -r requirements.txt

    cd "$INSTALL_DIR"
}

# Create user config from template
setup_config() {
    log_info "Setting up configuration..."

    INSTALL_DIR="${HOME}/SkyGlass"
    CONFIG_FILE="$INSTALL_DIR/config/config.yaml"

    if [ -f "$CONFIG_FILE" ]; then
        log_warn "Config file already exists, skipping"
        return
    fi

    # Copy default config
    cp "$INSTALL_DIR/config/default.yaml" "$CONFIG_FILE"

    log_info "Created config at $CONFIG_FILE"
    log_info "Airport, location and face are set from the SkyGlass phone app"
}

# Set up boot mode detection (provisioning vs normal) and the watchdog
setup_boot_mode() {
    log_info "Setting up boot mode detection and watchdog..."

    INSTALL_DIR="${HOME}/SkyGlass"

    # Make boot script executable
    chmod +x "$INSTALL_DIR/scripts/boot-mode.sh"

    # Install systemd services
    sudo cp "$INSTALL_DIR/config/systemd/skyglass-boot.service" /etc/systemd/system/
    sudo cp "$INSTALL_DIR/config/systemd/skyglass-provision.service" /etc/systemd/system/
    sudo cp "$INSTALL_DIR/config/systemd/skyglass-watchdog.service" /etc/systemd/system/

    # Update paths (and the watchdog's PM2 user) in service files
    sudo sed -i "s|/home/pi|$HOME|g" /etc/systemd/system/skyglass-boot.service
    sudo sed -i "s|/home/pi|$HOME|g" /etc/systemd/system/skyglass-provision.service
    sudo sed -i -e "s|/home/pi|$HOME|g" -e "s|--pm2-user pi|--pm2-user $USER|" \
        /etc/systemd/system/skyglass-watchdog.service

    # Reload systemd
    sudo systemctl daemon-reload

    # Enable boot mode detection and the watchdog (both start on next boot)
    sudo systemctl enable skyglass-boot.service
    sudo systemctl enable skyglass-watchdog.service

    log_info "Boot mode detection and watchdog configured"
    log_info "On first boot without WiFi, device will create setup hotspot"
}

# Set up auto-start with PM2
setup_autostart() {
    log_info "Setting up auto-start..."

    INSTALL_DIR="${HOME}/SkyGlass"

    cd "$INSTALL_DIR"

    # Start services with PM2 (the frontend is served by skyglass-backend on 3001)
    pm2 startOrRestart config/pm2.config.cjs

    # Save PM2 process list
    pm2 save

    log_info "Services configured to start on boot"
}

# Configure kiosk mode: log in to the labwc desktop automatically and run
# only scripts/kiosk.sh in it (Chromium on the mirror UI). Raspberry Pi OS has
# used labwc since late 2024.
setup_kiosk() {
    log_info "Setting up kiosk mode..."

    INSTALL_DIR="${HOME}/SkyGlass"
    chmod +x "$INSTALL_DIR/scripts/kiosk.sh"

    if command -v raspi-config &> /dev/null; then
        # W3 = labwc, B4 = desktop with automatic login
        sudo raspi-config nonint do_wayland W3 || log_warn "Could not select the labwc desktop"
        sudo raspi-config nonint do_boot_behaviour B4 || log_warn "Could not enable desktop autologin"
    else
        log_warn "raspi-config not found: set the desktop to labwc with automatic login yourself"
    fi

    # A user autostart file replaces the desktop's default one, so no panel,
    # desktop icons or screen blanker (swayidle) run behind the mirror.
    # kanshi keeps any display layout set in Screen Configuration.
    mkdir -p "$HOME/.config/labwc"
    cat > "$HOME/.config/labwc/autostart" << EOF
# SkyGlass kiosk, written by scripts/setup-pi.sh
command -v kanshi > /dev/null && kanshi &
"$INSTALL_DIR/scripts/kiosk.sh" &
EOF

    log_info "Kiosk mode configured; the mirror display starts on next reboot"
}

# Print post-install instructions
print_instructions() {
    echo ""
    echo "========================================"
    echo "  Installation Complete!"
    echo "========================================"
    echo ""
    echo "Your SkyGlass is now ready for out-of-box setup!"
    echo ""
    echo "========================================"
    echo "  OUT-OF-BOX EXPERIENCE"
    echo "========================================"
    echo ""
    echo "On first boot (or when WiFi is not configured):"
    echo ""
    echo "1. The mirror creates a WiFi hotspot: 'SkyGlass-Setup'"
    echo ""
    echo "2. Connect your phone to this hotspot"
    echo ""
    echo "3. A setup page opens automatically (or go to http://10.42.0.1)"
    echo ""
    echo "4. Select your home WiFi and enter the password"
    echo ""
    echo "5. Mirror connects and is accessible at:"
    echo "   http://skyglass.local:3001"
    echo ""
    echo "========================================"
    echo "  MANUAL SETUP (if already on WiFi)"
    echo "========================================"
    echo ""
    echo "1. Start the services:"
    echo "   pm2 start ~/SkyGlass/config/pm2.config.cjs"
    echo ""
    echo "2. Open the mirror display:"
    echo "   http://localhost:3001"
    echo ""
    echo "3. Optional browser admin portal (off until you set a password here):"
    echo "   cd $INSTALL_DIR/packages/presence && venv/bin/python set_admin_password.py"
    echo "   then open http://$(hostname).local:5000/admin"
    echo ""
    echo "========================================"
}

# Main installation flow
main() {
    check_pi

    echo ""
    log_info "This script will install:"
    echo "  - Node.js $NODE_MAJOR"
    echo "  - Python 3 with OpenCV and face_recognition"
    echo "  - Chromium browser (kiosk mode)"
    echo "  - PM2 process manager"
    echo "  - Display power control (CEC, wlr-randr, xset)"
    echo ""

    if ! confirm "Continue with installation? (Y/n)" y; then
        log_info "Installation cancelled"
        exit 0
    fi

    update_system
    install_node
    install_python
    install_camera
    install_display_control
    install_mdns
    install_wifi_provisioning
    install_chromium
    install_pm2
    setup_skyglass
    setup_config
    setup_boot_mode
    setup_autostart
    setup_kiosk
    enable_watchdog
    print_instructions
}

# Run main function
main "$@"
