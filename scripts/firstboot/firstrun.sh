#!/bin/bash
#
# SkyGlass First Run Script
# This is copied to the SD card boot partition and runs on first boot.
#

exec > /var/log/skyglass-firstrun.log 2>&1
echo "=== SkyGlass First Run ==="
echo "Started: $(date)"

set +e

# Set hostname
echo "Setting hostname..."
hostnamectl set-hostname skyglass
echo "skyglass" > /etc/hostname
sed -i 's/raspberrypi/skyglass/g' /etc/hosts

# Enable camera interface
echo "Enabling camera..."
raspi-config nonint do_camera 0 2>/dev/null || true

# Enable I2C (for sensors)
raspi-config nonint do_i2c 0 2>/dev/null || true

# Determine user
if [ -d "/home/pi" ]; then
    USER_HOME="/home/pi"
    USER_NAME="pi"
else
    USER_NAME=$(ls /home 2>/dev/null | head -1)
    USER_HOME="/home/$USER_NAME"
fi

echo "User: $USER_NAME"
echo "Home: $USER_HOME"

# Read config from boot partition
REPO_URL="https://github.com/YOUR_USERNAME/SkyGlass.git"
BRANCH="main"

for conf in /boot/skyglass.conf /boot/firmware/skyglass.conf; do
    [ -f "$conf" ] && source "$conf"
done

echo "Repository: $REPO_URL"
echo "Branch: $BRANCH"

# Create the main setup service
cat > /etc/systemd/system/skyglass-setup.service << SVCEOF
[Unit]
Description=SkyGlass Auto Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/var/lib/skyglass-setup-complete

[Service]
Type=oneshot
ExecStart=/usr/local/bin/skyglass-auto-setup.sh
RemainAfterExit=yes
TimeoutStartSec=3600
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
SVCEOF

# Create the auto-setup script
cat > /usr/local/bin/skyglass-auto-setup.sh << SETUPEOF
#!/bin/bash
exec > /var/log/skyglass-setup.log 2>&1
echo "=== SkyGlass Setup ==="
echo "Started: \$(date)"

# Wait for network
echo "Waiting for network..."
for i in \$(seq 1 60); do
    if ping -c 1 github.com &> /dev/null; then
        echo "Network connected!"
        break
    fi
    echo "  Retry \$i/60..."
    sleep 2
done

# Check network
if ! ping -c 1 github.com &> /dev/null; then
    echo "No network - will retry on next boot"
    exit 1
fi

# Update and install git
echo "Installing prerequisites..."
apt-get update
apt-get install -y git curl

# Clone repository
echo "Cloning repository..."
cd ${USER_HOME}

if [ ! -d "SkyGlass" ]; then
    sudo -u ${USER_NAME} git clone -b ${BRANCH} ${REPO_URL} SkyGlass
    chown -R ${USER_NAME}:${USER_NAME} SkyGlass
fi

# Run the main setup script
echo "Running SkyGlass setup..."
cd SkyGlass
chmod +x scripts/setup-pi.sh

export DEBIAN_FRONTEND=noninteractive
if ! sudo -u ${USER_NAME} bash -c 'export DEBIAN_FRONTEND=noninteractive; cd ~/SkyGlass && ./scripts/setup-pi.sh --yes < /dev/null'; then
    # Not marked complete: the service runs again on next boot
    echo "Setup FAILED - will retry on next boot. See /var/log/skyglass-setup.log"
    exit 1
fi

# Mark as complete (only reached when setup-pi.sh exited 0)
touch /var/lib/skyglass-setup-complete
echo "Setup complete: \$(date)"

# Disable this service
systemctl disable skyglass-setup.service

# Reboot to apply everything
echo "Rebooting to apply changes..."
sleep 5
reboot
SETUPEOF

chmod +x /usr/local/bin/skyglass-auto-setup.sh

# Enable the service
systemctl daemon-reload
systemctl enable skyglass-setup.service

echo "First run configuration complete: $(date)"

# Clean up this script
rm -f /boot/firstrun.sh /boot/firmware/firstrun.sh

# Reboot to start the setup service
echo "Rebooting to start setup..."
sleep 3
reboot
