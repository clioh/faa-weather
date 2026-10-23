#!/bin/bash
#
# SkyGlass kit card writer (macOS and Linux). docs/KIT_CARDS.md has the whole
# process; in short:
#
#   1. On a reference Pi: scripts/setup-pi.sh --yes, then
#      sudo scripts/prepare-image.sh --yes   (wipes per-unit state, powers off)
#   2. Capture that card once:
#      ./scripts/flash-sd.sh --capture --device <disk> --out skyglass-golden.img
#      -> skyglass-golden.img.xz + skyglass-golden.img.xz.sha256
#   3. For every kit:
#      ./scripts/flash-sd.sh --image skyglass-golden.img.xz --device <disk> \
#          [--license-key KEY | --license-key-file FILE | --license-id UUID] \
#          [--orientation landscape|portrait-cw|portrait-ccw] [--yes]
#
# Cards are clones of a finished install, so they work offline on first boot
# (SkyGlass-Setup hotspot); nothing is downloaded or installed on the card.
# This script never touches cmdline.txt and adds no first-boot script: the
# per-unit files it writes to the boot partition are only the ones the mirror
# already reads (lib/sd-card.sh).
#
# Options:
#   --image FILE          Golden image (.img, .img.xz or .img.gz). Checked against
#                         FILE.sha256 when that file exists.
#   --device DISK         The card: /dev/disk4 (macOS), /dev/sdb or /dev/mmcblk0 (Linux).
#                         Must be a removable, non-system disk.
#   --license-key KEY     Write KEY to skyglass-license.txt.
#   --license-key-file F  Same, key read from the first line of F.
#   --license-id UUID     Issue a key for that kit license through the admin API
#                         (scripts/provision-sd.sh; needs ADMIN_PASSWORD) and write it.
#   --orientation O       Write skyglass-orientation.txt (landscape, portrait-cw,
#                         portrait-ccw): the first setup screen is the right way up.
#   --capture             Read the card into --out instead of writing it, then
#                         compress it (xz -T0) and write OUT.xz.sha256.
#   --out FILE            Capture destination (e.g. skyglass-golden.img).
#   --yes                 Don't ask before erasing / reading the card.
#   --dry-run             Print every command that would change something instead
#                         of running it (read-only checks still run).
#   -h, --help
#
# Requires root for dd/mount; the script uses sudo for those when not root.
# Every message goes to stderr.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/sd-card.sh
. "$SCRIPT_DIR/lib/sd-card.sh"

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

usage() { sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//' >&2; }

# ------------------------------------------------------------ arguments

IMAGE=""
DEVICE=""
LICENSE_KEY=""
LICENSE_KEY_FILE=""
LICENSE_ID=""
ORIENTATION=""
CAPTURE=false
OUT=""
ASSUME_YES=false
DRY_RUN=false

need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }

while [ "$#" -gt 0 ]; do
    case "$1" in
        --image) need_value "$@"; IMAGE="$2"; shift 2 ;;
        --device) need_value "$@"; DEVICE="$2"; shift 2 ;;
        --license-key) need_value "$@"; LICENSE_KEY="$2"; shift 2 ;;
        --license-key-file) need_value "$@"; LICENSE_KEY_FILE="$2"; shift 2 ;;
        --license-id) need_value "$@"; LICENSE_ID="$2"; shift 2 ;;
        --orientation) need_value "$@"; ORIENTATION="$2"; shift 2 ;;
        --capture) CAPTURE=true; shift ;;
        --out) need_value "$@"; OUT="$2"; shift 2 ;;
        -y|--yes) ASSUME_YES=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; die "Unknown argument: $1" ;;
    esac
done

# SKYGLASS_FLASH_OS lets the tests run the macOS path on Linux and back.
case "${SKYGLASS_FLASH_OS:-$(uname -s)}" in
    Darwin|macos) OS=macos ;;
    Linux|linux) OS=linux ;;
    *) die "Unsupported operating system: $(uname -s)" ;;
esac

[ -n "$DEVICE" ] || { usage; die "--device is required"; }

