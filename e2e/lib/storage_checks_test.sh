#!/usr/bin/env bash
# storage.sh 里判断文件和存储的函数的自检，不用模拟器：假的 adb 把 "adb shell" 的命令放在本机一个临时
# 目录里跑，设备上的位置都换到这个目录下。CI 跑模拟器之前先跑这个。
#
#   bash e2e/lib/storage_checks_test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cat > "$WORK/bin/adb" <<'EOF'
#!/usr/bin/env bash
case "$1" in
    shell) shift; exec sh -c "$*" ;;
    push) mkdir -p "$(dirname "$3")"; cp -r "$2" "$3" ;;
    pull) cp -r "$2" "$3" ;;
    *) exit 0 ;;
esac
EOF
chmod +x "$WORK/bin/adb"
PATH="$WORK/bin:$PATH"

PKG=fun.upup.musicfree
OUT=$WORK/out
mkdir -p "$OUT"
# shellcheck source=../storage.sh
source "$HERE/storage.sh"
MEDIA_ROOT=$WORK/device/media
EXT_FILES=$MEDIA_ROOT/Android/data/$PKG/files
KV_DIR=$WORK/device/kvstore
DOWNLOADS=$EXT_FILES/download/music
mkdir -p "$DOWNLOADS" "$EXT_FILES/cache/download" "$EXT_FILES/log" "$KV_DIR"

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
# 只看返回值，输出（包括读不出来时的原因）不要
quiet() { "$@" > /dev/null 2>&1; }
equals() { [ "$1" = "$2" ] || { echo "     期望「$2」，实际「$1」"; return 1; }; }

snapshot() {
    python3 -I -c 'import json,sys; print(json.dumps({"version": 1, "entries": json.loads(sys.argv[1])}, ensure_ascii=False))' "$1"
}

# ---- 键值存储 ----
legacy='{\"lyricOffset\":1.5,\"e2eLegacy\":\"e2e-legacy-0.7.3\"}'
snapshot "{\"\$migratedFromMMKV\": {\"t\": \"s\", \"v\": \"x\"}, \"tone-b\": {\"t\": \"s\", \"v\": \"$legacy\"}, \"tone-a\": {\"t\": \"s\", \"v\": \"$legacy\"}, \"new\": {\"t\": \"s\", \"v\": \"{}\"}}" \
    > "$KV_DIR/MediaExtra.E2E%20%E6%B5%8B%E8%AF%95%E6%BA%90%20A.json"
ok "store id 编码成文件名，读得到" kv_exists "MediaExtra.E2E 测试源 A"
ok "没有的 store" not kv_exists "MediaExtra.E2E 测试源 B"
ok "带旧版标记的键，排好序" equals "$(legacy_left "MediaExtra.E2E 测试源 A")" "tone-a tone-b"
ok "legacy_left_is" legacy_left_is "MediaExtra.E2E 测试源 A" "tone-a tone-b"
ok "读不出来的 store 没有输出" equals "$(legacy_left "MediaExtra.E2E 测试源 B" 2> /dev/null)" ""
ok "有迁移标记" has_migration_flag "MediaExtra.E2E 测试源 A"
ok "读不出来的 store 没有迁移标记" not quiet has_migration_flag "MediaExtra.E2E 测试源 B"

songs=$(python3 -I -c 'import json; print(json.dumps(json.dumps([{"id": "tone-a", "platform": "E2E 测试源 A"}, {"id": "tone-c", "platform": "E2E 测试源 A"}], ensure_ascii=False), ensure_ascii=False))')
snapshot "{\"data\": {\"t\": \"s\", \"v\": $songs}}" > "$KV_DIR/LocalSheet.favorite.json"
ok "歌单里有 A、C，没有 B" sheet_has LocalSheet.favorite "tone-a tone-c" "tone-b"
ok "歌单里缺 B 时不算有" not sheet_has LocalSheet.favorite "tone-a tone-b" ""
ok "歌单里有不该有的 C" not sheet_has LocalSheet.favorite "tone-a" "tone-c"
ok "歌单内容写成一行" equals "$(sheet_text LocalSheet.favorite)" "tone-a tone-c"

echo '{"version":1,"entries":{}}' > "$KV_DIR/music.DownloadTasks.json"
ok "下载记录能解析" quiet kv music.DownloadTasks check
ok "下载记录的 sha256" equals "$(kv_sha music.DownloadTasks)" "$(sha256sum "$KV_DIR/music.DownloadTasks.json" | cut -d' ' -f1)"
echo '{"version":1,"entries":' > "$KV_DIR/music.DownloadTasks.json"
ok "写坏的下载记录解析不了" not quiet kv music.DownloadTasks check

# ---- 下载出来的文件 ----
echo C > "$DOWNLOADS/E2E Tone C - E2E Artist.mp3"
ok "C 下载完了" download_settled "E2E Tone C"
ok "下载出的路径" equals "$(downloaded_path "E2E Tone C")" "$DOWNLOADS/E2E Tone C - E2E Artist.mp3"
echo partial > "$EXT_FILES/cache/download/tone-b.part"
ok "缓存还在就不算下载完" not download_settled "E2E Tone C"
rm "$EXT_FILES/cache/download/tone-b.part"
echo user > "$DOWNLOADS/E2E Tone B - E2E Artist.mp3"
before=$(downloaded_files)
ok "只有用户自己的 B，不算新下载" not new_download "E2E Tone B" "$before"
echo B > "$DOWNLOADS/E2E Tone B - E2E Artist (1).mp3"
echo cache > "$EXT_FILES/cache/download/x"
ok "新的 B 有了但缓存没清" not new_download "E2E Tone B" "$before"
rm "$EXT_FILES/cache/download/x"
ok "新的 B" new_download "E2E Tone B" "$before"
after=$(downloaded_files)
ok "原有的文件都在" equals "$(missing_lines "$before" "$after")" ""
ok "多出来的是新的 B" equals "$(missing_lines "$after" "$before" | sed 's/^[0-9a-f]*  //')" "$DOWNLOADS/E2E Tone B - E2E Artist (1).mp3"
echo changed > "$DOWNLOADS/E2E Tone C - E2E Artist.mp3"
ok "内容变了的文件算不见了" equals "$(missing_lines "$before" "$(downloaded_files)" | sed 's/^[0-9a-f]*  //')" "$DOWNLOADS/E2E Tone C - E2E Artist.mp3"
echo cached > "$EXT_FILES/cache/download/E2E Tone A - E2E Artist.mp3"
ok "下载缓存里的不算下载出来的文件" not new_download "E2E Tone A" "$before"

# ---- 错误日志 ----
ok "没有错误日志时 0 条" equals "$(store_write_failures)" "0"
printf '%s\n' \
    '10:00:00 | ERROR : {"desc":"键值存储落盘失败","message":{"storeId":"music.DownloadTasks","attempts":3}}' \
    '10:00:01 | ERROR : {"desc":"键值存储落盘失败","message":{"storeId":"App.config","attempts":3}}' \
    '10:00:02 | ERROR : {"desc":"下载收尾回滚未完成","message":{"storeId":"music.DownloadTasks"}}' \
    > "$EXT_FILES/log/error-log-10-10-2026.log"
ok "只数 music.DownloadTasks 的落盘失败" equals "$(store_write_failures)" "1"
ok "比之前多" store_write_failures_above 0
ok "不比之前多" not store_write_failures_above 1

if [ "$FAILURES" -gt 0 ]; then
    echo "storage_checks_test.sh: $FAILURES 项没通过"
    exit 1
fi
echo "storage_checks_test.sh: 全部通过"
