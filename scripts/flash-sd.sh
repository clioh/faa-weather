#!/bin/bash
#
# SkyGlass SD Card Flasher
#
# This script prepares an SD card with Raspberry Pi OS and configures it
# to automatically install SkyGlass on first boot.
#
# Usage:
#   ./scripts/flash-sd.sh [device]
#
# Examples:
#   ./scripts/flash-sd.sh              # Auto-detect SD card
#   ./scripts/flash-sd.sh /dev/disk4   # Specify device (Mac)
#   ./scripts/flash-sd.sh /dev/sdb     # Specify device (Linux)
#
# Requirements:
#   - macOS or Linux
#   - SD card (16GB+ recommended)
#   - Internet connection to download Raspberry Pi OS
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOWNLOAD_DIR="$PROJECT_DIR/.cache"

# Raspberry Pi OS
PI_OS_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
PI_OS_IMAGE="raspios-bookworm-arm64-lite.img"

# SkyGlass Release (CHANGE THIS TO YOUR REPO)
GITHUB_REPO="YOUR_USERNAME/SkyGlass"
RELEASE_VERSION="${SKYGLASS_VERSION:-latest}"
RELEASE_FILE="$DOWNLOAD_DIR/skyglass-release.tar.gz"

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        *)       echo "unknown" ;;
    esac
}

OS=$(detect_os)

if [ "$OS" = "unknown" ]; then
    log_error "Unsupported operating system"
    exit 1
fi

# List available disks
list_disks() {
    echo ""
    log_info "Available disks:"
    echo ""

    if [ "$OS" = "macos" ]; then
        diskutil list external physical 2>/dev/null || diskutil list
    else
        lsblk -d -o NAME,SIZE,MODEL,TRAN | grep -E "sd|mmcblk"
    fi
    echo ""
}

# Find SD card automatically
find_sd_card() {
    if [ "$OS" = "macos" ]; then
        # Look for external physical disks (likely SD card)
        local disk=$(diskutil list external physical 2>/dev/null | grep -E "^/dev/disk[0-9]+" | head -1 | awk '{print $1}')
        echo "$disk"
    else
        # Look for removable devices
        local disk=$(lsblk -d -o NAME,RM,SIZE | awk '$2==1 && $3!="0B" {print "/dev/"$1}' | head -1)
        echo "$disk"
    fi
}

# Get disk size in GB
get_disk_size() {
    local disk=$1
    if [ "$OS" = "macos" ]; then
        diskutil info "$disk" 2>/dev/null | grep "Disk Size" | awk -F'[()]' '{print $2}'
    else
        lsblk -d -o SIZE "$disk" 2>/dev/null | tail -1
    fi
}

# Unmount disk
unmount_disk() {
    local disk=$1
    log_info "Unmounting $disk..."

    if [ "$OS" = "macos" ]; then
        diskutil unmountDisk "$disk" 2>/dev/null || true
    else
        # Unmount all partitions
        for part in ${disk}*; do
            umount "$part" 2>/dev/null || true
        done
    fi
}

# Get raw device for writing
get_raw_device() {
    local disk=$1
    if [ "$OS" = "macos" ]; then
        # Use rdisk for faster writes on Mac
        echo "${disk/disk/rdisk}"
    else
        echo "$disk"
    fi
}

# Download SkyGlass release from GitHub
download_release() {
    mkdir -p "$DOWNLOAD_DIR"

    # Check for cached release
    if [ -f "$RELEASE_FILE" ] && [ "$RELEASE_VERSION" != "latest" ]; then
        log_info "Using cached release: $RELEASE_FILE"
        echo "$RELEASE_FILE"
        return
    fi

    log_step "Downloading SkyGlass release..."

    local download_url=""

    if [ "$RELEASE_VERSION" = "latest" ]; then
        # Get latest release URL from GitHub API
        log_info "Finding latest release..."
        local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
        local release_info=$(curl -s "$api_url")

        # Extract the tarball URL
        download_url=$(echo "$release_info" | grep -o '"browser_download_url": *"[^"]*\.tar\.gz"' | head -1 | cut -d'"' -f4)
        RELEASE_VERSION=$(echo "$release_info" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)

        if [ -z "$download_url" ]; then
            log_error "Could not find release download URL"
            log_info "Make sure you have created a GitHub release with a .tar.gz asset"
            exit 1
        fi
    else
        # Use specific version
        download_url="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_VERSION}/skyglass-${RELEASE_VERSION}.tar.gz"
    fi

    log_info "Version: $RELEASE_VERSION"
    log_info "URL: $download_url"

    # Download
    curl -L -o "$RELEASE_FILE" "$download_url" --progress-bar

    if [ ! -f "$RELEASE_FILE" ]; then
        log_error "Download failed!"
        exit 1
    fi

    local size=$(du -h "$RELEASE_FILE" | cut -f1)
    log_info "Downloaded: $size"

    echo "$RELEASE_FILE"
}

