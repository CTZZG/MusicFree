#!/usr/bin/env bash
# 真正的读屏解析与点击循环；替换 adb/Maestro/时钟，检查当前控件位置、吞掉点击和过量点击。
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="$HERE/lib/media_session.py"
PKG=fun.upup.musicfree
source "$HERE/lib/pause_checks.sh"
source "$HERE/power.sh"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
clock() { cat "$OUT/clock"; }
sleep() { echo "$(( $(clock) + ${1%%.*} ))" > "$OUT/clock"; }
log() { :; }
REQUIRED=1
INITIAL="E2E Tone B"
STATE=3
FAULT=""
reset() {
    echo 0 > "$OUT/clock"
    echo 0 > "$OUT/taps"
    echo true > "$OUT/keyguard"
    REQUIRED=1 INITIAL="E2E Tone B" STATE=3 FAULT=""
}
adb() {
    local taps title position
    taps=$(cat "$OUT/taps")
    case "$*" in
        "shell dumpsys power") echo 'mWakefulness=Awake' ;;
        "shell dumpsys window policy") echo "mKeyguardShowing=$(cat "$OUT/keyguard")" ;;
        "shell dumpsys media_session")
            title=$INITIAL
            [ "$taps" -ge "$REQUIRED" ] && title="E2E Tone C"
            [ "$taps:$FAULT" = 1:wrong-song ] && title="E2E Other"
            position=$(( $(clock) * 1000 ))
            cat <<DATA
  Sessions Stack - have 1 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv/12 (userId=0)
      package=fun.upup.musicfree
      active=true
      state=PlaybackState {state=$STATE, position=$position, buffered position=0, speed=1.0, updated=10, actions=0, custom actions=[], active item id=0, error=null}
      metadata: size=3, description=$title, E2E Artist, E2E Album
DATA
            ;;
        "shell input tap "*)
            # 每次读屏的控件都移动，必须点本次找到的中心，不能缓存前一次坐标。
            if [ "$*" != "shell input tap $((50 + taps * 100)) 30" ]; then
                echo "坐标不对应本次控件：$*" >&2
                return 1
            fi
            echo "$((taps + 1))" > "$OUT/taps"
            ;;
        *) echo "未知 adb 调用：$*" >&2; return 1 ;;
    esac
}
maestro() {
    [ "$*" = 'hierarchy --compact --no-reinstall-driver' ] || return 1
    [ "$FAULT" != read-failed ] || return 1
    local taps label='Next track' enabled=true
    taps=$(cat "$OUT/taps")
    [ "$FAULT" = missing ] && label=Play
    [ "$FAULT" = disabled ] && enabled=false
    [ "$FAULT" = unlocked ] && echo false > "$OUT/keyguard"
    echo "1,0,\"accessibilityText=$label; bounds=[$((10 + taps * 100)),10][$((90 + taps * 100)),50]; enabled=$enabled\",0"
    [ "$FAULT" = ambiguous ] && echo '2,0,"accessibilityText=Next track; bounds=[400,10][480,50]; enabled=true",0'
    return 0
}
FAILURES=0
expect() {
    local expected=$1 taps=$2 label=$3 actual=FAIL
    if tap_lock_screen_next "E2E Tone B" "E2E Tone C" > "$OUT/detail"; then actual=PASS; fi
    if [ "$actual" = "$expected" ] && [ "$(cat "$OUT/taps")" -eq "$taps" ]; then
        echo "ok $label：$actual，点击 $taps 次"
    else
        echo "WRONG $label：预期 $expected/$taps 次，实际 $actual/$(cat "$OUT/taps") 次"
        cat "$OUT/detail"
        FAILURES=$((FAILURES + 1))
    fi
}
reset
expect PASS 1 '点击一次即切到 C，不再多点'
reset; REQUIRED=3
expect PASS 3 '前两次被吞掉，第三次成功，每次重新定位控件'
reset; REQUIRED=4
expect FAIL 3 '三次都无效，不能第四次再点'
reset; INITIAL='E2E Tone C'
expect FAIL 0 '开始已是 C，不能把自然接歌算作点击成功'
reset; FAULT=missing
expect FAIL 0 '读屏树没有下一曲'
reset; FAULT=ambiguous
expect FAIL 0 '两个不同的下一曲控件'
reset; FAULT=disabled
expect FAIL 0 '下一曲控件被禁用'
reset; FAULT=read-failed
expect FAIL 0 '读屏失败'
reset; FAULT=unlocked
expect FAIL 0 '定位后已解锁，不点击应用里的控件'
reset; FAULT=wrong-song
expect FAIL 1 '第一次点击后变成其他歌，不再点击'
reset; STATE=2
expect FAIL 0 'B 开始时不是在播'
if [ "$FAILURES" -ne 0 ]; then exit 1; fi
echo 'power_controls_test.sh: 11 项全部通过'
