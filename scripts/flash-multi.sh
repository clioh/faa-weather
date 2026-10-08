#!/bin/bash
#
# SkyGlass Multi-Card Flasher
#
# Flash multiple SD cards simultaneously for production.
# Designed for use with USB SD card docks/hubs.
#
# Usage:
#   ./scripts/flash-multi.sh [--verify] [--eject]
#
# Options:
#   --verify    Verify each card after flashing
#   --eject     Auto-eject cards when complete
#   --image     Path to custom image (optional)
#
# Requirements:
#   - macOS or Linux
#   - Multiple SD cards in USB readers/dock
#   - Internet connection (first run, to download OS image)
#

set -e

# Colors and formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

# Status symbols
SYMBOL_PENDING="○"
SYMBOL_WORKING="◐"
SYMBOL_SUCCESS="●"
SYMBOL_FAILED="✗"
SYMBOL_VERIFIED="✓"

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOWNLOAD_DIR="$PROJECT_DIR/.cache"
LOG_DIR="$PROJECT_DIR/.cache/flash-logs"
PI_OS_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
PI_OS_IMAGE="raspios-bookworm-arm64-lite.img"

# Options
VERIFY_AFTER_FLASH=false
AUTO_EJECT=false
CUSTOM_IMAGE=""

# Track card states
declare -A CARD_STATUS  # pending, flashing, configuring, verifying, complete, failed
declare -A CARD_START_TIME
declare -A CARD_ERROR

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        *)       echo "unknown" ;;
    esac
}

OS=$(detect_os)

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --verify)
                VERIFY_AFTER_FLASH=true
                shift
                ;;
            --eject)
                AUTO_EJECT=true
                shift
                ;;
            --image)
                CUSTOM_IMAGE="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# Find all external disks (SD cards)
find_all_sd_cards() {
    local disks=()

    if [ "$OS" = "macos" ]; then
        # Find all external physical disks
        while IFS= read -r line; do
            if [[ "$line" =~ ^/dev/disk[0-9]+ ]]; then
                local disk=$(echo "$line" | awk '{print $1}')
                # Verify it's external and physical
                if diskutil info "$disk" 2>/dev/null | grep -q "External"; then
                    disks+=("$disk")
                fi
            fi
        done < <(diskutil list external physical 2>/dev/null)
    else
        # Linux: find removable disks
        while IFS= read -r line; do
            local name=$(echo "$line" | awk '{print $1}')
            local removable=$(echo "$line" | awk '{print $2}')
            if [ "$removable" = "1" ]; then
                disks+=("/dev/$name")
            fi
        done < <(lsblk -d -o NAME,RM,TYPE | grep disk | grep -v "loop")
    fi

    echo "${disks[@]}"
}

# Get disk info
get_disk_info() {
    local disk=$1

    if [ "$OS" = "macos" ]; then
        local size=$(diskutil info "$disk" 2>/dev/null | grep "Disk Size" | awk -F'[()]' '{print $2}' | awk '{print $1, $2}')
        local model=$(diskutil info "$disk" 2>/dev/null | grep "Device / Media Name" | cut -d: -f2 | xargs)
        echo "${size:-Unknown} - ${model:-Unknown}"
    else
        local size=$(lsblk -d -o SIZE "$disk" 2>/dev/null | tail -1)
        local model=$(lsblk -d -o MODEL "$disk" 2>/dev/null | tail -1)
        echo "${size:-Unknown} - ${model:-Unknown}"
    fi
}

# Unmount disk
unmount_disk() {
    local disk=$1

    if [ "$OS" = "macos" ]; then
        diskutil unmountDisk force "$disk" &>/dev/null || true
    else
        for part in ${disk}*; do
            umount "$part" &>/dev/null || true
        done
    fi
}

# Get raw device for faster writes
get_raw_device() {
    local disk=$1
    if [ "$OS" = "macos" ]; then
        echo "${disk/disk/rdisk}"
    else
        echo "$disk"
    fi
}

# Download image if needed
download_image() {
    mkdir -p "$DOWNLOAD_DIR"
    local img_file="$DOWNLOAD_DIR/$PI_OS_IMAGE"

    if [ -n "$CUSTOM_IMAGE" ] && [ -f "$CUSTOM_IMAGE" ]; then
        echo "$CUSTOM_IMAGE"
        return
    fi

    if [ -f "$img_file" ]; then
        echo "$img_file"
        return
    fi

    echo "Downloading Raspberry Pi OS..." >&2
    local xz_file="$DOWNLOAD_DIR/$(basename "$PI_OS_URL")"

    curl -L -o "$xz_file" "$PI_OS_URL" --progress-bar >&2

    echo "Extracting..." >&2
    xz -d -k "$xz_file"
    mv "${xz_file%.xz}" "$img_file"
    rm -f "$xz_file"

    echo "$img_file"
}

