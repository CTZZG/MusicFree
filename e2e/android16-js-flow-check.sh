#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib/engine_progress_artifact.sh"
OUT=${1:?Missing result directory}
REF=${E2E_TEST_SOURCE_SHA:?Pin the fixture source SHA}
FOCUS_APK=${E2E_FOCUS_APK:?Missing focus helper APK}
mkdir -p "$OUT"
VALIDATOR="$HERE/lib/js_flow_evidence.py"
cleanup_js() {
    adb shell am force-stop fun.upup.musicfree.e2e.focus > /dev/null 2>&1 || true
    adb shell am force-stop fun.upup.musicfree > /dev/null 2>&1 || true
}
trap cleanup_js EXIT
adb install -r "$FOCUS_APK" > "$OUT/install-focus.log" 2>&1

run_js() {
    local name=$1 control=$2
    # A disposable emulator, a real fresh ReactHost, and no cached plugin/audio results.
    adb shell am force-stop fun.upup.musicfree
    adb shell pm clear fun.upup.musicfree
    adb shell pm grant fun.upup.musicfree android.permission.POST_NOTIFICATIONS
    adb logcat -c
    adb shell am instrument -w -r \
        -e class fun.upup.musicfree.mpvplayer.RealJsEngineProgressTest \
        -e jsFlowRef "$REF" -e jsFlowFreezeControl "$control" \
        fun.upup.musicfree.test/androidx.test.runner.AndroidJUnitRunner > "$OUT/$name-instrumentation.log" 2>&1
    adb logcat -d > "$OUT/$name-logcat.txt"
    export_engine_progress_samples "$OUT/$name-samples.jsonl" files/js-flow-engine-samples.jsonl
    local args=()
    if [ "$control" = true ]; then args+=(--control); fi
    python3 -I "$VALIDATOR" instrumentation "$OUT/$name-instrumentation.log" "${args[@]}"
    python3 -I "$VALIDATOR" samples "$OUT/$name-samples.jsonl" "${args[@]}"
}

run_js real-js false
python3 -I "$VALIDATOR" sources "$OUT/real-js-logcat.txt"
run_js freeze-control true
echo 'Real JS source/skip/quality/focus flows passed with 60 JNI samples; stale projection control rejected RAW_STALLED with five samples.' \
    | tee "$OUT/summary.txt"
