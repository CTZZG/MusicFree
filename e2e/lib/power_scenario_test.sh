#!/usr/bin/env bash
# 运行完整省电步骤，防止 power_check 存在但调用点漏接。播放检查使用可前进的假会话，
# 只改变 Doze 环境；旧 power.sh 在退出 Doze 的场景也会把七项全部记 PASS。
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

RESULTS=()
pass() { RESULTS+=("PASS $1：${2:-}"); }
fail() { RESULTS+=("FAIL $1：${2:-}"); }
log() { :; }
ACTIVITY="$PKG/.MainActivity"
FAKE_CLOCK_FILE=$(mktemp)
echo 0 > "$FAKE_CLOCK_FILE"
DEEP_STATE_FILE=$(mktemp)
DEVICE_FILE=$(mktemp)
printf '%s\n' -1 > "$DEEP_STATE_FILE"
trap 'rm -f "$DEEP_STATE_FILE" "$FAKE_CLOCK_FILE" "$DEVICE_FILE"' EXIT
SAVER=0
SCREEN=Asleep
GUARD=showing
DROP_DOZE=0
STICKY_IDLE=0
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
    printf 'PLAY_TITLE=%q\nPLAY_AT=%q\nPLAY_FROM=%q\nSPEED=%q\nSCREEN=%q\nGUARD=%q\nSAVER=%q\n' \
        "$PLAY_TITLE" "$PLAY_AT" "$PLAY_FROM" "$SPEED" "$SCREEN" "$GUARD" "$SAVER" > "$DEVICE_FILE"
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
        "shell dumpsys deviceidle unforce") [ "$STICKY_IDLE" -eq 1 ] || printf '%s\n' -1 > "$DEEP_STATE_FILE" ;;
        "shell input keyevent KEYCODE_SLEEP") SCREEN=Asleep; GUARD=showing ;;
        "shell input keyevent KEYCODE_WAKEUP") SCREEN=Awake ;;
        "shell wm dismiss-keyguard") GUARD=hidden ;;
        "shell cmd power set-mode 1") SAVER=1 ;;
        "shell cmd power set-mode 0") SAVER=0 ;;
        "shell settings get global low_power") echo "$SAVER" ;;
        "shell input keyevent KEYCODE_MEDIA_NEXT")
            if [ "$PLAY_TITLE" = "E2E Tone B" ]; then
                PLAY_TITLE="E2E Tone C"; PLAY_AT=0; PLAY_FROM=$NOW
            else
                PLAY_AT=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED)); PLAY_FROM=$((NOW + 16))
            fi
            ;;
        "shell input keyevent KEYCODE_MEDIA_PREVIOUS")
            PLAY_TITLE="E2E Tone B"; PLAY_AT=0; PLAY_FROM=$NOW ;;
        "shell input keyevent KEYCODE_MEDIA_PAUSE")
            PLAY_AT=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED)); PLAY_FROM=999999 ;;
        "shell input keyevent KEYCODE_MEDIA_PLAY") PLAY_FROM=$NOW ;;
        "shell input keyevent KEYCODE_HOME"|"shell dumpsys battery unplug"|"shell dumpsys battery reset"|"shell dumpsys deviceidle enable deep"|"shell am start -W -n "*) : ;;
        *) echo "Unexpected adb call: $*" >&2; return 1 ;;
    esac
    save_device
}


FAILURES=0
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
    # 失败也必须恢复屏幕和省电模式。
    if [ "$SCREEN:$SAVER:$GUARD" != Awake:0:hidden ]; then
        echo "WRONG $label：没有恢复屏幕和省电模式"
        FAILURES=$((FAILURES + 1))
    fi
}
run_case 'Doze 保持，独立省电测试正常' 0 0 0
run_case 'Doze 第五秒退出，四项 Doze 行为检查必须失败' 1 0 4
run_case 'unforce 后仍 IDLE，独立省电两项不能报通过' 0 1 2
if [ "$FAILURES" -ne 0 ]; then exit 1; fi
printf '%s\n' 'power_scenario_test.sh: 3 项全部通过'