# Flash a single card (runs in background)
flash_card() {
    local disk=$1
    local image=$2
    local card_id=$3
    local log_file="$LOG_DIR/card-${card_id}.log"

    exec > "$log_file" 2>&1

    echo "=== Flashing $disk ==="
    echo "Started: $(date)"
    echo "Image: $image"

    # Unmount
    echo "Unmounting..."
    unmount_disk "$disk"
    sleep 1

    # Flash
    echo "Flashing..."
    local raw_disk=$(get_raw_device "$disk")

    if [ "$OS" = "macos" ]; then
        dd if="$image" of="$raw_disk" bs=4m 2>&1
    else
        dd if="$image" of="$raw_disk" bs=4M status=progress conv=fsync 2>&1
    fi

    sync
    echo "Flash complete!"

    # Wait for partitions
    sleep 3

    # Remount
    if [ "$OS" = "macos" ]; then
        diskutil mountDisk "$disk" &>/dev/null || true
        sleep 2
    fi

    echo "Completed: $(date)"
}

# Configure boot partition
configure_card() {
    local disk=$1
    local card_id=$2
    local log_file="$LOG_DIR/card-${card_id}-config.log"

    exec > "$log_file" 2>&1

    echo "=== Configuring $disk ==="

    # Find boot partition mount
    local boot_mount=""

    if [ "$OS" = "macos" ]; then
        # Look for bootfs or boot volume
        for vol in /Volumes/bootfs /Volumes/boot; do
            if [ -d "$vol" ]; then
                boot_mount="$vol"
                break
            fi
        done

        # Try mounting
        if [ -z "$boot_mount" ]; then
            diskutil mountDisk "$disk" &>/dev/null || true
            sleep 2
            for vol in /Volumes/bootfs /Volumes/boot; do
                if [ -d "$vol" ]; then
                    boot_mount="$vol"
                    break
                fi
            done
        fi
    else
        boot_mount="/tmp/mm-boot-$card_id"
        mkdir -p "$boot_mount"
        local boot_part="${disk}1"
        [[ "$disk" == *"mmcblk"* ]] && boot_part="${disk}p1"
        mount "$boot_part" "$boot_mount" 2>/dev/null || true
    fi

    if [ -z "$boot_mount" ] || [ ! -d "$boot_mount" ]; then
        echo "ERROR: Could not mount boot partition"
        return 1
    fi

    echo "Boot partition: $boot_mount"

    # Enable SSH
    touch "$boot_mount/ssh"

    # Create user config
    local pass_hash='$6$rounds=656000$saltsalt$FakeHashForNow'
    if command -v openssl &> /dev/null; then
        pass_hash=$(echo 'skyglass' | openssl passwd -6 -stdin 2>/dev/null) || true
    fi
    echo "pi:${pass_hash}" > "$boot_mount/userconf.txt"

    # Copy firstrun script from project
    if [ -f "$SCRIPT_DIR/firstboot/firstrun.sh" ]; then
        cp "$SCRIPT_DIR/firstboot/firstrun.sh" "$boot_mount/firstrun.sh"
        chmod +x "$boot_mount/firstrun.sh"
    else
        # Create inline
        cat > "$boot_mount/firstrun.sh" << 'EOF'
#!/bin/bash
hostnamectl set-hostname skyglass
raspi-config nonint do_camera 0 || true
cat > /etc/systemd/system/sg-setup.service << 'SVC'
[Unit]
Description=SkyGlass Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/var/lib/sg-setup-done
[Service]
Type=oneshot
ExecStart=/bin/bash -c 'apt-get update && apt-get install -y git && cd /home/pi && git clone https://github.com/YOUR_USER/SkyGlass.git && cd SkyGlass && yes | ./scripts/setup-pi.sh && touch /var/lib/sg-setup-done && reboot'
RemainAfterExit=yes
TimeoutStartSec=3600
[Install]
WantedBy=multi-user.target
SVC
systemctl enable sg-setup.service
rm -f /boot/firstrun.sh /boot/firmware/firstrun.sh
reboot
EOF
        chmod +x "$boot_mount/firstrun.sh"
    fi

    # Copy skyglass.conf
    cat > "$boot_mount/skyglass.conf" << 'EOF'
REPO_URL=https://github.com/YOUR_USER/SkyGlass.git
BRANCH=main
EOF

    # Update cmdline.txt for Bookworm
    if [ -f "$boot_mount/cmdline.txt" ]; then
        if ! grep -q "systemd.run=" "$boot_mount/cmdline.txt"; then
            local cmdline=$(cat "$boot_mount/cmdline.txt" | tr -d '\n')
            echo "${cmdline} systemd.run=/boot/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target" > "$boot_mount/cmdline.txt"
        fi
    fi

    echo "Configuration complete!"

    # Unmount on Linux
    if [ "$OS" = "linux" ]; then
        umount "$boot_mount" 2>/dev/null || true
    fi

    return 0
}

