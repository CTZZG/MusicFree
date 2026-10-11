# shellcheck shell=bash
# 锁屏和省电（run.sh 的第 19、20 步）。run.sh source 这个文件，用它的 pass、fail、flow、open_link、
# log、session、wait_for_state、stays_paused、watch_video 等函数和 PKG、ACTIVITY、REF、OUT、HERE 等变量。
#
# 锁屏：灭屏后系统锁屏界面盖在上面，应用的界面停了，只剩播放服务和 JS 在后台跑。通知栏、锁屏上的按钮、
# 耳机按键都经过系统媒体会话：锁屏界面上的按钮用 Maestro 去点，其余用媒体键。
# 省电：拔电后强制进入深度休眠（Doze），再试省电模式。模拟器进 Doze 后 CPU 并不会真的停，真机熟睡时
# 计时器停走、厂商自己的省电和杀后台都测不到，要在真机上另外看。

DEVICE_STATE="$HERE/lib/device_state.py"
# shellcheck source=lib/power_environment.sh
source "$HERE/lib/power_environment.sh"

# ---- 设备状态 ----

screen_state() {
    adb shell dumpsys power | python3 -I "$DEVICE_STATE" wakefulness
}

screen_off() {
    local state
    state=$(screen_state 2>/dev/null) && [ "$state" != Awake ]
}

screen_on() {
    [ "$(screen_state 2>/dev/null)" = Awake ]
}

# keyguard_state：showing 或 hidden。不同版本写在不同的 dumpsys 里，先看窗口策略再看 activity
keyguard_state() {
    adb shell dumpsys window policy | python3 -I "$DEVICE_STATE" keyguard 2>/dev/null ||
        adb shell dumpsys activity activities | python3 -I "$DEVICE_STATE" keyguard
}

keyguard_showing() {
    [ "$(keyguard_state 2>/dev/null)" = showing ]
}

keyguard_hidden() {
    [ "$(keyguard_state 2>/dev/null)" = hidden ]
}

deep_idle_state() {
    adb shell dumpsys deviceidle | python3 -I "$DEVICE_STATE" deep-idle
}

deep_idle() {
    [ "$(deep_idle_state 2>/dev/null)" = IDLE ]
}

deep_idle_active() {
    [ "$(deep_idle_state 2>/dev/null)" = ACTIVE ]
}

power_saver_on() {
    [ "$(adb shell settings get global low_power 2>/dev/null | tr -d '\r')" = 1 ]
}

# device_summary：末尾的一次设备状态，供排查；整段期间的环境由 power_check 采样核对
device_summary() {
    local screen keyguard idle saver
    screen=$(screen_state 2>/dev/null || echo ?)
    keyguard=$(keyguard_state 2>/dev/null || echo ?)
    idle=$(deep_idle_state 2>/dev/null || echo ?)
    saver=$(adb shell settings get global low_power 2>/dev/null | tr -d '\r')
    echo "屏幕 $screen，锁屏 $keyguard，深度休眠 $idle，省电模式 ${saver:-?}"
}

# 这几个状态第一次读不出来时，把 dumpsys 里相关的几行打到日志里
log_raw_device_state() {
    log "设备状态原文："
    adb shell dumpsys power | tr -d '\r' | grep -E 'mWakefulness=|mBatterySaver|LowPower' | head -n 8
    adb shell dumpsys window policy | tr -d '\r' | grep -iE 'keyguard|showing' | head -n 12
    adb shell dumpsys deviceidle | tr -d '\r' | grep -E 'mState=|mForceIdle|mDeepEnabled' | head -n 4
}

# lock_screen：灭屏。锁屏界面在亮屏时才看得到，这里只等屏幕灭掉
lock_screen() {
    adb shell input keyevent KEYCODE_SLEEP
    wait_until 10 screen_off
}

# wake_to_lock_screen：亮屏但不解锁，停在锁屏界面
wake_to_lock_screen() {
    adb shell input keyevent KEYCODE_WAKEUP
    wait_until 10 screen_on && wait_until 10 keyguard_showing
}

# unlock：亮屏、解锁，回到应用
unlock() {
    adb shell input keyevent KEYCODE_WAKEUP
    wait_until 10 screen_on
    adb shell wm dismiss-keyguard
    wait_until 10 keyguard_hidden
}

