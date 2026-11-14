#!/usr/bin/env bash
# The full suite has two explicit starting conditions. The audio-first mode is
# only valid on a device where this app is not yet installed; never clear data.
validate_all_prelude() {
    case "$E2E_ALL_PRELUDE" in
        post-mv) return 0 ;;
        audio-first) [ "$E2E_SUITE" = all ] ;;
        *) return 1 ;;
    esac
}

check_audio_first_install() {
    local packages
    if ! packages=$(adb shell pm list packages "$PKG" 2> "$OUT/audio-first-packages-error.txt"); then
        fail '普通首启：检查已有安装' '无法读取系统包清单，未执行普通首启回归'
        return 1
    fi
    packages=$(printf '%s\n' "$packages" | tr -d '\r')
    printf '%s\n' "$packages" > "$OUT/audio-first-packages.txt"
    if ! printf '%s\n' "$packages" | awk 'NF && $0 !~ /^package:[A-Za-z0-9_.]+$/ { exit 1 }'; then
        fail '普通首启：检查已有安装' '系统包清单格式无效，未执行普通首启回归'
        return 1
    fi
    if printf '%s\n' "$packages" | grep -Fxq "package:$PKG"; then
        fail '普通首启：检查已有安装' '设备上已有应用，未清除数据或执行首次安装检查'
        return 1
    fi
    pass '普通首启：应用此前未安装' '系统包清单没有本应用；未清除设备数据'
}

run_all_prelude() {
    if [ "$E2E_ALL_PRELUDE" = post-mv ]; then
        source "$HERE/mv.sh"
        run_post_mv_roundtrip_for_all
    fi
}

check_all_pre_cold_start() {
    if [ "$E2E_ALL_PRELUDE" = post-mv ]; then
        if check_post_mv_all_process; then
            pass 'MV后普通回归：冷启动前保持同一进程' '搜索、分享、后台切歌、错误恢复及音质切换均在MV往返后执行'
        else
            fail 'MV后普通回归：冷启动前保持同一进程' '应用进程已变化，无法证明此前回归使用MV后的播放状态'
        fi
    else
        pass '普通首启回归：未执行MV前置步骤' '首次安装后先执行普通播放回归'
    fi
}
