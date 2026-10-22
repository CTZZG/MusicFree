#!/usr/bin/env bash
# crash.sh 的自检，不用模拟器：假的 adb 记着应用的进程号，am crash、kill -SEGV、force-stop 按场景结束
# 或者不结束进程；Maestro 流程和时钟也换成假的。CI 跑模拟器之前先跑这个。
#
#   bash e2e/lib/crash_checks_test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PKG=fun.upup.musicfree
ACTIVITY="$PKG/.MainActivity"
OUT=$WORK/out
mkdir -p "$OUT"
# shellcheck source=../storage.sh
source "$HERE/storage.sh"
# shellcheck source=../crash.sh
source "$HERE/crash.sh"

# 时钟：wait_until 看 SECONDS，sleep 直接把它往前拨
sleep() { SECONDS=$((SECONDS + ${1%%.*})); }
log() { :; }
pass() { printf 'PASS\t%s\t%s\n' "$1" "${2:-}" >> "$WORK/results"; }
fail() { printf 'FAIL\t%s\t%s\n' "$1" "${2:-}" >> "$WORK/results"; }

# 场景开关：JAVA=dies|stays|respawns，NATIVE=dies|stays，ROOT=yes|no，REPORT=ok|bad
reset() {
    JAVA=dies NATIVE=dies ROOT=yes REPORT=ok
    : > "$WORK/results"
    : > "$WORK/flows"
    : > "$WORK/kills"
    : > "$WORK/pid"
    echo 100 > "$WORK/next-pid"
}

spawn() {
    local pid
    pid=$(cat "$WORK/next-pid")
    echo "$pid" > "$WORK/pid"
    echo $((pid + 1)) > "$WORK/next-pid"
}

adb() {
    local call="$*"
    case "$call" in
        "shell pidof $PKG") cat "$WORK/pid" ;;
        "shell am start -W -n $ACTIVITY") [ -s "$WORK/pid" ] || spawn ;;
        "shell am crash $PKG")
            case $JAVA in
                dies) : > "$WORK/pid" ;;
                # 播放服务的进程被系统马上重新拉起
                respawns) spawn ;;
            esac
            ;;
        "shell kill -SEGV "*)
            echo "${call##* }" >> "$WORK/kills"
            [ "${call##* }" = "$(cat "$WORK/pid")" ] || return 1
            [ "$NATIVE" = dies ] && : > "$WORK/pid"
            ;;
        "shell id -u") if [ "$ROOT" = yes ]; then echo 0; else echo 2000; fi ;;
        "shell am force-stop $PKG") : > "$WORK/pid" ;;
        root | wait-for-device | "shell input keyevent "* | "shell ls -t /data/tombstones") ;;
        *) echo "未知 adb 调用：$*" >&2; return 1 ;;
    esac
}

flow() {
    echo "$2" >> "$WORK/flows"
    if [ "$REPORT" = ok ]; then pass "$1"; else fail "$1" "Maestro 流程 $2 没通过"; return 1; fi
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
equals() { [ "$1" = "$2" ] || { echo "     期望「$2」，实际「$1」"; return 1; }; }
result() { awk -F'\t' -v name="$1" '$2 == name { print $1 }' "$WORK/results"; }
detail() { awk -F'\t' -v name="$1" '$2 == name { print $3 }' "$WORK/results"; }
results() { cut -f1 "$WORK/results" | tr '\n' ' '; }
contains() { case "$1" in *"$2"*) return 0 ;; *) echo "     「$1」里没有「$2」"; return 1 ;; esac; }

reset
run_crash_record_checks
ok "都正常：四项都过" equals "$(results)" "PASS PASS PASS PASS "
ok "SIGSEGV 发给当时在跑的进程" equals "$(cat "$WORK/kills")" "101"
ok "先看诊断，再看清空后的诊断" equals "$(tr '\n' ' ' < "$WORK/flows")" "crash-records.yaml crash-records-cleared.yaml "
ok "最后应用重新开着" equals "$(cat "$WORK/pid")" "103"

reset
JAVA=respawns
run_crash_record_checks
ok "崩溃后被系统拉起成新进程也算退出" equals "$(result "$CRASH_JAVA")" "PASS"
ok "原生崩溃用的是新进程" equals "$(cat "$WORK/kills")" "101"

reset
JAVA=stays
run_crash_record_checks
ok "am crash 后进程还在：Java 崩溃失败" equals "$(result "$CRASH_JAVA")" "FAIL"
ok "失败说明写了进程号" contains "$(detail "$CRASH_JAVA")" "进程 100 还在"
ok "原生崩溃照常检查" equals "$(result "$CRASH_NATIVE")" "PASS"

reset
NATIVE=stays
run_crash_record_checks
ok "SIGSEGV 后进程还在：原生崩溃失败" equals "$(result "$CRASH_NATIVE")" "FAIL"
ok "等满 60 秒才判失败" contains "$(detail "$CRASH_NATIVE")" "60 秒后进程 101 还在"

reset
ROOT=no
run_crash_record_checks
ok "没有 root：原生崩溃失败、不发信号" equals "$(result "$CRASH_NATIVE"):$(cat "$WORK/kills")" "FAIL:"
ok "没有 root 的说明" contains "$(detail "$CRASH_NATIVE")" "拿不到 adb root"

reset
REPORT=bad
run_crash_record_checks
ok "诊断里没有记录：不再跑清空的流程" equals "$(tr '\n' ' ' < "$WORK/flows")" "crash-records.yaml "
ok "清空一项记失败" equals "$(result "$CRASH_CLEARED")" "FAIL"

if [ "$FAILURES" -gt 0 ]; then
    echo "$FAILURES 项没通过"
    exit 1
fi
echo "crash.sh 自检全部通过"
