#!/usr/bin/env bash
# Fake device boundaries verify cleanup and propagation. They are not UI/device proof.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "$HERE/player_continuity.sh"
prepare_public_ui_observer() { [ "$CASE" != observer_failed ]; }
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
            if [ -e "$OUT/state-${5}" ]; then cat "$OUT/state-${5}"; else echo "$ORIGINAL_SCALE"; fi ;;
        'shell settings put global '*)
            if [ "$CASE" = restore_failed ] && [ "${6}" = 2.0 ]; then return 1; fi
            if [ "$CASE" = scale_command_ignored ] && [ "${6}" = 1 ]; then return 0; fi
            if [ "$CASE" = reduced_scale_ignored ] && [ "${6}" = 0 ]; then return 0; fi
            printf '%s\n' "${6}" > "$OUT/state-${5}" ;;
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
    if [ "$CASE" = scale_reset_during_flow ] && [ "$3" = default ]; then
        printf '0.0\n' > "$OUT/state-animator_duration_scale"
    fi
    if [ "$CASE" = "$3" ]; then fail "$3 boundary"; return 1; fi
}
for CASE in normal normal_original_one default landscape reduced moved bad_rotation bad_landscape restore_failed rotation_command_failed scale_command_ignored reduced_scale_ignored scale_reset_during_flow observer_failed; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/results"; : > "$OUT/adb.log"
    FAILED=0
    ORIGINAL_SCALE=0.0
    if [ "$CASE" = normal_original_one ]; then ORIGINAL_SCALE=1.0; fi
    if [ "$CASE" = restore_failed ]; then ORIGINAL_SCALE=2.0; fi
    result=0; run_player_continuity_checks > "$OUT/test.log" 2>&1 || result=$?
    if [[ "$CASE" = normal* ]]; then
        [ "$result" -eq 0 ] && [ "$(cat "$OUT/phases")" = $'default\nlandscape\nreduced' ] || { cat "$OUT/test.log"; exit 1; }
    else
        [ "$result" -ne 0 ] && [ "$FAILED" -gt 0 ] || { echo "accepted/lost failure $CASE"; exit 1; }
    fi
    if [ "$CASE" != bad_rotation ] && [ "$CASE" != observer_failed ]; then
        for key in window_animation_scale transition_animation_scale animator_duration_scale; do
            grep -q "^shell settings put global $key $ORIGINAL_SCALE$" "$OUT/adb.log"
        done
        grep -q '^shell wm user-rotation free$' "$OUT/adb.log"
    fi
done
echo 'player continuity orchestration: 14 cases passed; 1x/0x, cleanup and parent failure status retained'

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
