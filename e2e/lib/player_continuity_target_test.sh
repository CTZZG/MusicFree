#!/usr/bin/env bash
# Real orchestration with a synthetic public-UI boundary, not a device result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "${CONTINUITY_SOURCE:-$HERE/player_continuity.sh}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
pass() { echo "$1" >> "$OUT/passed"; }
sleep() { :; }
shot() { printf 'shot %s\n' "$1" >> "$OUT/events"; }
public_ui_target() {
    local label=$1 tag=$2
    printf 'snapshot %s\n' "$tag" >> "$OUT/events"
    if [[ "$tag" = *-tap-* ]] && [ "$CASE" = snapshot_failed ]; then return 1; fi
    if [ "$label" = '更多操作' ] && [ "$SCREEN" != player ]; then return 1; fi
    if [[ "$tag" = *-returned-* ]]; then
        # Beta240's actual transient mini center. After the render/screenshot,
        # this becomes the search tab, while the mini center moves to 2059.
        printf '404 2237\n' > "$OUT/ui-$tag-point.txt"
    elif [ "$label" = '更多操作' ]; then
        printf '896 1324\n' > "$OUT/ui-$tag-point.txt"
    else
        printf '404 2059\n' > "$OUT/ui-$tag-point.txt"
    fi
}
adb() {
    printf 'input %s\n' "$*" >> "$OUT/events"
    case "$*" in
        'shell input tap 404 2059') SCREEN=player ;;
        'shell input tap 404 2237') SCREEN=search ;;
        'shell input keyevent KEYCODE_BACK') SCREEN=mini ;;
        *) return 1 ;;
    esac
}
for CASE in moving_mini snapshot_failed; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/events"
    SCREEN=mini
    result=0
    player_observation_ui_flow 'actual flow' continuity-default.yaml || result=$?
    if [ "$CASE" = moving_mini ]; then
        [ "$result" -eq 0 ] || { cat "$OUT/events"; exit 1; }
        [ "$(grep -c '^input shell input tap 404 2059$' "$OUT/events")" -eq 2 ]
        ! grep -q '^input shell input tap 404 2237$' "$OUT/events"
        # Keep the observation and input snapshots separate and immutable.
        [ "$(cat "$OUT/ui-default-before-point.txt")" = '404 2059' ]
        [ "$(cat "$OUT/ui-default-returned-1-point.txt")" = '404 2237' ]
        python3 - "$OUT/events" <<'PY'
from pathlib import Path
import sys
lines = Path(sys.argv[1]).read_text().splitlines()
for i, line in enumerate(lines):
    if line.startswith('input shell input tap '):
        assert lines[i-1].startswith('snapshot default-tap-'), lines
PY
    else
        [ "$result" -ne 0 ] && ! grep -q '^input ' "$OUT/events"
    fi
done
echo 'player target orchestration: 2 cases passed; moved target refreshed, failed snapshot never tapped'