if [ "$CAPTURE" = true ]; then
    [ -n "$OUT" ] || die "--capture needs --out (e.g. --out skyglass-golden.img)"
    [ -z "$IMAGE" ] || die "--capture reads the card; don't pass --image"
    [ -z "$LICENSE_KEY$LICENSE_KEY_FILE$LICENSE_ID$ORIENTATION" ] \
        || die "--capture takes no license or orientation: a golden image has no per-unit files"
    OUT="${OUT%.xz}"
    [ ! -e "$OUT" ] && [ ! -e "$OUT.xz" ] || die "$OUT or $OUT.xz already exists"
    command -v xz > /dev/null || die "xz is required to compress the image"
else
    [ -n "$IMAGE" ] || { usage; die "--image is required (or --capture)"; }
    [ -f "$IMAGE" ] || die "Image not found: $IMAGE"
    [ -z "$OUT" ] || die "--out is only for --capture"
fi

# At most one license source, checked before anything is written
license_sources=0
[ -n "$LICENSE_KEY" ] && license_sources=$((license_sources + 1))
[ -n "$LICENSE_KEY_FILE" ] && license_sources=$((license_sources + 1))
[ -n "$LICENSE_ID" ] && license_sources=$((license_sources + 1))
[ "$license_sources" -le 1 ] || die "Pass only one of --license-key, --license-key-file and --license-id"

if [ -n "$LICENSE_KEY" ]; then
    LICENSE_KEY="$(sd_normalize_license_key "$LICENSE_KEY")" \
        || die "Not a SkyGlass license key (XXXX-XXXX-XXXX-XXXX): $LICENSE_KEY"
elif [ -n "$LICENSE_KEY_FILE" ]; then
    [ -r "$LICENSE_KEY_FILE" ] || die "License key file not readable: $LICENSE_KEY_FILE"
    LICENSE_KEY="$(sd_read_license_key_file "$LICENSE_KEY_FILE")" \
        || die "No valid license key (XXXX-XXXX-XXXX-XXXX) on the first line of $LICENSE_KEY_FILE"
elif [ -n "$LICENSE_ID" ]; then
    [ -n "${ADMIN_PASSWORD:-}" ] || die "--license-id needs ADMIN_PASSWORD (see scripts/provision-sd.sh)"
fi
if [ -n "$ORIENTATION" ]; then
    sd_valid_orientation "$ORIENTATION" || die "--orientation must be one of: $SD_ORIENTATIONS"
fi

# ------------------------------------------------------------ running commands

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    command -v sudo > /dev/null || [ "$DRY_RUN" = true ] || die "Run as root (sudo is not available)"
    SUDO="sudo"
fi

# Printable form of a command line
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

# run_priv <cmd...>: run as root
run_priv() {
    if [ -n "$SUDO" ]; then run "$SUDO" "$@"; else run "$@"; fi
}

# ------------------------------------------------------------ the card

# Normalize "disk4" / "/dev/disk4" / "/dev/rdisk4" to /dev/diskN; Linux names as given
DEVICE_NAME="${DEVICE#/dev/}"
if [ "$OS" = macos ]; then
    DEVICE_NAME="${DEVICE_NAME#r}"
    [[ "$DEVICE_NAME" =~ ^disk[0-9]+$ ]] || die "Pass the whole disk, e.g. /dev/disk4 (see: diskutil list external physical)"
else
    [[ "$DEVICE_NAME" =~ ^(sd[a-z]+|mmcblk[0-9]+|nvme[0-9]+n[0-9]+|vd[a-z]+)$ ]] \
        || die "Pass the whole disk, e.g. /dev/sdb or /dev/mmcblk0 (see: lsblk -d -o NAME,SIZE,RM,TRAN,MODEL)"
fi
DEVICE="/dev/$DEVICE_NAME"

# diskutil info field ("Removable Media", "Device Location", ...)
mac_field() {
    printf '%s\n' "$1" | sed -n "s/^ *$2: *//p" | head -n 1
}

