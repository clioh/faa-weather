#!/bin/bash
#
# Install SkyGlass systemd services
# Run with: sudo ./scripts/install-systemd.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SYSTEMD_DIR="$PROJECT_DIR/config/systemd"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run with sudo: sudo $0"
    exit 1
fi

# Detect the actual user (not root)
if [ -n "$SUDO_USER" ]; then
    ACTUAL_USER="$SUDO_USER"
else
    ACTUAL_USER="$(logname 2>/dev/null || echo 'pi')"
fi

ACTUAL_HOME=$(eval echo "~$ACTUAL_USER")

log_info "Installing systemd services for user: $ACTUAL_USER"

# Update paths in service files for the actual user
for file in "$SYSTEMD_DIR"/*.service "$SYSTEMD_DIR"/*.timer; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        log_info "Installing $filename..."

        # Replace placeholders and copy to systemd directory
        sed -e "s|/home/pi|$ACTUAL_HOME|g" \
            -e "s|User=pi|User=$ACTUAL_USER|g" \
            "$file" > "/etc/systemd/system/$filename"
    fi
done

# Reload systemd
log_info "Reloading systemd daemon..."
systemctl daemon-reload

# Enable and start the update timer
log_info "Enabling update timer..."
systemctl enable skyglass-update.timer
systemctl start skyglass-update.timer

# Ask if user wants to use systemd for Python services (alternative to PM2)
echo ""
log_warn "NOTE: By default, PM2 manages all services including the admin portal and detector."
log_warn "The systemd services below are an ALTERNATIVE for those who prefer systemd."
echo ""
read -p "Enable systemd services for admin portal and detector? (y/N) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Enabling admin portal service..."
    systemctl enable skyglass-admin.service
    systemctl start skyglass-admin.service

    log_info "Enabling detector service..."
    systemctl enable skyglass-detector.service
    systemctl start skyglass-detector.service

    log_warn "IMPORTANT: Disable sg-admin and sg-detector in PM2 to avoid conflicts:"
    log_warn "  pm2 stop sg-admin sg-detector && pm2 save"
fi

# Show status
echo ""
log_info "Installation complete!"
echo ""
echo "Timer status:"
systemctl status skyglass-update.timer --no-pager || true

echo ""
echo "Next scheduled run:"
systemctl list-timers skyglass-update.timer --no-pager || true

echo ""
read -p "Enable mDNS service (network discovery)? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    log_info "Enabling mDNS service..."
    systemctl enable skyglass-mdns.service
    systemctl start skyglass-mdns.service
fi

echo ""
read -p "Enable hardware watchdog service? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    log_info "Enabling watchdog service..."
    systemctl enable skyglass-watchdog.service
    systemctl start skyglass-watchdog.service
fi

echo ""
log_info "Commands:"
echo "  Check timer status:    systemctl status skyglass-update.timer"
echo "  View update logs:      journalctl -u skyglass-update.service"
echo "  Run update now:        systemctl start skyglass-update.service"
echo "  Disable auto-update:   systemctl disable skyglass-update.timer"
echo ""
echo "  Admin portal status:   systemctl status skyglass-admin.service"
echo "  Detector status:       systemctl status skyglass-detector.service"
echo "  mDNS status:           systemctl status skyglass-mdns.service"
echo "  Watchdog status:       systemctl status skyglass-watchdog.service"
echo ""
echo "  View logs:             journalctl -u skyglass-<service> -f"
