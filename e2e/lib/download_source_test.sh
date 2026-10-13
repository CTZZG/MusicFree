#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
REF=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
source "$HERE/download-source.sh"
ensure_root() { return 0; }
open_link() { :; }
flow() { [ "$CASE" != flow_failed ]; }
pass() { printf 'PASS\t%s\n' "$1" >> "$OUT/results"; }
fail() { printf 'FAIL\t%s\n' "$1" >> "$OUT/results"; }
expect_playing() {
    if [ "$CASE" = playback_failed ]; then fail "$1"; return 1; fi
    pass "$1"
}
wait_until() { [ "$CASE" != missing_download ]; }
downloaded_path() { echo /device/fallback.mp3; }
kv() { [ "$CASE" != missing_source ]; }
adb() { [ "$CASE" != pull_failed ]; }
ffmpeg() {
    [ "$CASE" != decode_failed ] || return 1
    if [ "$CASE" = wrong_audio ] && [[ "$*" = *fallback-download* ]]; then
        echo SHA256=bad
    else
        echo SHA256=good
    fi
}
ffprobe() {
    if [ "$CASE" = wrong_tags ]; then
        echo '{"format":{"tags":{"title":"Other","artist":"E2E Artist","album":"E2E Album"}}}'
    else
        echo '{"format":{"tags":{"title":"E2E Fallback","artist":"E2E Artist","album":"E2E Album"}}}'
    fi
}
for CASE in normal flow_failed playback_failed missing_source missing_download pull_failed decode_failed wrong_audio wrong_tags; do
    : > "$OUT/results"
    run_download_source_checks || true
    [ "$(wc -l < "$OUT/results")" -eq 5 ] || { cat "$OUT/results"; exit 1; }
    case "$CASE" in
        normal) expected=0 ;;
        flow_failed|playback_failed) expected=5 ;;
        missing_source|missing_download) expected=4 ;;
        pull_failed) expected=2 ;;
        *) expected=1 ;;
    esac
    actual=$(grep -c '^FAIL' "$OUT/results" || true)
    [ "$actual" -eq "$expected" ] || { cat "$OUT/results"; exit 1; }
    if [ "$CASE" = decode_failed ] || [ "$CASE" = wrong_audio ]; then
        grep -q $'^FAIL\t备用来源下载文件能解码' "$OUT/results"
    fi
    if [ "$CASE" = wrong_tags ]; then
        grep -q $'^FAIL\t备用来源下载文件的歌曲标签正确' "$OUT/results"
    fi
done
echo "download-source self-test: 9 cases passed"
