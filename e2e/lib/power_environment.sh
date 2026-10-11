# shellcheck shell=bash
# power.sh 的环境断言。每次媒体会话采样前后及检查边界都核对；第一次失效写到文件，
# 让 session/stays_paused 的命令替换也能保留失败。采样之间的短暂变化不能保证被抓到。

power_environment() {
    local mode=$1 screen guard idle saver
    screen=$(screen_state 2>/dev/null) || screen=?
    case "$screen" in
        Asleep|Dozing) ;;
        *) echo "要求灭屏，实际屏幕 $screen"; return 1 ;;
    esac
    case "$mode" in
        locked)
            guard=$(keyguard_state 2>/dev/null) || guard=?
            if [ "$guard" != showing ]; then
                echo "要求锁屏，实际 $guard"
                return 1
            fi
            ;;
        doze)
            idle=$(deep_idle_state 2>/dev/null) || idle=?
            if [ "$idle" != IDLE ]; then
                echo "要求 Doze IDLE，实际 $idle"
                return 1
            fi
            ;;
        saver)
            idle=$(deep_idle_state 2>/dev/null) || idle=?
            saver=$(adb shell settings get global low_power 2>/dev/null | tr -d '\r')
            # 再次灭屏可能立即变成 INACTIVE 等准备状态，这时尚未进入深度 Doze。
            # IDLE_MAINTENANCE 仍属于 Doze 周期，不能当成独立省电环境；未知状态也拒绝。
            case "$idle" in
                ACTIVE|INACTIVE|IDLE_PENDING|SENSING|LOCATING|QUICK_DOZE_DELAY) ;;
                *) echo "要求退出深度 Doze，实际 ${idle:-?}"; return 1 ;;
            esac
            if [ "$saver" != 1 ]; then
                echo "要求退出 Doze 并打开省电模式，实际 Doze ${idle:-?}、low_power ${saver:-?}"
                return 1
            fi
            ;;
        *) echo "未知环境 $mode"; return 1 ;;
    esac
}

# power_check <locked|doze|saver> <检查名> <原检查函数> <原参数…>
# 原函数仍检查播放行为，且必须记录且只记录这一个检查的结果。放在子 shell 里替换采样和结果
# 函数，既不改变 run.sh 的全局计数，也不影响别的 E2E 步骤。结束后只向真正的报告记一次结果。
power_check() {
    local mode=$1 name=$2 scratch status recorded detail reason action_status
    shift 2
    if ! reason=$(power_environment "$mode"); then
        fail "$name" "检查前环境不满足：$reason"
        return 1
    fi
    if ! scratch=$(mktemp -d); then
        fail "$name" "无法建立环境检查记录"
        return 1
    fi
    (
        record_environment() {
            local problem
            if ! problem=$(power_environment "$mode"); then
                if [ ! -s "$scratch/environment" ]; then
                    printf '%s\n' "$(clock)s：$problem" > "$scratch/environment"
                fi
            fi
        }
        session() {
            local read_status
            record_environment
            read_session
            read_status=$?
            record_environment
            return "$read_status"
        }
        pass() { printf 'PASS\t%s\t%s\n' "$1" "${2:-}" >> "$scratch/result"; }
        fail() { printf 'FAIL\t%s\t%s\n' "$1" "${2:-}" >> "$scratch/result"; }
        record_environment
        "$@"
        action_status=$?
        record_environment
        printf '%s\n' "$action_status" > "$scratch/status"
    )
    reason=$(cat "$scratch/environment" 2>/dev/null || true)
    action_status=$(cat "$scratch/status" 2>/dev/null || echo 1)
    if [ ! -f "$scratch/result" ] || [ "$(wc -l < "$scratch/result")" -ne 1 ]; then
        status=FAIL
        detail="检查未记录唯一结果"
    else
        IFS=$'\t' read -r status recorded detail < "$scratch/result"
        if [ "$recorded" != "$name" ] || { [ "$status" = PASS ] && [ "$action_status" -ne 0 ]; }; then
            status=FAIL
            detail="检查名称或返回值不一致：${recorded:-?}，退出码 $action_status"
        fi
    fi
    rm -rf "$scratch"
    if [ -n "$reason" ]; then
        fail "$name" "环境失效：$reason；${detail:-}"
        return 1
    fi
    if [ "$status" != PASS ]; then
        fail "$name" "${detail:-检查没有通过}"
        return 1
    fi
    pass "$name" "${detail:-}；环境采样符合 $mode"
}
