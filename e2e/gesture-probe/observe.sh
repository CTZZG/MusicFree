# shellcheck shell=bash
# Diagnostic branch only. Real public UI + separate-UID native injected touches.
gesture_ui_dump() {
    local tag=$1
    adb shell uiautomator dump /sdcard/mf-gesture-ui.xml > "$OUT/$tag-dump.txt" 2>&1 &&
        adb pull /sdcard/mf-gesture-ui.xml "$OUT/$tag.xml" > "$OUT/$tag-pull.txt" 2>&1
}

run_held_gesture_cases() {
    local kind coords x y title
    for kind in right left short; do
        # Pause explicitly before a shell UI dump; a continuously changing
        # progress widget must not decide whether UiAutomator becomes idle.
        title=$(session | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["title"])') || return 1
        adb shell input keyevent KEYCODE_MEDIA_PAUSE || return 1
        wait_for_state PAUSED "$title" 15 || return 1
        gesture_ui_dump "gesture-$kind-setup" || return 1
        coords=$(python3 -I "$HERE/gesture-probe/inspect.py" row "$OUT/gesture-$kind-setup.xml") || return 1
        read -r x y <<< "$coords"
        adb shell input tap "$x" "$y" || return 1
        wait_for_state PLAYING "E2E Tone B" 20 || return 1
        adb shell input keyevent KEYCODE_MEDIA_PAUSE || return 1
        wait_for_state PAUSED "E2E Tone B" 15 || return 1
        session > "$OUT/gesture-$kind-before.json"
        gesture_ui_dump "gesture-$kind-before" || return 1
        adb shell dumpsys activity activities > "$OUT/gesture-$kind-foreground.txt" || return 1
        grep -Eq '(mResumedActivity|topResumedActivity).*fun[.]upup[.]musicfree/' "$OUT/gesture-$kind-foreground.txt" || return 1
        coords=$(python3 -I "$HERE/gesture-probe/inspect.py" coordinates "$OUT/gesture-$kind-before.xml" "$kind") || return 1
        printf '%s\n' "$coords" > "$OUT/gesture-$kind-coordinates.txt"
        local start end
        read -r start end y <<< "$coords"
        adb shell am instrument -w -r -e startX "$start" -e endX "$end" -e y "$y" \
            fun.upup.musicfree.e2e.gesture/.HeldGestureProbe > "$OUT/gesture-$kind-instrumentation.txt" 2>&1 || return 1
        # UI outcome is an observation, not an assumed correct-direction assertion.
        # Give the existing transition time to finish before collecting final UI.
        sleep 2
        session > "$OUT/gesture-$kind-after.json"
        shot "gesture-$kind-after-before-observer-pause"
        title=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$OUT/gesture-$kind-after.json") || return 1
        adb shell input keyevent KEYCODE_MEDIA_PAUSE || return 1
        wait_for_state PAUSED "$title" 15 || return 1
        session > "$OUT/gesture-$kind-after-observer-pause.json"
        gesture_ui_dump "gesture-$kind-after" || return 1
        shot "gesture-$kind-after"
        if ! python3 -I "$HERE/gesture-probe/inspect.py" result "$OUT" "$kind" > "$OUT/gesture-$kind-analysis.txt" 2> "$OUT/gesture-$kind-analysis-error.txt"; then
            return 1
        fi
        cat "$OUT/gesture-$kind-analysis.txt"
        if ! python3 -I -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))["matches"] is True else 1)' "$OUT/gesture-$kind-result.json"; then
            fail "手势：$kind 实际方向" "真实方向与拖动意图不符，保留原始证据"
            return 1
        fi
        pass "手势：$kind 方向与原始证据完整" "实际 UI/会话方向正确，非物理手指或声音测量"
    done
}

run_held_gesture_observation() {
    open_link "musicfree://search?keyword=e2e%20$REF"
    flow "手势诊断：准备真实 B 队列" gesture-start-b.yaml || return 1
    expect_playing "手势诊断：B 引擎实际前进" "E2E Tone B" || return 1
    source "$HERE/lib/maestro_handoff.sh"
    if ! stop_maestro_ui_driver "$OUT/gesture-automation"; then
        fail "手势诊断：测试驱动退出前提" "未得到有效的进程列表，未注入触摸"
        return 1
    fi
    adb install -r -t "$E2E_GESTURE_PROBE_APK" > "$OUT/gesture-install.txt" 2>&1 || return 1
    local recorder result=0
    recorder=$(adb shell 'screenrecord --time-limit 180 --size 540x1200 --bit-rate 800000 /sdcard/mf-gesture.mp4 >/sdcard/mf-gesture-recorder.log 2>&1 </dev/null & echo $!' | tr -d '\r')
    if ! [[ "$recorder" =~ ^[0-9]+$ ]] || ! adb shell kill -0 "$recorder"; then return 1; fi
    run_held_gesture_cases || result=$?
    adb shell kill -2 "$recorder" 2>/dev/null || true
    for _ in {1..50}; do
        if ! adb shell kill -0 "$recorder" 2>/dev/null; then break; fi
        sleep .2
    done
    adb pull /sdcard/mf-gesture-recorder.log "$OUT/gesture-recorder.log" >/dev/null 2>&1 || true
    if ! adb pull /sdcard/mf-gesture.mp4 "$OUT/gesture-observation.mp4" > "$OUT/gesture-video-pull.txt" 2>&1 ||
        ! ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name:format=duration -of json "$OUT/gesture-observation.mp4" > "$OUT/gesture-video.json" ||
        ! ffmpeg -v error -xerror -i "$OUT/gesture-observation.mp4" -fps_mode passthrough -enc_time_base -1 -f null - 2> "$OUT/gesture-video-decode.txt"; then result=1; fi
    if [ "$result" -ne 0 ]; then
        fail "手势诊断：采集完整性" "实际触摸/UI/会话或视频不完整，不能作方向结论"
        return 1
    fi
    pass "手势诊断：真实录屏完整解码" "仅诊断注入手势，不代表实体触摸或物理声音"
}
