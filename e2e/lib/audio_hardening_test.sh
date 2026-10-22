#!/usr/bin/env bash
# lib/audio_hardening.sh 的自检，不用模拟器：假的 adb 按场景给出 set-enable-hardening 的输出、替身的日志和
# dumpsys audio。CI 跑模拟器之前先跑这个。
#
#   bash e2e/lib/audio_hardening_test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PKG=fun.upup.musicfree
FOCUS_PKG=fun.upup.musicfree.e2e.focus
FOCUS_APK=$WORK/focus.apk
OUT=$WORK/out
mkdir -p "$OUT"
E2E_AUDIO_HARDENING=throw
# shellcheck source=adb_install.sh
source "$HERE/lib/adb_install.sh"
# shellcheck source=audio_hardening.sh
source "$HERE/lib/audio_hardening.sh"

sleep() { :; }
pass() { printf 'PASS\t%s\t%s\n' "$1" "${2:-}" >> "$WORK/results"; }
fail() { printf 'FAIL\t%s\t%s\n' "$1" "${2:-}" >> "$WORK/results"; }

CONTROL_LINE='10-22 10:00:01.000  1000  1200 W AS.AudioService: AudioHardening level: partial package: fun.upup.musicfree.e2e.focus uid: 10200 focus request blocked'
APP_LINE='10-22 10:20:00.000  1000  1200 W AS.AudioService: AudioHardening level: full package: fun.upup.musicfree uid: 10190 playback silenced'

# 场景：ENABLE=ok|unknown|bad-exit，CONTROL=blocked|no-record|no-broadcast，DUMPSYS 是 dumpsys audio 的内容，
# INSTALL_FAILURES 是替身前几次安装失败的次数（模拟刚开机时建不了安装会话）
reset() {
    ENABLE=ok CONTROL=blocked DUMPSYS="" INSTALL_FAILURES=0
    : > "$WORK/results"
    : > "$OUT/logcat.txt"
    echo 0 > "$WORK/installs"
}

adb() {
    case "$*" in
        "logcat -G 16M") ;;
        "shell cmd audio set-enable-hardening throw")
            case $ENABLE in
                unknown) echo "Unknown command: set-enable-hardening" ;;
                bad-exit) return 255 ;;
            esac
            ;;
        "install -r $FOCUS_APK")
            local installs
            installs=$(( $(cat "$WORK/installs") + 1 ))
            echo "$installs" > "$WORK/installs"
            if [ "$installs" -le "$INSTALL_FAILURES" ]; then
                printf '%s\n' "Exception occurred while executing 'install-create':" \
                    "java.lang.IllegalStateException: not ready" \
                    "	at com.android.server.pm.PackageInstallerService.createSession(PackageInstallerService.java:758)"
                return 1
            fi
            ;;
        "shell am broadcast --include-stopped-packages -n $FOCUS_PKG/.BackgroundAudioReceiver") echo "Broadcast completed: result=0" ;;
        "logcat -d -v threadtime")
            if [ "$CONTROL" != no-broadcast ]; then
                echo "10-22 10:00:01.100 10200 10200 I E2EFocus: background audio focus=threw IllegalStateException write=-3"
            fi
            if [ "$CONTROL" = blocked ]; then
                echo "$CONTROL_LINE"
            fi
            ;;
        "shell dumpsys audio") printf '%s\n' "$DUMPSYS" ;;
        *) echo "未知 adb 调用：$*" >&2; return 1 ;;
    esac
}

FAILURES=0
ok() {
    local name=$1
    shift
    if "$@"; then
        echo "ok   $name"
    else
        echo "FAIL $name"
        FAILURES=$((FAILURES + 1))
    fi
}
not() { ! "$@"; }
equals() { [ "$1" = "$2" ] || { echo "     期望「$2」，实际「$1」"; return 1; }; }
result() { awk -F'\t' -v name="$1" '$2 == name { print $1 }' "$WORK/results"; }
detail() { awk -F'\t' -v name="$1" '$2 == name { print $3 }' "$WORK/results"; }
contains() { case "$1" in *"$2"*) return 0 ;; *) echo "     「$1」里没有「$2」"; return 1 ;; esac; }