# Checks that DEVICE is a removable, non-system card; sets DEVICE_BYTES and DEVICE_DESC
check_device() {
    if [ "$OS" = macos ]; then
        local info root_info root_disk whole removable location protocol virtual name size_line
        info="$(diskutil info "$DEVICE" 2>/dev/null)" || die "diskutil doesn't know $DEVICE (see: diskutil list external physical)"
        whole="$(mac_field "$info" "Whole")"
        removable="$(mac_field "$info" "Removable Media")"
        location="$(mac_field "$info" "Device Location")"
        protocol="$(mac_field "$info" "Protocol")"
        virtual="$(mac_field "$info" "Virtual")"
        name="$(mac_field "$info" "Device \/ Media Name")"
        size_line="$(mac_field "$info" "Disk Size")"
        root_info="$(diskutil info / 2>/dev/null || true)"
        root_disk="$(mac_field "$root_info" "Part of Whole")"

        [ "$whole" = "Yes" ] || die "$DEVICE is a partition or volume; pass the whole card"
        [ "$DEVICE_NAME" != "$root_disk" ] || die "$DEVICE holds the running system"
        [ "$virtual" != "Yes" ] || die "$DEVICE is a virtual disk (APFS container or disk image), not a card"
        # The built-in SD slot is "Internal" but "Removable" over Secure Digital;
        # an internal SSD is "Fixed". USB card readers are External + Removable.
        [ "$removable" = "Removable" ] || die "$DEVICE is not removable media (Removable Media: ${removable:-unknown}); refusing"
        if [ "$location" = "Internal" ] && [ "$protocol" != "Secure Digital" ]; then
            die "$DEVICE is an internal $protocol disk; refusing"
        fi
        DEVICE_BYTES="$(printf '%s\n' "$size_line" | sed -n 's/.*(\([0-9][0-9]*\) Bytes).*/\1/p')"
        DEVICE_DESC="$DEVICE: ${name:-unknown}, ${size_line%% (*}, $location, $protocol"
    else
        local row rm tran type size model root_src root_disk
        row="$(lsblk -dnbo RM,TRAN,TYPE,SIZE "$DEVICE" 2>/dev/null)" || die "lsblk doesn't know $DEVICE (see: lsblk -d -o NAME,SIZE,RM,TRAN,MODEL)"
        # shellcheck disable=SC2086
        set -- $row
        if [ "$#" -eq 4 ]; then rm="$1" tran="$2" type="$3" size="$4"; else rm="$1" tran="" type="$2" size="$3"; fi
        model="$(lsblk -dno MODEL "$DEVICE" 2>/dev/null | sed 's/ *$//' || true)"
        root_src="$(findmnt -no SOURCE / 2>/dev/null || true)"
        root_disk="$(lsblk -no PKNAME "$root_src" 2>/dev/null | head -n 1 || true)"

        [ "$type" = "disk" ] || die "$DEVICE is a $type, not a whole disk"
        [ "$DEVICE_NAME" != "$root_disk" ] || die "$DEVICE holds the running system"
        case "$tran" in
            sata|nvme|ata|sas|fc|iscsi) die "$DEVICE is an internal $tran disk; refusing" ;;
        esac
        # USB card readers report RM=1; a built-in SD slot (mmcblk, tran mmc
        # or empty) often reports RM=0 but is still a card.
        if [ "$rm" != "1" ] && [[ ! "$DEVICE_NAME" =~ ^mmcblk ]]; then
            die "$DEVICE is not removable (RM=$rm, ${tran:-no transport}); refusing"
        fi
        DEVICE_BYTES="$size"
        DEVICE_DESC="$DEVICE: ${model:-unknown}, $((size / 1000000000)) GB, ${tran:-mmc}"
    fi
    [ -n "$DEVICE_BYTES" ] && [ "$DEVICE_BYTES" -gt 0 ] 2>/dev/null || die "Could not read the size of $DEVICE (no card in the reader?)"
}

