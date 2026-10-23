# shellcheck shell=bash
#
# Shared helpers for the per-unit files on a SkyGlass card's boot partition
# (sourced by scripts/flash-sd.sh and scripts/provision-sd.sh; bash 3.2 safe,
# because macOS still ships it as /bin/bash).
#
# The mirror reads, from /boot/firmware on the Pi:
#   skyglass-license.txt      pre-flashed license key (packages/backend/src/license/manager.ts,
#                             activated on the first boot that has network; docs/LICENSING.md)
#   skyglass-orientation.txt  landscape | portrait-cw | portrait-ccw, used until config.yaml
#                             sets display.orientation (packages/backend/src/config/index.ts,
#                             packages/presence/rotation.py)
#
# Every function prints only its value on stdout (callers capture it);
# messages go to stderr.

SD_LICENSE_FILE_NAME="skyglass-license.txt"
SD_ORIENTATION_FILE_NAME="skyglass-orientation.txt"
SD_ORIENTATIONS="landscape portrait-cw portrait-ccw"

# sd_boot_volume_problem <dir>: prints why <dir> can't take the per-unit
# files and fails, or prints nothing and succeeds.
sd_boot_volume_problem() {
    local dir="$1"
    if [ ! -d "$dir" ]; then
        echo "Boot volume not found: $dir (is the SD card mounted?)"
        return 1
    fi
    if [ ! -f "$dir/config.txt" ] && [ ! -f "$dir/cmdline.txt" ]; then
        echo "$dir doesn't look like a Raspberry Pi boot partition (no config.txt or cmdline.txt)"
        return 1
    fi
    if [ ! -w "$dir" ]; then
        echo "Boot volume is not writable: $dir"
        return 1
    fi
    return 0
}

# sd_normalize_license_key <text>: the key as XXXX-XXXX-XXXX-XXXX, or fails.
# Same rule as normalizeLicenseKey() in packages/backend/src/license/key.ts:
# spaces and dashes are ignored, letters are upper-cased, and the alphabet
# has no I, O, 0 or 1.
sd_normalize_license_key() {
    local compact key
    compact="$(printf '%s' "$1" | tr -d ' \t\r\n-' | tr '[:lower:]' '[:upper:]')"
    [ "${#compact}" -eq 16 ] || return 1
    key="${compact:0:4}-${compact:4:4}-${compact:8:4}-${compact:12:4}"
    [[ "$key" =~ ^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$ ]] || return 1
    printf '%s\n' "$key"
}

# sd_read_license_key_file <file>: the normalized key from the first
# non-empty line of <file>, or fails.
sd_read_license_key_file() {
    local line
    [ -r "$1" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        line="$(printf '%s' "$line" | tr -d ' \t\r')"
        [ -n "$line" ] || continue
        sd_normalize_license_key "$line"
        return
    done < "$1"
    return 1
}

# sd_valid_orientation <value>
sd_valid_orientation() {
    local o
    for o in $SD_ORIENTATIONS; do
        [ "$1" = "$o" ] && return 0
    done
    return 1
}
