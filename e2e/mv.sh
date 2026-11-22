# shellcheck shell=bash
# Normal product APK, public controls + native transition/Surface logs; no diagnostic App entry.
mv_clock_ms() { date +%s%3N; }
mv_snapshot() {
    local label=$1 tag=$2 kind=${3:-clickable} absent=${4:-} timeout_ms=${5:-15000} encoded absent_encoded
    encoded=$(printf '%s' "$label" | base64 | tr -d '\n')
    # adb shell joins argv into a remote command. An empty value disappears and
    # makes Android's -e parser consume the next option as that value.
    local instrument_args=(-e timeoutMs "$timeout_ms")
    if [ -n "$absent" ]; then
        absent_encoded=$(printf '%s' "$absent" | base64 | tr -d '\n')
        instrument_args+=(-e absentLabelBase64 "$absent_encoded")
    fi
    adb shell am instrument -w -r -e labelBase64 "$encoded" -e matchKind "$kind" \
        "${instrument_args[@]}" \
        fun.upup.musicfree.e2e.ui/.UiSnapshot > "$OUT/mv/ui-$tag.txt" 2>&1 || return 1
    local args=()
    if [ -n "$absent" ]; then args+=(--absent "$absent"); fi
    if [ "$kind" = visible ]; then
        python3 -I "$HERE/lib/ui_observer.py" "$OUT/mv/ui-$tag.txt" "$label" --visible "${args[@]}" > "$OUT/mv/point-$tag.txt"
    else
        python3 -I "$HERE/lib/ui_observer.py" "$OUT/mv/ui-$tag.txt" "$label" "${args[@]}" > "$OUT/mv/point-$tag.txt"
    fi
}
mv_tap() {
    local label=$1 tag=$2 x y
    mv_snapshot "$label" "$tag" || return 1
    read -r x y < "$OUT/mv/point-$tag.txt"
    adb shell input tap "$x" "$y"
}
mv_pause() {
    adb shell input keyevent KEYCODE_MEDIA_PAUSE || return 1
    wait_for_state PAUSED "${1:-E2E MV Song A · MV}" 15
}
mv_record_session() { session > "$OUT/mv/session-$1.json"; }
mv_persist() {
    # Filter before writing an artifact. No raw App.PersistStatus or plugin variables are uploaded.
    adb shell cat "'$(kv_path App.PersistStatus)'" | python3 -I "$HERE/mv/evidence.py" persist > "$OUT/mv/persist-$1.json"
}
mv_seek() {
    local fraction=$1 tag=$2 x y
    mv_snapshot '播放进度' "seek-$tag" visible || return 1
    read -r x y < <(python3 -I "$HERE/mv/evidence.py" seek-point "$OUT/mv/ui-seek-$tag.txt" "$fraction")
    [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]] || return 1
    adb shell input swipe "$x" "$y" "$x" "$y" 200 || return 1
}
mv_capture() {
    local phase=$1 source_snapshot=${2:-} picture_deadline=${3:-} picture_started=${4:-}
    if [ -n "$source_snapshot" ]; then
        cp "$source_snapshot" "$OUT/mv/ui-surface-$phase.txt" || return 1
    else
        mv_snapshot 'MV 视频画面' "surface-$phase" visible || return 1
    fi
    # One capture after the native seek-ready event; no retrying stale screenshots.
    sleep .25
    adb exec-out screencap -p > "$OUT/mv/$phase.png" || return 1
    if [ -n "$picture_deadline" ]; then
        local captured_at
        captured_at=$(mv_clock_ms)
        printf '{"startedAtMs":%s,"capturedAtMs":%s,"deadlineMs":%s}\n' "$picture_started" "$captured_at" "$picture_deadline" > "$OUT/mv/$phase-budget.json"
        if [ "$captured_at" -gt "$picture_deadline" ]; then return 1; fi
    fi
    adb logcat -d -v threadtime > "$OUT/mv/log-$phase.txt" || return 1
    mv_record_session "$phase"
    mv_persist "$phase" || return 1
    python3 -I "$HERE/mv/evidence.py" capture "$OUT/mv" "$phase"
}
mv_wait_ready() {
    local tag=$1 before=$2 deadline=${3:-$(( $(mv_clock_ms) + 15000 ))}
    while [ "$(mv_clock_ms)" -lt "$deadline" ]; do
        adb logcat -d -v threadtime > "$OUT/mv/ready-$tag.txt" || return 1
        if python3 -I "$HERE/mv/evidence.py" ready "$OUT/mv/ready-$tag.txt" "$before" > "$OUT/mv/ready-$tag.json" 2> "$OUT/mv/ready-$tag-error.txt"; then return 0; fi
        sleep .1
    done
    return 1
}
mv_ready_count() {
    adb logcat -d -v threadtime | python3 -I "$HERE/mv/evidence.py" count-ready
}
mv_start_video() {
    local title=$1 tag=$2 entry_label=$3 before started deadline remaining
    # The More sheet says "观看 MV"; the discovered cover shortcut says
    # "音乐视频". Keep the actual entry explicit instead of tapping a title.
    mv_tap "$entry_label" "$tag-open" || return 1
    before=$(mv_ready_count)
    mv_tap "$title, E2E Artist, E2E 测试源 A" "$tag-select" || return 1
    started=$(mv_clock_ms)
    deadline=$(( started + 15000 ))
    mv_wait_ready "$tag" "$before" "$deadline" || return 1
    # Clock-ready is not a video frame. Observe the actual native-frame-driven
    # UI before issuing a test pause, within the SAME 15s startup budget.
    remaining=$(( deadline - $(mv_clock_ms) ))
    if [ "$remaining" -le 0 ]; then return 1; fi
    mv_snapshot 'MV 视频画面' "$tag-first-frame" visible '正在等待 MV 画面…' "$remaining" || return 1
    # One real startup PNG, before any test pause/seek can manufacture a frame.
    mv_capture "first-$tag" "$OUT/mv/ui-$tag-first-frame.txt" "$deadline" "$started" || return 1
    mv_pause || return 1
}