# Verify card
verify_card() {
    local disk=$1
    local card_id=$2
    local log_file="$LOG_DIR/card-${card_id}-verify.log"

    exec > "$log_file" 2>&1

    echo "=== Verifying $disk ==="

    # Find boot partition
    local boot_mount=""

    if [ "$OS" = "macos" ]; then
        diskutil mountDisk "$disk" &>/dev/null || true
        sleep 2
        for vol in /Volumes/bootfs /Volumes/boot; do
            if [ -d "$vol" ]; then
                boot_mount="$vol"
                break
            fi
        done
    else
        boot_mount="/tmp/mm-verify-$card_id"
        mkdir -p "$boot_mount"
        local boot_part="${disk}1"
        [[ "$disk" == *"mmcblk"* ]] && boot_part="${disk}p1"
        mount "$boot_part" "$boot_mount" 2>/dev/null || true
    fi

    if [ -z "$boot_mount" ] || [ ! -d "$boot_mount" ]; then
        echo "ERROR: Could not mount boot partition"
        return 1
    fi

    # Check required files
    local errors=0

    for file in ssh userconf.txt firstrun.sh skyglass.conf; do
        if [ -f "$boot_mount/$file" ]; then
            echo "✓ $file exists"
        else
            echo "✗ $file MISSING"
            ((errors++))
        fi
    done

    # Check cmdline.txt has our additions
    if grep -q "systemd.run=" "$boot_mount/cmdline.txt" 2>/dev/null; then
        echo "✓ cmdline.txt configured"
    else
        echo "✗ cmdline.txt not configured"
        ((errors++))
    fi

    # Unmount on Linux
    if [ "$OS" = "linux" ]; then
        umount "$boot_mount" 2>/dev/null || true
    fi

    if [ $errors -gt 0 ]; then
        echo "Verification FAILED: $errors errors"
        return 1
    fi

    echo "Verification PASSED"
    return 0
}

# Eject card
eject_card() {
    local disk=$1

    if [ "$OS" = "macos" ]; then
        diskutil eject "$disk" &>/dev/null || true
    else
        eject "$disk" &>/dev/null || umount "${disk}"* &>/dev/null || true
    fi
}

# Update display
update_display() {
    # Clear screen and move to top
    echo -ne "\033[H\033[J"

    echo ""
    echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║         SkyGlass Multi-Card Flasher                           ║${NC}"
    echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Show options
    echo -e "Options: Verify=${VERIFY_AFTER_FLASH} | Auto-Eject=${AUTO_EJECT}"
    echo ""

    # Show each card's status
    echo -e "${BOLD}Cards:${NC}"
    echo "─────────────────────────────────────────────────────────────────"

    for disk in "${!CARD_STATUS[@]}"; do
        local status="${CARD_STATUS[$disk]}"
        local info=$(get_disk_info "$disk" 2>/dev/null)
        local symbol=""
        local color=""

        case "$status" in
            pending)
                symbol="$SYMBOL_PENDING"
                color="$WHITE"
                ;;
            flashing)
                symbol="$SYMBOL_WORKING"
                color="$YELLOW"
                ;;
            configuring)
                symbol="$SYMBOL_WORKING"
                color="$CYAN"
                ;;
            verifying)
                symbol="$SYMBOL_WORKING"
                color="$MAGENTA"
                ;;
            complete)
                symbol="$SYMBOL_SUCCESS"
                color="$GREEN"
                ;;
            verified)
                symbol="$SYMBOL_VERIFIED"
                color="$GREEN"
                ;;
            failed)
                symbol="$SYMBOL_FAILED"
                color="$RED"
                ;;
        esac

        # Calculate elapsed time
        local elapsed=""
        if [ -n "${CARD_START_TIME[$disk]}" ]; then
            local start=${CARD_START_TIME[$disk]}
            local now=$(date +%s)
            local secs=$((now - start))
            elapsed=" (${secs}s)"
        fi

        echo -e "  ${color}${symbol}${NC}  ${disk}  ${status}${elapsed}"
        echo -e "      ${info}"

        if [ -n "${CARD_ERROR[$disk]}" ]; then
            echo -e "      ${RED}Error: ${CARD_ERROR[$disk]}${NC}"
        fi

        echo ""
    done

    echo "─────────────────────────────────────────────────────────────────"
}

