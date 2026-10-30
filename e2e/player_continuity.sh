# shellcheck shell=bash
# Observe the real player/mini UI. No player commands, extra playback state or speed gate.
recorded_player_flow() {
    local title=$1 file=$2 label=$3 runner=${4:-flow} recorder result=0 remote="/sdcard/mf-continuity-$3.mp4"
    local capture_size=540x1200
    if [ "$label" = landscape ]; then capture_size=1200x540; fi
    recorder=$(adb shell "screenrecord --time-limit 180 --size $capture_size --bit-rate 800000 $remote >/sdcard/mf-continuity-$label.log 2>&1 </dev/null & echo \$!" | tr -d '\r')
    if ! [[ "$recorder" =~ ^[0-9]+$ ]] || ! adb shell kill -0 "$recorder" 2>/dev/null; then
        adb pull "/sdcard/mf-continuity-$label.log" "$OUT/player-$label-recorder.log" >/dev/null 2>&1 || true
        fail "录屏：$label" "录屏未启动，没有用截图充当视频"
        return 1
    fi
    "$runner" "$title" "$file" || result=$?
    adb shell kill -2 "$recorder" 2>/dev/null || true
    for _ in {1..50}; do
        if ! adb shell kill -0 "$recorder" 2>/dev/null; then break; fi
        sleep .2
    done
    adb pull "/sdcard/mf-continuity-$label.log" "$OUT/player-$label-recorder.log" >/dev/null 2>&1 || true
    if ! adb pull "$remote" "$OUT/player-$label.mp4" > "$OUT/player-$label-pull.log" 2>&1 ||
        ! ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name:format=duration \
            -of json "$OUT/player-$label.mp4" > "$OUT/player-$label-video.json" ||
        ! ffmpeg -v error -xerror -i "$OUT/player-$label.mp4" -fps_mode passthrough -enc_time_base -1 -f null - 2> "$OUT/player-$label-decode.log"; then
        fail "录屏：$label" "视频未完整解码，不能评估此段衔接"
        return 1
    fi
    if [ "$result" -ne 0 ]; then return "$result"; fi
    pass "录屏：$label" "真实录屏已解码；只保留观察证据，不设置速度通过线"
}

# Maestro's settling waits follow all visible animation, including unrelated
# views. For animation observation use a separate read-only UI snapshot helper;
# actual taps/back still use shell input and the same 15-second visible target.
prepare_public_ui_observer() {
    if [ ! -s "${E2E_UI_OBSERVER_APK:-}" ] ||
        ! adb install -r -t "$E2E_UI_OBSERVER_APK" > "$OUT/ui-observer-install.txt" 2>&1; then
        fail "播放页观察：公共 UI 前提" "只读快照 helper 未安装，未执行观察"
        return 1
    fi
    source "$HERE/lib/maestro_handoff.sh"
    if ! stop_maestro_ui_driver "$OUT/ui-observer"; then
        fail "播放页观察：公共 UI 前提" "原测试驱动没有释放 UiAutomation"
        return 1
    fi
    DRIVER_INSTALLED=0
}

public_ui_target() {
    local label=$1 tag=$2 encoded
    encoded=$(printf '%s' "$label" | base64 | tr -d '\n')
    adb shell am instrument -w -r -e labelBase64 "$encoded" \
        fun.upup.musicfree.e2e.ui/.UiSnapshot > "$OUT/ui-$tag-instrumentation.txt" 2>&1 || return 1
    python3 -I "$HERE/lib/ui_observer.py" "$OUT/ui-$tag-instrumentation.txt" "$label" > "$OUT/ui-$tag-point.txt"
}

