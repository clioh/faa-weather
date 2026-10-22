#!/bin/bash
#
# SkyGlass kit license provisioning (docs/LICENSING.md, "Fulfilment").
#
# Assigns a key to an unkeyed kit license through the admin API and writes it
# to skyglass-license.txt on a flashed SD card's boot partition. The mirror
# activates it on the first boot that has network.
#
# Usage:
#   ADMIN_PASSWORD=… ./scripts/provision-sd.sh <licenseId> [bootVolume] [--force] [--rekey]
#
#   licenseId   License uuid (find it with GET /api/admin/licenses?orderId=pi_…)
#   bootVolume  Mounted boot partition (default: /Volumes/bootfs on macOS)
#   --force     Overwrite an existing skyglass-license.txt
#   --rekey     The license already has a key that never reached a card (e.g. the
#               previous run lost the response): replace it with a new key. Only
#               for licenses that are still pending; the old key stops working.
#
# Environment:
#   ADMIN_PASSWORD  Required. Same value as on Vercel.
#   SKYGLASS_SITE   Default https://www.skyglass.dev
#
# The plaintext key is returned only once. If writing the card fails after the
# key was issued, the key is printed so it can be written by hand. If the
# request times out or the response is lost, run again with --rekey.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() { echo -e "${RED}Error:${NC} $*" >&2; exit 1; }

FORCE=0
REKEY=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --rekey) REKEY=1 ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $arg" ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

LICENSE_ID="${POSITIONAL[0]:-}"
if [ "$(uname)" = "Darwin" ]; then DEFAULT_VOLUME="/Volumes/bootfs"; else DEFAULT_VOLUME=""; fi
BOOT_VOLUME="${POSITIONAL[1]:-$DEFAULT_VOLUME}"
SITE="${SKYGLASS_SITE:-https://www.skyglass.dev}"
SITE="${SITE%/}"

[ -n "$LICENSE_ID" ] || die "Usage: $0 <licenseId> [bootVolume] [--force] [--rekey]"
[[ "$LICENSE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || die "licenseId must be a uuid: $LICENSE_ID"
[ -n "${ADMIN_PASSWORD:-}" ] || die "ADMIN_PASSWORD is not set"
[ -n "$BOOT_VOLUME" ] || die "Pass the mounted boot partition, e.g. /media/\$USER/bootfs"
command -v curl >/dev/null || die "curl is required"
command -v node >/dev/null || die "node is required"

# Check the card before issuing a key: a key is only ever returned once.
[ -d "$BOOT_VOLUME" ] || die "Boot volume not found: $BOOT_VOLUME (is the SD card mounted?)"
[ -f "$BOOT_VOLUME/config.txt" ] || [ -f "$BOOT_VOLUME/cmdline.txt" ] \
  || die "$BOOT_VOLUME doesn't look like a Raspberry Pi boot partition (no config.txt or cmdline.txt)"
[ -w "$BOOT_VOLUME" ] || die "Boot volume is not writable: $BOOT_VOLUME"

KEY_FILE="$BOOT_VOLUME/skyglass-license.txt"
if [ -e "$KEY_FILE" ] && [ "$FORCE" -ne 1 ]; then
  die "$KEY_FILE already exists. Use --force to overwrite it."
fi

if [ "$REKEY" -eq 1 ]; then
  echo "Rekeying license $LICENSE_ID via $SITE (any previous key stops working) ..."
  BODY="{\"action\":\"provision\",\"licenseId\":\"$LICENSE_ID\",\"rekey\":true}"
else
  echo "Provisioning license $LICENSE_ID via $SITE ..."
  BODY="{\"action\":\"provision\",\"licenseId\":\"$LICENSE_ID\"}"
fi
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

# The Authorization header is read from stdin so the password stays out of `ps`.
HTTP_STATUS="$(printf 'Authorization: Bearer %s\n' "$ADMIN_PASSWORD" | curl -sS \
  --connect-timeout 10 --max-time 30 \
  -o "$RESPONSE_FILE" -w '%{http_code}' \
  -X POST "$SITE/api/admin/licenses" \
  -H @- \
  -H 'Content-Type: application/json' \
  --data "$BODY")" \
  || die "Request to $SITE failed or timed out. If the key may have been issued, run again with --rekey."

json_field() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1" < "$RESPONSE_FILE"
}

if [ "$HTTP_STATUS" != "200" ]; then
  MESSAGE="$(json_field error)"
  if [ "$(json_field status)" = "already_keyed" ]; then
    MESSAGE="$MESSAGE (if that key never reached a card, run again with --rekey)"
  fi
  die "Provision failed (HTTP $HTTP_STATUS): ${MESSAGE:-$(cat "$RESPONSE_FILE")}"
fi

LICENSE_KEY="$(json_field licenseKey)"
[[ "$LICENSE_KEY" =~ ^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$ ]] \
  || die "Unexpected response: $(cat "$RESPONSE_FILE")"

if ! printf '%s\n' "$LICENSE_KEY" > "$KEY_FILE"; then
  echo -e "${YELLOW}Could not write $KEY_FILE. The key was issued; write it by hand:${NC}" >&2
  echo "$LICENSE_KEY" >&2
  exit 1
fi
sync

echo -e "${GREEN}Wrote license ending ${LICENSE_KEY: -4} to $KEY_FILE${NC}"
if [ "$(uname)" = "Darwin" ]; then
  echo "Eject the card with: diskutil eject \"$BOOT_VOLUME\""
fi
