#!/usr/bin/env bash
# 在已经开着的 Android 模拟器上跑端到端测试。CI 的 e2e 任务调用它，本地开着模拟器也能直接跑：
#
#   e2e/run.sh <x86_64 APK> <提交号> <结果目录>
#
# 提交号必须已经推到 GitHub：测试插件和测试音频都从这个提交的 raw.githubusercontent.com 地址读取
# （应用只允许从公网 https 地址装插件、取音频）。需要 adb、maestro、python3。
# 结果目录里有 summary.md（每项检查的结果）、截图、Maestro 日志和 logcat。
set -uo pipefail

APK=${1:?用法：e2e/run.sh <APK> <提交号> <结果目录>}
REF=${2:?缺少提交号}
OUT=${3:?缺少结果目录}
PKG=fun.upup.musicfree
ACTIVITY="$PKG/.MainActivity"
HERE="$(cd "$(dirname "$0")" && pwd)"
SESSION="$HERE/lib/media_session.py"
PLUGIN_URL="https://raw.githubusercontent.com/CTZZG/MusicFree/$REF/e2e/plugins/e2e-source-a.js"

mkdir -p "$OUT/screens" "$OUT/maestro"
RESULTS="$OUT/results.tsv"
: > "$RESULTS"
FAILED=0
DRIVER_INSTALLED=0

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
pass() { printf 'PASS\t%s\t%s\n' "$1" "${2:-}" >> "$RESULTS"; log "PASS $1 ${2:-}"; }
fail() { printf 'FAIL\t%s\t%s\n' "$1" "${2:-}" >> "$RESULTS"; log "FAIL $1 ${2:-}"; FAILED=$((FAILED + 1)); }
shot() { adb exec-out screencap -p > "$OUT/screens/$1.png" 2>/dev/null || true; }

# 把当前界面上带文字的元素打到日志里，流程没通过时不用看截图也能知道停在哪
print_screen_text() {
    log "当前界面上的文字："
    maestro hierarchy --compact --no-reinstall-driver 2>/dev/null |
        grep -E 'text=|accessibilityText=' | cut -c1-220 | head -n 80
}

# flow <检查名> <流程文件>：跑一个 Maestro 流程，截图存在结果目录里
flow() {
    local name=$1 file=$2
    local args=(test --test-output-dir "$OUT/maestro/${file%.yaml}")
    if [ "$DRIVER_INSTALLED" -eq 1 ]; then
        args+=(--no-reinstall-driver)
    fi
    DRIVER_INSTALLED=1
    if maestro "${args[@]}" "$HERE/flows/$file" > "$OUT/maestro/${file%.yaml}.log" 2>&1; then
        pass "$name"
        return 0
    fi
    fail "$name" "Maestro 流程 $file 没通过"
    tail -n 25 "$OUT/maestro/${file%.yaml}.log"
    shot "failed-${file%.yaml}"
    print_screen_text
    return 1
}

session() {
    adb shell dumpsys media_session | python3 -I "$SESSION" parse "$PKG"
}

# 每 2 秒记一次播放状态，失败时看歌是怎么切的
TIMELINE_PID=""
start_timeline() {
    (
        while true; do
            printf '%s %s\n' "$(date -u +%H:%M:%S)" \
                "$(adb shell dumpsys media_session | python3 -I "$SESSION" brief "$PKG")"
            sleep 2
        done
    ) > "$OUT/session-timeline.txt" 2>&1 &
    TIMELINE_PID=$!
}

# wait_for_song <标题> <秒>：等到系统媒体会话在播这首歌
wait_for_song() {
    local title=$1 deadline=$((SECONDS + $2)) now=""
    while [ $SECONDS -lt $deadline ]; do
        now=$(session)
        if python3 -I "$SESSION" is-playing "$title" "$now"; then
            return 0
        fi
        sleep 1
    done
    log "等了 $2 秒还没在播「$title」，最后一次：$now"
    return 1
}

# expect_playing <检查名> <标题>：在播这首歌，而且 4 秒里进度真的往前走了
expect_playing() {
    local name=$1 title=$2 first second problem
    if ! wait_for_song "$title" 30; then
        fail "$name" "没在播「$title」：$(session)"
        return 1
    fi
    first=$(session)
    sleep 4
    second=$(session)
    if problem=$(python3 -I "$SESSION" playing "$title" "$first" "$second"); then
        pass "$name" "$(python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"进度 {a/1000:.1f}s → {b/1000:.1f}s")' "$first" "$second")"
        return 0
    fi
    fail "$name" "$problem"
    return 1
}

open_link() {
    adb shell "am start -W -a android.intent.action.VIEW -d '$1' -n $ACTIVITY" > /dev/null
}

