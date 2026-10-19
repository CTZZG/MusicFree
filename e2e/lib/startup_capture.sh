#!/usr/bin/env bash
# Maestro clears logcat when its driver starts. Keep the preceding app launch
# on the host too, so an early native crash cannot disappear with that clear.
STARTUP_CAPTURE_PID=""
startup_capture_start() {
    adb logcat -v threadtime -b main -b system -b crash \
        > "$OUT/startup-stream-logcat.txt" 2> "$OUT/startup-stream-error.txt" &
    STARTUP_CAPTURE_PID=$!
}
startup_capture_stop() {
    if [ -n "$STARTUP_CAPTURE_PID" ]; then
        kill "$STARTUP_CAPTURE_PID" 2>/dev/null || true
        wait "$STARTUP_CAPTURE_PID" 2>/dev/null || true
        STARTUP_CAPTURE_PID=""
    fi
}
