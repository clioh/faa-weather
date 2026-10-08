#!/bin/bash
#
# SkyGlass First Boot Setup Script
#
# This script runs automatically on first boot to:
# 1. Clone the SkyGlass repository
# 2. Run the full setup
# 3. Configure auto-start
#
# It's triggered by a systemd service created during SD card flashing.
#

set -e

LOG_FILE="/var/log/skyglass-setup.log"
SETUP_FLAG="/home/pi/.skyglass-setup-complete"

# Redirect output to log
exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "SkyGlass First Boot Setup"
echo "Started at: $(date)"
echo "========================================"

# Exit if already completed
if [ -f "$SETUP_FLAG" ]; then
    echo "Setup already completed. Exiting."
    exit 0
fi

# Determine user home directory
if [ -d "/home/pi" ]; then
    USER_HOME="/home/pi"
    USER_NAME="pi"
else
    USER_NAME=$(ls /home | head -1)
    USER_HOME="/home/$USER_NAME"
fi

echo "User: $USER_NAME"
echo "Home: $USER_HOME"

# Wait for network connectivity
echo "Waiting for network..."
for i in {1..60}; do
    if ping -c 1 github.com &> /dev/null; then
        echo "Network connected!"
        break
    fi
    echo "  Attempt $i/60..."
    sleep 2
done

# Check if we have network
if ! ping -c 1 github.com &> /dev/null; then
    echo "WARNING: No network connectivity. Will retry on next boot."
    exit 1
fi

# Update package lists
echo "Updating package lists..."
apt-get update

# Install git if needed
if ! command -v git &> /dev/null; then
    echo "Installing git..."
    apt-get install -y git
fi

# Clone repository if not present
cd "$USER_HOME"
if [ ! -d "SkyGlass" ]; then
    echo "Cloning SkyGlass repository..."

    # Check for custom repo URL in boot config
    REPO_URL="https://github.com/YOUR_USERNAME/SkyGlass.git"
    if [ -f "/boot/skyglass.conf" ]; then
        source /boot/skyglass.conf
    elif [ -f "/boot/firmware/skyglass.conf" ]; then
        source /boot/firmware/skyglass.conf
    fi

    sudo -u "$USER_NAME" git clone "$REPO_URL" SkyGlass
fi

# Run the main setup script
echo "Running SkyGlass setup..."
cd "$USER_HOME/SkyGlass"

# Make setup script executable
chmod +x scripts/setup-pi.sh

# Run setup (non-interactive)
export DEBIAN_FRONTEND=noninteractive
sudo -u "$USER_NAME" bash -c 'cd ~/SkyGlass && yes | ./scripts/setup-pi.sh'

# Mark setup as complete
touch "$SETUP_FLAG"
chown "$USER_NAME:$USER_NAME" "$SETUP_FLAG"

echo "========================================"
echo "Setup Complete!"
echo "Finished at: $(date)"
echo "========================================"

# Disable this service so it doesn't run again
systemctl disable skyglass-firstboot.service 2>/dev/null || true

# Reboot to apply all changes
echo "Rebooting in 10 seconds..."
sleep 10
reboot