# Download Raspberry Pi OS
download_image() {
    mkdir -p "$DOWNLOAD_DIR"

    local xz_file="$DOWNLOAD_DIR/$(basename "$PI_OS_URL")"
    local img_file="$DOWNLOAD_DIR/$PI_OS_IMAGE"

    if [ -f "$img_file" ]; then
        log_info "Using cached image: $img_file"
        echo "$img_file"
        return
    fi

    log_step "Downloading Raspberry Pi OS (this may take a while)..."

    if command -v curl &> /dev/null; then
        curl -L -o "$xz_file" "$PI_OS_URL" --progress-bar
    elif command -v wget &> /dev/null; then
        wget -O "$xz_file" "$PI_OS_URL" --show-progress
    else
        log_error "Neither curl nor wget found. Please install one."
        exit 1
    fi

    log_step "Extracting image..."
    if command -v xz &> /dev/null; then
        xz -d -k "$xz_file"
        mv "${xz_file%.xz}" "$img_file"
    elif command -v unxz &> /dev/null; then
        unxz -k "$xz_file"
        mv "${xz_file%.xz}" "$img_file"
    else
        log_error "xz not found. Please install xz-utils."
        exit 1
    fi

    rm -f "$xz_file"
    echo "$img_file"
}

# Flash image to SD card
flash_image() {
    local img=$1
    local disk=$2
    local raw_disk=$(get_raw_device "$disk")

    log_step "Flashing image to $disk..."
    log_warn "This will ERASE ALL DATA on the disk!"

    # Use dd with progress
    if [ "$OS" = "macos" ]; then
        sudo dd if="$img" of="$raw_disk" bs=4m status=progress
    else
        sudo dd if="$img" of="$raw_disk" bs=4M status=progress conv=fsync
    fi

    sync
    log_info "Flash complete!"
}

# Mount boot partition
mount_boot() {
    local disk=$1
    local mount_point=""

    log_step "Mounting boot partition..."

    # Wait for partitions to appear
    sleep 3

    if [ "$OS" = "macos" ]; then
        # Remount disk
        diskutil mountDisk "$disk" 2>/dev/null || true
        sleep 2

        # Find boot partition (usually named "bootfs" or "boot")
        mount_point=$(df | grep -E "${disk}s1|bootfs" | awk '{print $NF}' | head -1)

        if [ -z "$mount_point" ]; then
            mount_point="/Volumes/bootfs"
            if [ ! -d "$mount_point" ]; then
                mount_point="/Volumes/boot"
            fi
        fi
    else
        # Linux - mount first partition
        local boot_part="${disk}1"
        if [[ "$disk" == *"mmcblk"* ]]; then
            boot_part="${disk}p1"
        fi

        mount_point="/tmp/skyglass_boot"
        mkdir -p "$mount_point"
        sudo mount "$boot_part" "$mount_point"
    fi

    if [ ! -d "$mount_point" ]; then
        log_error "Could not find boot partition mount point"
        exit 1
    fi

    echo "$mount_point"
}

