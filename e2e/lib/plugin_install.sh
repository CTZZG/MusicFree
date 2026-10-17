# shellcheck shell=bash
# Uses the same adb-root prerequisite as the storage suite; only fixture proof is saved.
plugin_install_snapshot() {
    local scratch=$1 directory=$2
    adb shell cat "$KV_DIR/plugin.cache.json" > "$scratch/cache.json" 2> "$directory/read-error.txt" &&
        adb shell cat "$KV_DIR/plugin-meta.json" > "$scratch/meta.json" 2>> "$directory/read-error.txt"
}

plugin_install_diagnostics() {
    local directory=$1 events
    if events=$(adb shell cat "$KV_DIR/plugin-diagnostics.json" 2>/dev/null |
        python3 -I "$HERE/lib/plugin_install.py" errors 2> "$directory/diagnostics-error.txt"); then
        printf '{"available":true,"events":%s}\n' "$events" > "$directory/install-errors.json"
    else
        printf '{"available":false,"events":[]}\n' > "$directory/install-errors.json"
    fi
}

install_plugin() {
    local file=$1 context=${2:-} name hash directory scratch deadline reason="no plugin snapshot" proof label
    label="${context:+$context：}验证插件安装 $file"
    case "$file" in
        e2e-source-a.js) name="E2E 测试源 A" ;;
        e2e-source-b.js) name="E2E 测试源 B" ;;
        *) fail "插件安装前提" "unknown fixture $file"; return 1 ;;
    esac
    directory=$(mktemp -d "$OUT/plugin-install-${file%.js}-XXXXXX") || {
        fail "$label" "无法创建插件证据目录"
        return 1
    }
    if ! ensure_root; then
        fail "$label" "需要可读取应用存储的测试模拟器（adb root），没有执行安装"
        return 1
    fi
    if ! hash=$(python3 -I "$HERE/lib/plugin_install.py" hash "$HERE/.." "$REF" "$file"); then
        fail "$label" "拿不到固定提交的测试插件，未执行安装"
        return 1
    fi
    if ! open_link "musicfree://install/$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PLUGIN_BASE/$file")"; then
        plugin_install_diagnostics "$directory"
        fail "$label" "无法发起外部插件安装请求"
        return 1
    fi
    if ! flow "确认外部插件安装请求 $file${context:+（$context）}" install-plugin.yaml; then
        plugin_install_diagnostics "$directory"
        return 1
    fi
    # Even an interrupted run must not upload raw snapshots of unrelated plugins.
    scratch=$(mktemp -d) || { fail "$label" "无法创建临时快照目录"; return 1; }
    deadline=$(( $(clock) + 30 ))
    while [ "$(clock)" -lt "$deadline" ]; do
        if plugin_install_snapshot "$scratch" "$directory"; then
            if proof=$(python3 -I "$HERE/lib/plugin_install.py" ready "$scratch/cache.json" "$scratch/meta.json" "$name" "$hash" 2> "$directory/validation-error.txt"); then
                printf '%s\n' "$proof" > "$directory/verified.json"
                rm -rf "$scratch"
                pass "$label" "$name：已注册、启用，支持单曲搜索，SHA256符合固定源码"
                return 0
            fi
            reason=$(cat "$directory/validation-error.txt")
        else
            reason="读取插件缓存或启用状态失败"
        fi
        sleep 1
    done
    rm -rf "$scratch"
    plugin_install_diagnostics "$directory"
    fail "$label" "$reason；安装诊断见 $(basename "$directory")/install-errors.json"
    return 1
}
