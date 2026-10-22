# shellcheck shell=bash
# 装 APK 的公共函数，run.sh 和 lib/audio_hardening.sh 用。
#
# 安装偶尔会因模拟器一时的状态失败，失败时过一会儿再试；失败原因写清楚，不只留调用栈的最后几行
# （Android 17 镜像第一次失败时就只看到 PackageInstallerService.createSession，看不出其实是数据分区满了）。

# adb_install <日志> <adb install 的参数…>：失败时等 10 秒再试，最多 3 次。每次的输出都追加到日志里，
# 最后还失败时返回 1
adb_install() {
    local log=$1 attempt
    shift
    : > "$log"
    for attempt in 1 2 3; do
        echo "== 第 $attempt 次：adb install $*" >> "$log"
        if adb install "$@" >> "$log" 2>&1; then
            return 0
        fi
        if [ "$attempt" -lt 3 ]; then
            sleep 10
        fi
    done
    return 1
}

# install_failure_reason <日志>：失败原因的要点，写进检查结果；完整的输出在日志里。取 Failure [...]、
# 第一个异常（类名开头的那行，不是“Exception occurred while executing …”）和第一行 Caused by，
# 都没有时取最后三行
install_failure_reason() {
    local reason
    reason=$({
        grep -m1 -E 'Failure \[' "$1"
        grep -m1 -E '^[A-Za-z_$][A-Za-z0-9_.$]*(Exception|Error)(: |$)' "$1"
        grep -m1 -E '^[[:space:]]*Caused by' "$1"
    } 2> /dev/null)
    if [ -z "$reason" ]; then
        reason=$(tail -n 3 "$1" 2> /dev/null)
    fi
    printf '%s' "$reason" | tr '\n\t' '  ' | cut -c1-300
}
