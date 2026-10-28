# shellcheck shell=bash
# Targeted public-UI proof against an existing Release APK. No App hooks, seek,
# replacement lyric renderer or second playback clock.
boundary_tap() {
    local label=$1 tag=$2 x y
    public_ui_target "$label" "boundary-$tag" || return 1
    read -r x y < "$OUT/ui-boundary-$tag-point.txt"
    adb shell input tap "$x" "$y"
}

boundary_dump_info() {
    local phase=$1 size width height
    size=$(adb shell wm size | tr -d '\r' | sed -n 's/^Physical size: //p')
    [[ "$size" =~ ^[0-9]+x[0-9]+$ ]] || return 1
    width=${size%x*}; height=${size#*x}
    # The header remains outside the ScrollView. Reach the real refresh button
    # at the bottom, preserving the full raw tree and the fixed title.
    for _ in {1..8}; do
        adb shell input swipe "$((width/2))" "$((height*3/4))" "$((width/2))" "$((height/3))" 200 || return 1
    done
    public_ui_target '刷新音频信息' "boundary-info-$phase" || return 1
    shot "boundary-info-$phase"
}

boundary_hold() { sleep 12; }

run_lyric_boundary_steps() {
    local wide='WWWWWWWWWWWWWWWWWWWWWWWWWW' file before after
    open_link "musicfree://search?keyword=e2e%20boundaries%20$REF"
    flow '边界：点播真实宽字符夹具' boundary-wide-start.yaml || return 1
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    wait_for_state PAUSED "$wide" 15 || return 1
    list_share_images > "$OUT/share-images-before.txt" || true
    flow '边界：选择四句后直接使用固定保存操作' boundary-wide-card.yaml || return 1
    wait_until 20 new_share_image || return 1
    file=$(cat "$OUT/share-image-latest.txt")
    adb pull "/sdcard/Pictures/MusicFree/$file" "$OUT/boundary-wide.png" > "$OUT/boundary-pull.log" 2>&1 || return 1
    python3 -I "$HERE/lib/lyric_boundaries.py" card "$OUT/boundary-wide.png" > "$OUT/boundary-wide-pixels.json" || return 1
    pass '边界：真实宽W/中文/组合emoji/长英文卡片位于画布内'

    # All subsequent taps use independent public node snapshots so continuous
    # lyric motion does not make Maestro wait for the whole UI to settle.
    prepare_public_ui_observer || return 1
    adb shell input keyevent KEYCODE_BACK
    open_link "musicfree://search?keyword=e2e%20boundaries%20$REF"
    boundary_tap 'E2E Long Word, E2E Artist' long-select || return 1
    boundary_tap '歌曲: E2E Long Word 歌手: E2E Artist' long-mini || return 1
    boundary_tap '显示歌词' long-lyrics || return 1
    public_ui_target '歌词工具' boundary-long-visible || return 1
    before=$(session); printf '%s\n' "$before" > "$OUT/boundary-long-before.json"
    recorded_player_flow '边界：真实2400ms长词与中文长音场景' unused long-word boundary_hold || return 1
    after=$(session); printf '%s\n' "$after" > "$OUT/boundary-long-after.json"
    python3 -I "$SESSION" playing 'E2E Long Word' "$before" "$after" || return 1
    shot boundary-long-word
    pass '边界：长音录屏期间原生播放会话持续前进'

    open_link "musicfree://search?keyword=e2e%20boundaries%20$REF"
    boundary_tap 'E2E Delayed Lyrics, E2E Artist' delay-select || return 1
    boundary_tap '歌曲: E2E Delayed Lyrics 歌手: E2E Artist' delay-mini || return 1
    boundary_tap '分享歌曲与歌词' delay-share || return 1
    public_ui_target '重新载入歌词' boundary-reload-before || return 1
    python3 -I "$HERE/lib/lyric_boundaries.py" empty "$OUT/ui-boundary-reload-before-instrumentation.txt" || return 1
    shot boundary-reload-before
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    wait_for_state PAUSED 'E2E Delayed Lyrics' 15 || return 1
    before=$(session); printf '%s\n' "$before" > "$OUT/boundary-reload-paused.json"
    # The fixture resolves after22s under the original product25s timeout. Keep
    # the panel open; do not replace its frozen snapshot or call App internals.
    sleep 24
    boundary_tap '重新载入歌词' reload || return 1
    public_ui_target '选择歌词：Delayed lyrics ready' boundary-reload-after || return 1
    shot boundary-reload-after
    after=$(session); printf '%s\n' "$after" > "$OUT/boundary-reload-after.json"
    python3 -I "$SESSION" still-paused 'E2E Delayed Lyrics' "$before" "$after" || return 1
    pass '边界：同曲歌词晚到后手动重载，面板保持原曲暂停位置'

    adb shell input keyevent KEYCODE_BACK
    boundary_tap '更多操作' info-menu || return 1
    boundary_tap '当前播放信息' info-open || return 1
    boundary_dump_info 1x || return 1
    adb shell settings put system font_scale 2.0 || return 1
    adb shell settings get system font_scale > "$OUT/boundary-info-font-scale.txt" || return 1
    boundary_dump_info 2x || return 1
    python3 -I "$HERE/lib/lyric_boundaries.py" font "$OUT" > "$OUT/boundary-info-font-proof.json" || return 1
    after=$(session)
    printf '%s\n' "$after" > "$OUT/boundary-info-after.json"
    python3 -I "$SESSION" still-paused 'E2E Delayed Lyrics' "$before" "$after" || return 1
    pass '边界：播放信息真实系统2x字号、固定标题与可达刷新按钮'
}

run_lyric_boundary_checks() {
    local font original_rotation result=0 failures_before=$FAILED
    font=$(adb shell settings get system font_scale | tr -d '\r')
    original_rotation=$(adb shell wm user-rotation | tr -d '\r')
    [[ "$font" =~ ^(null|[0-9]+([.][0-9]+)?)$ ]] || { fail '边界：字体前提' '无法保存实际系统字号'; return 1; }
    [[ "$original_rotation" =~ ^(free|lock\ [0-3])$ ]] || { fail '边界：旋转前提' '无法保存旋转设置'; return 1; }
    printf 'font=%s\nrotation=%s\n' "$font" "$original_rotation" > "$OUT/boundary-original-settings.txt"
    if ! adb shell settings put system font_scale 1.0 || ! adb shell wm user-rotation lock 0; then
        fail '边界：设备设置' '设置失败，没有执行专项'
        return 1
    fi
    run_lyric_boundary_steps || result=$?
    if [ "$font" = null ]; then adb shell settings delete system font_scale >/dev/null || result=1
    else adb shell settings put system font_scale "$font" >/dev/null || result=1; fi
    local -a rotation_args
    read -r -a rotation_args <<< "$original_rotation"
    adb shell wm user-rotation "${rotation_args[@]}" >/dev/null || result=1
    if [ "$result" -ne 0 ] && [ "$FAILED" -eq "$failures_before" ]; then
        fail '边界：专项完整性' '查看原始节点、图片、录屏或设备命令；未完成不能算通过'
    fi
    return "$result"
}
