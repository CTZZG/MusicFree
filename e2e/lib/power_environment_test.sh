#!/usr/bin/env bash
# 用真实的环境解析、power_check、播放/暂停检查，只替换设备 I/O 和时钟。
# 时钟写入文件，让子 shell 和命令替换里的 sleep 也能推进同一个时间。
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="$HERE/lib/media_session.py"
PKG=fun.upup.musicfree
source "$HERE/lib/pause_checks.sh"
source "$HERE/power.sh"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
CLOCK_FILE="$scratch/clock"
clock() { cat "$CLOCK_FILE"; }
sleep() { echo "$(( $(clock) + ${1%%.*} ))" > "$CLOCK_FILE"; }
log() { :; }
LAST=""
COUNT=0
pass() { LAST="PASS ${2:-}"; COUNT=$((COUNT + 1)); }
fail() { LAST="FAIL ${2:-}"; COUNT=$((COUNT + 1)); }

MODE=doze
FAULT=""
FAULT_FROM=5
FAULT_UNTIL=999
PLAY_STATE=3
PLAY_FROM=0
SPEED=1000
SAVER_IDLE_STATE=ACTIVE
reset() {
    echo 0 > "$CLOCK_FILE"
    MODE=doze FAULT="" FAULT_FROM=5 FAULT_UNTIL=999 PLAY_STATE=3 PLAY_FROM=0 SPEED=1000 SAVER_IDLE_STATE=ACTIVE
    LAST="" COUNT=0
}
adb() {
    local now broken=0 screen=Asleep guard=true idle=IDLE saver=1 state=$PLAY_STATE position=10000
    now=$(clock)
    [ "$MODE" = saver ] && idle=$SAVER_IDLE_STATE
    if [ "$now" -ge "$FAULT_FROM" ] && [ "$now" -lt "$FAULT_UNTIL" ]; then broken=1; fi
    if [ "$broken" -eq 1 ]; then
        case "$FAULT" in
            doze) idle=ACTIVE ;;
            screen) screen=Awake ;;
            guard) guard=false ;;
            saver) saver=0 ;;
            still-idle) idle=IDLE ;;
        esac
    fi
    case "$*" in
        "shell dumpsys power")
            if [ "$broken:$FAULT" = 1:unknown ]; then echo 'unreadable'; else echo "mWakefulness=$screen"; fi ;;
        "shell dumpsys window policy"|"shell dumpsys activity activities") echo "mKeyguardShowing=$guard" ;;
        "shell dumpsys deviceidle") echo "mState=$idle" ;;
        "shell settings get global low_power") echo "$saver" ;;
        "shell dumpsys media_session")
            if [ "$now" -lt "$PLAY_FROM" ]; then state=2; elif [ "$state" -eq 3 ]; then position=$((10000 + (now - PLAY_FROM) * SPEED)); fi
            cat <<OUT
  Sessions Stack - have 1 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv/12 (userId=0)
      package=fun.upup.musicfree
      active=true
      state=PlaybackState {state=$state, position=$position, buffered position=0, speed=1.0, updated=10, actions=0, custom actions=[], active item id=0, error=null}
      metadata: size=3, description=E2E Tone C, E2E Artist, E2E Album
OUT
            ;;
        "shell input keyevent KEYCODE_MEDIA_NEXT") PLAY_FROM=$((now + 16)) ;;
        "shell input keyevent KEYCODE_MEDIA_PLAY") PLAY_STATE=3 PLAY_FROM=$now ;;
        *) echo "未知设备调用：$*" >&2; return 1 ;;
    esac
}

FAILURES=0
expect() {
    local want=$1 label=$2
    shift 2
    "$@" >/dev/null
    if [ "${LAST%% *}" = "$want" ] && [ "$COUNT" -eq 1 ]; then
        echo "ok $label：$LAST"
    else
        echo "WRONG $label：预期 $want 一次，实际 ${LAST:-空}（$COUNT 次）"
        FAILURES=$((FAILURES + 1))
    fi
}
check_progress() { power_check "$MODE" 播放 expect_progress_for 播放 "E2E Tone C" 15; }
check_paused() { power_check "$MODE" 暂停 expect_power_paused 暂停 "E2E Tone C" 15; }

