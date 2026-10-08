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

# Install Node.js 20
install_node() {
    log_info "Installing Node.js 20..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        log_info "Node.js already installed: $NODE_VERSION"

        # Check if version is 20+
        if [[ "$NODE_VERSION" =~ ^v2[0-9] ]]; then
            log_info "Node.js version is compatible"
            return
        fi
    fi

    # Install Node.js via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    log_info "Node.js installed: $(node -v)"
    log_info "npm installed: $(npm -v)"
}

# Install Python and dependencies
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
        libpng-dev

    log_info "Python installed: $(python3 --version)"
}

# Install OpenCV and face_recognition dependencies
install_cv_deps() {
    log_info "Installing OpenCV and face recognition dependencies..."

    sudo apt-get install -y \
        libatlas-base-dev \
        libhdf5-dev \
        libhdf5-serial-dev \
        libharfbuzz0b \
        libwebp-dev \
        libtiff5-dev \
        libjasper-dev \
        libilmbase-dev \
        libopenexr-dev \
        libgstreamer1.0-dev \
        libavcodec-dev \
        libavformat-dev \
        libswscale-dev \
        libv4l-dev \
        libxvidcore-dev \
        libx264-dev \
        libgtk-3-dev
}

# Install Pi camera support
install_camera() {
    log_info "Installing camera support..."

    sudo apt-get install -y \
        libcamera-apps \
        python3-picamera2 \
        python3-libcamera

    # Enable camera interface
    if command -v raspi-config &> /dev/null; then
        log_info "Enabling camera interface..."
        sudo raspi-config nonint do_camera 0
    fi
}

