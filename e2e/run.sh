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
FOCUS="$HERE/lib/audio_focus.py"
PLUGIN_BASE="https://raw.githubusercontent.com/CTZZG/MusicFree/$REF/e2e/plugins"
# “视频”替身（e2e/focus-app）：像视频应用一样占用音频焦点。CI 先用 focus-app/build.sh 打好
FOCUS_APK=${E2E_FOCUS_APK:-}
FOCUS_PKG=fun.upup.musicfree.e2e.focus

mkdir -p "$OUT/screens" "$OUT/maestro"
RESULTS="$OUT/results.tsv"
: > "$RESULTS"
FAILED=0
DRIVER_INSTALLED=0

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
pass() { printf 'PASS\t%s\t%s\n' "$1" "${2:-}" >> "$RESULTS"; log "PASS $1 ${2:-}"; }
fail() { printf 'FAIL\t%s\t%s\n' "$1" "${2:-}" >> "$RESULTS"; log "FAIL $1 ${2:-}"; FAILED=$((FAILED + 1)); }
shot() { adb exec-out screencap -p > "$OUT/screens/$1.png" 2>/dev/null || true; }
# 播放会话、暂停、“视频”打断的判断（session、stays_paused、held_until_video_ends……）
# shellcheck source=lib/pause_checks.sh
source "$HERE/lib/pause_checks.sh"

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

