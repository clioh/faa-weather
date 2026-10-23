#!/bin/bash
#
# SkyGlass Bill of Materials PDF
# Renders docs/build-guide/bom.html to docs/build-guide/SkyGlass-Bill-of-Materials.pdf
# with headless Chrome. Needs network access for the Inter / JetBrains Mono web fonts.
#
# Usage:
#   ./scripts/build-bom-pdf.sh            # write the PDF next to the source
#   ./scripts/build-bom-pdf.sh out.pdf    # write it somewhere else

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/build-guide/bom.html"
OUT="${1:-$ROOT/docs/build-guide/SkyGlass-Bill-of-Materials.pdf}"

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
    for candidate in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium" \
        google-chrome google-chrome-stable chromium chromium-browser; do
        if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
            CHROME="$candidate"
            break
        fi
    done
fi
if [ -z "$CHROME" ]; then
    echo "Chrome or Chromium not found; set CHROME=/path/to/chrome" >&2
    exit 1
fi

"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=15000 \
    --print-to-pdf="$OUT" "file://$SRC" 2>/dev/null

echo "Wrote $OUT"