# The normal all suite must also exercise its existing audio checks after MV
# tracking has been enabled in this same App process.
run_post_mv_roundtrip_for_all() {
    local before_pid after_pid ready_before
    mkdir -p "$OUT/mv" || return 1
    open_link "musicfree://search?keyword=e2e%20mv%20$REF"
    flow '全量前提：准备MV原歌曲' mv/start.yaml || return 1
    if ! prepare_public_ui_observer || ! adb root > "$OUT/mv/all-adb-root.txt" 2>&1 || ! adb wait-for-device; then
        fail '全量前提：MV往返' '无法准备公开界面观察器或读取合成测试证据'
        return 1
    fi
    before_pid=$(adb shell pidof "$PKG" | tr -d '\r')
    if ! [[ "$before_pid" =~ ^[0-9]+$ ]] || ! mv_pause 'E2E MV Song A' ||
        ! mv_tap '更多操作' all-more || ! mv_start_video 'E2E H264 MV' h264 '观看 MV'; then
        fail '全量前提：MV往返' '没有在当前进程中取得并暂停真实MV画面'
        return 1
    fi
    if ! ready_before=$(mv_ready_count) || ! [[ "$ready_before" =~ ^[0-9]+$ ]]; then
        fail '全量前提：MV往返' '无法读取返回歌曲前的原生就绪计数'
        return 1
    fi
    if ! mv_tap '返回歌曲' all-return || ! mv_wait_ready all-return "$ready_before" ||
        ! wait_for_state PAUSED 'E2E MV Song A' 15 || ! mv_record_session all-return || ! mv_persist all-return; then
        fail '全量前提：MV往返' '未确认返回原歌曲并保持暂停'
        return 1
    fi
    shot mv-all-returned-audio
    if ! adb shell input keyevent KEYCODE_BACK || ! mv_tap '首页' all-home ||
        ! flow '全量前提：返回首页' home.yaml; then
        fail '全量前提：MV往返' '无法返回首页继续普通回归'
        return 1
    fi
    after_pid=$(adb shell pidof "$PKG" | tr -d '\r')
    if [ "$before_pid" != "$after_pid" ]; then
        fail '全量前提：MV往返' '应用进程已改变，无法证明后续普通回归位于MV之后'
        return 1
    fi
    printf '%s\n' "$before_pid" > "$OUT/mv/all-process-id.txt"
    pass '全量前提：MV往返后继续普通回归' '真实首帧及原歌曲暂停已确认，App进程未重启'
}

check_post_mv_all_process() {
    local before_pid current_pid
    [ -s "$OUT/mv/all-process-id.txt" ] || return 1
    before_pid=$(cat "$OUT/mv/all-process-id.txt")
    current_pid=$(adb shell pidof "$PKG" | tr -d '\r')
    [[ "$before_pid" =~ ^[0-9]+$ ]] && [ "$before_pid" = "$current_pid" ]
}