player_observation_ui_flow() {
    local title=$1 phase=${2#continuity-} count=2 i point x y
    local mini='歌曲: E2E Tone C 歌手: E2E Artist'
    phase=${phase%.yaml}
    if [ "$phase" = landscape ]; then count=1; fi
    public_ui_target "$mini" "$phase-before" || return 1
    sleep .4
    shot "player-$phase-mini-before"
    for ((i=1; i<=count; i++)); do
        point=$(cat "$OUT/ui-$phase-before-point.txt")
        read -r x y <<< "$point"
        adb shell input tap "$x" "$y" || return 1
        public_ui_target '更多操作' "$phase-page-$i" || return 1
        # Keep a stable frame as well as the complete transition in the video.
        # This is not a latency sample or a replacement for the visible target.
        sleep .4
        shot "player-$phase-page"
        adb shell input keyevent KEYCODE_BACK || return 1
        public_ui_target "$mini" "$phase-returned-$i" || return 1
        sleep .4
        cp "$OUT/ui-$phase-returned-$i-point.txt" "$OUT/ui-$phase-before-point.txt" || return 1
        shot "player-$phase-mini-after"
    done
    pass "$title" "实际可见节点快照和公开触摸/返回，不等待整个界面的所有动画结束"
}

# Restore settings on every returned error, without replacing the main EXIT trap
# or losing the main harness fail counter in a subshell. Only scalar settings are read.
player_animation_scales() {
    local phase=$1 expected=$2 edge=$3 key value
    local file="$OUT/player-$phase-animation-$edge.txt"
    : > "$file"
    for key in window_animation_scale transition_animation_scale animator_duration_scale; do
        value=$(adb shell settings get global "$key" | tr -d '\r')
        printf '%s=%s\n' "$key" "$value" >> "$file"
        if ! [[ "$value" =~ ^$expected([.]0+)?$ ]]; then
            fail "播放页观察：$phase 动画前提" "实际 $key=$value，不把倍率不符的视频当作对照"
            return 1
        fi
    done
}

run_player_continuity_checks() {
    local rotation key value
    local -A scales
    local -a rotation_args
    local preparation_failures=${FAILED:-0}
    if ! prepare_public_ui_observer; then
        if [ "${FAILED:-0}" -eq "$preparation_failures" ]; then
            fail "播放页观察：公共 UI 前提" "设备命令未完成，没有执行观察"
        fi
        return 1
    fi
    rotation=$(adb shell wm user-rotation | tr -d '\r')
    if ! [[ "$rotation" =~ ^(free|lock\ [0-3])$ ]]; then
        fail "播放页观察：设备前提" "无法保存旋转设置，没有执行观察"
        return 1
    fi
    for key in window_animation_scale transition_animation_scale animator_duration_scale; do
        value=$(adb shell settings get global "$key" | tr -d '\r')
        if ! [[ "$value" =~ ^(null|[0-9]+([.][0-9]+)?)$ ]]; then
            fail "播放页观察：设备前提" "无法保存动画设置，没有执行观察"
            return 1
        fi
        scales[$key]=$value
    done
    {
        printf 'rotation=%s\n' "$rotation"
        for key in "${!scales[@]}"; do printf '%s=%s\n' "$key" "${scales[$key]}"; done
    } > "$OUT/player-observation-original-settings.txt"
    restore_player_observation_settings() {
        local failed=0
        for key in "${!scales[@]}"; do
            if [ "${scales[$key]}" = null ]; then
                adb shell settings delete global "$key" >/dev/null || failed=1
            else
                adb shell settings put global "$key" "${scales[$key]}" >/dev/null || failed=1
            fi
        done
        # The validated string is only "free" or "lock N".
        read -r -a rotation_args <<< "$rotation"
        adb shell wm user-rotation "${rotation_args[@]}" >/dev/null || failed=1
        return "$failed"
    }
    run_player_observation_steps() {
        session > "$OUT/player-observation-before.json"
        if ! adb shell wm user-rotation lock 0; then return 1; fi
        # android-emulator-runner normally disables animations for E2E. The old
        # clip called "default" therefore also had scale 0. Explicitly establish
        # and read back 1x; require it to remain set after the real UI flow.
        for key in "${!scales[@]}"; do
            if ! adb shell settings put global "$key" 1; then return 1; fi
        done
        player_animation_scales default 1 before || return 1
        recorded_player_flow "播放页与迷你条：进入、返回两次" continuity-default.yaml default player_observation_ui_flow || return 1
        player_animation_scales default 1 after || return 1
        if ! adb shell wm user-rotation lock 1; then return 1; fi
        player_animation_scales landscape 1 before || return 1
        recorded_player_flow "播放页：旋转后进入与返回" continuity-landscape.yaml landscape player_observation_ui_flow || return 1
        player_animation_scales landscape 1 after || return 1
        if ! adb shell wm user-rotation lock 0; then return 1; fi
        for key in "${!scales[@]}"; do
            if ! adb shell settings put global "$key" 0; then return 1; fi
        done
        player_animation_scales reduced 0 before || return 1
        recorded_player_flow "播放页与迷你条：系统移除动画下进入、返回" continuity-reduced.yaml reduced player_observation_ui_flow || return 1
        player_animation_scales reduced 0 after || return 1
        if ! python3 -I "$HERE/lib/player_continuity_evidence.py" "$OUT"; then
            fail "播放页观察：设备证据" "实际横屏截图或 1x/0x 设置记录不完整"
            return 1
        fi
        session > "$OUT/player-observation-after.json"
        if ! python3 -I "$SESSION" still-paused "E2E Tone C" \
            "$(cat "$OUT/player-observation-before.json")" "$(cat "$OUT/player-observation-after.json")"; then
            fail "播放页观察：保持暂停位置" "导航/旋转/减少动态期间播放发生变化"
            return 1
        fi
        pass "播放页观察：保持暂停位置" "录屏只观察 UI，前后仍是原来的暂停 C"
    }
    local result=0 failures_before=${FAILED:-0}
    run_player_observation_steps || result=$?
    if [ "$result" -ne 0 ] && [ "${FAILED:-0}" -eq "$failures_before" ]; then
        fail "播放页观察：流程完整性" "设备命令未完成，不能算观察通过"
    fi
    if ! restore_player_observation_settings; then
        fail "播放页观察：恢复设备设置" "恢复旋转/动画设置失败"
        result=1
    fi
    return "$result"
}
