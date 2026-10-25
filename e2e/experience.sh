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
    local file kind
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
    else fail "分享：实际 PNG 含远程封面与选中的译文歌词" "见 share-card-pixels-error.txt"; fi
    flow "歌词工具：保留偏移、聚焦与音译入口" share-close-and-lyric-tools.yaml
}