run_mv_checks() {
    mkdir -p "$OUT/mv"
    local rotation recorder status=0 before after rotation_args
    rotation=$(adb shell wm user-rotation | tr -d '\r')
    if ! [[ "$rotation" =~ ^(free|lock\ [0-3])$ ]]; then fail 'MV：旋转前提' '无法保存旋转模式'; return 1; fi
    open_link "musicfree://search?keyword=e2e%20mv%20$REF"
    flow 'MV：准备原歌曲队列' mv/start.yaml || return 1
    prepare_public_ui_observer || return 1
    adb root > "$OUT/mv/adb-root.txt" 2>&1 || return 1
    adb wait-for-device
    # Keep a host stream through subsequent UiAutomation/Activity operations.
    adb logcat -v threadtime > "$OUT/mv/native-stream.txt" 2> "$OUT/mv/native-stream-error.txt" &
    local stream_pid=$!
    recorder=$(adb shell 'screenrecord --time-limit 180 --size 540x1200 --bit-rate 1000000 /sdcard/musicfree-mv-app.mp4 >/sdcard/musicfree-mv-app-recorder.txt 2>&1 </dev/null & echo $!' | tr -d '\r')
    if ! [[ "$recorder" =~ ^[0-9]+$ ]] || ! adb shell kill -0 "$recorder" 2>/dev/null; then
        kill "$stream_pid" 2>/dev/null || true; fail 'MV：录屏前提' '实际录屏没有启动'; return 1
    fi
    adb shell log -t MV_APP_GATE MV_APP_RECORD_BEGIN
    printf '{"apkCommit":"%s","scriptCommit":"%s","apkSha256":"%s"}\n' "${E2E_APK_COMMIT:-}" "$REF" "$(sha256sum "$APK" | cut -d' ' -f1)" > "$OUT/mv/source.json"
    mv_app_scenarios || status=$?
    if [ "$status" -ne 0 ]; then
        # Preserve the first failed state, never feed these later diagnostic
        # pixels back into a passed capture or retry a frame assertion.
        mv_clock_ms > "$OUT/mv/first-failure-host-ms.txt"
        adb exec-out screencap -p > "$OUT/mv/first-failure.png" || true
        session > "$OUT/mv/session-first-failure.json" || true
        timeout 5s adb shell dumpsys gfxinfo "$PKG" > "$OUT/mv/first-failure-gfx.txt" 2>&1 || true
        timeout 5s adb shell dumpsys SurfaceFlinger --list > "$OUT/mv/first-failure-surfaces.txt" 2>&1 || true
    fi
    adb shell log -t MV_APP_GATE MV_APP_RECORD_END
    # Restore every setting even after an assertion fails. Do not turn a partial run green.
    read -r -a rotation_args <<< "$rotation"
    adb shell wm user-rotation "${rotation_args[@]}" > "$OUT/mv/rotation-restored.txt" 2>&1 || status=1
    adb shell kill -2 "$recorder" 2>/dev/null || true
    for _ in {1..50}; do if ! adb shell kill -0 "$recorder" 2>/dev/null; then break; fi; sleep .2; done
    kill "$stream_pid" 2>/dev/null || true
    wait "$stream_pid" 2>/dev/null || true
    adb pull /sdcard/musicfree-mv-app.mp4 "$OUT/mv/app.mp4" > "$OUT/mv/video-pull.txt" 2>&1 || status=1
    if ! ffmpeg -v error -xerror -i "$OUT/mv/app.mp4" -fps_mode passthrough -enc_time_base -1 -f null - 2> "$OUT/mv/video-decode.txt"; then status=1; fi
    if [ "$status" -ne 0 ]; then fail 'MV：正常App专项' '首个真实步骤失败，原始UI/native/PNG/录屏保留，没有重试断言'; return 1; fi
    if python3 -I "$HERE/mv/evidence.py" verify "$OUT/mv"; then
        pass 'MV：正常App独立证据' '真实按钮、帧、返回停点、后台与视频EOF接管；不代表物理声音'
    else fail 'MV：正常App独立证据' '原始证据不满足完整契约'; return 1; fi
}
mv_app_scenarios() {
    local before
    mv_pause 'E2E MV Song A' || return 1
    mv_seek .08 original || return 1
    sleep .5
    mv_record_session original
    mv_tap '更多操作' original-more || return 1
    mv_start_video 'E2E H264 MV' h264 '观看 MV' || return 1
    before=$(mv_ready_count); mv_seek .125 h264 || return 1; mv_wait_ready h264-seek "$before" || return 1
    mv_capture inline || return 1
    pass 'MV：明确选择H264出画' '实际PNG帧检验通过，原歌曲身份保留，ready后暂停'
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_FULLSCREEN_BEGIN || return 1
    mv_tap '全屏' fullscreen || return 1
    mv_tap '显示或隐藏 MV 控制' hide-fullscreen-controls || return 1
    mv_capture fullscreen || return 1
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_FULLSCREEN_END || return 1
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_INLINE_BEGIN || return 1
    adb shell input keyevent KEYCODE_BACK || return 1
    mv_snapshot 'MV 视频画面' returned-inline visible || return 1
    mv_capture returned-inline || return 1
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_INLINE_END || return 1
    pass 'MV：同页全屏与返回' '同一代际画面，Back只退出全屏'
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_ROTATION_BEGIN || return 1
    adb shell wm user-rotation lock 1 > "$OUT/mv/rotation-landscape.txt" 2>&1 || return 1
    mv_capture landscape || return 1
    adb shell wm user-rotation lock 0 > "$OUT/mv/rotation-portrait.txt" 2>&1 || return 1
    mv_capture portrait || return 1
    adb shell log -t MV_APP_GATE MV_APP_LAYOUT_ROTATION_END || return 1
    adb shell input keyevent KEYCODE_MEDIA_PLAY || return 1
    wait_for_state PLAYING 'E2E MV Song A · MV' 15 || return 1
    mv_capture before-home || return 1
    adb shell log -t MV_APP_GATE MV_APP_HOME_BEGIN
    adb shell input keyevent KEYCODE_HOME || return 1
    sleep 2
    mv_record_session background
    adb shell log -t MV_APP_GATE MV_APP_HOME_END
    adb shell am start -W -n "$ACTIVITY" > "$OUT/mv/foreground-start.txt" 2>&1 || return 1
    mv_pause || return 1
    mv_capture foreground || return 1
    pass 'MV：后台音轨与前台新画面' '真实Home窗口Surface释放，原MV代际保持'
    mv_tap 'MV 选项' quality-options || return 1
    before=$(mv_ready_count); mv_tap '360p' quality-select || return 1
    mv_wait_ready quality "$before" || return 1
    mv_capture quality || return 1
    pass 'MV：同剪辑画质保留视频位置' '独立核对native preserve-mv和实际360p画面'
    mv_tap 'MV 选项' alternate-options || return 1
    mv_tap '另一个剪辑' alternate-select || return 1
    before=$(mv_ready_count)
    mv_tap '从头播放' alternate-confirm || return 1
    mv_wait_ready alternate "$before" || return 1
    mv_pause || return 1
    before=$(mv_ready_count); mv_seek .08 alternate || return 1; mv_wait_ready alternate-seek "$before" || return 1
    mv_capture alternate || return 1
    pass 'MV：不同剪辑确认后重头' '明确确认后才执行start-zero，没有把歌曲或旧MV秒数套入'
    mv_tap '返回歌曲' audio-return || return 1
    wait_for_state PAUSED 'E2E MV Song A' 15 || return 1
    mv_snapshot '更多操作' audio-returned-more || return 1
    mv_record_session returned-audio
    mv_persist returned-audio || return 1
    shot mv-returned-audio
    pass 'MV：返回歌曲原停点' '在同一个mpv恢复原音频，稍后独立核对native捕获与ready'
    mv_tap '音乐视频' missing-open || return 1
    mv_tap 'E2E Unavailable MV, E2E Artist, E2E 测试源 A' missing-select || return 1
    mv_snapshot '更多操作' missing-restored || return 1
    wait_for_state PAUSED 'E2E MV Song A' 15 || return 1
    mv_record_session missing-restored
    mv_persist missing-restored || return 1
    shot mv-missing-restored
    pass 'MV：实际404后恢复原音频' '原停点仍保留，不在错误页卡住，也不因回退自动播放'
    # Use the real audio-rate control before the final MV. Its native prepared
    # successor must restore this value even if JS is not involved in promotion.
    flow 'MV：设置原歌曲1.5倍速' mv/set-rate.yaml || return 1
    prepare_public_ui_observer || return 1
    # The positive cover shortcut is only shown after actual candidate discovery.
    mv_start_video 'E2E HEVC MV' hevc '音乐视频' || return 1
    before=$(mv_ready_count); mv_seek .08 hevc || return 1; mv_wait_ready hevc-seek "$before" || return 1
    mv_capture hevc || return 1
    pass 'MV：明确选择HEVC出画' '第二候选从头，不套原歌曲或上一MV时间'
    # Seek near this short video's end via the actual slider, then let it finish.
    mv_seek .99 eof || return 1
    adb shell input keyevent KEYCODE_MEDIA_PLAY || return 1
    wait_for_state PLAYING 'E2E MV Song B' 25 || return 1
    mv_record_session prepared-audio
    shot mv-prepared-audio
    adb logcat -d -v threadtime > "$OUT/mv/log-prepared-audio.txt" || return 1
    pass 'MV：真实视频EOF进入预备歌曲' '必须再由native autoAdvanced日志证明不是JS重新加载'
}