# Configure boot partition for first-boot setup
configure_boot() {
    local boot_mount=$1

    log_step "Configuring first-boot setup..."

    # 1. Enable SSH (create empty ssh file)
    touch "$boot_mount/ssh"
    log_info "SSH enabled"

    # 2. Create userconf.txt for default user (pi:skyglass)
    # Generate password hash
    local pass_hash
    if command -v openssl &> /dev/null; then
        pass_hash=$(echo 'skyglass' | openssl passwd -6 -stdin)
    else
        # Fallback: pre-computed hash for 'skyglass'
        pass_hash='$6$xyz$LzHvwErpk5tLpBQ3l9YOvDlnxVJpX.gfqHKxVLxPFpZGKPQBKMqh3x8r4QZNwwA2W9jcLSPJqRYVMn8UKJZWJ0'
    fi
    echo "pi:${pass_hash}" > "$boot_mount/userconf.txt"
    log_info "Default user: pi / password: skyglass"

    # 3. Copy the SkyGlass release to boot partition
    log_info "Copying SkyGlass release to SD card..."
    if [ -f "$RELEASE_FILE" ]; then
        cp "$RELEASE_FILE" "$boot_mount/skyglass-release.tar.gz"
        log_info "Release copied ($(du -h "$boot_mount/skyglass-release.tar.gz" | cut -f1))"
    else
        log_error "Release file not found! Download failed."
        exit 1
    fi

    # 4. Create the firstrun.sh script
    # This extracts the bundle and runs setup - NO INTERNET REQUIRED
    cat > "$boot_mount/firstrun.sh" << 'FIRSTRUN_SCRIPT'
#!/bin/bash
#
# SkyGlass First Boot Script
# Extracts bundled code and sets up the system - NO INTERNET NEEDED
#

exec > /var/log/skyglass-firstboot.log 2>&1
echo "=== SkyGlass First Boot ==="
echo "Started: $(date)"

set +e

# Set hostname
hostnamectl set-hostname skyglass
echo "skyglass" > /etc/hostname
sed -i 's/raspberrypi/skyglass/g' /etc/hosts

# Enable camera
raspi-config nonint do_camera 0 2>/dev/null || true

# Enable I2C
raspi-config nonint do_i2c 0 2>/dev/null || true

# Get user info
if [ -d "/home/pi" ]; then
    USER_HOME="/home/pi"
    USER_NAME="pi"
else
    USER_NAME=$(ls /home 2>/dev/null | head -1)
    USER_HOME="/home/$USER_NAME"
fi

echo "User: $USER_NAME"
echo "Home: $USER_HOME"

# Find the release on boot partition
RELEASE=""
for path in /boot/skyglass-release.tar.gz /boot/firmware/skyglass-release.tar.gz; do
    if [ -f "$path" ]; then
        RELEASE="$path"
        break
    fi
done

if [ -z "$RELEASE" ]; then
    echo "ERROR: SkyGlass release not found!"
    exit 1
fi

echo "Found release: $RELEASE"

# Extract to user home
echo "Extracting SkyGlass..."
cd "$USER_HOME"
mkdir -p SkyGlass
tar -xzf "$RELEASE" -C SkyGlass
chown -R ${USER_NAME}:${USER_NAME} SkyGlass

# Show version
if [ -f SkyGlass/VERSION ]; then
    echo "Version: $(cat SkyGlass/VERSION)"
fi

echo "Extraction complete!"

# Create the setup service (runs the dependency installation)
cat > /etc/systemd/system/skyglass-setup.service << 'SVCEOF'
[Unit]
Description=SkyGlass Setup
# setup-pi.sh runs apt-get update and npm install, so wait for the network
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/var/lib/skyglass-setup-done

[Service]
Type=oneshot
ExecStart=/usr/local/bin/skyglass-setup.sh
RemainAfterExit=yes
TimeoutStartSec=3600
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
SVCEOF

# Create the offline-capable setup script
cat > /usr/local/bin/skyglass-setup.sh << SETUPEOF
#!/bin/bash
exec > /var/log/skyglass-setup.log 2>&1
echo "=== SkyGlass Offline Setup ==="
echo "Started: \$(date)"

cd ${USER_HOME}/SkyGlass
chmod +x scripts/setup-pi.sh

# Run setup (works offline - installs from apt, npm caches what it can)
export DEBIAN_FRONTEND=noninteractive
if ! sudo -u ${USER_NAME} bash -c 'export DEBIAN_FRONTEND=noninteractive; cd ~/SkyGlass && ./scripts/setup-pi.sh --yes < /dev/null'; then
    # Not marked done: the service runs again on next boot
    echo "Setup FAILED - will retry on next boot. See /var/log/skyglass-setup.log"
    exit 1
fi

# Mark setup as complete (only reached when setup-pi.sh exited 0)
touch /var/lib/skyglass-setup-done
echo "Setup complete: \$(date)"

# Disable this service
systemctl disable skyglass-setup.service

# Clean up release from boot partition to save space
rm -f /boot/skyglass-release.tar.gz /boot/firmware/skyglass-release.tar.gz

echo "Rebooting..."
sleep 5
reboot
SETUPEOF

chmod +x /usr/local/bin/skyglass-setup.sh

# Enable the service
systemctl daemon-reload
systemctl enable skyglass-setup.service

echo "First boot config complete: $(date)"

# Clean up firstrun script
rm -f /boot/firstrun.sh /boot/firmware/firstrun.sh

# Reboot to run setup
echo "Rebooting to run setup..."
sleep 3
reboot
FIRSTRUN_SCRIPT

    chmod +x "$boot_mount/firstrun.sh"
    log_info "First-run script created"

    # 4. Create skyglass.conf with repo settings
    cat > "$boot_mount/skyglass.conf" << 'CONFIG_EOF'
# SkyGlass Configuration
# Edit this file BEFORE first boot to customize

# GitHub repository URL (change to your fork if needed)
REPO_URL=https://github.com/YOUR_USERNAME/SkyGlass.git

# Branch to use
BRANCH=main
CONFIG_EOF

    log_info "Created skyglass.conf (edit to customize repo URL)"

    # 5. For Raspberry Pi OS Bookworm, also add to cmdline.txt
    if [ -f "$boot_mount/cmdline.txt" ]; then
        # Check if systemd.run is supported
        if ! grep -q "systemd.run=" "$boot_mount/cmdline.txt"; then
            # Add firstrun execution to cmdline
            local cmdline=$(cat "$boot_mount/cmdline.txt")
            echo "${cmdline} systemd.run=/boot/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target" > "$boot_mount/cmdline.txt"
            log_info "Added firstrun to cmdline.txt"
        fi
    fi

    log_info "Boot configuration complete!"
}