# restore_power：退出休眠、省电，接回电源，亮屏解锁，回到应用。后面的步骤要用正常状态
restore_power() {
    adb shell dumpsys deviceidle unforce > /dev/null 2>&1 || true
    adb shell cmd power set-mode 0 > /dev/null 2>&1 || true
    adb shell dumpsys battery reset || true
    unlock || log "没能解锁：$(device_summary)"
    adb shell am start -W -n "$ACTIVITY" > /dev/null
}

# ---- 播放的判断 ----

# expect_progress_for <检查名> <标题> <秒>：这段时间里每 5 秒看一次，一直在播这首，最后比开始至少多播了
#   （秒数 - 5）秒。这套 E2E 使用 Android 14，不运行 Android 16 Live Update 的秒级通知刷新；
#   会话仍可能含有服务估算；这里只验证会话进度，不能证明扬声器实际输出或 CPU 真正休眠
expect_progress_for() {
    local name=$1 title=$2 seconds=$3 start now deadline problem samples=0
    start=$(session)
    if ! python3 -I "$SESSION" is-playing "$title" "$start"; then
        fail "$name" "开始时没在播「$title」：$(sample_text "$start")；$(device_summary)"
        return 1
    fi
    now=$start
    deadline=$(( $(clock) + seconds ))
    while [ "$(clock)" -lt "$deadline" ]; do
        sleep 5
        now=$(session)
        samples=$((samples + 1))
        if ! python3 -I "$SESSION" is-playing "$title" "$now"; then
            fail "$name" "第 $samples 次采样不在播「$title」：$(sample_text "$now")；$(device_summary)"
            return 1
        fi
    done
    if ! problem=$(python3 -I "$SESSION" playing "$title" "$start" "$now" $(((seconds - 5) * 1000))); then
        fail "$name" "$problem；$(device_summary)"
        return 1
    fi
    pass "$name" "$seconds 秒里采样 $samples 次一直在播，$(progress_text "$start" "$now")；$(device_summary)"
}

# expect_hang_rollback <检查名> <标题>：在播这首时按下一首，切到取地址时一直不回应的 Hang。这首先停下
#   等地址，一轮取源期限（15 秒）后放弃、回到这首接着播。期限用后台计时器，灭屏、休眠时也要按时到：
#   25 秒内回来、进度在走才算通过
expect_hang_rollback() {
    local name=$1 title=$2 started waited first second problem
    adb shell input keyevent KEYCODE_MEDIA_NEXT
    started=$(clock)
    if ! wait_for_state PAUSED "$title" 10; then
        fail "$name" "按下一首后「$title」没有停下等 Hang 的地址：$(session)"
        return 1
    fi
    if ! wait_for_song "$title" 45; then
        fail "$name" "45 秒内没回到「$title」：$(sample_text "$(session)")；$(device_summary)"
        return 1
    fi
    waited=$(( $(clock) - started ))
    first=$(session)
    sleep 4
    second=$(session)
    if ! problem=$(python3 -I "$SESSION" playing "$title" "$first" "$second"); then
        fail "$name" "${waited} 秒回到「$title」，但没接着播：$problem"
        return 1
    fi
    if [ "$waited" -gt 25 ]; then
        fail "$name" "等了 ${waited} 秒才回到「$title」（取源期限 15 秒）；$(device_summary)"
        return 1
    fi
    pass "$name" "按下一首后 ${waited} 秒回到「$title」，$(progress_text "$first" "$second")；$(device_summary)"
}