# Install CEC for display control
install_cec() {
    log_info "Installing HDMI CEC support..."

    sudo apt-get install -y cec-utils

    log_info "CEC installed. Test with: echo 'scan' | cec-client -s -d 1"
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

    # Check if we're on a Raspberry Pi
    if [ ! -f /boot/config.txt ]; then
        log_warn "Not a Raspberry Pi - skipping hardware watchdog"
        return
    fi

    # Enable watchdog in boot config
    if grep -q "dtparam=watchdog=on" /boot/config.txt; then
        log_info "Hardware watchdog already enabled"
    else
        log_info "Enabling hardware watchdog in /boot/config.txt..."
        echo "" | sudo tee -a /boot/config.txt
        echo "# Enable hardware watchdog for reliability" | sudo tee -a /boot/config.txt
        echo "dtparam=watchdog=on" | sudo tee -a /boot/config.txt
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

# Install Chromium for kiosk mode
install_chromium() {
    log_info "Installing Chromium browser..."

    sudo apt-get install -y \
        chromium-browser \
        unclutter \
        xdotool
}

# Install PM2 for process management
install_pm2() {
    log_info "Installing PM2 process manager..."

    sudo npm install -g pm2

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

    # Install npm dependencies
    log_info "Installing npm dependencies..."
    npm install

    # Build backend + frontend (the backend serves packages/frontend/dist
    # on port 3001 in production)
    log_info "Building project..."
    npm run build
    if [ ! -f packages/frontend/dist/index.html ] || [ ! -f packages/backend/dist/server.js ]; then
        log_error "Build did not produce packages/frontend/dist and packages/backend/dist"
        exit 1
    fi

    # Set up Python virtual environment (kept if it already exists)
    log_info "Setting up Python virtual environment..."
    cd packages/presence
    if [ ! -x venv/bin/python ]; then
        python3 -m venv venv
    fi
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
    log_warn "Please edit this file to set your airport and location!"
}

# Set up boot mode detection (provisioning vs normal)
setup_boot_mode() {
    log_info "Setting up boot mode detection..."

    INSTALL_DIR="${HOME}/SkyGlass"

    # Make boot script executable
    chmod +x "$INSTALL_DIR/scripts/boot-mode.sh"

    # Install systemd services
    sudo cp "$INSTALL_DIR/config/systemd/skyglass-boot.service" /etc/systemd/system/
    sudo cp "$INSTALL_DIR/config/systemd/skyglass-provision.service" /etc/systemd/system/

    # Update paths in service files
    sudo sed -i "s|/home/pi|$HOME|g" /etc/systemd/system/skyglass-boot.service
    sudo sed -i "s|/home/pi|$HOME|g" /etc/systemd/system/skyglass-provision.service

    # Reload systemd
    sudo systemctl daemon-reload

    # Enable boot mode detection
    sudo systemctl enable skyglass-boot.service

    log_info "Boot mode detection configured"
    log_info "On first boot without WiFi, device will create setup hotspot"
}

# Set up auto-start with PM2
setup_autostart() {
    log_info "Setting up auto-start..."

    INSTALL_DIR="${HOME}/SkyGlass"

    cd "$INSTALL_DIR"

    # Start services with PM2 (the frontend is served by skyglass-backend on 3001).
    # Drop legacy mm-* apps (including the old standalone frontend) if present.
    for legacy in mm-frontend mm-backend mm-detector mm-admin mm-mdns mm-presence; do
        pm2 delete "$legacy" > /dev/null 2>&1 || true
    done
    pm2 startOrRestart config/pm2.config.cjs

    # Save PM2 process list
    pm2 save

    log_info "Services configured to start on boot"
}

# Configure kiosk mode
setup_kiosk() {
    log_info "Setting up kiosk mode..."

    INSTALL_DIR="${HOME}/SkyGlass"
    AUTOSTART_DIR="${HOME}/.config/lxsession/LXDE-pi"

    mkdir -p "$AUTOSTART_DIR"

    # Create autostart file
    cat > "$AUTOSTART_DIR/autostart" << EOF
@lxpanel --profile LXDE-pi
@pcmanfm --desktop --profile LXDE-pi
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.5 -root
@chromium-browser --noerrdialogs --disable-infobars --kiosk http://localhost:3001
EOF

    log_info "Kiosk mode configured"
    log_info "The browser will auto-start on next reboot"
}

# Disable screen blanking
disable_screensaver() {
    log_info "Disabling screen blanking..."

    # Disable screen blanking in lightdm
    sudo sed -i 's/#xserver-command=X/xserver-command=X -s 0 -dpms/' /etc/lightdm/lightdm.conf 2>/dev/null || true

    log_info "Screen blanking disabled"
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
    echo "   http://skyglass.local"
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
    echo "3. Access the admin portal:"
    echo "   http://$(hostname).local:5000/admin"
    echo "   or http://$(hostname -I | awk '{print $1}'):5000/admin"
    echo ""
    echo "========================================"
    echo "  OPTIONAL ENHANCEMENTS"
    echo "========================================"
    echo ""
    echo "Install nginx (serves everything on port 80):"
    echo "   sudo ./scripts/install-nginx.sh"
    echo ""
    echo "Enable HTTPS (secure local access):"
    echo "   sudo ./scripts/install-nginx.sh --ssl"
    echo ""
    echo "========================================"
}

# Main installation flow
main() {
    check_pi

    echo ""
    log_info "This script will install:"
    echo "  - Node.js 20"
    echo "  - Python 3 with OpenCV and face_recognition"
    echo "  - Chromium browser (kiosk mode)"
    echo "  - PM2 process manager"
    echo "  - CEC utilities (display control)"
    echo ""

    if ! confirm "Continue with installation? (Y/n)" y; then
        log_info "Installation cancelled"
        exit 0
    fi

    update_system
    install_node
    install_python
    install_cv_deps
    install_camera
    install_cec
    install_mdns
    install_wifi_provisioning
    install_chromium
    install_pm2
    setup_skyglass
    setup_config
    setup_boot_mode
    setup_autostart
    setup_kiosk
    disable_screensaver
    enable_watchdog
    print_instructions
}

# Run main function
main "$@"
