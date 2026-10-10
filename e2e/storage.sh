# shellcheck shell=bash
# 下载、旧版数据迁移的故障注入（run.sh 的第 17、18 步）。run.sh source 这个文件，用它的 pass、fail、
# flow、open_link、log 等函数和 PKG、ACTIVITY、APK、REF、OUT、HERE、PLUGIN_BASE 等变量。
#
# 要读写应用的私有目录，用 adb root（google_apis 模拟器镜像可以）。故障都在设备上直接做，应用里没有
# 任何测试开关：
#   - 下载记录写不进去：在键值存储的临时文件位置（music.DownloadTasks.json.tmp）放一个 root 的目录。
#     存储每次落盘都先写这个临时文件再改名，于是下载记录一次也写不进去，下载收尾第一次提交日志就失败
#   - 旧版数据迁移期间清空：从 0.7.3 覆盖安装，测试源 B 的附加信息一直没用到，卸载插件时才第一次
#     用到，清空和从旧版 MMKV 迁移同时进行

# 设备上的位置。MEDIA_ROOT 是 /sdcard 在底层的位置，应用的外部存储目录（/sdcard/Android/data/<包名>/files）
# 也在它下面
MEDIA_ROOT=/data/media/0
EXT_FILES=$MEDIA_ROOT/Android/data/$PKG/files
KV_DIR=/data/data/$PKG/files/kvstore
DEVICE_TMP=/data/local/tmp
DEVICE_PLACE=$DEVICE_TMP/e2e-place.sh
KVSTORE="$HERE/lib/kvstore.py"
# 写进旧版 MMKV 的附加信息都带着这个标记，迁移后在新存储里找它，就知道是不是旧数据
LEGACY_MARKER="e2e-legacy-0.7.3"
PLATFORM_A="E2E 测试源 A"
PLATFORM_B="E2E 测试源 B"