# tap_lock_screen_next <原歌> <新歌>：按系统读屏标签解析本次按钮位置，adb 点屏幕上的按钮。
# 不用固定坐标，也不等锁屏进度条静止；仍在原歌时最多重试三次，出现新歌就停止，避免多点到 Hang。
tap_lock_screen_next() {
    local before=$1 target=$2 attempt tree point x y now
    for attempt in 1 2 3; do
        now=$(session)
        if [ "$attempt" -gt 1 ] && python3 -I "$SESSION" is-playing "$target" "$now"; then
            echo "前一次点击后已切到「$target」"
            return 0
        fi
        if ! python3 -I "$SESSION" is-playing "$before" "$now"; then
            echo "点击前不是在播「$before」：$(sample_text "$now")"
            return 1
        fi
        if ! tree=$(maestro hierarchy --compact --no-reinstall-driver 2> "$OUT/lock-controls-$attempt.log"); then
            echo "无法读取锁屏控件"
            return 1
        fi
        if ! point=$(printf '%s\n' "$tree" | python3 -I "$DEVICE_STATE" media-next-point 2>&1); then
            echo "$point"
            return 1
        fi
        if ! screen_on || ! keyguard_showing || ! python3 -I "$SESSION" is-playing "$before" "$(session)"; then
            echo "定位后不再是亮屏锁屏界面上的「$before」：$(device_summary)"
            return 1
        fi
        read -r x y <<< "$point"
        if ! adb shell input tap "$x" "$y"; then
            echo "无法点击当前下一曲控件"
            return 1
        fi
        if wait_for_song "$target" 8 > /dev/null; then
            echo "第 $attempt 次点击系统下一曲控件后切到「$target」"
            return 0
        fi
    done
    echo "点击三次系统下一曲控件后没有切到「$target」：$(sample_text "$(session)")"
    return 1
}

# tapped_next <原来那首> <点之前的采样> <切过去之后的采样> <两次采样隔了几秒> <原来那首的长度（秒）>：
#   切过去的那一刻原来那首播到了哪里（点之前的进度 + 隔的时间 - 新歌已经播的）。离播完不到 5 秒时，
#   分不清是点出来的还是播完自动接的：输出原因、返回 1
tapped_next() {
    local title=$1 before=$2 after=$3 elapsed=$4 length=$5 at
    if ! python3 -I "$SESSION" is-playing "$title" "$before"; then
        echo "点之前没在播「$title」：$(sample_text "$before")"
        return 1
    fi
    at=$(python3 -I -c 'import json,sys; b,a=(json.loads(x)["position"] for x in sys.argv[1:3]); print(int(b / 1000 + int(sys.argv[3]) - a / 1000))' "$before" "$after" "$elapsed")
    if [ "$at" -ge $((length - 5)) ]; then
        echo "切歌时「$title」已经播到约 ${at}s（共 ${length} 秒），分不清是点出来的还是播完自动接的"
        return 1
    fi
    echo "切歌时「$title」播到约 ${at}s（共 ${length} 秒，不是播完自动接的）"
}

# expect_paused_resume <检查名> <标题> <停多少秒>：先暂停，这段时间里一直停着，再按播放从暂停处接着播
expect_paused_resume() {
    local name=$1 title=$2 seconds=$3 paused detail
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    if ! wait_for_state PAUSED "$title" 10; then
        fail "$name" "按暂停后没停下：$(session)"
        return 1
    fi
    paused=$(session)
    if ! detail=$(stays_paused "$title" "$seconds"); then
        fail "$name" "暂停期间：$detail；$(device_summary)"
        return 1
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    expect_power_resumed "$name" "$title" "$paused"
}

# 恢复不仅要回到暂停处，还要继续前进；run.sh 的 expect_resumed 只检查恢复位置。
expect_power_resumed() {
    local name=$1 title=$2 paused=$3 first second problem
    if ! wait_for_song "$title" 30; then
        fail "$name" "按播放后没恢复：$(session)"
        return 1
    fi
    first=$(session)
    if ! problem=$(python3 -I "$SESSION" resumed "$title" "$paused" "$first"); then
        fail "$name" "$problem"
        return 1
    fi
    sleep 4
    second=$(session)
    if ! problem=$(python3 -I "$SESSION" playing "$title" "$first" "$second"); then
        fail "$name" "恢复后进度没继续走：$problem"
        return 1
    fi
    pass "$name" "从 $(position_text "$paused") 恢复，$(progress_text "$first" "$second")"
}

resume_after_power_pause() {
    local name=$1 title=$2 paused=$3 detail
    if ! detail=$(stays_paused "$title" "$4"); then
        fail "$name" "$detail"
        return 1
    fi
    adb shell input keyevent KEYCODE_MEDIA_PLAY
    expect_power_resumed "$name" "$title" "$paused"
}

expect_power_skip() {
    local name=$1 title=$2 key=$3
    adb shell input keyevent "$key"
    expect_playing "$name" "$title"
}

expect_power_pause_skip() {
    local name=$1 title=$2
    adb shell input keyevent KEYCODE_MEDIA_NEXT
    if ! wait_for_state PAUSED "$title" 10; then
        fail "$name" "按下一首后没有停下等地址：$(session)"
        return 1
    fi
    sleep 2
    adb shell input keyevent KEYCODE_MEDIA_PAUSE
    expect_power_paused "$name" "$title" 20
}

