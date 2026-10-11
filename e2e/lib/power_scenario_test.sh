#!/usr/bin/env bash
# 运行完整的锁屏、省电步骤，防止 power_check 存在但调用点漏接。播放检查使用可前进的假会话，
# 只改变 Doze 或锁屏环境；旧 power.sh 在退出 Doze 的场景也会把七项全部记 PASS。
# 正常场景里，要核对环境的每一项都必须经 power_check 记录（说明以“环境采样符合 <环境>”结尾）：
# 哪个调用点漏接或接错环境，这里就失败。
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="$HERE/lib/media_session.py"
PKG=fun.upup.musicfree
source "$HERE/lib/pause_checks.sh"
source "$HERE/power.sh"
clock() { cat "$FAKE_CLOCK_FILE"; }
sleep() { echo "$(( $(clock) + ${1%%.*} ))" > "$FAKE_CLOCK_FILE"; }
PLAY_TITLE="E2E Tone B"
PLAY_FROM=0
PLAY_AT=0
SPEED=1000
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

# 下面几个变量和函数给 power.sh 的锁屏步骤用
FOCUS="$HERE/lib/audio_focus.py"
FOCUS_PKG=fun.upup.musicfree.e2e.focus
FOCUS_APK=/fake/e2e-focus.apk
REF=0
OUT=$(mktemp -d)
RESULTS=()
pass() { RESULTS+=("PASS $1：${2:-}"); }
fail() { RESULTS+=("FAIL $1：${2:-}"); }
log() { :; }
shot() { :; }
open_link() { :; }
# Maestro 流程只在界面上找东西；这里不测界面，记一行通过
flow() { pass "$1"; }
# 锁屏界面的读屏树里只有一个系统“下一曲”控件
maestro() { echo '1,0,"accessibilityText=Next track; bounds=[10,20][90,60]; enabled=true",0'; }
# 播放页和媒体会话的比对另有 power_checks_test.sh 自检
expect_player_matches() { pass "$1" "播放页替身"; }
ACTIVITY="$PKG/.MainActivity"
FAKE_CLOCK_FILE=$(mktemp)
echo 0 > "$FAKE_CLOCK_FILE"
DEEP_STATE_FILE=$(mktemp)
DEVICE_FILE=$(mktemp)
printf '%s\n' -1 > "$DEEP_STATE_FILE"
trap 'rm -rf "$DEEP_STATE_FILE" "$FAKE_CLOCK_FILE" "$DEVICE_FILE" "$OUT"' EXIT
SAVER=0
SCREEN=Asleep
GUARD=showing
DROP_DOZE=0
STICKY_IDLE=0
# 1：点过锁屏按钮之后再灭屏就没有锁屏界面（比如锁屏被关掉了）
NO_KEYGUARD_AFTER_TAP=0
TAPPED=0
VIDEO_END=-1
VIDEO_TAG=""
deep_mode() {
    local DEEP_START=$(cat "$DEEP_STATE_FILE") NOW=$(clock)
    if [ "$DEEP_START" -ge 0 ] && { [ "$DROP_DOZE" -eq 0 ] || [ "$NOW" -lt $((DEEP_START + 5)) ]; }; then
        echo IDLE
    else
        echo ACTIVE
    fi
}
wait_until() {
    local end=$(( $(clock) + $1 )); shift
    while [ "$(clock)" -lt "$end" ]; do
        "$@" && return 0
        sleep 1
    done
    "$@"
}
# 真 adb 的命令跨子 shell 改的是同一台设备；替身也必须把状态持久化，不能只改 shell 变量。
save_device() {
    printf 'PLAY_TITLE=%q\nPLAY_AT=%q\nPLAY_FROM=%q\nSPEED=%q\nSCREEN=%q\nGUARD=%q\nSAVER=%q\nTAPPED=%q\nVIDEO_END=%q\nVIDEO_TAG=%q\n' \
        "$PLAY_TITLE" "$PLAY_AT" "$PLAY_FROM" "$SPEED" "$SCREEN" "$GUARD" "$SAVER" "$TAPPED" "$VIDEO_END" "$VIDEO_TAG" > "$DEVICE_FILE"
}
# 当前进度停住：之后从 PLAY_FROM 起接着放
hold_position() {
    if [ "$NOW" -ge "$PLAY_FROM" ]; then
        PLAY_AT=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED))
    fi
}
adb() {
    source "$DEVICE_FILE"
    NOW=$(clock)
    case "$*" in
        "shell dumpsys media_session")
            local state=2 position=$PLAY_AT
            if [ "$NOW" -ge "$PLAY_FROM" ]; then
                state=3; position=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED))
            fi
            cat <<OUT
  Sessions Stack - have 1 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv/12 (userId=0)
      package=fun.upup.musicfree
      active=true
      state=PlaybackState {state=$state, position=$position, buffered position=0, speed=1.0, updated=10, actions=0, custom actions=[], active item id=0, error=null}
      metadata: size=3, description=$PLAY_TITLE, E2E Artist, E2E Album