# Raw device for dd: /dev/rdiskN on macOS (much faster)
raw_device() {
    if [ "$OS" = macos ]; then printf '/dev/r%s\n' "$DEVICE_NAME"; else printf '%s\n' "$DEVICE"; fi
}

# Device node of partition <n>
partition_device() {
    if [ "$OS" = macos ]; then
        printf '/dev/%ss%s\n' "$DEVICE_NAME" "$1"
    elif [[ "$DEVICE_NAME" =~ [0-9]$ ]]; then
        printf '%sp%s\n' "$DEVICE" "$1"
    else
        printf '%s%s\n' "$DEVICE" "$1"
    fi
}

confirm() {
    [ "$ASSUME_YES" = true ] && return 0
    local reply
    printf '%s ' "$1" >&2
    read -r reply < /dev/tty || return 1
    [ "$reply" = "$2" ]
}

unmount_device() {
    log_info "Unmounting $DEVICE..."
    if [ "$OS" = macos ]; then
        run diskutil unmountDisk "$DEVICE" > /dev/null
    else
        local part mnt
        while read -r part mnt; do
            [ -n "$mnt" ] && run_priv umount "$part"
        done < <(lsblk -lnpo NAME,MOUNTPOINT "$DEVICE" 2>/dev/null | awk 'NF == 2')
    fi
}

# ------------------------------------------------------------ the image

sha256_of() {
    if command -v sha256sum > /dev/null; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

verify_checksum() {
    local sumfile="$IMAGE.sha256" expected actual
    if [ ! -f "$sumfile" ]; then
        log_warn "No $(basename "$sumfile") next to the image: not verified"
        return 0
    fi
    expected="$(awk 'NR == 1 {print tolower($1)}' "$sumfile")"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "$sumfile holds no sha256"
    log_info "Verifying $(basename "$IMAGE") against $(basename "$sumfile")..."
    actual="$(sha256_of "$IMAGE")"
    [ "$actual" = "$expected" ] || die "Checksum mismatch: $IMAGE is $actual, $sumfile says $expected"
    log_info "Checksum OK"
}

# Uncompressed size of the image in bytes (empty when unknown: .gz)
image_bytes() {
    case "$IMAGE" in
        *.xz) { xz --robot --list "$IMAGE" 2>/dev/null || true; } | awk -F'\t' '$1 == "totals" {print $5}' ;;
        *.gz) ;;
        *) wc -c < "$IMAGE" | tr -d ' ' ;;
    esac
}

# Decompressor for the image
image_reader() {
    case "$IMAGE" in
        *.xz) command -v xz > /dev/null || die "xz is required for $IMAGE"; printf 'xz -dc\n' ;;
        *.gz) printf 'gzip -dc\n' ;;
        *.img|*.bin|*.raw) printf 'cat\n' ;;
        *) die "Unknown image type (expected .img, .img.xz or .img.gz): $IMAGE" ;;
    esac
}

# Separate ibs/obs: dd then gathers short reads from the decompressor pipe into
# full 4 MiB writes (BSD dd has no iflag=fullblock, and a raw disk refuses
# writes that aren't whole sectors).
DD_IBS=1048576
DD_OBS=4194304

write_image() {
    local reader raw
    reader="$(image_reader)"
    raw="$(raw_device)"
    local dd_cmd=(dd "of=$raw" "ibs=$DD_IBS" "obs=$DD_OBS")
    # macOS dd before 13 has no status=progress; Ctrl+T prints progress there
    [ "$OS" = linux ] && dd_cmd+=(conv=fsync status=progress)
    [ -n "$SUDO" ] && dd_cmd=("$SUDO" "${dd_cmd[@]}")

    log_step "Writing $(basename "$IMAGE") to $raw (several minutes$([ "$OS" = macos ] && echo '; Ctrl+T shows progress'))..."
    if [ "$DRY_RUN" = true ]; then
        # shellcheck disable=SC2086
        printf 'DRY-RUN: %s | %s\n' "$(quote_cmd $reader "$IMAGE")" "$(quote_cmd "${dd_cmd[@]}")" >&2
    else
        # Ask for the sudo password before the pipe starts
        [ -n "$SUDO" ] && sudo -v
        # shellcheck disable=SC2086
        $reader "$IMAGE" | "${dd_cmd[@]}"
    fi
    run sync
    log_info "Image written"
}

