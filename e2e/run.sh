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
PLUGIN_BASE="https://raw.githubusercontent.com/CTZZG/MusicFree/$REF/e2e/plugins"

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

# wait_for_state <状态> <标题> <秒>：等到系统媒体会话里这首歌是这个状态（PLAYING、PAUSED……）
wait_for_state() {
    local state=$1 title=$2 deadline=$((SECONDS + $3)) now=""
    while [ $SECONDS -lt $deadline ]; do
        now=$(session)
        if python3 -I "$SESSION" is-state "$state" "$title" "$now"; then
            return 0
        fi
        sleep 1
    done
    log "等了 $3 秒，「$title」还不是 $state，最后一次：$now"
    return 1
}

# wait_for_song <标题> <秒>：等到系统媒体会话在播这首歌
wait_for_song() {
    wait_for_state PLAYING "$1" "$2"
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

# expect_continued <检查名> <标题> <之前的采样>：还在播这首歌，而且接着之前的进度往前播（没有从头播、没有停）
expect_continued() {
    local name=$1 title=$2 before=$3 after problem
    after=$(session)
    if problem=$(python3 -I "$SESSION" playing "$title" "$before" "$after" 1000); then
        pass "$name" "$(python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"进度 {a/1000:.1f}s → {b/1000:.1f}s")' "$before" "$after")"
        return 0
    fi
    fail "$name" "$problem"
    return 1
}

# expect_resumed <检查名> <标题> <暂停时的采样>：在播这首歌，而且是从暂停的地方接着播的
expect_resumed() {
    local name=$1 title=$2 paused=$3 now problem
    if ! wait_for_song "$title" 30; then
        fail "$name" "没在播「$title」：$(session)"
        return 1
    fi
    now=$(session)
    if problem=$(python3 -I "$SESSION" resumed "$title" "$paused" "$now"); then
        pass "$name" "$(python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"暂停在 {a/1000:.1f}s，接着从 {b/1000:.1f}s 播")' "$paused" "$now")"
        return 0
    fi
    fail "$name" "$problem"
    return 1
}

# set_network on|off：模拟器只用 Wi-Fi 上网（移动数据在开头关掉了），关掉 Wi-Fi 就是断网。
# 等系统的默认网络真的断开或连上再返回
set_network() {
    local want=$1 deadline=$((SECONDS + 60)) current=""
    if [ "$want" = on ]; then
        adb shell svc wifi enable
    else
        adb shell svc wifi disable
    fi
    while [ $SECONDS -lt $deadline ]; do
        current=$(adb shell dumpsys connectivity | tr -d '\r' | sed -n 's/^ *Active default network: *//p' | head -n 1)
        if [ -z "$current" ]; then
            log "dumpsys connectivity 里找不到默认网络，等 10 秒"
            sleep 10
            return 0
        fi
        if { [ "$want" = on ] && [ "$current" != none ]; } || { [ "$want" = off ] && [ "$current" = none ]; }; then
            log "网络已$([ "$want" = on ] && echo 连上 || echo 断开)（默认网络：$current）"
            # 刚连上时域名解析可能还没好
            [ "$want" = on ] && sleep 3
            return 0
        fi
        sleep 1
    done
    log "等了 60 秒网络还没$([ "$want" = on ] && echo 连上 || echo 断开)（默认网络：$current）"
    return 1
}

# expect_dock_clear <检查名>：主页上迷你播放器要在底部标签栏上方，不能盖住它（见 lib/dock.py）
expect_dock_clear() {
    local name=$1 detail
    if detail=$(maestro hierarchy --compact --no-reinstall-driver 2>/dev/null | python3 -I "$HERE/lib/dock.py"); then
        pass "$name" "$detail"
        return 0
    fi
    fail "$name" "$detail"
    shot "failed-dock"
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
log "测试音源：$PLUGIN_BASE/"
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

# 2. 用外部链接装两个测试音源（B 只在找其他来源时有结果，见 plugins/e2e-source-b.js）
install_plugin() {
    open_link "musicfree://install/$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PLUGIN_BASE/$1")"
    flow "通过链接安装 $1" install-plugin.yaml
}
install_plugin e2e-source-a.js || finish
install_plugin e2e-source-b.js || finish

# 3. 搜索并依次播放三首，确认系统媒体会话里的进度真的在走。新装的应用点搜索结果时，
#    用整页结果替换播放队列（旧版配置迁移时设的默认值），所以队列就是测试源 A 的那 7 首
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

# 6. 在后台播完一首后自动接下一首。Short 排在队列最后，队列循环模式下播完绕回 A。
#    Short 只有 20 秒，Maestro 读一次界面就要好几秒，所以只用它点歌，开始播放和播完
#    切歌都看媒体会话（每秒查一次）
if flow "点播一首 20 秒的短歌" short-song.yaml; then
    if wait_for_song "E2E Short" 15; then
        adb shell input keyevent KEYCODE_HOME
        expect_playing "后台播完自动接下一首（回到 A）" "E2E Tone A"
    else
        fail "短歌开始播放" "$(session)"
    fi
fi

# 7. 原来源取不到地址时，自动换到其他来源的同一个录音，播放页标出改用的来源
adb shell am start -W -n "$ACTIVITY" > /dev/null
if flow "点播只有其他来源能播的歌" fallback-song.yaml; then
    expect_playing "原来源失败，自动换到测试源 B 播放" "E2E Fallback"
    flow "播放页标出改用的来源" fallback-player.yaml
fi

# 8. 其他来源只有别的版本（Live 版）时不能换，要留下失败提示
flow "其他来源只有 Live 版时不换，留下失败提示" live-only.yaml

# 9. 设置里的播放统计记下了上面的换源和失败
flow "播放统计记下了换源和失败" play-stats.yaml

# 10. 播放中切换音质：在播放页换成 320K，要接着原来的进度播；再选测试源 A 没有的无损，
#     取不到时保持 320K 接着播
before=$(session)
if flow "播放中切到 320K，标签变成 HQ" quality.yaml; then
    expect_continued "切换音质后接着原来的进度播" "E2E Tone A" "$before"
fi
before=$(session)
if flow "选了取不到的无损，标签保持 HQ" quality-unavailable.yaml; then
    expect_continued "取不到新音质时照常播" "E2E Tone A" "$before"
fi

# 11. 冷启动：暂停后把应用彻底关掉（和被系统清掉一样）再打开。播放条要恢复上次那首，
#     音质还是 HQ，点播放从暂停的地方接着播
adb shell input keyevent KEYCODE_MEDIA_PAUSE
if wait_for_state PAUSED "E2E Tone A" 15; then
    # 暂停时会马上存一次进度，留点余量
    sleep 2
    paused=$(session)
    adb shell am force-stop "$PKG"
    sleep 2
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    # 应用起来后会把上次那首按暂停的进度装好：通知栏、锁屏上要停在暂停的地方，不是 0 秒
    restored=""
    problem="30 秒内媒体会话里没有暂停的「E2E Tone A」"
    deadline=$((SECONDS + 30))
    while [ $SECONDS -lt $deadline ]; do
        restored=$(session)
        if problem=$(python3 -I "$SESSION" paused-at "E2E Tone A" "$paused" "$restored"); then
            break
        fi
        sleep 1
    done
    if [ -z "$problem" ]; then
        pass "冷启动后通知栏停在暂停的地方" "$(python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"暂停在 {a/1000:.1f}s，重开后 {b/1000:.1f}s")' "$paused" "$restored")"
    else
        fail "冷启动后通知栏停在暂停的地方" "$problem"
    fi
    if flow "冷启动后恢复上次的歌和音质" cold-start.yaml; then
        expect_resumed "冷启动后点播放，从暂停的地方接着播" "E2E Tone A" "$paused"
    fi
else
    fail "冷启动前暂停" "$(session)"
fi

# 12. 断网：断网后点一首歌，要提示播放未成功（不能一直转圈，也不能一路往下跳）；
#     恢复网络后在提示里点“重试”，要能播
open_link "musicfree://search?keyword=e2e%20$REF"
if flow "再次打开搜索页" search-results.yaml && set_network off; then
    offline_notice=0
    if flow "断网时点歌，提示播放未成功" offline-song.yaml; then
        offline_notice=1
    fi
    log "断网时的媒体会话：$(session)"
    set_network on
    if [ "$offline_notice" -eq 1 ]; then
        flow "网络恢复后在失败提示里点重试" offline-retry.yaml
    else
        flow "网络恢复后再点一次这首歌" offline-replay.yaml
    fi
    expect_playing "网络恢复后在播 B" "E2E Tone B"
fi
# 不管上面哪步没过，都把网络恢复
set_network on > /dev/null

# 13. 迷你播放器不能盖住底部标签栏。从二级页面回到标签页时，播放条会从底部升到标签栏上方；
#     刚升上去就切到后台、过几秒再回来，Reanimated 4.4 会丢掉播放条最后停下的位置，之后
#     页面一重绘（这里是切换标签）播放条就掉回底部、正好盖住标签栏（真机上遇到过“标签栏
#     不见了，只剩播放条”）。patches/react-native-reanimated+4.4.0.patch 修了这个问题
adb shell am start -W -n "$ACTIVITY" > /dev/null
expect_dock_clear "标签页上迷你播放器在标签栏上方"
if flow "打开资料库里的播放历史" library-history.yaml; then
    # 等播放条在二级页面底部停稳，位置同步回 React
    sleep 3
    # 返回标签页，播放条开始上升；升完、还没同步就按 Home 切到后台
    adb shell "input keyevent KEYCODE_BACK; sleep 0.6; input keyevent KEYCODE_HOME"
    sleep 5
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    sleep 2
    flow "回到应用后切到首页标签" tap-home-tab.yaml
    expect_dock_clear "从二级页面返回后马上切后台，回来切标签，迷你播放器不盖住标签栏"
fi

finish