OUT
            ;;
        "shell dumpsys power") echo "  mWakefulness=$SCREEN" ;;
        "shell dumpsys window policy") echo "  mKeyguardShowing=$([ "$GUARD" = showing ] && echo true || echo false)" ;;
        "shell dumpsys deviceidle") echo "  mState=$(deep_mode)" ;;
        "shell dumpsys deviceidle force-idle deep") echo "$NOW" > "$DEEP_STATE_FILE" ;;
        "shell dumpsys deviceidle unforce") : ;;
        "shell dumpsys deviceidle get force") echo false ;;
        "shell dumpsys deviceidle motion") [ "$STICKY_IDLE" -eq 1 ] || printf '%s\n' -1 > "$DEEP_STATE_FILE" ;;
        "shell input keyevent KEYCODE_SLEEP")
            SCREEN=Asleep
            if [ "$NO_KEYGUARD_AFTER_TAP" -eq 1 ] && [ "$TAPPED" -eq 1 ]; then GUARD=hidden; else GUARD=showing; fi
            ;;
        "shell input tap "*)
            # 锁屏界面上的系统“下一曲”：只有亮屏、锁屏界面在时点得到
            if [ "$SCREEN" = Awake ] && [ "$GUARD" = showing ] && [ "$PLAY_TITLE" = "E2E Tone B" ]; then
                PLAY_TITLE="E2E Tone C"; PLAY_AT=0; PLAY_FROM=$NOW; TAPPED=1
            fi
            ;;
        "shell locksettings set-disabled false"|"shell input keyevent KEYCODE_BACK") : ;;
        "shell pm path $FOCUS_PKG") echo "package:/data/app/e2e-focus/base.apk" ;;
        "shell am start -n $FOCUS_PKG/.HoldFocusActivity "*)
            # 视频替身：占用焦点 seconds 秒，音乐停着，放下焦点后 1 秒接着放
            local seconds tag
            seconds=$(sed -n 's/.*--ei seconds \([0-9]*\).*/\1/p' <<< "$*")
            tag=$(sed -n 's/.*--es tag \([^ ]*\).*/\1/p' <<< "$*")
            hold_position
            VIDEO_END=$((NOW + seconds)); VIDEO_TAG=$tag; PLAY_FROM=$((VIDEO_END + 1))
            ;;
        "shell dumpsys audio")
            local top=$PKG
            if [ "$VIDEO_END" -ge 0 ] && [ "$NOW" -lt "$VIDEO_END" ]; then top=$FOCUS_PKG; fi
            cat <<OUT
Audio Focus stack entries (last is top of stack):
  source:x -- pack: $PKG -- client: c -- gain: GAIN -- flags:  -- loss: LOSS_TRANSIENT -- notified: true
  source:y -- pack: $top -- client: d -- gain: GAIN_TRANSIENT -- flags:  -- loss: none -- notified: true