# ------------------------------------------------------------ boot partition

BOOT_MOUNT=""
BOOT_MOUNTED_BY_US=false

mount_boot() {
    local part
    part="$(partition_device 1)"
    if [ "$DRY_RUN" = true ]; then
        if [ "$OS" = macos ]; then
            run diskutil mountDisk "$DEVICE"
            BOOT_MOUNT="/Volumes/bootfs"
        else
            BOOT_MOUNT="/tmp/skyglass-boot.DRYRUN"
            run_priv mount -t vfat -o "uid=$(id -u),gid=$(id -g)" "$part" "$BOOT_MOUNT"
        fi
        return 0
    fi

    if [ "$OS" = macos ]; then
        # The new partition table needs a moment to show up after dd
        local i
        for i in 1 2 3 4 5 6 7 8 9 10; do
            diskutil mountDisk "$DEVICE" > /dev/null 2>&1 || true
            BOOT_MOUNT="$(mac_field "$(diskutil info "$part" 2>/dev/null || true)" "Mount Point")"
            [ -n "$BOOT_MOUNT" ] && [ -d "$BOOT_MOUNT" ] && return 0
            sleep 2
        done
        die "The boot partition ($part) didn't mount; is the image a Raspberry Pi OS image?"
    else
        command -v partprobe > /dev/null && { $SUDO partprobe "$DEVICE" 2>/dev/null || true; }
        local i
        for i in 1 2 3 4 5; do [ -b "$part" ] && break; sleep 1; done
        [ -b "$part" ] || die "Boot partition $part not found after writing"
        BOOT_MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/skyglass-boot.XXXXXX")"
        $SUDO mount -t vfat -o "uid=$(id -u),gid=$(id -g)" "$part" "$BOOT_MOUNT" \
            || die "Could not mount $part"
        BOOT_MOUNTED_BY_US=true
    fi
}

unmount_boot() {
    [ -n "$BOOT_MOUNT" ] || return 0
    run sync
    if [ "$OS" = macos ]; then
        run diskutil eject "$DEVICE" > /dev/null
    else
        if [ "$BOOT_MOUNTED_BY_US" = true ] || [ "$DRY_RUN" = true ]; then
            run_priv umount "$BOOT_MOUNT"
            run rmdir "$BOOT_MOUNT"
        fi
    fi
    BOOT_MOUNT=""
}

# write_boot_file <name> <content>
write_boot_file() {
    local path="$BOOT_MOUNT/$1"
    if [ "$DRY_RUN" = true ]; then
        printf 'DRY-RUN: write %s (%s)\n' "$path" "$3" >&2
        return 0
    fi
    printf '%s\n' "$2" > "$path" || die "Could not write $path"
}

write_unit_files() {
    if [ -z "$LICENSE_KEY$LICENSE_ID$ORIENTATION" ]; then
        log_info "No per-unit files requested (license key or orientation)"
        return 0
    fi
    log_step "Writing per-unit files to the boot partition..."
    mount_boot
    if [ "$DRY_RUN" != true ]; then
        local problem
        problem="$(sd_boot_volume_problem "$BOOT_MOUNT")" || die "$problem"
    fi

    if [ -n "$LICENSE_KEY" ]; then
        write_boot_file "$SD_LICENSE_FILE_NAME" "$LICENSE_KEY" "license ending ${LICENSE_KEY: -4}"
        log_info "License key ending ${LICENSE_KEY: -4} -> $SD_LICENSE_FILE_NAME"
    elif [ -n "$LICENSE_ID" ]; then
        # Issues the key (once) and writes it; see scripts/provision-sd.sh
        run "$SCRIPT_DIR/provision-sd.sh" "$LICENSE_ID" "$BOOT_MOUNT" --force
    fi
    if [ -n "$ORIENTATION" ]; then
        write_boot_file "$SD_ORIENTATION_FILE_NAME" "$ORIENTATION" "$ORIENTATION"
        log_info "Orientation $ORIENTATION -> $SD_ORIENTATION_FILE_NAME"
    fi
    unmount_boot
}

