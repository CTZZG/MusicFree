#!/usr/bin/env bash
# Debug app + Metro on a disposable emulator. No release/tag is published.
set -euo pipefail

OUT="$PWD/proxy-subscription-results"
mkdir -p "$OUT"
METRO_PID=""
RECORD_PID=""
cleanup() {
    if [ -n "$RECORD_PID" ]; then
        adb shell pkill -2 screenrecord 2>/dev/null || true
        wait "$RECORD_PID" 2>/dev/null || true
        adb pull /sdcard/subscription-transition.mp4 "$OUT/subscription-transition.mp4" 2>/dev/null || true
    fi
    [ -z "$METRO_PID" ] || kill "$METRO_PID" 2>/dev/null || true
    adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
}
trap cleanup EXIT

adb install -r android/app/build/outputs/apk/debug/app-x86_64-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
TEST_CLASSES="fun.upup.musicfree.network.PublicHttpsNetworkPolicyTest,fun.upup.musicfree.network.SystemProxyNetworkPolicyTest,fun.upup.musicfree.network.NotificationArtworkProxyTest"
adb shell am instrument -w -r -e class "$TEST_CLASSES" \
    fun.upup.musicfree.test/androidx.test.runner.AndroidJUnitRunner \
    > "$OUT/instrumentation.log" 2>&1
# `am instrument` can exit zero even when JUnit fails. Require every selected
# class to complete tests successfully, and reject skipped or partial runs.
python3 - "$OUT/instrumentation.log" "$TEST_CLASSES" <<'PY'
import json, re, sys
from pathlib import Path
log = Path(sys.argv[1]).read_text()
completed, fields = [], {}
for line in log.splitlines():
    if line.startswith('INSTRUMENTATION_STATUS: '):
        key, sep, value = line.removeprefix('INSTRUMENTATION_STATUS: ').partition('=')
        if sep: fields[key] = value
    elif line.startswith('INSTRUMENTATION_STATUS_CODE: '):
        code = int(line.split(':', 1)[1])
        if code <= 0 and 'class' in fields and 'test' in fields:
            completed.append({'class': fields['class'], 'test': fields['test'], 'code': code})
        fields = {}
expected = max((int(n) for n in re.findall(r'^INSTRUMENTATION_STATUS: numtests=(\d+)', log, re.M)), default=0)
passed = len(completed) == expected and expected > 0 and all(t['code'] == 0 for t in completed)
passed &= {t['class'] for t in completed} == set(sys.argv[2].split(','))
passed &= bool(re.search(r'^INSTRUMENTATION_CODE: -1\s*$', log, re.M))
summary = {'passed': passed, 'expected': expected, 'completed': completed}
Path(sys.argv[1]).with_name('instrumentation-summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({'passed': passed, 'expected': expected, 'completed': len(completed)}))
sys.exit(0 if passed else 1)
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
echo 'Native proxy tests passed; subscription entry/back flow passed with animations enabled.' \
    | tee "$OUT/summary.txt"