Notify on duck:  true
OUT
            ;;
        "logcat -d -s E2EFocus")
            if [ "$VIDEO_END" -ge 0 ] && [ "$NOW" -ge "$VIDEO_END" ]; then
                echo "I E2EFocus: releasing focus tag=$VIDEO_TAG"
            fi
            ;;
        "shell input keyevent KEYCODE_WAKEUP") SCREEN=Awake ;;
        "shell wm dismiss-keyguard") GUARD=hidden ;;
        "shell cmd power set-mode 1") SAVER=1 ;;
        "shell cmd power set-mode 0") SAVER=0 ;;
        "shell settings get global low_power") echo "$SAVER" ;;
        "shell input keyevent KEYCODE_MEDIA_NEXT")
            if [ "$PLAY_TITLE" = "E2E Tone B" ]; then
                PLAY_TITLE="E2E Tone C"; PLAY_AT=0; PLAY_FROM=$NOW
            else
                hold_position; PLAY_FROM=$((NOW + 16))
            fi
            ;;
        "shell input keyevent KEYCODE_MEDIA_PREVIOUS")
            PLAY_TITLE="E2E Tone B"; PLAY_AT=0; PLAY_FROM=$NOW ;;
        "shell input keyevent KEYCODE_MEDIA_PAUSE")
            hold_position; PLAY_FROM=999999 ;;
        "shell input keyevent KEYCODE_MEDIA_PLAY") PLAY_FROM=$NOW ;;
        "shell input keyevent KEYCODE_HOME"|"shell dumpsys battery unplug"|"shell dumpsys battery reset"|"shell dumpsys deviceidle enable deep"|"shell am start -W -n "*) : ;;
        *) echo "Unexpected adb call: $*" >&2; return 1 ;;
    esac
    save_device
}


FAILURES=0
# result_of <检查名>：这一项记下的那行（"PASS 名字：说明"或"FAIL 名字：说明"）
result_of() {
    local line
    for line in "${RESULTS[@]}"; do
        if [[ "$line" = "PASS $1："* || "$line" = "FAIL $1："* ]]; then
            echo "$line"
            return 0
        fi
    done
    return 1
}
# expect_wired <环境> <检查名…>：这些检查都通过了，而且都是经 power_check 按这个环境记录的
expect_wired() {
    local mode=$1 name line
    shift
    for name in "$@"; do
        line=$(result_of "$name") || line="没有记录"
        if [[ "$line" != "PASS $name："*"环境采样符合 $mode" ]]; then
            echo "WRONG 「$name」没有经 power_check $mode 记录：$line"
            FAILURES=$((FAILURES + 1))
        fi
    done
}
run_case() {
    local label=$1 drop=$2 sticky=$3 expected=$4 failures=0 line
    RESULTS=() DROP_DOZE=$drop STICKY_IDLE=$sticky SAVER=0 SCREEN=Asleep GUARD=showing
    PLAY_TITLE="E2E Tone B" PLAY_AT=0 PLAY_FROM=0 SPEED=1000
    echo 0 > "$FAKE_CLOCK_FILE"
    echo -1 > "$DEEP_STATE_FILE"
    save_device
    run_power_saving_checks >/dev/null
    for line in "${RESULTS[@]}"; do [[ "$line" = FAIL* ]] && failures=$((failures + 1)); done
    if [ "${#RESULTS[@]}" -ne 7 ] || [ "$failures" -ne "$expected" ]; then
        echo "WRONG $label：预期 7 项/$expected 失败，实际 ${#RESULTS[@]} 项/$failures 失败"
        printf '%s\n' "${RESULTS[@]}"
        FAILURES=$((FAILURES + 1))
    else
        echo "ok $label：7 项/$failures 失败"
    fi
    if [ "$expected" -eq 0 ]; then
        expect_wired doze "$DOZE_PLAY" "$DOZE_SKIP" "$DOZE_HANG" "$DOZE_PAUSE_LONG"
        expect_wired saver "$SAVER_SKIP" "$SAVER_PLAY"
    fi
    # 失败也必须恢复屏幕和省电模式。
    if [ "$SCREEN:$SAVER:$GUARD" != Awake:0:hidden ]; then
        echo "WRONG $label：没有恢复屏幕和省电模式"
        FAILURES=$((FAILURES + 1))
    fi
}
LOCKED_CHECKS=("$LOCK_PLAY" "$LOCK_HANG" "$LOCK_PAUSE_HANG" "$LOCK_PAUSE_LONG" "$LOCK_HANG_NEXT" \
    "$LOCK_FOCUS_HELD" "$LOCK_FOCUS_RESUME")