cleanup() {
    if [ "$DRY_RUN" != true ] && [ "$BOOT_MOUNTED_BY_US" = true ] && [ -n "$BOOT_MOUNT" ]; then
        $SUDO umount "$BOOT_MOUNT" 2>/dev/null || true
        rmdir "$BOOT_MOUNT" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# ------------------------------------------------------------ capture

capture() {
    local raw dd_cmd
    raw="$(raw_device)"
    dd_cmd=(dd "if=$raw" "of=$OUT" "bs=$DD_OBS")
    [ "$OS" = linux ] && dd_cmd+=(status=progress)
    [ -n "$SUDO" ] && dd_cmd=("$SUDO" "${dd_cmd[@]}")

    log_step "Reading $DEVICE into $OUT ($((DEVICE_BYTES / 1000000000)) GB)..."
    [ -n "$SUDO" ] && [ "$DRY_RUN" != true ] && sudo -v
    run "${dd_cmd[@]}"
    [ -n "$SUDO" ] && run sudo chown "$(id -u):$(id -g)" "$OUT"

    # The reference card's root partition fills the card. PiShrink (Linux)
    # shrinks it to its contents so smaller cards of the "same" size fit;
    # -s: the image has its own first-boot resize (skyglass-firstboot).
    if command -v pishrink.sh > /dev/null; then
        log_step "Shrinking the image with PiShrink..."
        run_priv pishrink.sh -s "$OUT"
    else
        log_warn "pishrink.sh not found: the image is the full size of this card, and every"
        log_warn "card it is written to must be at least as large (docs/KIT_CARDS.md)."
    fi

    log_step "Compressing (xz -T0)..."
    run xz -T0 -v "$OUT"
    log_step "Writing $(basename "$OUT").xz.sha256..."
    if [ "$DRY_RUN" = true ]; then
        printf 'DRY-RUN: sha256 %s > %s\n' "$OUT.xz" "$OUT.xz.sha256" >&2
    else
        printf '%s  %s\n' "$(sha256_of "$OUT.xz")" "$(basename "$OUT.xz")" > "$OUT.xz.sha256"
    fi
    [ "$OS" = macos ] && run diskutil eject "$DEVICE" > /dev/null
    log_info "Golden image: $OUT.xz (+ .sha256)"
}

# ------------------------------------------------------------ main

main() {
    [ "$DRY_RUN" = true ] && log_info "Dry run: commands that change anything are printed, not run"
    check_device
    printf '\n  %s\n\n' "$DEVICE_DESC" >&2

    if [ "$CAPTURE" = true ]; then
        confirm "Read this card into $OUT? Type the device name ($DEVICE_NAME) to continue:" "$DEVICE_NAME" \
            || die "Cancelled"
        unmount_device
        capture
        return
    fi

    verify_checksum
    local need
    need="$(image_bytes)"
    if [ -n "$need" ] && [ "$need" -gt "$DEVICE_BYTES" ]; then
        die "The image needs $need bytes but $DEVICE has $DEVICE_BYTES. Use a larger card, or shrink the image (docs/KIT_CARDS.md)."
    fi

    printf '  %bEverything on %s will be erased.%b\n\n' "$RED" "$DEVICE" "$NC" >&2
    confirm "Type the device name ($DEVICE_NAME) to erase it and write $(basename "$IMAGE"):" "$DEVICE_NAME" \
        || die "Cancelled"

    unmount_device
    write_image
    write_unit_files
    # write_unit_files ejects when it mounted the card; otherwise eject here
    if [ "$OS" = macos ] && [ -z "$LICENSE_KEY$LICENSE_ID$ORIENTATION" ]; then
        run diskutil eject "$DEVICE" > /dev/null
    fi
    log_info "Done: $DEVICE can be removed."
}

main