# expect_stays_paused <检查名> <标题> <秒>：见 lib/pause_checks.sh 的 stays_paused
expect_stays_paused() {
    local name=$1 detail
    if detail=$(stays_paused "$2" "$3"); then
        pass "$name" "$detail"
        return 0
    fi
    fail "$name" "$detail"
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
    sleep 3
    # 用链接换到搜索标签让主页重绘。不去点标签栏：要是已经被盖住，点下去会点到迷你播放器
    open_link "musicfree://search?keyword=e2e%20$REF"
    sleep 3
    expect_dock_clear "从二级页面返回后马上切后台，回来换个标签，迷你播放器不盖住标签栏"
fi

# 14. 插件一直不回应：从 C 按下一首切到取播放地址时插件一直不回应的 Hang。切歌先暂停 C，
#     等一轮取源期限（15 秒）就放弃、回到 C 接着播；以前预取等 15 秒、兜底再向同一个来源
#     要一次又等 15 秒。之后按上一首照常切到 B，切歌没有被卡住。
#     前提（C 在播）没满足时，两项检查都要记失败，不能悄悄跳过
HANG_BACK="插件不回应时只等一轮就回到原来那首"
HANG_NEXT="之后按上一首照常切到 B"
open_link "musicfree://search?keyword=e2e%20hang%20$REF"
if ! flow "点播不回应那首前面的 C" hang-song.yaml; then
    fail "$HANG_BACK" "没能点播 C，没有执行"
    fail "$HANG_NEXT" "没能点播 C，没有执行"
elif ! wait_for_song "E2E Tone C" 30; then
    fail "$HANG_BACK" "点了 C 但 C 没开始播，没有执行：$(session)"
    fail "$HANG_NEXT" "点了 C 但 C 没开始播，没有执行"
else
    adb shell input keyevent KEYCODE_MEDIA_NEXT
    started=$SECONDS
    if ! wait_for_state PAUSED "E2E Tone C" 10; then
        fail "$HANG_BACK" "按下一首后 C 没有暂停等 Hang 的地址：$(session)"
    elif ! wait_for_song "E2E Tone C" 45; then
        fail "$HANG_BACK" "45 秒内没回到 C：$(session)"
    else
        waited=$((SECONDS - started))
        if [ "$waited" -gt 25 ]; then
            fail "$HANG_BACK" "等了 ${waited} 秒才回到 C（一轮取源期限是 15 秒）"
        else
            # 回到 C 之后进度真的在走，不只是状态写着在播
            first=$(session)
            sleep 4
            second=$(session)
            if problem=$(python3 -I "$SESSION" playing "E2E Tone C" "$first" "$second"); then
                pass "$HANG_BACK" "按下一首后 ${waited} 秒回到 C，$(python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"进度 {a/1000:.1f}s → {b/1000:.1f}s")' "$first" "$second")"
            else
                fail "$HANG_BACK" "${waited} 秒回到 C，但没接着播：$problem"
            fi
        fi
    fi
    adb shell input keyevent KEYCODE_MEDIA_PREVIOUS
    expect_playing "$HANG_NEXT" "E2E Tone B"
fi

# 15. 外部暂停（通知栏、锁屏、耳机按键都走系统媒体会话，和这里的媒体键同一条路）是用户主动暂停：
#     切歌取源超时回滚、新歌装好、自动播放补偿都不能把它放出来；之后按播放照常接着放。
#     队列还是上一步搜出来的 B、C、Hang
EXT_ROLLBACK="切歌等地址时按暂停，超时回滚后仍停在 C"
EXT_ROLLBACK_PLAY="之后按播放，C 接着放"
EXT_LOAD="按上一首后马上暂停，B 装好后仍停着"
EXT_LOAD_PLAY="之后按播放，B 接着放"
adb shell input keyevent KEYCODE_MEDIA_NEXT
if ! wait_for_song "E2E Tone C" 30; then
    for check in "$EXT_ROLLBACK" "$EXT_ROLLBACK_PLAY" "$EXT_LOAD" "$EXT_LOAD_PLAY"; do
        fail "$check" "按下一首没切到 C，没有执行：$(session)"
    done
else
    # 切到一直不回应的 Hang：C 先停下等地址，这时按暂停；取源期限 15 秒，多等一会儿
    adb shell input keyevent KEYCODE_MEDIA_NEXT
    if ! wait_for_state PAUSED "E2E Tone C" 10; then
        fail "$EXT_ROLLBACK" "按下一首后 C 没有停下等 Hang 的地址：$(session)"
    else
        sleep 2
        adb shell input keyevent KEYCODE_MEDIA_PAUSE
        expect_stays_paused "$EXT_ROLLBACK" "E2E Tone C" 20
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    expect_playing "$EXT_ROLLBACK_PLAY" "E2E Tone C"

    # 按上一首切到 B，0.3 秒后暂停：B 可能还在装、也可能刚装好，原生的取消暂停重试和
    # JS 的自动播放补偿（2 秒内）都不能再把它放出来
    adb shell "input keyevent KEYCODE_MEDIA_PREVIOUS; sleep 0.3; input keyevent KEYCODE_MEDIA_PAUSE"
    if ! wait_for_state PAUSED "E2E Tone B" 15; then
        fail "$EXT_LOAD" "没停在 B：$(session)"
    else
        expect_stays_paused "$EXT_LOAD" "E2E Tone B" 8
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    expect_playing "$EXT_LOAD_PLAY" "E2E Tone B"
fi

# 16. 看视频：视频临时占用音频焦点（短视频、来电也一样），音乐要停，看的时候自动播放补偿、切歌
#     回滚都不能把焦点抢回来；看完系统还回焦点，音乐自动接着放。看之前、看的时候主动暂停过的，
#     看完仍停着。切歌等地址时来了视频，切歌自己的暂停不算用户暂停，看完也接着放。
#     以替身打出的“放下焦点”日志为界（lib/pause_checks.sh）：之前每秒核对音乐停着、焦点在视频那边，
#     之后才看音乐有没有接着放。视频没结束音乐就放了，记失败
VIDEO_RESUME="看完视频自动接着放"
VIDEO_HELD="看视频期间焦点一直在视频那边，音乐停着"
VIDEO_PAUSED_BEFORE="看视频前暂停，看完仍停着"
VIDEO_PAUSED_DURING="看视频时按暂停，看完仍停着"
VIDEO_SKIP_HELD="切歌等地址时来了视频，回滚后不抢焦点"
VIDEO_SKIP_RESUME="切歌等地址时来了视频，看完接着放原来那首"
VIDEO_CHECKS=("$VIDEO_RESUME" "$VIDEO_HELD" "$VIDEO_PAUSED_BEFORE" "$VIDEO_PAUSED_DURING" "$VIDEO_SKIP_HELD" "$VIDEO_SKIP_RESUME")

# expect_paused_through_video <检查名> <标题> <视频标记> <最多等几秒>：视频期间停着、焦点在视频那边，
#   视频放下焦点之后 8 秒里也仍停着（用户暂停过，系统还回焦点也不接着放）
expect_paused_through_video() {
    local name=$1 title=$2 tag=$3 max=$4 during after
    if ! during=$(held_until_video_ends "$title" "$tag" "$max"); then
        fail "$name" "$during"
        return 1
    fi
    if ! after=$(stays_paused "$title" 8); then
        fail "$name" "视频放下焦点后：$after"
        return 1
    fi
    pass "$name" "$during；视频放下焦点后 $after"
    return 0
}

if [ -z "$FOCUS_APK" ] || ! adb install -r "$FOCUS_APK" > "$OUT/install-focus.log" 2>&1; then
    for check in "${VIDEO_CHECKS[@]}"; do
        fail "$check" "没装上“视频”替身（E2E_FOCUS_APK=${FOCUS_APK:-未设置}），没有执行"
    done
elif ! wait_for_song "E2E Tone B" 10; then
    for check in "${VIDEO_CHECKS[@]}"; do
        fail "$check" "B 没在放，没有执行：$(session)"
    done
else
    # 16a. 在放 B 时看一段 12 秒的视频
    watch_video transient 12 video-a
    if ! wait_for_state PAUSED "E2E Tone B" 5; then
        fail "$VIDEO_HELD" "视频开始后音乐没停：$(session)"
        fail "$VIDEO_RESUME" "视频开始后音乐没停，没有执行"
    elif ! detail=$(held_until_video_ends "E2E Tone B" video-a 25); then
        fail "$VIDEO_HELD" "$detail"
        fail "$VIDEO_RESUME" "视频期间没停住，没有执行"
    else
        pass "$VIDEO_HELD" "12 秒的视频：$detail"
        if detail=$(resumes_after_video "E2E Tone B" 15); then
            pass "$VIDEO_RESUME" "$detail"
        else
            fail "$VIDEO_RESUME" "$detail"
        fi
    fi

    # 16b. 先暂停，再看 6 秒视频：看完仍停着
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    if wait_for_state PAUSED "E2E Tone B" 10; then
        watch_video transient 6 video-b
        expect_paused_through_video "$VIDEO_PAUSED_BEFORE" "E2E Tone B" video-b 20
    else
        fail "$VIDEO_PAUSED_BEFORE" "看视频前没能暂停：$(session)"
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    wait_for_song "E2E Tone B" 15 > /dev/null

    # 16c. 看 10 秒视频，看到第 3 秒按暂停（耳机、蓝牙上的暂停键）：看完仍停着
    watch_video transient 10 video-c
    if wait_for_state PAUSED "E2E Tone B" 5; then
        sleep 3
        adb shell input keyevent KEYCODE_MEDIA_PAUSE
        expect_paused_through_video "$VIDEO_PAUSED_DURING" "E2E Tone B" video-c 20
    else
        fail "$VIDEO_PAUSED_DURING" "视频开始后音乐没停：$(session)"
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY

    # 16d. 从 C 按下一首切到 Hang，C 停下等地址时开始看 25 秒视频。15 秒后切歌放弃、回到 C：
    #      视频还在放，C 要停着、焦点不能被抢回来；看完 C 接着放
    adb shell input keyevent KEYCODE_MEDIA_NEXT
    if ! wait_for_song "E2E Tone C" 30; then
        fail "$VIDEO_SKIP_HELD" "没切到 C，没有执行：$(session)"
        fail "$VIDEO_SKIP_RESUME" "没切到 C，没有执行"
    else
        adb shell input keyevent KEYCODE_MEDIA_NEXT
        if ! wait_for_state PAUSED "E2E Tone C" 10; then
            fail "$VIDEO_SKIP_HELD" "按下一首后 C 没有停下等 Hang 的地址：$(session)"
            fail "$VIDEO_SKIP_RESUME" "C 没有停下等地址，没有执行"
        else
            watch_video transient 25 video-d
            # 切歌 15 秒放弃、回到 C，在视频的第 13 秒左右
            if ! detail=$(held_until_video_ends "E2E Tone C" video-d 40); then
                fail "$VIDEO_SKIP_HELD" "$detail"
                fail "$VIDEO_SKIP_RESUME" "视频期间没停住，没有执行"
            else
                pass "$VIDEO_SKIP_HELD" "25 秒的视频：$detail"
                if detail=$(resumes_after_video "E2E Tone C" 15); then
                    pass "$VIDEO_SKIP_RESUME" "$detail"
                else
                    fail "$VIDEO_SKIP_RESUME" "$detail"
                fi
            fi
        fi
    fi
fi

finish
