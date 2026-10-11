#!/usr/bin/env bash
# 用假的 adb 和时钟自检 power.sh 的判断：灭屏后歌停了（会话还写着在播）、切歌等地址的期限没按时到、
# 播放页上的进度和系统媒体会话对不上，都要判失败；正常的要判通过。CI 在跑模拟器之前先跑一遍：
#
#   bash e2e/lib/power_checks_test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="$HERE/lib/media_session.py"
FOCUS="$HERE/lib/audio_focus.py"
PKG=fun.upup.musicfree
FOCUS_PKG=fun.upup.musicfree.e2e.focus
# shellcheck source=pause_checks.sh
source "$HERE/lib/pause_checks.sh"
# shellcheck source=../power.sh
source "$HERE/power.sh"

# 假时钟：sleep 只拨时钟，不真等
NOW=0
clock() { echo "$NOW"; }
sleep() { NOW=$((NOW + ${1%%.*})); }
log() { :; }
device_summary() { echo "假设备"; }

# 场景。PLAY_TITLE 从 PLAY_FROM 秒起在播、进度从 PLAY_AT 毫秒起每秒涨 SPEED 毫秒（0：卡住了，
# 会话还写着在播）；PLAY_FROM 之前是暂停在 PLAY_AT
PLAY_TITLE="E2E Tone C"
PLAY_FROM=0
PLAY_AT=10000
SPEED=1000
# 按下一首时：ROLLBACK 秒后回到原来那首接着播（空：一直停着等地址）；STALL_AFTER_ROLLBACK 非空时回来后进度不走
ROLLBACK=""
STALL_AFTER_ROLLBACK=""

adb() {
    case "$*" in
        "shell dumpsys media_session")
            local state=2 position=$PLAY_AT
            if [ "$NOW" -ge "$PLAY_FROM" ]; then
                state=3
                position=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED))
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
        "shell input keyevent KEYCODE_MEDIA_NEXT")
            # 这首停下等地址：进度停在现在的位置
            PLAY_AT=$((PLAY_AT + (NOW - PLAY_FROM) * SPEED))
            if [ -n "$ROLLBACK" ]; then
                PLAY_FROM=$((NOW + ROLLBACK))
                [ -n "$STALL_AFTER_ROLLBACK" ] && SPEED=0
            else
                PLAY_FROM=999999
            fi
            ;;
        *)
            echo "没模拟的 adb 调用：$*" >&2
            return 1
            ;;
    esac
}

# 记下检查结果，不写文件
LAST=""
pass() { LAST="PASS $1：${2:-}"; }
fail() { LAST="FAIL $1：${2:-}"; }

FAILURES=0
# expect <PASS|FAIL> <说明> <命令…>：跑一个 expect_* 检查，看它记的是不是 PASS/FAIL
expect() {
    local want=$1 label=$2
    shift 2
    LAST=""
    "$@" > /dev/null
    if [ "${LAST%% *}" = "$want" ]; then
        echo "ok    $label：$LAST"
    else
        echo "WRONG $label：应该 $want，实际 ${LAST:-没记结果}"
        FAILURES=$((FAILURES + 1))
    fi
}

reset() {
    NOW=0
    PLAY_FROM=0
    PLAY_AT=10000
    SPEED=1000
    ROLLBACK=""
    STALL_AFTER_ROLLBACK=""
}

# ---- 灭屏期间照常播放 ----
reset
expect PASS "一直在播，进度在走" expect_progress_for 播放 "E2E Tone C" 30
reset
SPEED=0
expect FAIL "会话写着在播但进度不动（灭屏后歌卡住）" expect_progress_for 播放 "E2E Tone C" 30
reset
SPEED=500
expect FAIL "30 秒只播了 15 秒" expect_progress_for 播放 "E2E Tone C" 30
reset
PLAY_FROM=12
expect FAIL "开始时没在播" expect_progress_for 播放 "E2E Tone C" 30

# ---- 切歌等地址的期限 ----
reset
ROLLBACK=16
expect PASS "16 秒回到 C 接着播" expect_hang_rollback 回滚 "E2E Tone C"
reset
ROLLBACK=40
expect FAIL "40 秒才回到 C（灭屏时计时器没按时走）" expect_hang_rollback 回滚 "E2E Tone C"
reset
expect FAIL "一直没回到 C" expect_hang_rollback 回滚 "E2E Tone C"
reset
ROLLBACK=16
STALL_AFTER_ROLLBACK=1
expect FAIL "回到 C 但没接着播" expect_hang_rollback 回滚 "E2E Tone C"

# ---- 锁屏界面上点下一曲：是点出来的，不是原来那首播完自动接的 ----
check_tap() {
    if detail=$(tapped_next "E2E Tone B" "$1" "$2" "$3" 180); then pass 点下一曲 "$detail"; else fail 点下一曲 "$detail"; fi
}
b_at_31='{"found": true, "state": "PLAYING", "title": "E2E Tone B", "position": 31500}'
c_at_55='{"found": true, "state": "PLAYING", "title": "E2E Tone C", "position": 55800}'
expect PASS "点的时候 B 在约 120 秒" check_tap "$b_at_31" "$c_at_55" 145
expect FAIL "隔了 200 秒、C 才放 5 秒：B 是播完自动接的" check_tap "$b_at_31" "${c_at_55/55800/5000}" 200
expect FAIL "点之前 B 就没在播" check_tap "${b_at_31/PLAYING/PAUSED}" "$c_at_55" 145

# ---- 解锁后播放页和媒体会话一致 ----
before='{"found": true, "state": "PLAYING", "title": "E2E Tone B", "position": 41200}'
after='{"found": true, "state": "PLAYING", "title": "E2E Tone B", "position": 45900}'
check_player() {
    if detail=$(player_matches_session "$1" "$2" "$3"); then pass 播放页 "$detail"; else fail 播放页 "$detail"; fi
}
expect PASS "界面 43 秒，在两次采样之间" check_player "43 137" "$before" "$after"
expect PASS "界面 39 秒，比读之前少 2 秒以内" check_player "39 141" "$before" "$after"
expect FAIL "界面还停在 12 秒（回到前台没刷新）" check_player "12 168" "$before" "$after"
expect FAIL "界面跑到 60 秒" check_player "60 120" "$before" "$after"
expect FAIL "读界面时换了歌" check_player "43 137" "$before" "${after/Tone B/Tone C}"
expect FAIL "读界面前是暂停的" check_player "43 137" "${before/PLAYING/PAUSED}" "$after"

if [ "$FAILURES" -gt 0 ]; then
    echo "power_checks_test.sh: $FAILURES 项判断不对"
    exit 1
fi
echo "power_checks_test.sh: 全部通过"
