#!/usr/bin/env bash
# Debug app + Metro on a disposable emulator. No release/tag is published.
set -euo pipefail
source "$(dirname "$0")/lib/engine_progress_artifact.sh"

OUT="$PWD/proxy-subscription-results"
mkdir -p "$OUT"
METRO_PID=""
RECORD_PID=""
cleanup() {
    # Keep partial raw samples even when an instrumentation assertion fails.
    export_engine_progress_samples "$OUT/engine-progress-samples.jsonl" || true
    export_engine_progress_samples "$OUT/quality-loading-state.jsonl" files/quality-loading-state.jsonl || true
    export_engine_progress_samples "$OUT/audiotrack-seek-clock.jsonl" files/audiotrack-seek-clock.jsonl || true
    if [ -n "$RECORD_PID" ]; then
        adb shell pkill -2 screenrecord 2>/dev/null || true
        wait "$RECORD_PID" 2>/dev/null || true
        adb pull /sdcard/subscription-transition.mp4 "$OUT/subscription-transition.mp4" 2>/dev/null || true
    fi
    [ -z "$METRO_PID" ] || kill "$METRO_PID" 2>/dev/null || true
    adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
}
trap cleanup EXIT

adb install -r -t android/app/build/outputs/apk/debug/app-x86_64-debug.apk
adb install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb install -r -t "$E2E_FOCUS_APK"
# Raw engine samples are written by instrumentation, independently of the
# service's projected clock. Do not retain samples from a previous installation.
adb shell run-as fun.upup.musicfree rm -f files/engine-progress-samples.jsonl files/quality-loading-state.jsonl files/audiotrack-seek-clock.jsonl
# Record this adb version's actual missing-file behavior as text, never JSONL.
# The exporter must reject it regardless of whether exec-out returns zero.
MISSING_SAMPLE_STATUS=0
adb exec-out run-as fun.upup.musicfree cat files/engine-progress-samples.jsonl \
    > "$OUT/missing-sample-exec-out.txt" 2>&1 || MISSING_SAMPLE_STATUS=$?
echo "Missing sample exec-out probe: status=$MISSING_SAMPLE_STATUS bytes=$(wc -c < "$OUT/missing-sample-exec-out.txt")"
if export_engine_progress_samples "$OUT/missing-sample-probe.jsonl"; then
    echo 'Missing-file sample export unexpectedly succeeded' >&2
    exit 1
fi
test ! -e "$OUT/missing-sample-probe.jsonl"
echo 'Missing sample export rejected without creating a JSONL artifact.'
TEST_CLASSES="fun.upup.musicfree.network.PublicHttpsNetworkPolicyTest,fun.upup.musicfree.network.SystemProxyNetworkPolicyTest,fun.upup.musicfree.network.NotificationArtworkProxyTest,fun.upup.musicfree.mpvplayer.LiveUpdateNotificationStyleTest,fun.upup.musicfree.mpvplayer.EngineProgressProbeTest,fun.upup.musicfree.mpvplayer.JsFlowProbePolicyTest,fun.upup.musicfree.mpvplayer.SourceTransitionReaderTest,fun.upup.musicfree.mpvplayer.SourceReplacementPositionTest,fun.upup.musicfree.mpvplayer.PendingSeekTest,fun.upup.musicfree.mpvplayer.LiveUpdateEngineProgressTest,fun.upup.musicfree.mpvplayer.PlaybackServiceStartupTest,fun.upup.musicfree.mpvplayer.AudioTrackSeekClockTest,fun.upup.musicfree.mpvplayer.SlowQualityLoadingTest,fun.upup.musicfree.lyricUtil.LyricColorsInstrumentedTest,fun.upup.musicfree.lyricUtil.LyricUiTaskRunnerTest,fun.upup.musicfree.lyricUtil.LyricUiTaskInstrumentedTest,fun.upup.musicfree.mp3Util.OggCoverWriterInstrumentedTest"
adb shell am instrument -w -r -e class "$TEST_CLASSES" \
    fun.upup.musicfree.test/androidx.test.runner.AndroidJUnitRunner \
    > "$OUT/instrumentation.log" 2>&1