expect_power_paused() {
    local name=$1 detail
    if detail=$(stays_paused "$2" "$3"); then
        pass "$name" "$detail"
        return 0
    fi
    fail "$name" "$detail"
    return 1
}

expect_power_focus_start() {
    local name=$1 title=$2 tag=$3
    watch_video transient 12 "$tag"
    if ! wait_for_state PAUSED "$title" 5; then
        fail "$name" "焦点打断后音乐没停：$(session)；焦点在 $(focus_owner)"
        return 1
    fi
    expect_power_focus_held "$name" "$title" "$tag" 25
}

expect_power_focus_held() {
    local name=$1 detail
    if detail=$(held_until_video_ends "$2" "$3" "$4"); then
        pass "$name" "$detail"
        return 0
    fi
    fail "$name" "$detail"
    return 1
}

expect_power_focus_resume() {
    local name=$1 detail
    if detail=$(resumes_after_video "$2" "$3"); then
        pass "$name" "$detail"
        return 0
    fi
    fail "$name" "$detail"
    return 1
}

# player_matches_session <播放页上的“已播放 剩余”秒数> <读界面前的采样> <读界面后的采样>：播放页上的已播放时间
#   在读界面前后两次采样之间（界面上的时间每秒刷新一次，读界面要几秒，两头各放宽 2 秒），两次都在播
#   同一首。输出说明，对不上返回 1
player_matches_session() {
    local shown=$1 before=$2 after=$3 elapsed low high
    if ! python3 -I "$SESSION" is-playing "$(sample_title "$before")" "$after" ||
        [ "$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1]).get("state"))' "$before")" != PLAYING ]; then
        echo "读界面时媒体会话不是一直在播同一首：$(sample_text "$before") → $(sample_text "$after")"
        return 1
    fi
    elapsed=${shown%% *}
    low=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["position"] // 1000 - 2)' "$before")
    high=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["position"] // 1000 + 2)' "$after")
    if [ "$elapsed" -lt "$low" ] || [ "$elapsed" -gt "$high" ]; then
        echo "播放页显示已播放 ${elapsed}s，媒体会话在 $(position_text "$before") → $(position_text "$after")"
        return 1
    fi
    echo "已播放 ${elapsed}s；媒体会话 $(position_text "$before") → $(position_text "$after")"
}

sample_title() {
    python3 -I -c 'import json,sys; print(json.loads(sys.argv[1]).get("title", ""))' "$1"
}

# expect_player_matches <检查名> <标题>：解锁后打开播放页，歌名、播放/暂停按钮（open-player.yaml）和
#   进度（player_matches_session）跟系统媒体会话一致
expect_player_matches() {
    local name=$1 title=$2 before tree after shown detail
    if ! flow "解锁后打开「$title」的播放页，按钮是暂停" open-player.yaml -e TITLE="$title" -e BUTTON=暂停; then
        fail "$name" "播放页上不是在播的「$title」，没有执行"
        return 1
    fi
    before=$(session)
    tree=$(maestro hierarchy --compact --no-reinstall-driver 2>/dev/null)
    after=$(session)
    if ! shown=$(printf '%s\n' "$tree" | python3 -I "$DEVICE_STATE" player-time 2>&1); then
        fail "$name" "播放页上读不到进度：$shown"
        return 1
    fi
    if ! python3 -I "$SESSION" is-playing "$title" "$before"; then
        fail "$name" "读界面时媒体会话不在播「$title」：$(sample_text "$before")"
        return 1
    fi
    if detail=$(player_matches_session "$shown" "$before" "$after"); then
        pass "$name" "播放页：「$title」、暂停按钮、$detail"
        return 0
    fi
    fail "$name" "$detail"
    return 1
}

# ---- 第 19 步：锁屏 ----

