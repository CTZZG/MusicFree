# Isolated same-APK diagnosis. Never imported by the product branch.
# Every controlled state has one raw screenshot; no failed image is retried or
# fed back into the unchanged normal MV evidence checker.
mv_probe_capture() {
    local phase=$1
    mv_snapshot 'MV 视频画面' "probe-$phase" visible || return 1
    mv_clock_ms > "$OUT/mv/probe-$phase-host-ms.txt"
    adb exec-out screencap -p > "$OUT/mv/probe-$phase.png" || return 1
    mv_record_session "probe-$phase" || return 1
    adb logcat -d -v threadtime > "$OUT/mv/probe-$phase-logcat.txt" || return 1
}
mv_app_scenarios() {
    local before
    mv_pause 'E2E MV Song A' || return 1
    mv_seek .08 original || return 1
    mv_record_session original
    mv_tap '更多操作' original-more || return 1
    mv_start_video 'E2E H264 MV' h264 '观看 MV' || return 1
    before=$(mv_ready_count); mv_seek .125 h264 || return 1
    mv_wait_ready h264-seek "$before" || return 1
    mv_capture inline || return 1
    mv_tap '全屏' fullscreen || return 1
    mv_tap '显示或隐藏 MV 控制' hide-fullscreen-controls || return 1
    mv_probe_capture fullscreen-paused || return 1
    # This later diagnostic sample cannot replace the first fullscreen image.
    sleep 2
    mv_probe_capture fullscreen-wait || return 1
    adb shell input keyevent KEYCODE_MEDIA_PLAY || return 1
    wait_for_state PLAYING 'E2E MV Song A · MV' 15 || return 1
    sleep .9
    mv_probe_capture fullscreen-playing || return 1
    mv_pause || return 1
    mv_probe_capture fullscreen-paused-again || return 1
    adb shell input keyevent KEYCODE_BACK || return 1
    mv_probe_capture inline-paused || return 1
    # Contrast a fullscreen transition while already playing, using only the
    # public play/tap controls. No seek is issued after the original inline seek.
    adb shell input keyevent KEYCODE_MEDIA_PLAY || return 1
    wait_for_state PLAYING 'E2E MV Song A · MV' 15 || return 1
    mv_tap '全屏' playing-fullscreen || return 1
    mv_tap '显示或隐藏 MV 控制' hide-playing-fullscreen-controls || return 1
    mv_probe_capture fullscreen-playing-entry || return 1
    mv_pause || return 1
    adb shell input keyevent KEYCODE_BACK || return 1
}