# 系统对每个应用的通知更新限速（约每秒 5 次），超过时丢掉更新并打这条日志
adb logcat -d -s NotificationService:E | grep -i "shedding" || true
# `am instrument` can exit zero even when JUnit fails. Require every selected
# class to complete tests successfully, and reject skipped or partial runs.
python3 - "$OUT/instrumentation.log" "$TEST_CLASSES" <<'PY'
import json, re, sys
from pathlib import Path
log = Path(sys.argv[1]).read_text()
completed, fields, last_key = [], {}, None
for line in log.splitlines():
    if line.startswith('INSTRUMENTATION_STATUS: '):
        key, sep, value = line.removeprefix('INSTRUMENTATION_STATUS: ').partition('=')
        if sep: fields[key], last_key = value, key
    elif line.startswith('INSTRUMENTATION_STATUS_CODE: '):
        code = int(line.split(':', 1)[1])
        if code <= 0 and 'class' in fields and 'test' in fields:
            completed.append({'class': fields['class'], 'test': fields['test'], 'code': code,
                              'stack': fields.get('stack', '')})
        fields, last_key = {}, None
    elif last_key == 'stack':
        # 失败的堆栈跨多行，后面的行不带前缀
        fields['stack'] += '\n' + line
# 失败的测试和堆栈打在任务日志里：结果附件不一定下载得到
for t in completed:
    if t['code'] != 0:
        print(f"FAILED {t['class']}#{t['test']} (status {t['code']})")
        print('\n'.join(t['stack'].splitlines()[:40]))
expected = max((int(n) for n in re.findall(r'^INSTRUMENTATION_STATUS: numtests=(\d+)', log, re.M)), default=0)
passed = len(completed) == expected and expected > 0 and all(t['code'] == 0 for t in completed)
passed &= {t['class'] for t in completed} == set(sys.argv[2].split(','))
passed &= bool(re.search(r'^INSTRUMENTATION_CODE: -1\s*$', log, re.M))
summary = {'passed': passed, 'expected': expected, 'completed': completed}
Path(sys.argv[1]).with_name('instrumentation-summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({'passed': passed, 'expected': expected, 'completed': len(completed)}))
sys.exit(0 if passed else 1)
PY
export_engine_progress_samples "$OUT/engine-progress-samples.jsonl"
export_engine_progress_samples "$OUT/quality-loading-state.jsonl" files/quality-loading-state.jsonl
export_engine_progress_samples "$OUT/audiotrack-seek-clock.jsonl" files/audiotrack-seek-clock.jsonl
python3 -I native/mpv/check-seek-clock.py "$OUT/audiotrack-seek-clock.jsonl"
python3 -I e2e/lib/quality_loading_evidence.py "$OUT/quality-loading-state.jsonl"
python3 - "$OUT/engine-progress-samples.jsonl" <<'PY'
import json, sys
from collections import Counter
from pathlib import Path
rows = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
phases = Counter(row['phase'] for row in rows)
expected = {'playing', 'paused', 'resumed', 'negative-stale-projection', 'recovered-after-control'}
if set(phases) != expected or any(n != 5 for n in phases.values()):
    raise SystemExit(f'Incomplete raw engine evidence: {dict(phases)}')
print('Raw JNI progress evidence:', dict(phases))
PY
adb reverse tcp:8081 tcp:8081
adb shell settings put global window_animation_scale 2
adb shell settings put global transition_animation_scale 2
adb shell settings put global animator_duration_scale 1
adb shell setprop debug.hwui.profile false

npx expo start --dev-client --port 8081 > "$OUT/metro.log" 2>&1 &
METRO_PID=$!
for attempt in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8081/status > /dev/null; then break; fi
    sleep 1
done
curl -fsS http://127.0.0.1:8081/status
adb shell am start -W -n fun.upup.musicfree/.MainActivity

maestro test --test-output-dir "$OUT/maestro-settings" e2e/flows/plugin-settings.yaml \
    > "$OUT/open-settings.log" 2>&1
# Leave enough time for Maestro's driver startup; stop once the flow completes.
adb shell screenrecord --time-limit 60 /sdcard/subscription-transition.mp4 &
RECORD_PID=$!
sleep 1
maestro test --no-reinstall-driver --test-output-dir "$OUT/maestro-subscription" e2e/flows/plugin-subscription.yaml \
    > "$OUT/subscription.log" 2>&1
adb shell pkill -2 screenrecord || true
wait "$RECORD_PID" || true
RECORD_PID=""
adb pull /sdcard/subscription-transition.mp4 "$OUT/subscription-transition.mp4"
maestro hierarchy --compact --no-reinstall-driver > "$OUT/final-hierarchy.txt"
bash e2e/android16-js-flow-check.sh "$OUT/real-js"
echo 'Native proxy and real-engine Live Update tests passed; subscription entry/back flow passed with animations enabled.' \
    | tee "$OUT/summary.txt"
