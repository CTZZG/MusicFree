#!/usr/bin/env bash
set -euo pipefail
APK=$1
OUT=$2
FIXTURES=$3
PKG=fun.upup.musicfree.mvprobe
REMOTE=/sdcard/Android/data/$PKG/files/mv-view-probe
mkdir -p "$OUT"
adb shell df -k /data > "$OUT/device-data-space.txt"
adb install --no-streaming -r "$APK"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
adb logcat -c
adb logcat -v threadtime > "$OUT/logcat.txt" 2> "$OUT/logcat-stderr.txt" &
LOG_PID=$!
cleanup() {
    adb shell settings put system accelerometer_rotation 1 >/dev/null || true
    adb shell pidof screenrecord | tr -d '\r' | xargs -r -I{} adb shell kill -2 '{}' || true
    if [ -n "${RECORD_PID:-}" ]; then wait "$RECORD_PID" || true; fi
    adb pull "$REMOTE/result.json" "$OUT/result.json" >/dev/null 2>&1 || true
    adb pull "$REMOTE/recording.mp4" "$OUT/recording.mp4" >/dev/null 2>&1 || true
    adb exec-out screencap -p > "$OUT/final-screen.png" || true
    kill "$LOG_PID" 2>/dev/null || true
}
trap cleanup EXIT
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0
adb shell am start -W -n "$PKG/fun.upup.musicfree.MainActivity" > "$OUT/launch.txt"
for _ in $(seq 1 90); do
    adb shell test -d "$REMOTE" && break
    sleep 1
done
python3 -I e2e/mv-view-probe/prepare_ui.py "$OUT"
adb push "$FIXTURES/audio.m4a" "$FIXTURES/mv-a.mp4" "$FIXTURES/mv-hevc.mp4" "$REMOTE/" > "$OUT/push.txt"
adb shell screenrecord --time-limit 180 "$REMOTE/recording.mp4" > "$OUT/recording-process.txt" 2>&1 &
RECORD_PID=$!
for phase in seek-paused new-owner landscape portrait background foreground hevc returned-audio; do
    matched=false
    for _ in $(seq 1 90); do
        adb pull "$REMOTE/result.json" "$OUT/result.json" >/dev/null 2>&1 || true
        if [ ! -f "$OUT/result.json" ]; then sleep 1; continue; fi
        if python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if d["status"]!="failed" else 1)' "$OUT/result.json"; then
            current=$(adb shell cat "$REMOTE/phase.txt" 2>/dev/null | tr -d '\r' || true)
            if [ "$current" = "$phase" ] && python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if type(d.get("probeOwner")) is int and d["probeOwner"]>0 and any(e["phase"]==sys.argv[2] and e.get("probeOwner")==d["probeOwner"] for e in d["events"]) else 1)' "$OUT/result.json" "$phase"; then matched=true; break; fi
        else
            cat "$OUT/result.json"; exit 1
        fi
        sleep 1
    done
    test "$matched" = true
    if [ "$phase" != returned-audio ]; then
        captured=false
        for attempt in $(seq 1 10); do
            adb shell uiautomator dump "$REMOTE/ui-$phase.xml" > "$OUT/$phase-ui-dump.txt" 2>&1
            adb pull "$REMOTE/ui-$phase.xml" "$OUT/$phase-ui.xml" >/dev/null
            adb exec-out screencap -p > "$OUT/$phase.png"
            adb pull "$REMOTE/result.json" "$OUT/result.json" >/dev/null
            if [[ "$phase" =~ ^(seek-paused|new-owner|landscape|portrait)$ ]]; then expected=(144); elif [ "$phase" = hevc ]; then expected=(24); else expected=(); fi
            if python3 -I e2e/mv-view-probe/capture.py "$OUT" "$phase" "${expected[@]}" > "$OUT/$phase-frame.json" 2> "$OUT/$phase-frame-stderr.txt"; then captured=true; break; fi
            if [ "$attempt" = 1 ]; then
                cp "$OUT/$phase.png" "$OUT/$phase-first-pending.png"
                cp "$OUT/$phase-ui.xml" "$OUT/$phase-first-pending-ui.xml"
            fi
            sleep 0.1
        done
        test "$captured" = true
    else
        adb exec-out screencap -p > "$OUT/$phase.png"
    fi
    case "$phase" in
        new-owner) adb shell settings put system user_rotation 1; sleep 2 ;;
        landscape) adb shell settings put system user_rotation 0; sleep 2 ;;
        background)
            adb shell log -t MvViewHost MV_VIEW_BACKGROUND_BEGIN
            adb shell input keyevent KEYCODE_HOME
            adb shell dumpsys media_session > "$OUT/background-start-media-session.txt"
            sleep 2
            adb shell dumpsys media_session > "$OUT/background-media-session.txt"
            adb shell log -t MvViewHost MV_VIEW_BACKGROUND_END
            adb shell am start -W -n "$PKG/fun.upup.musicfree.MainActivity" > "$OUT/foreground-launch.txt"
            ;;
    esac
    OWNER=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["probeOwner"])' "$OUT/result.json")
    adb shell touch "$REMOTE/continue-$OWNER-$phase"
done
for _ in $(seq 1 20); do
    adb pull "$REMOTE/result.json" "$OUT/result.json" >/dev/null
    if python3 -c 'import json,sys;sys.exit(json.load(open(sys.argv[1]))["status"]!="passed")' "$OUT/result.json"; then break; fi
    sleep 1
done
adb shell pidof screenrecord | tr -d '\r' | xargs -r -I{} adb shell kill -2 '{}'
wait "$RECORD_PID" || true
adb pull "$REMOTE/recording.mp4" "$OUT/recording.mp4"
ffmpeg -v error -xerror -i "$OUT/recording.mp4" -f null -
python3 -I e2e/mv-view-probe/verify.py "$OUT"
