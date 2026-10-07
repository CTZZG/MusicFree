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

./android/gradlew -p android :app:connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=fun.upup.musicfree.network.PublicHttpsNetworkPolicyTest,fun.upup.musicfree.network.SystemProxyNetworkPolicyTest,fun.upup.musicfree.network.NotificationArtworkProxyTest \
    -PreactNativeArchitectures=x86_64 --no-daemon --max-workers=2 \
    -Dorg.gradle.jvmargs="-Xmx3072m -XX:MaxMetaspaceSize=768m" \
    > "$OUT/instrumentation.log" 2>&1

adb install -r android/app/build/outputs/apk/debug/app-x86_64-debug.apk
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