# Eject disk safely
eject_disk() {
    local disk=$1

    log_step "Ejecting disk..."

    if [ "$OS" = "macos" ]; then
        diskutil eject "$disk"
    else
        sudo eject "$disk" 2>/dev/null || sudo umount "${disk}"* 2>/dev/null || true
    fi

    log_info "Disk ejected safely"
}

# Main
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║           SkyGlass SD Card Flasher                       ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    # Check for root/sudo
    if [ "$EUID" -ne 0 ] && [ "$OS" = "linux" ]; then
        log_warn "Some operations require sudo. You may be prompted for your password."
    fi

    # Get target disk
    local disk="${1:-}"

    if [ -z "$disk" ]; then
        log_info "No disk specified, searching for SD card..."
        disk=$(find_sd_card)

        if [ -z "$disk" ]; then
            log_error "No SD card found automatically."
            list_disks
            echo "Please specify the disk: $0 /dev/diskX"
            exit 1
        fi
    fi

    # Verify disk exists
    if [ ! -e "$disk" ]; then
        log_error "Disk not found: $disk"
        list_disks
        exit 1
    fi

    # Show disk info
    local disk_size=$(get_disk_size "$disk")
    echo ""
    log_info "Selected disk: $disk"
    log_info "Size: $disk_size"
    echo ""

    # Confirm
    echo -e "${RED}WARNING: This will ERASE ALL DATA on $disk${NC}"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        log_info "Aborted."
        exit 0
    fi

    # Download Raspberry Pi OS image
    local image=$(download_image)

    # Download SkyGlass release from GitHub
    download_release

    # Unmount disk
    unmount_disk "$disk"

    # Flash image
    flash_image "$image" "$disk"

    # Mount boot partition and configure
    local boot_mount=$(mount_boot "$disk")
    log_info "Boot partition mounted at: $boot_mount"

    configure_boot "$boot_mount"

    # Eject
    eject_disk "$disk"

    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                    FLASH COMPLETE!                        ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Insert the SD card into your Raspberry Pi"
    echo ""
    echo "  2. Connect the Pi to power (and optionally Ethernet)"
    echo ""
    echo "  3. Wait 5-10 minutes for first-boot setup"
    echo ""
    echo "  4. The Pi will create a WiFi hotspot: 'SkyGlass-Setup'"
    echo ""
    echo "  5. Connect your phone to complete setup"
    echo ""
    echo "Default credentials (if needed):"
    echo "  User: pi"
    echo "  Password: skyglass"
    echo ""
}

main "$@"
