# shellcheck shell=bash
# Public UI only. Keep private settings on stdin; publish only the selected order.
home_order_matches() {
    adb shell cat "$KV_DIR/App.config.json" 2>/dev/null | python3 -I -c '
import json,sys
value=json.load(sys.stdin)["entries"]["theme.homeSectionOrder"]
order=json.loads(value["v"]) if value["t"]=="s" else None
if order!=sys.argv[1].split(","): sys.exit(1)
print(json.dumps({"homeSectionOrder":order}))
' "$1" > "$OUT/home-order-$2.json" 2>/dev/null
}

run_home_order_checks() {
    if flow "首页：把快捷入口移至最前" home-order.yaml &&
        wait_until 10 home_order_matches "shortcuts,continue,discovery,recent" reordered; then
        pass "首页：排序已写入实际设置"
    else fail "首页：排序已写入实际设置" "未得到实际顺序"; fi
    if flow "首页：恢复默认顺序" home-order-reset.yaml &&
        wait_until 10 home_order_matches "continue,discovery,recent,shortcuts" default; then
        pass "首页：恢复默认设置"
    else fail "首页：恢复默认设置" "未得到实际默认顺序"; fi
}

list_share_images() {
    adb shell ls -1 /sdcard/Pictures/MusicFree/ 2>/dev/null |
        tr -d '\r' | grep -E '^MusicFree-[0-9]+\.png$' | sort
}

new_share_image() {
    local name
    name=$(list_share_images | while read -r file; do
        if ! grep -Fxq "$file" "$OUT/share-images-before.txt"; then printf '%s\n' "$file"; fi
    done)
    [ -n "$name" ] && [ "$(printf '%s\n' "$name" | wc -l)" -eq 1 ] || return 1
    printf '%s' "$name" > "$OUT/share-image-latest.txt"
}

run_share_card_checks() {
    local file kind paused before_resume
    # Maestro's share/tool flows can outlast the 180s fixture. Pause through the
    # actual media control, then explicitly restore it before the existing C/B/A regression.
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    if ! wait_for_state PAUSED "E2E Tone C" 15; then
        fail "分享：原曲暂停前提" "未暂停在 C，没有执行分享流程"
        return 1
    fi
    paused=$(session)
    printf '%s\n' "$paused" > "$OUT/share-playback-paused.json"
    list_share_images > "$OUT/share-images-before.txt" || true
    for kind in song lyric; do
        if ! flow "分享：实际生成 $kind 卡片" "share-$kind-card.yaml" ||
            ! wait_until 20 new_share_image; then
            fail "分享：真实 PNG 导出" "$kind 没有保存新文件"
            return 1
        fi
        file=$(cat "$OUT/share-image-latest.txt")
        if ! adb pull "/sdcard/Pictures/MusicFree/$file" "$OUT/share-card-$kind.png" > "$OUT/share-pull-$kind.log" 2>&1; then
            fail "分享：真实 PNG 导出" "$kind 无法读取"
            return 1
        fi
        list_share_images > "$OUT/share-images-before.txt" || return 1
    done
    if python3 -I "$HERE/lib/share_card.py" "$OUT/share-card-song.png" "$OUT/share-card-lyric.png" > "$OUT/share-card-pixels.json" 2> "$OUT/share-card-pixels-error.txt"; then
        pass "分享：实际 PNG 含远程封面与选中的译文歌词"
    else
        fail "分享：实际 PNG 含远程封面与选中的译文歌词" "见 share-card-pixels-error.txt"
        return 1
    fi
    run_share_receiver_checks || return 1
    flow "歌词工具：保留偏移、聚焦与音译入口" share-close-and-lyric-tools.yaml || return 1
    before_resume=$(session)
    printf '%s\n' "$before_resume" > "$OUT/share-playback-before-resume.json"
    if ! python3 -I "$SESSION" still-paused "E2E Tone C" "$paused" "$before_resume"; then
        fail "分享：原曲暂停前提" "UI 检查期间已换歌或进度改变"
        return 1
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    if wait_for_state PLAYING "E2E Tone C" 15; then
        session > "$OUT/share-playback-resumed.json"
        pass "分享：UI 检查后显式恢复原曲播放"
    else
        fail "分享：UI 检查后显式恢复原曲播放" "未回到 C，停止后续播放回归"
        return 1
    fi
}

# The stand-in has no media permission and reads through a real separate-UID URI
# grant. Keep its activity alive for a delayed second read; do not assume Android
# grants survive force-stop or a finished receiving activity.
share_receiver_report() {
    adb exec-out run-as fun.upup.musicfree.e2e.share cat files/result.json > "$OUT/share-receiver-$1.json" 2>/dev/null || return 1
    python3 -I "$HERE/lib/share_receiver.py" "$1" "$OUT/share-receiver-$1.json" >/dev/null 2>&1
}

run_share_receiver_checks() {
    if [ ! -s "${E2E_SHARE_RECEIVER_APK:-}" ] ||
        ! adb install -r "$E2E_SHARE_RECEIVER_APK" > "$OUT/share-receiver-install.log" 2>&1; then
        fail "分享：独立接收器前提" "测试接收器未安装，没有执行 URI 检查"
        return 1
    fi
    adb shell am start -W -n fun.upup.musicfree.e2e.share/.ReceiveActivity \
        -a android.intent.action.SEND -t image/png > "$OUT/share-receiver-negative-start.txt" 2>&1 || return 1
    if ! wait_until 10 share_receiver_report missing; then
        fail "分享：接收器拒绝缺失附件" "缺失真实 URI 的 Intent 未被拒绝"
        return 1
    fi
    pass "分享：接收器拒绝缺失附件"
    adb shell input keyevent KEYCODE_BACK
    flow "分享：关闭系统选择器后可以重试" share-chooser-cancel.yaml || return 1
    flow "分享：独立应用读取真实图片" share-receiver.yaml || return 1
    if ! wait_until 10 share_receiver_report received; then
        fail "分享：独立 UID 的真实 URI 授权" "接收报告不完整"
        return 1
    fi
    # A chosen receiver may consume its file later, after the sender is backgrounded.
    sleep 5
    flow "分享：后台发送方附件仍可延迟读取" share-receiver-again.yaml || return 1
    if ! wait_until 10 share_receiver_report reread ||
        ! adb exec-out run-as fun.upup.musicfree.e2e.share cat files/received.png > "$OUT/share-receiver.png"; then
        fail "分享：独立 UID 的真实 URI 授权" "第二次读取或图片拉取失败"
        return 1
    fi
    if python3 -I "$HERE/lib/share_receiver.py" image "$OUT/share-receiver-reread.json" "$OUT/share-receiver.png" > "$OUT/share-receiver-verified.json" 2> "$OUT/share-receiver-error.txt"; then
        pass "分享：独立 UID 读取两次且 PNG 字节与像素完整"
    else
        fail "分享：独立 UID 读取两次且 PNG 字节与像素完整" "见 share-receiver-error.txt"
        return 1
    fi
    flow "分享：返回原面板后可以继续操作" share-receiver-return.yaml
}
