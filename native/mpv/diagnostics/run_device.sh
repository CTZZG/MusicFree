#!/usr/bin/env bash
# Original full device script, counter-only APK, separate durable host capture.
set -euo pipefail
APP=$1
TEST=$2
OUT=$3
mkdir -p "$OUT"
CAPTURE_PID=""
cleanup() {
    if [ -n "$CAPTURE_PID" ]; then
        kill "$CAPTURE_PID" 2>/dev/null || true
        wait "$CAPTURE_PID" 2>/dev/null || true
        CAPTURE_PID=""
    fi
}
trap cleanup EXIT
# Only generated build output is replaced; source AAR and test assertions remain intact.
cp "$APP" android/app/build/outputs/apk/debug/app-x86_64-debug.apk
test -f "$TEST"
adb logcat -c
adb logcat -v threadtime -b main -b system -b crash > "$OUT/logcat.txt" 2> "$OUT/logcat-error.txt" &
CAPTURE_PID=$!
marker() {
    adb shell log -p i -t MPVClockTrace "$1"
    for attempt in {1..50}; do
        kill -0 "$CAPTURE_PID" 2>/dev/null || return 1
        grep -qE "[[:space:]]MPVClockTrace[[:space:]]*:[[:space:]]$1[[:space:]]*$" "$OUT/logcat.txt" && return 0
        sleep 0.1
    done
    return 1
}
marker mpv-diagnostic-start
status=0
bash e2e/proxy-subscription-check.sh > "$OUT/regression.log" 2>&1 || status=$?
printf '%s\n' "$status" > "$OUT/regression-shell-exit.txt"
if [ -d proxy-subscription-results ]; then
    cp -R proxy-subscription-results "$OUT/product-check"
    for name in instrumentation.log audiotrack-seek-clock.jsonl; do
        if [ -f "proxy-subscription-results/$name" ]; then
            cp "proxy-subscription-results/$name" "$OUT/$name"
        fi
    done
fi
if marker mpv-diagnostic-end && [ ! -s "$OUT/logcat-error.txt" ]; then
    printf '{"complete":true}\n' > "$OUT/capture-health.json"
else
    printf '{"complete":false}\n' > "$OUT/capture-health.json"
fi
cleanup
