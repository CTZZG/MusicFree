# shellcheck shell=bash
# Android 17 的后台音频加固（https://developer.android.com/about/versions/17/changes/bg-audio）：
# 后台的应用没有可见界面、也没有（带“使用期间”权限的）前台服务时，播放被静音、焦点请求失败、音量调不动，
# 系统在 logcat 和 dumpsys audio 里留下带包名的 AudioHardening 记录。
#
# E2E_AUDIO_HARDENING=enable|throw 时 run.sh 在开头打开加固（throw 还会让焦点、音量请求直接抛异常），
# 先用“视频”替身在后台抢焦点、写音频作对照：必须被拦下并留下记录，否则说明加固没生效或记录格式变了，
# 后面的判断不作数。结束时本应用一条记录都不能有。由 run.sh source，用到它的 pass、fail、log、OUT、PKG、
# FOCUS_APK、FOCUS_PKG 和 lib/adb_install.sh 的 adb_install。

HARDENING_ON="打开后台音频加固（${E2E_AUDIO_HARDENING:-未设置}）"
HARDENING_CONTROL="对照：后台没有前台服务的替身被加固拦下"
HARDENING_APP="后台音频加固没有拦下本应用"
HARDENING_CONTROL_OK=0

# hardening_lines <包名> <文件…>：文件里提到这个包的 AudioHardening 记录，去掉重复。包名前后不能紧挨着
# 包名里能出现的字符：fun.upup.musicfree 不能算上 fun.upup.musicfree.e2e.focus 的记录
hardening_lines() {
    local package=${1//./\\.}
    shift
    cat "$@" 2>/dev/null |
        grep -F 'AudioHardening' |
        grep -E "(^|[^A-Za-z0-9_.])${package}([^A-Za-z0-9_.]|\$)" |
        sort -u
}

hardening_count() {
    cat "$@" 2>/dev/null | grep -cF 'AudioHardening'
}

enable_audio_hardening() {
    local output status=0
    # 整套跑下来半小时以上，日志缓冲区太小会把前面的记录挤掉
    adb logcat -G 16M > /dev/null 2>&1 || true
    output=$(adb shell cmd audio set-enable-hardening "$E2E_AUDIO_HARDENING" 2>&1) || status=$?
    if [ "$status" -ne 0 ] || grep -qiE 'unknown|error|exception' <<< "$output"; then
        fail "$HARDENING_ON" "退出码 $status：$(tr '\n' ' ' <<< "$output" | cut -c1-200)"
        return 1
    fi
    pass "$HARDENING_ON" "${output:-命令没有输出}"
}

run_hardening_control() {
    local result lines
    if [ -z "${FOCUS_APK:-}" ]; then
        fail "$HARDENING_CONTROL" "没有“视频”替身（E2E_FOCUS_APK 未设置），没有执行"
        return 1
    fi
    if ! adb_install "$OUT/install-focus-control.log" -r "$FOCUS_APK"; then
        fail "$HARDENING_CONTROL" "“视频”替身试了 3 次没装上：$(install_failure_reason "$OUT/install-focus-control.log")"
        return 1
    fi
    adb shell am broadcast --include-stopped-packages -n "$FOCUS_PKG/.BackgroundAudioReceiver" \
        > "$OUT/hardening-control-broadcast.txt" 2>&1
    sleep 5
    adb logcat -d -v threadtime > "$OUT/hardening-control-logcat.txt" 2>/dev/null
    adb shell dumpsys audio > "$OUT/hardening-control-dumpsys-audio.txt" 2>/dev/null
    result=$(grep -F 'background audio focus=' "$OUT/hardening-control-logcat.txt" | tail -n 1 | sed 's/.*background audio //')
    lines=$(hardening_lines "$FOCUS_PKG" "$OUT/hardening-control-logcat.txt" "$OUT/hardening-control-dumpsys-audio.txt")
    if [ -z "$result" ]; then
        fail "$HARDENING_CONTROL" "替身没有收到广播：$(tr '\n' ' ' < "$OUT/hardening-control-broadcast.txt" | cut -c1-200)"
        return 1
    fi
    if [ -z "$lines" ]; then
        fail "$HARDENING_CONTROL" "替身（$result）没有留下 AudioHardening 记录：加固没生效，或者记录里不写包名"
        return 1
    fi
    HARDENING_CONTROL_OK=1
    pass "$HARDENING_CONTROL" "替身 $result；$(wc -l <<< "$lines") 条记录，第一条：$(head -n 1 <<< "$lines" | cut -c1-200)"
}

# check_audio_hardening：finish 里在存好 logcat.txt 之后调用
check_audio_hardening() {
    local lines
    adb shell dumpsys audio > "$OUT/dumpsys-audio.txt" 2>/dev/null || true
    lines=$(hardening_lines "$PKG" "$OUT/logcat.txt" "$OUT/dumpsys-audio.txt")
    printf '%s\n' "$lines" > "$OUT/audio-hardening-app.txt"
    if [ -n "$lines" ]; then
        fail "$HARDENING_APP" "$(wc -l <<< "$lines") 条，第一条：$(head -n 1 <<< "$lines" | cut -c1-200)；全部在 audio-hardening-app.txt"
    elif [ "$HARDENING_CONTROL_OK" -ne 1 ]; then
        fail "$HARDENING_APP" "没有本应用的记录，但对照没通过，不能说明没被拦下"
    else
        pass "$HARDENING_APP" "logcat 和 dumpsys audio 里共 $(hardening_count "$OUT/logcat.txt" "$OUT/dumpsys-audio.txt") 条 AudioHardening 记录，没有本应用的"
    fi
}
