#!/usr/bin/env bash
set -euo pipefail
APK=${1:?usage: run.sh probe.apk output-directory}
OUT=${2:?}
HERE=$(cd "$(dirname "$0")" && pwd)
PACKAGE=fun.upup.musicfree.e2e.mvprobe
mkdir -p "$OUT"
adb install -r "$APK"
adb logcat -v threadtime > "$OUT/logcat.txt" 2>"$OUT/logcat.stderr" &
CAPTURE=$!
trap 'kill "$CAPTURE" 2>/dev/null || true; wait "$CAPTURE" 2>/dev/null || true' EXIT
for SURFACE in texture surface; do
    CASE="$OUT/$SURFACE"
    mkdir -p "$CASE"
    adb shell am force-stop "$PACKAGE"
    adb shell pm clear "$PACKAGE" >/dev/null
    adb shell am start -W -n "$PACKAGE/.ProbeActivity" --es surface "$SURFACE" > "$CASE/start.txt"
    read_events() { adb exec-out run-as "$PACKAGE" cat files/events.jsonl 2>/dev/null || true; }
    # A concrete phase marker, not a timed blind tap or success assumption.
    background_ready=false
    for _ in $(seq 1 80); do
        if read_events | grep -q '"name":"background-wait"'; then background_ready=true; break; fi
        if adb shell run-as "$PACKAGE" test -f files/summary.json; then break; fi
        sleep 0.25
    done
    if [ "$background_ready" = true ]; then
        adb shell input keyevent KEYCODE_HOME
        for _ in $(seq 1 40); do
            if read_events | grep -q '"name":"foreground-wait"'; then break; fi
            sleep 0.25
        done
        adb shell am start -W -n "$PACKAGE/.ProbeActivity" --es surface "$SURFACE" > "$CASE/return.txt"
    fi
    finished=false
    for _ in $(seq 1 100); do
        if adb shell run-as "$PACKAGE" test -f files/summary.json; then finished=true; break; fi
        sleep 0.25
    done
    adb exec-out screencap -p > "$CASE/device.png"
    adb exec-out run-as "$PACKAGE" tar -cf - files > "$CASE/evidence.tar"
    tar -xf "$CASE/evidence.tar" -C "$CASE"
    if [ "$finished" != true ]; then printf '%s\n' 'Probe did not produce a final summary' > "$CASE/missing-summary.txt"; fi
done
adb shell am force-stop "$PACKAGE"
python3 "$HERE/verify.py" "$OUT" --native "${APK%.apk}-native.json"
