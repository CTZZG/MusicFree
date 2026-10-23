# shellcheck shell=bash
# 第 24 步：本机的崩溃记录（android/.../diagnostics/CrashDiagnostics.kt）。由 run.sh source，
# 用到 run.sh 的 flow、pass、fail、log 和 storage.sh 的 ensure_root、wait_until、restart_app。
#
# 先用 `am crash` 让主线程抛出未捕获的异常（和应用自己崩溃走同一个处理器），再用 root 给进程发 SIGSEGV
# （debuggerd 照常写 tombstone，系统记为原生崩溃）。之后打开“复制播放诊断”，两次崩溃都要在里面：
# Java 崩溃带异常类名，对应的退出记录标为已记下调用栈；原生崩溃带信号和崩溃线程的调用栈。
# 最后“清空日志”，再打开诊断，两次崩溃都不再出现。

CRASH_JAVA="Java 崩溃：进程退出前记下异常"
CRASH_NATIVE="原生崩溃：进程被 SIGSEGV 结束"
CRASH_REPORT="复制播放诊断里有两次崩溃的记录"
CRASH_CLEARED="清空日志后崩溃记录不再显示"

app_pid() {
    adb shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{ print $1 }'
}

# 进程号和崩溃前的不一样（已经退出，或者被系统重新拉起成了新进程）
app_pid_changed_from() {
    [ "$(app_pid)" != "$1" ]
}

app_is_running() {
    [ -n "$(app_pid)" ]
}

start_app_for_crash() {
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    wait_until 20 app_is_running
}

run_crash_record_checks() {
    local before
    # 停下播放，崩溃后系统不会为了前台服务把进程马上拉起来再混进下一次检查
    adb shell input keyevent KEYCODE_MEDIA_PAUSE || true

    if ! start_app_for_crash; then
        fail "$CRASH_JAVA" "应用没起来，没有执行"
    else
        before=$(app_pid)
        adb shell am crash "$PKG" > "$OUT/crash-java.txt" 2>&1 || true
        if wait_until 20 app_pid_changed_from "$before"; then
            pass "$CRASH_JAVA" "am crash 后进程 $before 已退出"
        else
            fail "$CRASH_JAVA" "am crash 后 20 秒进程 $before 还在：$(cat "$OUT/crash-java.txt")"
        fi
    fi

    if ! ensure_root; then
        fail "$CRASH_NATIVE" "拿不到 adb root，没有执行"
    elif ! start_app_for_crash; then
        fail "$CRASH_NATIVE" "应用没起来，没有执行"
    else
        before=$(app_pid)
        adb shell kill -SEGV "$before"
        # debuggerd 要先展开所有线程的调用栈、写 tombstone，进程才退出
        if wait_until 60 app_pid_changed_from "$before"; then
            pass "$CRASH_NATIVE" "进程 $before 已退出"
            adb shell ls -t /data/tombstones 2>/dev/null | head -n 3 > "$OUT/crash-tombstones.txt" || true
        else
            fail "$CRASH_NATIVE" "发出 SIGSEGV 60 秒后进程 $before 还在"
        fi
    fi
    # 系统把 tombstone 关联到退出记录要一点时间
    sleep 5

    adb shell am start -W -n "$ACTIVITY" > /dev/null
    if flow "$CRASH_REPORT" crash-records.yaml; then
        flow "$CRASH_CLEARED" crash-records-cleared.yaml
    else
        fail "$CRASH_CLEARED" "诊断里没有崩溃记录，没有执行"
    fi
    restart_app
}