# ensure_root：让 adbd 以 root 运行，之后 adb shell 都是 root
ensure_root() {
    if [ "$(adb shell id -u 2>/dev/null | tr -d '\r')" = 0 ]; then
        return 0
    fi
    adb root > /dev/null 2>&1 || true
    adb wait-for-device
    local deadline=$((SECONDS + 30))
    while [ $SECONDS -lt $deadline ]; do
        if [ "$(adb shell id -u 2>/dev/null | tr -d '\r')" = 0 ]; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# wait_until <秒> <命令…>：每秒跑一次命令，成功就返回 0，到时间还不成功返回 1
wait_until() {
    local deadline=$((SECONDS + $1))
    shift
    while [ $SECONDS -lt $deadline ]; do
        if "$@"; then
            return 0
        fi
        sleep 1
    done
    "$@"
}

restart_app() {
    adb shell am force-stop "$PKG"
    sleep 2
    adb shell am start -W -n "$ACTIVITY" > /dev/null
}

# ---- 键值存储（/data/data/<包名>/files/kvstore/<store id>.json）----

kv_path() {
    echo "$KV_DIR/$(python3 -I "$KVSTORE" file-name "$1")"
}

kv_exists() {
    adb shell "[ -f '$(kv_path "$1")' ]"
}

# kv <store id> <kvstore.py 的命令…>：读出这个 store，交给 kvstore.py
kv() {
    local id=$1
    shift
    adb shell cat "'$(kv_path "$id")'" 2>/dev/null | python3 -I "$KVSTORE" "$@"
}

kv_sha() {
    adb shell sha256sum "'$(kv_path "$1")'" 2>/dev/null | tr -d '\r' | cut -d' ' -f1
}

# ---- 下载出来的文件 ----

# downloaded_files：设备上文件名带 "E2E Tone" 的歌曲文件（不算下载缓存），每行 "sha256  路径"，按路径排序
downloaded_files() {
    adb shell "find '$MEDIA_ROOT' -type f -name '*E2E Tone*' ! -path '*/cache/*' -exec sha256sum {} +" 2>/dev/null |
        tr -d '\r' | sort -k2
}

# download_cache：下载缓存目录里的文件
download_cache() {
    adb shell "ls -1 '$EXT_FILES/cache/download' 2>/dev/null" | tr -d '\r'
}

# downloaded_path <标题>：这首歌下载出来的文件路径（只取第一个）
downloaded_path() {
    downloaded_files | grep -F "/$1 - " | head -n 1 | sed 's/^[0-9a-f]*  //'
}

# download_settled <标题>：这首已经下载出来、下载缓存清空了，并且 2 秒里文件没再变
download_settled() {
    local first second
    first=$(downloaded_files | grep -F "/$1 - ")
    [ -n "$first" ] && [ -z "$(download_cache)" ] || return 1
    sleep 2
    second=$(downloaded_files | grep -F "/$1 - ")
    [ "$first" = "$second" ]
}

# store_write_failures：错误日志里 music.DownloadTasks 落盘失败的条数。日志把对象排成多行 JSON，
#   一条从 "键值存储落盘失败" 到下一条的 "desc" 为止
store_write_failures() {
    adb shell "cat '$EXT_FILES'/log/error-log-*.log 2>/dev/null" | tr -d '\r' | python3 -I -c '
import sys
entries = sys.stdin.read().split("键值存储落盘失败")[1:]
print(sum(1 for entry in entries if "music.DownloadTasks" in entry.split("\"desc\"")[0]))'
}

# store_write_failures_above <条数>
store_write_failures_above() {
    [ "$(store_write_failures)" -gt "$1" ]
}

# new_download <标题> <之前的 downloaded_files>：这首有了之前没有的文件，下载缓存也清空了
new_download() {
    [ -n "$(missing_lines "$(downloaded_files)" "$2" | grep -F "/$1 - ")" ] && [ -z "$(download_cache)" ]
}

# missing_lines <之前> <之后>：之前有、之后没有（或者内容变了）的行
missing_lines() {
    comm -23 <(printf '%s\n' "$1" | sed '/^$/d' | sort) <(printf '%s\n' "$2" | sed '/^$/d' | sort)
}

push_device_helper() {
    adb push "$HERE/lib/device_place.sh" "$DEVICE_PLACE" > /dev/null
}

# 17. 下载收尾时下载记录写不进去（存储满了、文件系统出错都是这样）：收尾第一次提交日志就失败，
#     这时不能写出最终文件，也不能去删、去改已有的文件；任务标为失败，只清掉这次自己的下载缓存。
#     去掉故障、重启后已有的文件和下载记录都完好，重新下载照常成功。
#     先不注入故障下载一首 C 作对照（也作为“已有的文件”），再在 B 的位置放一个用户自己的同名文件
run_download_fault_checks() {
    local DL_CONTROL="下载 C（不注入故障）：下载出文件"
    local DL_FAULT="注入故障：下载记录确实写不进去"
    local DL_FAILED="下载 B 时下载记录写不进去：任务标为失败"
    local DL_NO_FILE="下载记录没写进去时，不写出 B 的最终文件"
    local DL_KEEP_FILES="下载失败不碰已有的文件（下载好的 C、用户自己的同名 B）"
    local DL_KEEP_STORE="下载记录文件保持故障前的完整内容"
    local DL_NO_CACHE="下载失败后不留下这次的下载缓存"
    local DL_RESTART="去掉故障、重启后已有的文件和下载记录都完好"
    local DL_RETRY="去掉故障后重新下载 B：写到新文件，已有的文件不变"
    local checks=("$DL_CONTROL" "$DL_FAULT" "$DL_FAILED" "$DL_NO_FILE" "$DL_KEEP_FILES" "$DL_KEEP_STORE" "$DL_NO_CACHE" "$DL_RESTART" "$DL_RETRY")
    local check c_path b_user before after store_before failures_before problem fault_dir missing extra

    if ! ensure_root; then
        for check in "${checks[@]}"; do
            fail "$check" "拿不到 adb root，没有执行"
        done
        return 1
    fi
    push_device_helper

    # 对照：不注入故障，下载 C
    open_link "musicfree://search?keyword=e2e%20$REF"
    if ! flow "下载前打开搜索结果" search-results.yaml ||
        ! flow "点下载 C" download-song.yaml -e TITLE="E2E Tone C" ||
        ! wait_until 90 download_settled "E2E Tone C"; then
        fail "$DL_CONTROL" "90 秒内没下载出 C：$(downloaded_files | tr '\n' ' ')；下载缓存：$(download_cache | tr '\n' ' ')"
        for check in "${checks[@]:1}"; do
            fail "$check" "对照的下载没成功，没有执行"
        done
        return 1
    fi
    c_path=$(downloaded_path "E2E Tone C")
    pass "$DL_CONTROL" "$c_path"

    # 用户自己的文件，正好在 B 要下载到的位置：下载不能覆盖、不能删它
    b_user=${c_path/E2E Tone C/E2E Tone B}
    adb shell "cp '$c_path' $DEVICE_TMP/e2e-user-b && echo 'user file' >> $DEVICE_TMP/e2e-user-b &&
        sh $DEVICE_PLACE '$c_path' $DEVICE_TMP/e2e-user-b '$b_user'"

    before=$(downloaded_files)
    failures_before=$(store_write_failures)
    log "注入故障前的下载文件："
    printf '%s\n' "$before"

    # 注入故障：下载记录的临时文件位置被一个 root 的目录占着（里面有文件，应用删不掉）。先等 C 的
    # 收尾写完下载记录；正好在写的那一刻临时文件还在，mkdir 会失败，过一秒再试
    sleep 3
    fault_dir="$KV_DIR/music.DownloadTasks.json.tmp"
    if ! wait_until 10 adb shell "mkdir '$fault_dir' && touch '$fault_dir/e2e-fault'"; then
        for check in "${checks[@]:1}"; do
            fail "$check" "没能在 $fault_dir 放下目录，没有执行"
        done
        return 1
    fi
    # 故障放好之后，下载记录文件就不会再变了
    store_before=$(kv_sha music.DownloadTasks)

    flow "注入故障后点下载 B" download-song.yaml -e TITLE="E2E Tone B"
    flow "$DL_FAILED" download-failed.yaml -e TITLE="E2E Tone B"
    # 落盘失败重试三次（0.2 + 1 + 5 秒）才记进错误日志
    if wait_until 30 store_write_failures_above "${failures_before:-0}" &&
        adb shell "[ -d '$fault_dir' ]"; then
        pass "$DL_FAULT" "错误日志里 music.DownloadTasks 落盘失败 $(( $(store_write_failures) - ${failures_before:-0} )) 次，临时文件位置一直被占着"
    else
        fail "$DL_FAULT" "错误日志里没有新的 music.DownloadTasks 落盘失败（之前 ${failures_before:-0} 条，现在 $(store_write_failures) 条）"
    fi

    after=$(downloaded_files)
    extra=$(missing_lines "$after" "$before" | grep -F "/E2E Tone B - ")
    if [ -z "$extra" ]; then
        pass "$DL_NO_FILE" "下载目录里没有新的 B"
    else
        fail "$DL_NO_FILE" "下载记录没写进去，还是写出了：$(printf '%s' "$extra" | tr '\n' ' ')"
    fi
    missing=$(missing_lines "$before" "$after")
    if [ -z "$missing" ]; then
        pass "$DL_KEEP_FILES" "$(printf '%s\n' "$before" | sed '/^$/d' | wc -l) 个文件内容都没变"
    else
        fail "$DL_KEEP_FILES" "不见了或者内容变了：$(printf '%s' "$missing" | tr '\n' ' ')"
    fi
    if [ -n "$store_before" ] && [ "$(kv_sha music.DownloadTasks)" = "$store_before" ] &&
        problem=$(kv music.DownloadTasks check); then
        pass "$DL_KEEP_STORE" "和故障前逐字节相同，能正常解析（$problem）"
    else
        fail "$DL_KEEP_STORE" "故障前 ${store_before:-读不到}，现在 $(kv_sha music.DownloadTasks)；$(kv music.DownloadTasks check)"
    fi
    if [ -z "$(download_cache)" ]; then
        pass "$DL_NO_CACHE" "下载缓存目录是空的"
    else
        fail "$DL_NO_CACHE" "还有：$(download_cache | tr '\n' ' ')"
    fi

    # 去掉故障，重启
    adb shell "rm -rf '$fault_dir'"
    restart_app
    flow "去掉故障后重启" home.yaml
    sleep 5
    after=$(downloaded_files)
    missing=$(missing_lines "$before" "$after")
    extra=$(missing_lines "$after" "$before")
    if [ -z "$missing" ] && [ -z "$extra" ] && problem=$(kv music.DownloadTasks check); then
        pass "$DL_RESTART" "下载文件和故障前一样，下载记录能正常解析（$problem）"
    else
        fail "$DL_RESTART" "少了：$(printf '%s' "$missing" | tr '\n' ' ')；多了：$(printf '%s' "$extra" | tr '\n' ' ')；下载记录：$(kv music.DownloadTasks check)"
    fi

    # 重新下载 B：写到新文件（同名的位置被用户的文件占着），已有的文件不变
    open_link "musicfree://search?keyword=e2e%20$REF"
    if flow "重新下载前打开搜索结果" search-results.yaml &&
        flow "去掉故障后再点下载 B" download-song.yaml -e TITLE="E2E Tone B" &&
        wait_until 90 new_download "E2E Tone B" "$before"; then
        sleep 3
        after=$(downloaded_files)
        extra=$(missing_lines "$after" "$before")
        missing=$(missing_lines "$before" "$after")
        if [ -z "$missing" ]; then
            pass "$DL_RETRY" "新文件：$(printf '%s' "$extra" | sed 's/^[0-9a-f]*  //' | tr '\n' ' ')；原有 $(printf '%s\n' "$before" | sed '/^$/d' | wc -l) 个文件不变"
        else
            fail "$DL_RETRY" "重新下载后不见了或者变了：$(printf '%s' "$missing" | tr '\n' ' ')"
        fi
    else
        fail "$DL_RETRY" "90 秒内没下载出新的 B：$(downloaded_files | tr '\n' ' ')；下载缓存：$(download_cache | tr '\n' ' ')"
    fi
}

# ---- 旧版（0.7.3）数据 ----

# legacy_song_json <id> <标题> <文件> <时长> <排序>：0.7.3 歌单里的一首歌（带它写的 $timestamp、$sortIndex）
legacy_song_json() {
    printf '{"id":"%s","platform":"%s","title":"%s","artist":"E2E Artist","album":"E2E Album","duration":%s,"e2eRef":"%s","e2eFile":"%s","$timestamp":%s,"$sortIndex":%s}' \
        "$1" "$PLATFORM_A" "$2" "$4" "$REF" "$3" "$(date +%s000)" "$5"
}

# seed_legacy <本机上的 mmkv 目录>：往 0.7.3 的 MMKV 里写：我喜欢里三首测试源 A 的歌，测试源 A、B 的
# 附加信息（带 LEGACY_MARKER）
seed_legacy() {
    local dir=$1 favorites
    favorites="[$(legacy_song_json tone-a "E2E Tone A" tone-a.mp3 480 2),$(legacy_song_json tone-b "E2E Tone B" tone-b.mp3 180 1),$(legacy_song_json tone-c "E2E Tone C" tone-c.mp3 180 0)]"
    "$E2E_MMKV_SEED" set "$dir" LocalSheet.favorite data "$favorites" &&
        "$E2E_MMKV_SEED" set "$dir" "MediaExtra.$PLATFORM_A" tone-a "{\"lyricOffset\":1.5,\"e2eLegacy\":\"$LEGACY_MARKER\"}" &&
        "$E2E_MMKV_SEED" set "$dir" "MediaExtra.$PLATFORM_A" tone-b "{\"lyricOffset\":-0.5,\"e2eLegacy\":\"$LEGACY_MARKER\"}" &&
        "$E2E_MMKV_SEED" set "$dir" "MediaExtra.$PLATFORM_B" fallback "{\"lyricOffset\":2,\"e2eLegacy\":\"$LEGACY_MARKER\"}" &&
        "$E2E_MMKV_SEED" get "$dir" LocalSheet.favorite data > /dev/null &&
        "$E2E_MMKV_SEED" get "$dir" "MediaExtra.$PLATFORM_B" fallback > /dev/null
}

# sheet_has <store id> <期望的歌，空格分开> <不该有的歌，空格分开>：歌单里正好有这些、没有那些
sheet_has() {
    local songs id
    songs=$(kv "$1" sheet-ids) || return 1
    for id in $2; do
        grep -qxF "$PLATFORM_A/$id" <<< "$songs" || return 1
    done
    for id in $3; do
        if grep -qxF "$PLATFORM_A/$id" <<< "$songs"; then
            return 1
        fi
    done
}

sheet_text() {
    kv "$1" sheet-ids | sed "s|^$PLATFORM_A/||" | tr '\n' ' ' | sed 's/ *$//'
}

# legacy_left <store id>：这个 store 里还带着旧版标记的键（排好序，空格分开）。store 读不出来时什么也
#   不输出，所以“没有旧数据”的判断都要再看一下迁移标记（has_migration_flag 要求读得出来）
legacy_left() {
    kv "$1" find "$LEGACY_MARKER" | sort | tr '\n' ' ' | sed 's/ *$//'
}

# legacy_left_is <store id> <键，排好序、空格分开>
legacy_left_is() {
    [ "$(legacy_left "$1")" = "$2" ]
}

has_migration_flag() {
    kv "$1" keys | grep -qxF '$migratedFromMMKV'
}

# 18. 从 0.7.3（MMKV 时代的最后一版）覆盖安装：旧版的我喜欢、附加信息要迁移过来；迁移进行期间
#     清空（卸载插件）、迁移之后删除和清空的数据，当场和重启后都不能被旧数据补回来。
#     旧版数据这样准备：装 0.7.3 启动一次（建出它自己的 MMKV 目录和文件），再用 mmkv-seed（同一个
#     版本的 MMKV 核心）往里写测试数据。会先卸载应用，所以放在最后
run_legacy_upgrade_checks() {
    local LEG_SEEDED="准备旧版数据：0.7.3 启动后，往它的 MMKV 写入我喜欢和附加信息"
    local LEG_UPGRADE="从 0.7.3 覆盖安装新版并启动"
    local LEG_FAV="升级后我喜欢里是旧版的 A、B、C"
    local LEG_EXTRA="测试源 A 的附加信息在第一次用到时从旧版迁移过来"
    local LEG_DELETE="删掉我喜欢里的 B"
    local LEG_CLEAR_DURING="测试源 B 的附加信息迁移中被卸载插件清空：旧数据不回来"
    local LEG_CLEAR_AFTER="测试源 A 的附加信息迁移后被卸载插件清空：旧数据不回来"
    local LEG_RESTART_FAV="重启后我喜欢里只有 A、C，删掉的 B 没回来"
    local LEG_RESTART_EXTRA="重启、再用到测试源 A 后，两个平台的旧附加信息都没回来"
    local checks=("$LEG_SEEDED" "$LEG_UPGRADE" "$LEG_FAV" "$LEG_EXTRA" "$LEG_DELETE" "$LEG_CLEAR_DURING" "$LEG_CLEAR_AFTER" "$LEG_RESTART_FAV" "$LEG_RESTART_EXTRA")
    local check mmkv=$EXT_FILES/mmkv host=$OUT/legacy-mmkv ref name left_a left_b b_before

    skip_rest() {
        local from=$1 reason=$2 i
        for ((i = from; i < ${#checks[@]}; i++)); do
            fail "${checks[$i]}" "$reason"
        done
    }

    if [ -z "${E2E_LEGACY_APK:-}" ] || [ ! -f "$E2E_LEGACY_APK" ] ||
        [ -z "${E2E_MMKV_SEED:-}" ] || [ ! -x "$E2E_MMKV_SEED" ]; then
        skip_rest 0 "没有 0.7.3 的 APK 或 mmkv-seed（E2E_LEGACY_APK=${E2E_LEGACY_APK:-未设置}，E2E_MMKV_SEED=${E2E_MMKV_SEED:-未设置}），没有执行"
        return 1
    fi
    if ! ensure_root; then
        skip_rest 0 "拿不到 adb root，没有执行"
        return 1
    fi
    push_device_helper

    # 0.7.3 启动一次，等它建出 MMKV 文件
    adb uninstall "$PKG" > /dev/null 2>&1 || true
    if ! adb install -g "$E2E_LEGACY_APK" > "$OUT/install-legacy.log" 2>&1; then
        skip_rest 0 "装不上 0.7.3：$(tail -n 3 "$OUT/install-legacy.log" | tr '\n' ' ')"
        return 1
    fi
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    if ! wait_until 60 adb shell "[ -f '$mmkv/LocalSheet.music-sheets' ]"; then
        skip_rest 0 "0.7.3 启动 60 秒还没建出 $mmkv/LocalSheet.music-sheets：$(adb shell "ls -la '$mmkv'" 2>&1 | tr '\n' ' ')"
        return 1
    fi
    sleep 5
    adb shell am force-stop "$PKG"
    ref="$mmkv/LocalSheet.music-sheets"

    # 拉到本机，用 mmkv-seed 写入，再按 0.7.3 自己文件的属主、权限、SELinux 标签放回去
    rm -rf "$host"
    mkdir -p "$host"
    adb pull "$mmkv" "$host" > /dev/null
    if ! seed_legacy "$host/mmkv"; then
        skip_rest 0 "mmkv-seed 写入失败"
        return 1
    fi
    adb shell "rm -rf $DEVICE_TMP/e2e-mmkv && mkdir -p $DEVICE_TMP/e2e-mmkv"
    for name in LocalSheet.favorite "MediaExtra.$PLATFORM_A" "MediaExtra.$PLATFORM_B"; do
        for file in "$name" "$name.crc"; do
            adb push "$host/mmkv/$file" "$DEVICE_TMP/e2e-mmkv/$file" > /dev/null &&
                adb shell "sh $DEVICE_PLACE '$ref' '$DEVICE_TMP/e2e-mmkv/$file' '$mmkv/$file'" ||
                { skip_rest 0 "放不回 $file"; return 1; }
        done
    done
    adb shell "ls -lnZ '$mmkv'" | tr -d '\r' > "$OUT/legacy-mmkv-ls.txt"
    pass "$LEG_SEEDED" "$(grep -c . "$OUT/legacy-mmkv-ls.txt") 行目录列表在 legacy-mmkv-ls.txt；属主、标签照 0.7.3 的 LocalSheet.music-sheets"

    # 覆盖安装新版
    if ! adb install -r -g "$APK" > "$OUT/install-upgrade.log" 2>&1; then
        skip_rest 1 "覆盖安装失败：$(tail -n 3 "$OUT/install-upgrade.log" | tr '\n' ' ')"
        return 1
    fi
    adb shell am start -W -n "$ACTIVITY" > /dev/null
    if ! flow "$LEG_UPGRADE" home.yaml; then
        skip_rest 2 "升级后没进首页，没有执行"
        return 1
    fi

    # 对照：迁移确实在做
    if flow "打开我喜欢（旧版的三首）" legacy-favorites.yaml &&
        wait_until 30 sheet_has LocalSheet.favorite "tone-a tone-b tone-c" ""; then
        pass "$LEG_FAV" "新存储里：$(sheet_text LocalSheet.favorite)"
    else
        fail "$LEG_FAV" "新存储里：$(sheet_text LocalSheet.favorite)"
    fi
    if wait_until 30 legacy_left_is "MediaExtra.$PLATFORM_A" "tone-a tone-b"; then
        pass "$LEG_EXTRA" "带旧版标记的：$(legacy_left "MediaExtra.$PLATFORM_A")"
    else
        fail "$LEG_EXTRA" "带旧版标记的：$(legacy_left "MediaExtra.$PLATFORM_A")；$(kv "MediaExtra.$PLATFORM_A" check)"
    fi

    # 装上两个测试源（卸载时才会清空它们的附加信息）
    open_link "musicfree://install/$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PLUGIN_BASE/e2e-source-a.js")"
    flow "升级后装测试源 A" install-plugin.yaml
    open_link "musicfree://install/$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PLUGIN_BASE/e2e-source-b.js")"
    flow "升级后装测试源 B" install-plugin.yaml

    # 迁移之后删除：我喜欢里删掉 B
    if flow "在我喜欢里删 B" legacy-favorite-delete.yaml &&
        wait_until 15 sheet_has LocalSheet.favorite "tone-a tone-c" "tone-b"; then
        pass "$LEG_DELETE" "新存储里：$(sheet_text LocalSheet.favorite)"
    else
        fail "$LEG_DELETE" "新存储里：$(sheet_text LocalSheet.favorite)"
    fi

    # 迁移进行期间清空：测试源 B 的附加信息到现在还没用到过（新存储里没有这个文件），卸载插件时才
    # 第一次用到。测试源 A 的已经迁移完了，是迁移之后清空
    if kv_exists "MediaExtra.$PLATFORM_B"; then
        b_before="卸载前测试源 B 的附加信息已经用到过（$(kv "MediaExtra.$PLATFORM_B" keys | tr '\n' ' ')），测不到迁移进行期间清空"
    else
        b_before=""
    fi
    if ! flow "卸载全部插件" uninstall-all-plugins.yaml; then
        fail "$LEG_CLEAR_DURING" "没能卸载插件"
        fail "$LEG_CLEAR_AFTER" "没能卸载插件"
    else
        # 等迁移做完、落盘
        wait_until 20 has_migration_flag "MediaExtra.$PLATFORM_B"
        sleep 3
        left_b=$(legacy_left "MediaExtra.$PLATFORM_B")
        if [ -n "$b_before" ]; then
            fail "$LEG_CLEAR_DURING" "$b_before"
        elif ! has_migration_flag "MediaExtra.$PLATFORM_B"; then
            fail "$LEG_CLEAR_DURING" "卸载后测试源 B 的附加信息没有迁移标记，迁移没有跑：$(kv "MediaExtra.$PLATFORM_B" keys 2>&1 | tr '\n' ' ')"
        elif [ -n "$left_b" ]; then
            fail "$LEG_CLEAR_DURING" "清空后旧数据又回来了：$left_b"
        else
            pass "$LEG_CLEAR_DURING" "卸载前新存储里没有它；卸载时迁移跑完（有迁移标记），没有带旧版标记的键"
        fi
        left_a=$(legacy_left "MediaExtra.$PLATFORM_A")
        if [ -z "$left_a" ] && has_migration_flag "MediaExtra.$PLATFORM_A"; then
            pass "$LEG_CLEAR_AFTER" "没有带旧版标记的键，迁移标记还在"
        else
            fail "$LEG_CLEAR_AFTER" "带旧版标记的：${left_a:-无}；迁移标记：$(has_migration_flag "MediaExtra.$PLATFORM_A" && echo 在 || echo 不在)"
        fi
    fi

    # 重启：删掉、清空的都不能回来。我喜欢里显示测试源 A 的歌，会在新进程里再用到测试源 A 的附加信息
    restart_app
    flow "重启后进首页" home.yaml
    if flow "重启后打开我喜欢" legacy-favorites-after.yaml &&
        wait_until 10 sheet_has LocalSheet.favorite "tone-a tone-c" "tone-b"; then
        pass "$LEG_RESTART_FAV" "新存储里：$(sheet_text LocalSheet.favorite)"
    else
        fail "$LEG_RESTART_FAV" "新存储里：$(sheet_text LocalSheet.favorite)"
    fi
    sleep 5
    left_a=$(legacy_left "MediaExtra.$PLATFORM_A")
    left_b=$(legacy_left "MediaExtra.$PLATFORM_B")
    if [ -z "$left_a" ] && [ -z "$left_b" ] &&
        has_migration_flag "MediaExtra.$PLATFORM_A" && has_migration_flag "MediaExtra.$PLATFORM_B"; then
        pass "$LEG_RESTART_EXTRA" "两个平台都没有带旧版标记的键，迁移标记都在（不会再迁移一遍）"
    else
        fail "$LEG_RESTART_EXTRA" "测试源 A：${left_a:-无旧数据}；测试源 B：${left_b:-无旧数据}；迁移标记 A $(has_migration_flag "MediaExtra.$PLATFORM_A" && echo 在 || echo 不在)、B $(has_migration_flag "MediaExtra.$PLATFORM_B" && echo 在 || echo 不在)"
    fi
}