# ---- 包名边界 ----
printf '%s\n%s\n' "$CONTROL_LINE" "$APP_LINE" > "$WORK/both.txt"
printf '%s\n' "$CONTROL_LINE" > "$WORK/control-only.txt"
ok "替身的记录不算本应用的" equals "$(hardening_lines "$PKG" "$WORK/control-only.txt")" ""
ok "本应用的记录只挑出一条" equals "$(hardening_lines "$PKG" "$WORK/both.txt")" "$APP_LINE"
ok "替身的记录" equals "$(hardening_lines "$FOCUS_PKG" "$WORK/both.txt")" "$CONTROL_LINE"
printf '%s\n%s\n' "$APP_LINE" "$APP_LINE" > "$WORK/twice.txt"
ok "logcat 和 dumpsys 里同一条只算一次" equals "$(hardening_lines "$PKG" "$WORK/twice.txt" | wc -l)" "1"
echo "W AS.AudioService: AudioHardening level: full fun.upup.musicfree/10190" > "$WORK/slash.txt"
ok "包名后面跟斜杠也认得" equals "$(hardening_lines "$PKG" "$WORK/slash.txt" | wc -l)" "1"
echo "I Something: fun.upup.musicfree started" > "$WORK/other.txt"
ok "不是 AudioHardening 的行不算" equals "$(hardening_lines "$PKG" "$WORK/other.txt")" ""
ok "读不到的文件不出错" equals "$(hardening_lines "$PKG" "$WORK/missing.txt")" ""

# ---- 打开加固 ----
reset
ok "打开加固成功" enable_audio_hardening
ok "记为通过" equals "$(result "$HARDENING_ON")" "PASS"
reset
ENABLE=unknown
ok "Android 14 不认这个命令：返回失败" not enable_audio_hardening
ok "不认命令记失败" equals "$(result "$HARDENING_ON")" "FAIL"
ok "失败里有命令输出" contains "$(detail "$HARDENING_ON")" "Unknown command"
reset
ENABLE=bad-exit
enable_audio_hardening
ok "命令退出码不是 0 记失败" contains "$(detail "$HARDENING_ON")" "退出码 255"

# ---- 对照和最后的检查 ----
reset
run_hardening_control
ok "替身被拦下：对照通过" equals "$(result "$HARDENING_CONTROL")" "PASS"
ok "对照写出替身自己看到的结果" contains "$(detail "$HARDENING_CONTROL")" "focus=threw IllegalStateException write=-3"
check_audio_hardening
ok "本应用没有记录：通过" equals "$(result "$HARDENING_APP")" "PASS"
ok "通过时写出一共几条记录" contains "$(detail "$HARDENING_APP")" "共 0 条"

reset
HARDENING_CONTROL_OK=0
CONTROL=no-record
run_hardening_control
ok "替身没留下记录：对照失败" equals "$(result "$HARDENING_CONTROL")" "FAIL"
check_audio_hardening
ok "对照失败时本应用没记录也不算通过" equals "$(result "$HARDENING_APP")" "FAIL"
ok "说明是对照的问题" contains "$(detail "$HARDENING_APP")" "对照没通过"

reset
HARDENING_CONTROL_OK=0
CONTROL=no-broadcast
run_hardening_control
ok "替身没收到广播：对照失败" contains "$(detail "$HARDENING_CONTROL")" "没有收到广播"

reset
HARDENING_CONTROL_OK=1
printf '%s\n' "$APP_LINE" > "$OUT/logcat.txt"
DUMPSYS="$APP_LINE"
check_audio_hardening
ok "本应用被拦下：失败" equals "$(result "$HARDENING_APP")" "FAIL"
ok "失败写出条数和第一条" contains "$(detail "$HARDENING_APP")" "1 条，第一条：10-22 10:20:00.000"
ok "全部记录另存" equals "$(cat "$OUT/audio-hardening-app.txt")" "$APP_LINE"

reset
reset
INSTALL_FAILURES=2
run_hardening_control
ok "刚开机前两次装不上，第三次装上：对照照常通过" equals "$(result "$HARDENING_CONTROL"):$(cat "$WORK/installs")" "PASS:3"

reset
INSTALL_FAILURES=5
run_hardening_control
ok "三次都装不上：对照失败、不再多试" equals "$(result "$HARDENING_CONTROL"):$(cat "$WORK/installs")" "FAIL:3"
ok "失败写出异常，不是调用栈的最后几行" contains "$(detail "$HARDENING_CONTROL")" "IllegalStateException: not ready"
ok "三次的输出都留在日志里" equals "$(grep -c '^== 第' "$OUT/install-focus-control.log")" "3"

reset
FOCUS_APK=""
run_hardening_control
ok "没有替身 APK：对照失败" contains "$(detail "$HARDENING_CONTROL")" "没有“视频”替身"

if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES 项没通过"
    exit 1
fi
echo "audio_hardening.sh 自检全部通过"
