# Temporary diagnostic only: preserve driver startup before Maestro clears logcat.
OFFLINE_CAPTURE_PID=""
OFFLINE_CAPTURE_TOKEN=""
offline_capture_cancel() {
    if [ -n "$OFFLINE_CAPTURE_PID" ]; then
        kill "$OFFLINE_CAPTURE_PID" 2>/dev/null || true
        wait "$OFFLINE_CAPTURE_PID" 2>/dev/null || true
        OFFLINE_CAPTURE_PID=""
    fi
}
offline_capture_marker() {
    [ "${E2E_OFFLINE_PROBE:-}" = 1 ] || return 0
    local phase=$1
    kill -0 "$OFFLINE_CAPTURE_PID" 2>/dev/null || return 1
    adb shell log -p i -t MFOfflineProbe "$phase:$OFFLINE_CAPTURE_TOKEN" || return 1
    for _ in {1..50}; do
        if python3 -I "$HERE/lib/offline_probe.py" marker "$OUT/offline-driver-stream.txt" "$OFFLINE_CAPTURE_TOKEN" "$phase"; then return 0; fi
        kill -0 "$OFFLINE_CAPTURE_PID" 2>/dev/null || return 1
        sleep .1
    done
    return 1
}
offline_capture_start() {
    OFFLINE_CAPTURE_TOKEN="offline-${GITHUB_RUN_ID:-local}-$$"
    printf '%s\n' "$OFFLINE_CAPTURE_TOKEN" > "$OUT/offline-driver-token.txt"
    adb logcat -v threadtime -b main -b system -b crash > "$OUT/offline-driver-stream.txt" 2> "$OUT/offline-driver-stream-error.txt" &
    OFFLINE_CAPTURE_PID=$!
    offline_capture_marker begin
}
offline_capture_finish() {
    local complete=0
    if offline_capture_marker end && [ ! -s "$OUT/offline-driver-stream-error.txt" ]; then complete=1; fi
    offline_capture_cancel
    if [ "$complete" -eq 1 ] && python3 -I "$HERE/lib/offline_probe.py" check "$OUT/offline-driver-stream.txt" "$OUT/offline-driver-token.txt" > "$OUT/offline-driver-verified.json"; then
        pass '离线诊断：原始全程日志完整'
    else
        fail '离线诊断：原始全程日志完整' '采集健康、实际首尾/阶段标记未通过'
    fi
}
