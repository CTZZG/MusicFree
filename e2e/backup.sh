# shellcheck shell=bash
# Dedicated suite: public restore UI plus actual Android file-read failure/retry.
# Only synthetic fixture fields and hashes leave the emulator, never raw settings.
backup_snapshot() {
    local name=$1 index config sheet_id
    index=$(kv_path LocalSheet.music-sheets)
    config=$(kv_path App.config)
    adb exec-out cat "$index" | python3 -I "$HERE/lib/backup_restore.py" extract index > "$OUT/backup-$name-index.json" || return 1
    adb exec-out cat "$config" | python3 -I "$HERE/lib/backup_restore.py" extract config > "$OUT/backup-$name-config.json" || return 1
    sheet_id=$(python3 -I -c 'import json,sys; print(next(row["id"] for row in json.load(sys.stdin) if row["title"] == "E2E Backup Playlist"))' < "$OUT/backup-$name-index.json") || return 1
    adb exec-out cat "$(kv_path "LocalSheet.$sheet_id")" | python3 -I "$HERE/lib/backup_restore.py" extract songs > "$OUT/backup-$name-songs.json" || return 1
}

run_backup_checks() {
    local kind config before after mode
    ensure_root || { fail '备份：设备文件前提' '需要真实私有快照'; return 1; }
    flow '备份：打开现有恢复界面' backup-open.yaml || return 1
    for kind in v3 legacy; do
        flow "备份：实际导入 $kind" backup-import.yaml \
            -e "BACKUP_URL=https://raw.githubusercontent.com/CTZZG/MusicFree/$REF/e2e/fixtures/backup-$kind.json" \
            -e "SNAPSHOT_NAME=backup-$kind-report" || return 1
        backup_snapshot "$kind" || { fail "备份：$kind 快照读取"; return 1; }
        local args=()
        if [ "$kind" = legacy ]; then args+=(--legacy); fi
        if python3 -I "$HERE/lib/backup_restore.py" check "$OUT/backup-$kind-config.json" "$OUT/backup-$kind-index.json" "$OUT/backup-$kind-songs.json" "${args[@]}" > "$OUT/backup-$kind-verified.json"; then
            pass "备份：$kind 元数据与新ID分组置顶"
        else
            fail "备份：$kind 元数据与新ID分组置顶" '未采用确认框关闭作为成功证据'
            return 1
        fi
    done
    config=$(kv_path App.config)
    before=$(kv_sha App.config)
    mode=$(adb shell stat -c %a "$config" | tr -d '\r')
    [[ "$before" =~ ^[0-9a-f]{64}$ && "$mode" =~ ^[0-7]{3,4}$ ]] || { fail '存储：原文件前提'; return 1; }
    adb shell am force-stop "$PKG"
    adb shell chmod 000 "$config" || return 1
    adb shell am start -W -n "$ACTIVITY" > "$OUT/backup-read-error-start.txt" 2>&1
    local observed=0
    if flow '存储：真实读取失败保留并提示' storage-read-failed.yaml; then observed=1; fi
    after=$(kv_sha App.config)
    # Always restore permissions, including an assertion failure. No corrupt file is deleted.
    adb shell chmod "$mode" "$config" || return 1
    printf '{"before":"%s","duringFailure":"%s","originalMode":"%s"}\n' "$before" "$after" "$mode" > "$OUT/backup-read-file-hashes.json"
    if [ "$observed" -ne 1 ] || [ "$before" != "$after" ]; then
        fail '存储：读取失败原文件未覆盖' '对话框或原字节不匹配'
        return 1
    fi
    pass '存储：读取失败原文件未覆盖' "$before"
    flow '存储：恢复权限后实际重试' storage-read-retry.yaml || return 1
    backup_snapshot recovered || { fail '存储：重试后快照'; return 1; }
    if python3 -I "$HERE/lib/backup_restore.py" check "$OUT/backup-recovered-config.json" "$OUT/backup-recovered-index.json" "$OUT/backup-recovered-songs.json" --legacy > "$OUT/backup-recovered-verified.json"; then
        pass '存储：重试后布局与歌单保留'
    else
        fail '存储：重试后布局与歌单保留'
        return 1
    fi
    # Same actual APK, static image boundary only; no new product instrumentation.
    source "$HERE/lyric_boundaries.sh"
    run_share_boundary_card || return 1
}
