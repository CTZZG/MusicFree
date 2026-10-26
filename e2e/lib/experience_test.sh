#!/usr/bin/env bash
# Orchestration test with fake device/clock boundaries. Real PNGs stay a device requirement.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
python3 -I "$HERE/lib/playback_info_flow_test.py"
python3 -I "$HERE/lib/download_menu_flow_test.py"
python3 -I "$HERE/lib/ui_observer.py" --self-test
bash "$HERE/lib/player_continuity_test.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SESSION="$HERE/lib/media_session.py"
source "${E2E_EXPERIENCE_IMPL:-$HERE/experience.sh}"

pass() { printf 'PASS\t%s\n' "$1" >> "$OUT/results"; }
fail() { printf 'FAIL\t%s\n' "$1" >> "$OUT/results"; }
session() { printf '{"found":true,"active":true,"state":"%s","title":"%s","position":%s}\n' "$STATE" "$TITLE" "$POSITION"; }
wait_for_state() { [ "$STATE" = "$1" ] && [ "$TITLE" = "$2" ]; }
wait_until() { shift; "$@"; }
list_share_images() { cat "$OUT/device-images"; }
python3() {
    if [[ "${2:-}" = */share_card.py ]]; then [ "$CASE" != wrong_pixels ];
    else command python3 "$@"; fi
}
adb() {
    case "$*" in
        *KEYCODE_MEDIA_PAUSE) [ "$CASE" = pause_failed ] || STATE=PAUSED ;;
        *KEYCODE_MEDIA_PLAY) [ "$CASE" = resume_failed ] || STATE=PLAYING ;;
        pull*) printf 'fake device bytes' > "$3" ;;
        *) return 1 ;;
    esac
    return 0
}
flow() {
    FLOWS=$((FLOWS + 1))
    if [ "$CASE" = info_failed ] && [ "$2" = playback-info.yaml ]; then fail "info boundary"; return 1; fi
    # Four 70s UI phases outlast the actual 180s recording if not paused.
    if [ "$STATE" = PLAYING ]; then
        POSITION=$((POSITION + 70000))
        if [ "$POSITION" -gt 180000 ]; then TITLE='E2E Fallback'; POSITION=0; fi
    fi
    if [ "$CASE" = progress_changed ]; then POSITION=$((POSITION + 1000)); fi
    case "$2" in
        share-song-card.yaml) echo MusicFree-1.png >> "$OUT/device-images" ;;
        share-lyric-card.yaml) echo MusicFree-2.png >> "$OUT/device-images" ;;
    esac
}
# Separate receiver orchestration/metadata checks live in share_receiver_test.sh.
run_share_receiver_checks() {
    if [ "$CASE" = receiver_failed ]; then fail "receiver boundary"; return 1; fi
}
run_player_continuity_checks() {
    if [ "$CASE" = observation_failed ]; then fail "observation boundary"; return 1; fi
}

for CASE in normal pause_failed resume_failed wrong_pixels progress_changed receiver_failed info_failed observation_failed; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/results"; : > "$OUT/device-images"
    STATE=PLAYING; TITLE='E2E Tone C'; POSITION=19000; FLOWS=0
    result=0; run_share_card_checks > "$OUT/check.log" 2>&1 || result=$?
    if [ "$CASE" = normal ]; then
        [ "$result" -eq 0 ] && [ "$STATE" = PLAYING ] && [ "$TITLE" = 'E2E Tone C' ] &&
            [ "$POSITION" -eq 19000 ] && [ "$FLOWS" -eq 4 ] || {
                echo "unexpected terminal playback: $STATE / $TITLE / $POSITION ms / $FLOWS flows"
                cat "$OUT/check.log"; exit 1
            }
    else
        [ "$result" -ne 0 ] && grep -q '^FAIL' "$OUT/results" || { cat "$OUT/check.log"; exit 1; }
        if [ "$CASE" = pause_failed ]; then [ "$FLOWS" -eq 0 ]; fi
    fi
done
echo 'experience orchestration: 8 cases passed (long UI, pause/resume failure, missing pixels, changed position, receiver failure, info/observation failure)'