write_summary() {
    local passed
    passed=$(grep -c '^PASS' "$RESULTS" || true)
    {
        echo "## 模拟器自动测试"
        echo
        echo "- 提交：\`$REF\`"
        echo "- 设备：$(adb shell getprop ro.product.model | tr -d '\r')，Android $(adb shell getprop ro.build.version.release | tr -d '\r')"
        echo "- 结果：$passed 项通过，$FAILED 项失败"
        echo
        echo "| 结果 | 检查 | 说明 |"
        echo "| --- | --- | --- |"
        while IFS=$'\t' read -r status name detail; do
            if [ "$status" = "PASS" ]; then status="✅"; else status="❌"; fi
            echo "| $status | $name | ${detail//|/\\|} |"
        done < "$RESULTS"
    } > "$OUT/summary.md"
    cat "$OUT/summary.md"
}

finish() {
    if [ -n "$TIMELINE_PID" ]; then
        kill "$TIMELINE_PID" 2>/dev/null || true
        log "播放状态的变化（完整的每 2 秒一条在 session-timeline.txt）："
        # 只列歌名或状态变了的那几条
        awk '{ key = $2; for (i = 3; i < NF; i++) key = key " " $i; if (key != last) print; last = key }' \
            "$OUT/session-timeline.txt"
    fi
    adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
    adb logcat -d -b crash > "$OUT/crash.txt" 2>/dev/null || true
    if [ -s "$OUT/crash.txt" ]; then
        log "有崩溃日志："
        head -n 60 "$OUT/crash.txt"
    fi
    write_summary
    exit $((FAILED > 0 ? 1 : 0))
}

log "设备：$(adb shell getprop ro.product.model | tr -d '\r')，Android $(adb shell getprop ro.build.version.release | tr -d '\r')"
log "插件：$PLUGIN_URL"
# 只留 Wi-Fi：应用在移动网络下默认不播放，会弹“流量提醒”
adb shell svc data disable || true
# 刚开机的模拟器上系统桌面等经常“无响应”，弹窗会盖住应用；应用自己崩溃另看 logcat
adb shell settings put global hide_error_dialogs 1 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
adb logcat -c || true

# 1. 安装并启动。-g 直接给通知、音频读取等运行时权限，不在系统弹窗上卡住
if adb install -r -g "$APK" > "$OUT/install.log" 2>&1; then
    pass "安装 APK" "$(basename "$APK")"
else
    fail "安装 APK" "$(tail -n 3 "$OUT/install.log" | tr '\n' ' ')"
    finish
fi
adb shell am start -W -n "$ACTIVITY" > /dev/null
start_timeline
flow "启动后进入首页" home.yaml || finish

# 2. 用外部链接装测试插件
open_link "musicfree://install/$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PLUGIN_URL")"
flow "通过链接安装测试插件" install-plugin.yaml || finish

# 3. 搜索并依次播放三首，确认系统媒体会话里的进度真的在走
open_link "musicfree://search?keyword=e2e%20$REF"
flow "搜索并依次点播三首歌" play-three.yaml || finish
expect_playing "前台播放：在播 C，进度在走" "E2E Tone C"

# 4. 在后台用媒体键切歌（和通知栏、锁屏按钮走同一条路），再回到应用
adb shell input keyevent KEYCODE_HOME
sleep 3
expect_playing "回到桌面后继续播放" "E2E Tone C"
adb shell input keyevent KEYCODE_MEDIA_PREVIOUS
if wait_for_song "E2E Tone B" 20; then
    pass "后台按上一首：切到 B"
else
    fail "后台按上一首：切到 B" "$(session)"
fi
adb shell input keyevent KEYCODE_MEDIA_PREVIOUS
expect_playing "后台再按上一首：切到 A 并在播" "E2E Tone A"
shot 05-background
adb shell am start -W -n "$ACTIVITY" > /dev/null
sleep 6
expect_playing "回到应用 6 秒后仍在播 A" "E2E Tone A"
flow "回到应用后播放条显示 A" reopened.yaml

# 5. 播放失败要留下提示，点开有处理方式
flow "播放失败后有提示和处理方式" broken-song.yaml
log "失败后的媒体会话：$(session)"

# 6. 在后台播完一首后自动接下一首。队列现在是 A、B、C、Broken、Short，
#    队列循环模式下 Short 播完回到 A。短歌只有 6 秒，Maestro 读一次界面就要好几秒，
#    所以只用它点歌，开始播放和播完切歌都看媒体会话（每秒查一次）
if flow "点播一首 6 秒的短歌" short-song.yaml; then
    if wait_for_song "E2E Short" 15; then
        adb shell input keyevent KEYCODE_HOME
        expect_playing "后台播完自动接下一首（回到 A）" "E2E Tone A"
    else
        fail "短歌开始播放" "$(session)"
    fi
fi

finish