reset
expect PASS "一直处于 IDLE 且进度在走" check_progress
reset; FAULT=doze
expect FAIL "第 5 秒退出 Doze，进度仍正常也失败" check_progress
reset; FAULT=doze FAULT_UNTIL=10
expect FAIL "退出 Doze 后又恢复，失败不会丢失" check_progress
reset; FAULT=screen
expect FAIL "播放期间屏幕亮起" check_progress
reset; MODE=locked FAULT=guard
expect FAIL "播放期间锁屏解除" check_progress
reset; FAULT=guard FAULT_FROM=0
expect PASS "Doze 要求灭屏与 IDLE，不要求锁屏界面显示" check_progress
reset; MODE=saver FAULT=guard FAULT_FROM=0
expect PASS "独立省电要求灭屏与省电开启，不要求锁屏界面显示" check_progress
reset; FAULT=unknown
expect FAIL "播放期间无法解析设备状态" check_progress
reset; MODE=locked
expect PASS "灭屏锁屏状态下播放" check_progress
reset; MODE=locked FAULT=screen
expect FAIL "锁屏播放期间屏幕亮起" check_progress
reset; MODE=saver
expect PASS "已退出 Doze 且省电模式开启" check_progress
reset; MODE=saver SAVER_IDLE_STATE=INACTIVE
expect PASS "重新灭屏后的 INACTIVE 尚未进入深度 Doze" check_progress
reset; MODE=saver SAVER_IDLE_STATE=IDLE_MAINTENANCE
expect FAIL "Doze 维护窗口不能当作独立省电环境" check_progress
reset; MODE=saver SAVER_IDLE_STATE=UNKNOWN
expect FAIL "未知休眠状态不能通过" check_progress
reset; MODE=saver FAULT=saver
expect FAIL "播放期间省电模式被关闭" check_progress
reset; MODE=saver FAULT=still-idle FAULT_FROM=0
expect FAIL "仍处于 Doze，不能冒充独立省电测试" check_progress
reset; PLAY_STATE=2
expect PASS "暂停状态和 Doze 都保持" check_paused
reset; PLAY_STATE=2 FAULT=doze FAULT_UNTIL=10
expect FAIL "暂停命令替换内退出 Doze，之后恢复也失败" check_paused
reset; FAULT=doze FAULT_FROM=10
expect FAIL "取源等待期间退出 Doze" power_check doze 回滚 expect_hang_rollback 回滚 "E2E Tone C"
reset; SPEED=0
expect FAIL "环境正确但播放器卡住" check_progress
reset
no_result() { :; }
expect FAIL "原检查没有报告结果" power_check doze 空 no_result
reset
duplicate_result() { pass 双重 第一; pass 双重 第二; }
expect FAIL "原检查重复报告不能通过" power_check doze 双重 duplicate_result
reset
wrong_name() { pass 错名字; }
expect FAIL "原检查用了其他名字不能通过" power_check doze 正确 wrong_name
reset
bad_return() { pass 返回; return 1; }
expect FAIL "报告通过但返回失败不能通过" power_check doze 返回 bad_return
reset; MODE=bogus
expect FAIL "未知环境不能通过" check_progress
reset
expect PASS "前一项失败不污染后一项，采样函数恢复" check_progress
reset; SPEED=0
expect FAIL "恢复后会话在播但进度停住" power_check doze 恢复 expect_power_resumed 恢复 "E2E Tone C" '{"found":true,"title":"E2E Tone C","state":"PAUSED","position":10000}'

if [ "$FAILURES" -ne 0 ]; then echo "power_environment_test.sh: $FAILURES 项失败"; exit 1; fi
echo 'power_environment_test.sh: 27 项全部通过'