# Process a single card through all stages
process_card() {
    local disk=$1
    local image=$2
    local card_id=$3

    CARD_START_TIME[$disk]=$(date +%s)

    # Flash
    CARD_STATUS[$disk]="flashing"
    if flash_card "$disk" "$image" "$card_id"; then
        # Configure
        CARD_STATUS[$disk]="configuring"
        if configure_card "$disk" "$card_id"; then
            # Verify if requested
            if [ "$VERIFY_AFTER_FLASH" = true ]; then
                CARD_STATUS[$disk]="verifying"
                if verify_card "$disk" "$card_id"; then
                    CARD_STATUS[$disk]="verified"
                else
                    CARD_STATUS[$disk]="failed"
                    CARD_ERROR[$disk]="Verification failed"
                fi
            else
                CARD_STATUS[$disk]="complete"
            fi

            # Eject if requested
            if [ "$AUTO_EJECT" = true ] && [[ "${CARD_STATUS[$disk]}" =~ ^(complete|verified)$ ]]; then
                eject_card "$disk"
            fi
        else
            CARD_STATUS[$disk]="failed"
            CARD_ERROR[$disk]="Configuration failed"
        fi
    else
        CARD_STATUS[$disk]="failed"
        CARD_ERROR[$disk]="Flash failed"
    fi
}

# Main
main() {
    parse_args "$@"

    # Setup
    mkdir -p "$LOG_DIR"

    if [ "$OS" = "unknown" ]; then
        echo "Unsupported operating system"
        exit 1
    fi

    echo "Scanning for SD cards..."

    # Find all cards
    local cards_str=$(find_all_sd_cards)
    local cards=($cards_str)

    if [ ${#cards[@]} -eq 0 ]; then
        echo "No SD cards found!"
        echo ""
        echo "Make sure your SD cards are inserted in USB readers and connected."
        exit 1
    fi

    echo "Found ${#cards[@]} card(s):"
    for disk in "${cards[@]}"; do
        local info=$(get_disk_info "$disk")
        echo "  - $disk: $info"
        CARD_STATUS[$disk]="pending"
    done

    echo ""
    echo -e "${RED}WARNING: This will ERASE ALL DATA on ALL detected cards!${NC}"
    echo ""
    read -p "Type 'FLASH' to confirm: " confirm

    if [ "$confirm" != "FLASH" ]; then
        echo "Aborted."
        exit 0
    fi

    # Download image
    echo ""
    echo "Preparing image..."
    local image=$(download_image)
    echo "Image ready: $image"
    echo ""

    # Start flashing all cards in parallel
    echo "Starting flash operations..."

    local pids=()
    local card_id=0

    for disk in "${cards[@]}"; do
        ((card_id++))
        process_card "$disk" "$image" "$card_id" &
        pids+=($!)
    done

    # Monitor progress
    while true; do
        local all_done=true

        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                all_done=false
            fi
        done

        update_display

        if [ "$all_done" = true ]; then
            break
        fi

        sleep 2
    done

    # Final summary
    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo ""

    local success=0
    local failed=0

    for disk in "${!CARD_STATUS[@]}"; do
        case "${CARD_STATUS[$disk]}" in
            complete|verified)
                ((success++))
                ;;
            failed)
                ((failed++))
                ;;
        esac
    done

    echo -e "Results: ${GREEN}${success} successful${NC}, ${RED}${failed} failed${NC}"
    echo ""

    if [ $success -gt 0 ]; then
        echo "Successfully flashed cards are ready!"
        if [ "$AUTO_EJECT" = true ]; then
            echo "Cards have been ejected - safe to remove."
        else
            echo "Eject the cards before removing."
        fi
    fi

    echo ""
    echo "Logs saved to: $LOG_DIR"
    echo ""
}

main "$@"
