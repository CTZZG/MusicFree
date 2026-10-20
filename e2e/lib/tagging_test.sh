#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
REF=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
source "$HERE/tagging.sh"
ensure_root() { [ "$CASE" != missing_root ]; }
open_link() { [[ "$1" = *'e2e%20wma%20'* ]]; }
flow() { [[ "$*" = *'TITLE=E2E Tagged WMA'* ]] && [ "$CASE" != flow_failed ]; }
wait_until() { [ "$1" = 90 ] && [ "$CASE" != missing_download ]; }
downloaded_path() { echo /device/tagged.wma; }
pass() { printf 'PASS\t%s\n' "$1" >> "$OUT/results"; }
fail() { printf 'FAIL\t%s\n' "$1" >> "$OUT/results"; }
adb() { [ "$CASE" != pull_failed ]; }
ffmpeg() {
    [[ "$*" = *-xerror* ]] && [ "$CASE" != decode_failed ] || return 1
    if [ "$CASE" = wrong_audio ] && [[ "$*" = *tagged-download* ]]; then
        echo SHA256=wrong
    else
        echo SHA256=correct
    fi
}
ffprobe() {
    [ "$CASE" != probe_failed ] || return 1
    if [ "$CASE" = stale_tags ]; then
        echo '{"format":{"tags":{"title":"Before Title","artist":"Before Artist","album":"Before Album"}}}'
    elif [ "$CASE" = missing_tags ]; then
        echo '{"format":{"tags":{}}}'
    else
        echo '{"format":{"tags":{"title":"E2E Tagged WMA","artist":"E2E Artist","album":"E2E Album"}}}'
    fi
}
for CASE in normal missing_root flow_failed missing_download pull_failed decode_failed wrong_audio stale_tags missing_tags probe_failed; do
    : > "$OUT/results"
    run_wma_tagging_checks || true
    [ "$(wc -l < "$OUT/results")" -eq 3 ] || { cat "$OUT/results"; exit 1; }
    case "$CASE" in
        normal) expected=0 ;;
        missing_root|flow_failed|missing_download) expected=3 ;;
        pull_failed) expected=2 ;;
        *) expected=1 ;;
    esac
    actual=$(grep -c '^FAIL' "$OUT/results" || true)
    [ "$actual" -eq "$expected" ] || { cat "$OUT/results"; exit 1; }
done
echo 'WMA tagging harness self-test: 10 cases passed'