LOCK_BUTTON="锁屏界面上点下一曲：从 B 切到 C"
LOCK_PLAY="锁屏 30 秒照常播放"
LOCK_HANG="锁屏时切到不回应的歌：15 秒期限照常到，回到 C 接着播"
LOCK_PAUSE_HANG="锁屏时切歌等地址按暂停：超时回滚后仍停着"
LOCK_PAUSE_LONG="锁屏暂停 1 分钟后按播放：从暂停处接着播"
LOCK_HANG_NEXT="锁屏时两次切歌超时之后，按上一首照常切到 B"
LOCK_FOCUS_HELD="锁屏时临时占用音频焦点：打断期间停着"
LOCK_FOCUS_RESUME="锁屏时临时音频焦点打断结束：接着放"
LOCK_UNLOCK="解锁后播放页和系统媒体会话一致"

# start_b：队列换成 B、C、Hang，从头放 B（点播 C 再按上一首）。应用要在前台
start_b() {
    open_link "musicfree://search?keyword=e2e%20hang%20$REF"
    flow "$1" hang-song.yaml &&
        adb shell input keyevent KEYCODE_MEDIA_PREVIOUS &&
        wait_for_song "E2E Tone B" 20
}

run_lock_screen_checks() {
    local all=("$LOCK_BUTTON" "$LOCK_PLAY" "$LOCK_HANG" "$LOCK_PAUSE_HANG" "$LOCK_PAUSE_LONG" \
        "$LOCK_HANG_NEXT" "$LOCK_FOCUS_HELD" "$LOCK_FOCUS_RESUME" "$LOCK_UNLOCK")
    local check paused detail before started switched problem
    # 锁屏方式是“滑动”时灭屏再亮屏就有锁屏界面；之前被关掉的话打开
    adb shell locksettings set-disabled false > /dev/null 2>&1 || true
    unlock || true
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    if ! start_b "锁屏前：从头放 B（队列是 B、C、Hang）"; then
        for check in "${all[@]}"; do
            fail "$check" "没能从头放 B，没有执行：$(session)"
        done
        return 1
    fi

    # 19a. 从头放 B 后先试锁屏按钮，避免长时间采样后 B 已接近播完
    if ! lock_screen; then
        log_raw_device_state
        for check in "${all[@]}"; do
            fail "$check" "屏幕没灭：$(device_summary)"
        done
        restore_power
        return 1
    fi
    # 19b. 亮屏，停在锁屏界面，点锁屏界面上媒体控件的“下一曲”。B 只有 180 秒，播完也会自己接着放 C：
    #      算出切到 C 时 B 播到了哪里，B 快播完了就分不清是不是点出来的，记失败
    if ! wake_to_lock_screen; then
        log_raw_device_state
        fail "$LOCK_BUTTON" "亮屏后没有锁屏界面：$(device_summary)"
    else
        before=$(session)
        started=$(clock)
        if ! flow "锁屏界面上有媒体控件" lockscreen-next.yaml; then
            fail "$LOCK_BUTTON" "锁屏界面上没找到媒体控件的下一曲"
        elif ! detail=$(tap_lock_screen_next "E2E Tone B" "E2E Tone C"); then
            fail "$LOCK_BUTTON" "$detail"
        elif ! wait_for_song "E2E Tone C" 20 || ! keyguard_showing; then
            fail "$LOCK_BUTTON" "点了下一曲：$(sample_text "$(session)")；$(device_summary)"
        else
            switched=$(session)
            if ! detail=$(tapped_next "E2E Tone B" "$before" "$switched" $(( $(clock) - started )) 180); then
                fail "$LOCK_BUTTON" "$detail"
            else
                sleep 4
                if ! screen_on || ! keyguard_showing; then
                    fail "$LOCK_BUTTON" "C 开始播放后不在亮屏锁屏界面：$(device_summary)"
                elif problem=$(python3 -I "$SESSION" playing "E2E Tone C" "$switched" "$(session)"); then
                    pass "$LOCK_BUTTON" "$detail；锁屏界面还在"
                else
                    fail "$LOCK_BUTTON" "$detail，但 C 没接着播：$problem"
                fi
            fi
        fi
    fi
    shot 30-lock-screen
    if ! lock_screen; then
        for check in "$LOCK_PLAY" "$LOCK_HANG" "$LOCK_PAUSE_HANG" "$LOCK_PAUSE_LONG" "$LOCK_HANG_NEXT" \
            "$LOCK_FOCUS_HELD" "$LOCK_FOCUS_RESUME" "$LOCK_UNLOCK"; do
            fail "$check" "点锁屏按钮后没能再次灭屏，没有执行：$(device_summary)"
        done
        restore_power
        return 1
    fi

    # 19b. 锁屏按钮失败仍保留失败记录，再用媒体键准备 C，后面的独立检查继续。
    if ! wait_for_song "E2E Tone C" 3; then
        log "锁屏界面上没切到 C，用媒体键切过去：$(sample_text "$(session)")"
        adb shell input keyevent KEYCODE_MEDIA_NEXT
        wait_for_song "E2E Tone C" 20 || true
    fi
    power_check locked "$LOCK_PLAY" expect_progress_for "$LOCK_PLAY" "E2E Tone C" 30

    # 19c. 灭屏锁着，从 C 切到一直不回应的 Hang：期限到了回到 C
    if ! wait_for_song "E2E Tone C" 10; then
        for check in "$LOCK_HANG" "$LOCK_PAUSE_HANG" "$LOCK_PAUSE_LONG"; do
            fail "$check" "C 没在放，没有执行：$(session)"
        done
    else
        power_check locked "$LOCK_HANG" expect_hang_rollback "$LOCK_HANG" "E2E Tone C"

        # 19d. 再切到 Hang，C 停下等地址时按暂停（锁屏上的暂停键、耳机）：回滚后仍停着。
        #      接着停够 1 分钟再按播放；这里没有直接查询播放器的唤醒锁
        if power_check locked "$LOCK_PAUSE_HANG" expect_power_pause_skip "$LOCK_PAUSE_HANG" "E2E Tone C"; then
            paused=$(session)
            power_check locked "$LOCK_PAUSE_LONG" resume_after_power_pause "$LOCK_PAUSE_LONG" "E2E Tone C" "$paused" 40
        else
            fail "$LOCK_PAUSE_LONG" "暂停或锁屏环境没保持住，没有执行"
        fi
    fi
    # 两次切歌都超时放弃了，切歌没被卡住
    power_check locked "$LOCK_HANG_NEXT" expect_power_skip "$LOCK_HANG_NEXT" "E2E Tone B" KEYCODE_MEDIA_PREVIOUS

    # 19e. 锁着屏临时打断：用 USAGE_MEDIA 的“视频”替身占用焦点 12 秒；不模拟 Telecom 来电。
    if [ -n "$FOCUS_APK" ] && ! adb shell pm path "$FOCUS_PKG" > /dev/null 2>&1; then
        adb install -r "$FOCUS_APK" > "$OUT/install-focus-lock.log" 2>&1 || true
    fi
    if [ -z "$FOCUS_APK" ] || ! adb shell pm path "$FOCUS_PKG" > /dev/null 2>&1; then
        fail "$LOCK_FOCUS_HELD" "没装“视频”替身，没有执行"
        fail "$LOCK_FOCUS_RESUME" "没装“视频”替身，没有执行"
    elif ! wait_for_song "E2E Tone B" 10; then
        fail "$LOCK_FOCUS_HELD" "B 没在放，没有执行：$(session)"
        fail "$LOCK_FOCUS_RESUME" "B 没在放，没有执行"
    else
        if power_check locked "$LOCK_FOCUS_HELD" expect_power_focus_start "$LOCK_FOCUS_HELD" "E2E Tone B" focus-locked; then
            power_check locked "$LOCK_FOCUS_RESUME" expect_power_focus_resume "$LOCK_FOCUS_RESUME" "E2E Tone B" 15
        else
            fail "$LOCK_FOCUS_RESUME" "打断或锁屏环境没保持住，没有执行"
        fi
    fi

    # 19f. 解锁回到应用：播放页上的歌、按钮、进度和系统媒体会话一样
    if ! unlock; then
        log_raw_device_state
        fail "$LOCK_UNLOCK" "没能解锁：$(device_summary)"
    else
        adb shell am start -W -n "$ACTIVITY" > /dev/null
        if wait_for_song "E2E Tone B" 10; then
            expect_player_matches "$LOCK_UNLOCK" "E2E Tone B"
        else
            fail "$LOCK_UNLOCK" "B 没在放，没有执行：$(session)"
        fi
        shot 31-unlocked-player
        adb shell input keyevent KEYCODE_BACK
    fi
    restore_power
}

