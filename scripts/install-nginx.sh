#!/bin/bash
#
# Install and configure Nginx for SkyGlass
# This provides a single port (80/443) for all services
#
# Usage: sudo ./scripts/install-nginx.sh [--ssl]
#
# Options:
#   --ssl    Enable HTTPS with self-signed certificates
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse arguments
USE_SSL=false
for arg in "$@"; do
    case $arg in
        --ssl)
            USE_SSL=true
            ;;
    esac
done

if [ "$USE_SSL" = true ]; then
    NGINX_CONF="$PROJECT_DIR/config/nginx/skyglass-ssl.conf"
else
    NGINX_CONF="$PROJECT_DIR/config/nginx/skyglass.conf"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

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

log_info "Installing Nginx for SkyGlass..."

# Install nginx
if ! command -v nginx &> /dev/null; then
    log_info "Installing nginx..."
    apt-get update
    apt-get install -y nginx
else
    log_info "Nginx already installed"
fi

# Stop nginx temporarily
systemctl stop nginx 2>/dev/null || true

# Remove default site
if [ -f /etc/nginx/sites-enabled/default ]; then
    log_info "Removing default nginx site..."
    rm -f /etc/nginx/sites-enabled/default
fi

# Check if config file exists
if [ ! -f "$NGINX_CONF" ]; then
    log_error "Nginx config not found at $NGINX_CONF"
    exit 1
fi

# Generate SSL certificates if using SSL mode
if [ "$USE_SSL" = true ]; then
    CERT_DIR="$PROJECT_DIR/config/certs"
    if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
        log_info "Generating SSL certificates..."
        sudo -u "$ACTUAL_USER" bash "$PROJECT_DIR/scripts/generate-certs.sh"
    else
        log_info "SSL certificates already exist"
    fi
fi

# Copy config with path substitution
log_info "Installing SkyGlass nginx configuration..."
sed -e "s|/home/pi|$ACTUAL_HOME|g" "$NGINX_CONF" > /etc/nginx/sites-available/skyglass

# Enable the site
ln -sf /etc/nginx/sites-available/skyglass /etc/nginx/sites-enabled/skyglass

# Test nginx configuration
log_info "Testing nginx configuration..."
if nginx -t; then
    log_info "Nginx configuration is valid"
else
    log_error "Nginx configuration test failed!"
    exit 1
fi

# Start nginx
log_info "Starting nginx..."
systemctl start nginx
systemctl enable nginx

# Show status
echo ""
log_info "Nginx installation complete!"
echo ""

IP_ADDR=$(hostname -I | awk '{print $1}')

if [ "$USE_SSL" = true ]; then
    echo "SkyGlass is now accessible at:"
    echo "  https://localhost/"
    echo "  https://$IP_ADDR/"
    echo "  https://skyglass.local/ (if mDNS is enabled)"
    echo ""
    log_warn "Note: Your browser will show a certificate warning."
    log_warn "This is normal for self-signed certificates on local networks."
    log_warn "Click 'Advanced' -> 'Proceed' to continue."
    echo ""
else
    echo "SkyGlass is now accessible at:"
    echo "  http://localhost/"
    echo "  http://$IP_ADDR/"
    echo ""
    log_warn "For secure HTTPS, run: sudo $0 --ssl"
    echo ""
fi

echo "Services proxied:"
echo "  /           -> Frontend UI, served by backend (port 3001)"
echo "  /api/*      -> Backend API (port 3001)"
echo "  /ws         -> WebSocket (port 3001)"
echo "  /admin      -> Admin Portal (port 5000)"
echo ""
echo "Commands:"
echo "  Check status:    systemctl status nginx"
echo "  View logs:       tail -f /var/log/nginx/skyglass-*.log"
echo "  Restart:         sudo systemctl restart nginx"
echo "  Test config:     sudo nginx -t"
echo ""

# Optional: point the kiosk at nginx (port 80) instead of the backend (3001)
KIOSK_AUTOSTART="$ACTUAL_HOME/.config/lxsession/LXDE-pi/autostart"
if [ -f "$KIOSK_AUTOSTART" ] && grep -q "localhost:3001" "$KIOSK_AUTOSTART"; then
    log_warn "Note: the kiosk still opens http://localhost:3001 (works without nginx)."
    log_warn "To go through nginx instead, run: sed -i 's|localhost:3001|localhost|g' $KIOSK_AUTOSTART"
    log_warn "(or start scripts/kiosk.sh with: SKYGLASS_URL=http://localhost)"
fi
