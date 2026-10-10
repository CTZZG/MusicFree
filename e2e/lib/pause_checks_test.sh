#!/usr/bin/env bash
# 用假的 adb 和时钟自检 pause_checks.sh 的判断：音乐在视频放下焦点之前就接着放、视频结束后一直不接着放，
# 都要判失败；正常接着放、用户暂停过一直停着，要判通过。CI 在跑模拟器之前先跑一遍：
#
#   bash e2e/lib/pause_checks_test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SESSION="$HERE/media_session.py"
FOCUS="$HERE/audio_focus.py"
PKG=fun.upup.musicfree
FOCUS_PKG=fun.upup.musicfree.e2e.focus
# shellcheck source=pause_checks.sh
source "$HERE/pause_checks.sh"

# 假时钟：sleep 只拨时钟，不真等
NOW=0
clock() { echo "$NOW"; }
sleep() { NOW=$((NOW + ${1%%.*})); }

# 场景：视频在 VIDEO_END 秒放下焦点；MUSIC_START 秒起音乐在放（空：一直停着），放的时候焦点归音乐
VIDEO_END=12
MUSIC_START=""
music_playing() { [ -n "$MUSIC_START" ] && [ "$NOW" -ge "$MUSIC_START" ]; }

adb() {
    case "$*" in
        "shell dumpsys media_session")
            local state="2" position=8600
            if music_playing; then
                state="3"
                position=$((8600 + (NOW - MUSIC_START) * 1000))
            fi
            cat <<OUT
  Sessions Stack - have 1 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv/12 (userId=0)
      package=fun.upup.musicfree
      active=true
      state=PlaybackState {state=$state, position=$position, buffered position=0, speed=1.0, updated=10, actions=0, custom actions=[], active item id=0, error=null}
      metadata: size=3, description=E2E Tone B, E2E Artist, E2E Album
OUT
            ;;
        "shell dumpsys audio")
            local top=$FOCUS_PKG
            if music_playing || [ "$NOW" -ge "$VIDEO_END" ]; then
                top=$PKG
            fi
            cat <<OUT
Audio Focus stack entries (last is top of stack):
  source:x -- pack: $PKG -- client: c -- gain: GAIN -- flags:  -- loss: LOSS_TRANSIENT -- notified: true
  source:y -- pack: $top -- client: d -- gain: GAIN_TRANSIENT -- flags:  -- loss: none -- notified: true

Notify on duck:  true
OUT
            ;;
        "logcat -d -s E2EFocus")
            echo "I E2EFocus: requested GAIN_TRANSIENT for ${VIDEO_END}s, tag=v, result=1"
            if [ "$NOW" -ge "$VIDEO_END" ]; then
                echo "I E2EFocus: releasing focus tag=v"
            fi
            ;;
        *)
            echo "没模拟的 adb 调用：$*" >&2
            return 1
            ;;
    esac
}

FAILURES=0
# expect <通过|失败> <说明> <命令…>
expect() {
    local want=$1 label=$2 detail got
    shift 2
    if detail=$("$@"); then got=通过; else got=失败; fi
    if [ "$got" = "$want" ]; then
        echo "ok    $label：$got（$detail）"
    else
        echo "WRONG $label：应该$want，实际$got（$detail）"
        FAILURES=$((FAILURES + 1))
    fi
}

scenario() {
    NOW=0
    VIDEO_END=$1
    MUSIC_START=$2
}

# 视频放下焦点之后的检查从放下的那一刻开始计时（expect 在子 shell 里跑，前一项拨的时钟带不过来）
after_video() {
    NOW=$VIDEO_END
}

scenario 12 13
expect 通过 "12 秒视频、第 13 秒接着放：视频期间停着" held_until_video_ends "E2E Tone B" v 20
after_video
expect 通过 "12 秒视频、第 13 秒接着放：之后接着放" resumes_after_video "E2E Tone B" 15

scenario 12 6
expect 失败 "12 秒视频、第 6 秒就接着放" held_until_video_ends "E2E Tone B" v 20

scenario 12 ""
expect 通过 "视频结束后一直不放：视频期间停着" held_until_video_ends "E2E Tone B" v 20
after_video
expect 失败 "视频结束后一直不放" resumes_after_video "E2E Tone B" 15

scenario 6 ""
expect 通过 "看之前暂停：视频期间停着" held_until_video_ends "E2E Tone B" v 15
after_video
expect 通过 "看之前暂停：看完仍停着" stays_paused "E2E Tone B" 8

scenario 6 8
after_video
expect 失败 "看之前暂停，看完却自己放了" stays_paused "E2E Tone B" 8

scenario 100 ""
expect 失败 "视频一直不放下焦点" held_until_video_ends "E2E Tone B" v 20

if [ "$FAILURES" -gt 0 ]; then
    echo "pause_checks_test.sh：$FAILURES 项判断不对"
    exit 1
fi
echo "pause_checks_test.sh self-test ok"
