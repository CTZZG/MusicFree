#!/usr/bin/env bash
# Fake device boundaries verify cleanup and propagation. They are not UI/device proof.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "$HERE/player_continuity.sh"
python3 -I "$HERE/lib/player_continuity_evidence.py" --self-test
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SESSION="$HERE/lib/media_session.py"
pass() { printf 'PASS %s\n' "$1" >> "$OUT/results"; }
fail() { printf 'FAIL %s\n' "$1" >> "$OUT/results"; FAILED=$((FAILED + 1)); }
session() {
    local position=7000
    if [ "$CASE" = moved ] && [ -e "$OUT/reduced" ]; then position=9000; fi
    printf '{"found":true,"state":"PAUSED","title":"E2E Tone C","position":%s}\n' "$position"
}
adb() {
    printf '%s\n' "$*" >> "$OUT/adb.log"
    case "$*" in
        'shell wm user-rotation') if [ "$CASE" = bad_rotation ]; then echo invalid; else echo free; fi ;;
        'shell settings get global '*)
            if [ -e "$OUT/zero-${5}" ]; then echo 0; else echo 1.0; fi ;;
        'shell settings put global '*)
            if [ "$CASE" = restore_failed ] && [ "${6}" = 1.0 ]; then return 1; fi
            if [ "${6}" = 0 ]; then touch "$OUT/zero-${5}"; else rm -f "$OUT/zero-${5}"; fi ;;
        'shell wm user-rotation '*) [ "$CASE" != rotation_command_failed ] ;;
        *) return 1 ;;
    esac
}
python3() {
    if [[ "${2:-}" = */player_continuity_evidence.py ]]; then [ "$CASE" != bad_landscape ];
    else command python3 "$@"; fi
}
recorded_player_flow() {
    echo "$3" >> "$OUT/phases"
    if [ "$3" = reduced ]; then touch "$OUT/reduced"; fi
    if [ "$CASE" = "$3" ]; then fail "$3 boundary"; return 1; fi
}
for CASE in normal default landscape reduced moved bad_rotation bad_landscape restore_failed rotation_command_failed; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/results"; : > "$OUT/adb.log"
    FAILED=0
    result=0; run_player_continuity_checks > "$OUT/test.log" 2>&1 || result=$?
    if [ "$CASE" = normal ]; then
        [ "$result" -eq 0 ] && [ "$(cat "$OUT/phases")" = $'default\nlandscape\nreduced' ] || { cat "$OUT/test.log"; exit 1; }
    else
        [ "$result" -ne 0 ] && [ "$FAILED" -gt 0 ] || { echo "accepted/lost failure $CASE"; exit 1; }
    fi
    if [ "$CASE" != bad_rotation ]; then
        for key in window_animation_scale transition_animation_scale animator_duration_scale; do
            grep -q "^shell settings put global $key 1.0$" "$OUT/adb.log"
        done
        grep -q '^shell wm user-rotation free$' "$OUT/adb.log"
    fi
done
echo 'player continuity orchestration: 9 cases passed; cleanup and parent failure status retained'

# Exercise the real recorder wrapper separately; no real video/device is claimed here.
adb() {
    printf '%s\n' "$*" >> "$OUT/adb.log"
    case "$*" in
        'shell screenrecord '*)
            if [ "$CASE" = bad_pid ]; then echo invalid; else touch "$OUT/alive"; echo 123; fi ;;
        'shell kill -0 123') test -e "$OUT/alive" ;;
        'shell kill -2 123') rm -f "$OUT/alive" ;;
        pull*)
            if [ "$CASE" = pull_failed ]; then return 1; fi
            printf 'stand-in bytes, not video' > "$3" ;;
        *) return 1 ;;
    esac
}
flow() { if [ "$CASE" = flow_failed ]; then fail 'flow'; return 1; fi; pass 'flow'; }
ffprobe() { if [ "$CASE" = probe_failed ]; then return 1; fi; echo '{"streams":[{"width":1080,"height":2400}],"format":{"duration":"2"}}'; }
ffmpeg() { [ "$CASE" != decode_failed ]; }
# Remove the observer-boundary override to use the original recorder function.
source "$HERE/player_continuity.sh"
for CASE in normal flow_failed bad_pid pull_failed probe_failed decode_failed; do
    OUT="$WORK/record-$CASE"; mkdir -p "$OUT"; : > "$OUT/results"; : > "$OUT/adb.log"
    FAILED=0
    result=0; recorded_player_flow 'actual wrapper' arbitrary.yaml sample > "$OUT/test.log" 2>&1 || result=$?
    if [ "$CASE" = normal ]; then
        [ "$result" -eq 0 ] && grep -q '^PASS 录屏：sample' "$OUT/results"
    else
        [ "$result" -ne 0 ] && ! grep -q '^PASS 录屏：sample' "$OUT/results" || exit 1
    fi
    if [ "$CASE" != bad_pid ]; then grep -q '^shell kill -2 123$' "$OUT/adb.log"; fi
done
echo 'player recorder boundary: 6 cases passed; flow/pull/probe/decode failures not accepted'