# ---- 第 20 步：省电 ----

DOZE_ENTER="拔电、灭屏后强制进入深度休眠（Doze）"
DOZE_PLAY="Doze 中照常播放"
DOZE_SKIP="Doze 中按下一首：取到地址，C 放出来"
DOZE_HANG="Doze 中切到不回应的歌：15 秒期限照常到，回到 C 接着播"
DOZE_PAUSE_LONG="Doze 中暂停 1 分钟后按播放：从暂停处接着播"
SAVER_SKIP="省电模式下灭屏按上一首：取到地址，B 放出来"
SAVER_PLAY="省电模式下灭屏照常播放"

run_power_saving_checks() {
    local all=("$DOZE_ENTER" "$DOZE_PLAY" "$DOZE_SKIP" "$DOZE_HANG" "$DOZE_PAUSE_LONG" "$SAVER_SKIP" "$SAVER_PLAY")
    local check detail
    # 第 19 步可能没有完成，单独准备 B，避免省电检查被前面的失败全部牵连。
    if ! wait_for_song "E2E Tone B" 5 && ! start_b "省电前：从头放 B（队列是 B、C、Hang）"; then
        for check in "${all[@]}"; do
            fail "$check" "没能放 B，没有执行：$(session)"
        done
        return 1
    fi
    adb shell input keyevent KEYCODE_HOME
    adb shell dumpsys battery unplug
    if ! lock_screen; then
        for check in "${all[@]}"; do
            fail "$check" "省电测试前没能灭屏，没有执行：$(device_summary)"
        done
        restore_power
        return 1
    fi
    adb shell dumpsys deviceidle enable deep > /dev/null 2>&1 || true
    log "$(adb shell dumpsys deviceidle force-idle deep 2>&1 | tr -d '\r')"
    if ! wait_until 15 deep_idle; then
        log_raw_device_state
        for check in "${all[@]}"; do
            fail "$check" "没能进入深度休眠：$(device_summary)"
        done
        restore_power
        return 1
    fi
    if ! detail=$(power_environment doze); then
        for check in "${all[@]}"; do fail "$check" "进入 Doze 时环境不满足：$detail"; done
        restore_power
        return 1
    fi
    pass "$DOZE_ENTER" "$(device_summary)"

    # 20a–d. Doze 中：照常播放；切歌要联网取地址；切到 Hang 要按时回滚；暂停 1 分钟再接着播
    power_check doze "$DOZE_PLAY" expect_progress_for "$DOZE_PLAY" "E2E Tone B" 20
    if power_check doze "$DOZE_SKIP" expect_power_skip "$DOZE_SKIP" "E2E Tone C" KEYCODE_MEDIA_NEXT; then
        power_check doze "$DOZE_HANG" expect_hang_rollback "$DOZE_HANG" "E2E Tone C"
        power_check doze "$DOZE_PAUSE_LONG" expect_paused_resume "$DOZE_PAUSE_LONG" "E2E Tone C" 60
    else
        fail "$DOZE_HANG" "C 没在放或 Doze 环境失效，没有执行"
        fail "$DOZE_PAUSE_LONG" "C 没在放，没有执行"
    fi
    # 20e–f. unforce 只取消强制状态，不保证已经离开 IDLE；亮屏使设备退出并核对 ACTIVE，再灭屏。
    adb shell dumpsys deviceidle unforce > /dev/null 2>&1 || true
    if ! { adb shell input keyevent KEYCODE_WAKEUP; wait_until 10 screen_on; } ||
        ! wait_until 10 deep_idle_active || ! lock_screen; then
        fail "$SAVER_SKIP" "无法确认已退出 Doze 并再次灭屏：$(device_summary)"
        fail "$SAVER_PLAY" "省电模式的独立环境未准备好，没有执行"
        restore_power
        return 1
    fi
    adb shell cmd power set-mode 1
    if ! wait_until 10 power_saver_on; then
        log_raw_device_state
        fail "$SAVER_SKIP" "没能打开省电模式：$(device_summary)"
        fail "$SAVER_PLAY" "没能打开省电模式，没有执行"
        restore_power
        return 1
    fi
    if power_check saver "$SAVER_SKIP" expect_power_skip "$SAVER_SKIP" "E2E Tone B" KEYCODE_MEDIA_PREVIOUS; then
        power_check saver "$SAVER_PLAY" expect_progress_for "$SAVER_PLAY" "E2E Tone B" 20
    else
        fail "$SAVER_PLAY" "B 没在放或省电环境失效，没有执行"
    fi
    restore_power
}