run_lock_case() {
    local label=$1 no_keyguard=$2 name line wrong=0
    RESULTS=() DROP_DOZE=0 STICKY_IDLE=0 NO_KEYGUARD_AFTER_TAP=$no_keyguard SAVER=0 SCREEN=Awake GUARD=hidden
    PLAY_TITLE="E2E Tone B" PLAY_AT=0 PLAY_FROM=0 SPEED=1000 TAPPED=0 VIDEO_END=-1 VIDEO_TAG=""
    echo 0 > "$FAKE_CLOCK_FILE"
    echo -1 > "$DEEP_STATE_FILE"
    save_device
    run_lock_screen_checks >/dev/null
    # SHOW_RESULTS=1 时打出每项结果，排查用
    [ -z "${SHOW_RESULTS:-}" ] || printf '  %s\n' "${RESULTS[@]}"
    line=$(result_of "$LOCK_BUTTON") || line="没有记录"
    if [[ "$line" != PASS* ]]; then
        echo "WRONG $label：锁屏按钮这一项应当通过：$line"
        wrong=1
    fi
    if [ "$no_keyguard" -eq 0 ]; then
        line=$(result_of "$LOCK_UNLOCK") || line="没有记录"
        [[ "$line" = PASS* ]] || { echo "WRONG $label：解锁这一项应当通过：$line"; wrong=1; }
        local before=$FAILURES
        expect_wired locked "${LOCKED_CHECKS[@]}"
        [ "$FAILURES" -eq "$before" ] || wrong=1
        FAILURES=$before
    else
        # 没有锁屏界面：要求锁屏的七项一项也不能通过
        for name in "${LOCKED_CHECKS[@]}"; do
            line=$(result_of "$name") || line="没有记录"
            if [[ "$line" != FAIL* ]]; then
                echo "WRONG $label：没有锁屏界面时「$name」不能通过：$line"
                wrong=1
            fi
        done
    fi
    if [ "$wrong" -ne 0 ]; then
        printf '%s\n' "${RESULTS[@]}"
        FAILURES=$((FAILURES + 1))
    else
        echo "ok $label"
    fi
    if [ "$SCREEN:$SAVER:$GUARD" != Awake:0:hidden ]; then
        echo "WRONG $label：没有恢复亮屏、解锁"
        FAILURES=$((FAILURES + 1))
    fi
}
run_lock_case '锁屏一直在，锁屏检查都经 power_check locked 通过' 0
run_lock_case '点过锁屏按钮后再灭屏没有锁屏界面，七项锁屏检查都不能通过' 1
run_case 'Doze 保持，独立省电测试正常' 0 0 0
run_case 'Doze 第五秒退出，四项 Doze 行为检查必须失败' 1 0 4
run_case '模拟运动后仍 IDLE，独立省电两项不能报通过' 0 1 2
if [ "$FAILURES" -ne 0 ]; then exit 1; fi
printf '%s\n' 'power_scenario_test.sh: 5 项全部通过'
