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
# Maestro keeps its driver instrumentation alive after a flow; UiAutomation has
# one owner. Finish that owner before starting our instrumented UI test.
for driver in dev.mobile.maestro dev.mobile.maestro.test; do
    adb shell am force-stop "$driver"
done
for attempt in $(seq 1 20); do
    adb shell dumpsys activity instrumentation > "$OUT/ui-automation-handoff.txt"
    if ! grep -Fq 'dev.mobile.maestro' "$OUT/ui-automation-handoff.txt"; then break; fi
    sleep 0.25
done
if grep -Fq 'dev.mobile.maestro' "$OUT/ui-automation-handoff.txt"; then
    echo 'Maestro instrumentation did not release UiAutomation' >&2
    exit 1
fi

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
    # 换音质时原生记下的停止位置和每 50 ms 的轮询打进任务日志，只供排查，不参与判定
    python3 -I "$HERE/lib/source_transition_trace.py" transition "$OUT/$name-logcat.txt" || true
    local exported=false
    if export_engine_progress_samples "$OUT/$name-samples.jsonl" files/js-flow-engine-samples.jsonl; then exported=true; fi
    local args=()
    if [ "$control" = true ]; then args+=(--control); fi
    # A setup failure may produce no samples. Always show the actual assertion
    # before rejecting missing evidence, rather than just returning exit 1.
    cat "$OUT/$name-instrumentation.log"
    python3 -I "$VALIDATOR" instrumentation "$OUT/$name-instrumentation.log" "${args[@]}"
    test "$exported" = true
    python3 -I "$VALIDATOR" samples "$OUT/$name-samples.jsonl" "${args[@]}"
}

run_js real-js false
python3 -I "$VALIDATOR" sources "$OUT/real-js-logcat.txt"
export_engine_progress_samples "$OUT/loading-spinner-ui.jsonl" files/loading-spinner-ui.jsonl
python3 -I "$HERE/lib/loading_spinner_evidence.py" "$OUT/loading-spinner-ui.jsonl"
for name in page mini; do
    adb exec-out run-as fun.upup.musicfree cat "files/loading-spinner-$name.png" > "$OUT/loading-spinner-$name.png"
    python3 -I -c 'from pathlib import Path; import sys; b=Path(sys.argv[1]).read_bytes(); assert b.startswith(b"\x89PNG\r\n\x1a\n") and len(b)>100, "missing/invalid spinner screenshot"' "$OUT/loading-spinner-$name.png"
done
run_js freeze-control true
echo 'Real JS source/skip/quality/focus flows passed with 70 JNI samples, buffering buttons with 20 separate UI samples; stale projection control rejected RAW_STALLED with five samples.' \
    | tee "$OUT/summary.txt"
