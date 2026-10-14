# shellcheck shell=bash
# 本地音乐库（run.sh 的第 22 步）：首次扫描、原样重扫、文件改名移动和复制后删除、相同的文件、
# 两条导入途径（系统音乐库和选择文件夹）、音频权限撤销和恢复。run.sh source 这个文件，用它的 pass、fail、
# flow、shot、log、expect_playing 等函数，storage.sh 的 ensure_root、wait_until、restart_app、kv，
# 和 PKG、OUT、HERE 等变量。
#
# 测试音频在这里用 ffmpeg 现做（带 ID3 的标题、歌手、专辑，每首时长不同），adb push 到 /sdcard/Music/E2E-*。
# 推、改名、复制、删除都走 /sdcard（FUSE），系统媒体库（MediaStore）自己跟着更新；每一步都等 MediaStore 里
# 真的有了（或没了）这些行再往下走。应用里没有任何测试开关：扫描、加入我喜欢、点歌都是点界面。
# 应用的本地音乐列表从 RKStorage（AsyncStorage 的 SQLite 文件）里读，我喜欢从键值存储里读（见 lib/local_library.py）。
#
# 这里定下的预期：
#   - 同一个文件（文件名、大小、时长、标题、歌手、专辑都相同）在本地音乐里只算一首，不管是同一次扫描
#     扫到几份、后来又多出几份，还是从两条途径各导入一次
#   - 文件改名、移动后重扫，原来那一条跟到新位置（键不变），我喜欢里的也跟着指向新位置；
#     重扫前原位置已经没有文件时列表显示“文件不存在”
#   - 没有音频读取权限时文件仍在：不删、不改条目，不把它们说成“文件不存在”，点歌时向用户要权限；
#     恢复权限后不用重扫就能播放

LIBRARY="$HERE/lib/local_library.py"
LIB_WORK="$OUT/library"
# 推文件、改名用 /sdcard；MediaStore 的 _data 记的是 /storage/emulated/0
LIB_SD=/sdcard/Music
LIB_ST=/storage/emulated/0/Music
LIB_DIRS=(E2E-Library E2E-Moved E2E-Copies E2E-Extra)
RK_DB=/data/data/$PKG/databases/RKStorage
AUDIO_PERMISSION=android.permission.READ_MEDIA_AUDIO
LIB_ROW=""

# make_library_track <文件> <标题> <秒数> <频率>
make_library_track() {
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "sine=frequency=$4:sample_rate=16000:duration=$3" \
        -ac 1 -c:a libmp3lame -b:a 16k -id3v2_version 3 \
        -metadata title="$2" -metadata artist="E2E Library" -metadata album="E2E Library Album" "$1"
}

# lib_media：MediaStore 里 Music/E2E-* 下的音频，一行 JSON（见 local_library.py media-rows）
lib_media() {
    adb shell "content query --uri content://media/external/audio/media --projection _id:_data:title:duration:is_music --where \"_data LIKE '$LIB_ST/E2E-%'\"" 2>/dev/null |
        tr -d '\r' | python3 -I "$LIBRARY" media-rows
}

# lib_media_is <ready|gone> <文件…>：这些文件在 MediaStore 里都有了（扫完了）/ 都没了
lib_media_is() {
    local state=$1
    shift
    lib_media > "$LIB_WORK/media-now.json" && python3 -I "$LIBRARY" "$state" "$LIB_WORK/media-now.json" "$@"
}

# lib_wait_media <ready|gone> <文件…>：等 MediaStore 跟上（FUSE 一般几秒内就处理完）。等了 20 秒还没有，
#   再用媒体扫描广播点一下这些文件
lib_wait_media() {
    local state=$1 file
    shift
    if wait_until 20 lib_media_is "$state" "$@"; then
        return 0
    fi
    log "MediaStore 20 秒没跟上（要 $state：$*），发媒体扫描广播"
    for file in "$@"; do
        adb shell "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://$file'" > /dev/null 2>&1 || true
    done
    if wait_until 40 lib_media_is "$state" "$@"; then
        return 0
    fi
    log "MediaStore 里现在是：$(cat "$LIB_WORK/media-now.json")"
    return 1
}

# lib_read <名字>：读出应用的本地音乐（E2E Lib 开头的）到 $LIB_WORK/<名字>.json，MediaStore 到 <名字>-media.json。
#   连读两次一样才算（防止正好在写的时候拷出半份数据库）
lib_read_once() {
    local dir="$LIB_WORK/db-$1"
    rm -rf "$dir"
    mkdir -p "$dir"
    adb exec-out cat "$RK_DB" > "$dir/RKStorage" 2>/dev/null || return 1
    if adb shell "[ -f '$RK_DB-wal' ]"; then
        adb exec-out cat "$RK_DB-wal" > "$dir/RKStorage-wal" 2>/dev/null || return 1
    fi
    python3 -I "$LIBRARY" entries "$dir/RKStorage" > "$LIB_WORK/$1.json"
}

lib_read() {
    local name=$1 deadline=$((SECONDS + 15))
    while [ $SECONDS -lt $deadline ]; do
        if lib_read_once "$name" && sleep 1 && lib_read_once "$name-again" &&
            cmp -s "$LIB_WORK/$name.json" "$LIB_WORK/$name-again.json"; then
            lib_media > "$LIB_WORK/$name-media.json"
            log "本地音乐（$name）：$(cat "$LIB_WORK/$name.json")"
            log "MediaStore（$name）：$(cat "$LIB_WORK/$name-media.json")"
            return 0
        fi
        sleep 1
    done
    log "读不出应用的本地音乐（$name）：$(cat "$LIB_WORK/$name.json" 2>/dev/null)"
    return 1
}

# lib_verify <快照名> <标题> [key=<键>] [file=<文件>]：见 local_library.py check，输出说明或原因
lib_verify() {
    local snapshot=$1
    shift
    python3 -I "$LIBRARY" check "$LIB_WORK/$snapshot.json" "$LIB_WORK/$snapshot-media.json" "$@"
}

# lib_check <检查名> <快照名> <标题> [key=<键>] [file=<文件>]
lib_check() {
    local name=$1 snapshot=$2 title=$3 detail
    shift 3
    if detail=$(lib_verify "$snapshot" "$title" "$@"); then
        pass "$name" "$title：$detail"
        return 0
    fi
    fail "$name" "$detail"
    return 1
}

# lib_same <之前的快照> <之后的快照>：条目完全没变，输出说明；变了输出差别、返回 1
lib_same() {
    python3 -I "$LIBRARY" same "$LIB_WORK/$1.json" "$LIB_WORK/$2.json"
}

lib_key() {
    python3 -I "$LIBRARY" key "$LIB_WORK/$1.json" "$2"
}

# lib_path <快照名> <标题>：这首记的文件位置
lib_path() {
    python3 -I -c 'import json,sys; print(next(e["path"] for e in json.load(open(sys.argv[1])) if e["title"] == sys.argv[2]))' \
        "$LIB_WORK/$1.json" "$2"
}

# lib_uri <快照名> <文件>：MediaStore 里这个文件的 content URI
lib_uri() {
    python3 -I -c 'import json,sys; print(next(r["uri"] for r in json.load(open(sys.argv[1])) if r["file"] == sys.argv[2]))' \
        "$LIB_WORK/$1-media.json" "$2"
}

# lib_favorite_path <键>：我喜欢里这首记的文件位置（不在我喜欢里时为空）
lib_favorite_path() {
    kv LocalSheet.favorite sheet-paths | awk -F'\t' -v key="$1" '$1 == key { print $2 }'
}

lib_favorite_is() {
    [ "$(lib_favorite_path "$1")" = "$2" ]
}

# lib_scan <检查名>：重启应用，扫描系统音乐库；结果页的“发现…新增…修复…”记到日志里
lib_scan() {
    restart_app
    flow "$1" local-music-scan.yaml || return 1
    log "扫描结果：$(maestro hierarchy --compact --no-reinstall-driver 2>/dev/null | grep -oE 'text=发现[^;"]*' | head -n 1)"
}

# lib_row <检查名> <标题>：重启应用，打开本地音乐，等这一行出来，再等 3 秒（文件在不在是异步查的）；
#   LIB_ROW 设成 missing（读屏标签带「文件不存在」）、ok 或 absent
lib_row() {
    LIB_ROW=absent
    restart_app
    flow "$1" local-music-row.yaml -e TITLE="$2" || return 1
    sleep 3
    LIB_ROW=$(maestro hierarchy --compact --no-reinstall-driver 2>/dev/null | python3 -I "$LIBRARY" row "$2")
    shot "library-row-$(date +%s)"
    log "本地音乐里「$2」这一行：$LIB_ROW"
}

permission_dialog_shown() {
    adb shell dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | grep -q GrantPermissionsActivity
}

audio_permission_granted() {
    adb shell dumpsys package "$PKG" 2>/dev/null | grep -F "$AUDIO_PERMISSION: granted=true" > /dev/null
}

lib_push() { # <本机文件> <设备上的文件>
    adb shell "mkdir -p '$(dirname "$2")'" && adb push "$1" "$2" > /dev/null
}

# 22. 本地音乐库
run_library_checks() {
    local LIB_FIRST="首次扫描系统音乐库：两首各一条，指向 MediaStore 里的文件"
    local LIB_FAVORITE="把 One 加入我喜欢：我喜欢里记着 One 的文件"
    local LIB_RESCAN="原样重扫：条目、键、路径都不变，我喜欢里的 One 也不变"
    local LIB_RENAME="Two 改名移到别的文件夹后重扫：还是一条，键不变，指向改名后的文件"
    local LIB_MISSING="One 复制到别处、删掉原文件后，重扫前列表里 One 显示文件不存在"
    local LIB_MOVED="重扫后 One 还是一条，键不变，指向新文件"
    local LIB_MOVED_FAVORITE="重扫后我喜欢里的 One 也指向新文件"
    local LIB_MOVED_PLAY="移动后的 One 能播放"
    local LIB_LATER_COPIES="One 后来又多出两份相同的文件：重扫后仍是一条"
    local LIB_SAME_SCAN="Three 的两份相同文件同一次扫进来：只有一条"
    local LIB_FOLDER="选择文件夹（另一条途径）再导入已在库里的文件：不多出条目，原条目不变"
    local LIB_REVOKED_KEEP="撤销音频权限后打开本地音乐：条目、键、路径都不变"
    local LIB_REVOKED_ROW="撤销音频权限后：不把 Two 显示成文件不存在"
    local LIB_REVOKED_TAP="撤销音频权限后点 Two：弹出系统授权框，而不是提示文件不存在"
    local LIB_GRANTED="恢复权限后不用重扫：条目不变，Two 不显示文件不存在"
    local LIB_GRANTED_PLAY="恢复权限后点 Two 能播放"
    local checks=("$LIB_FIRST" "$LIB_FAVORITE" "$LIB_RESCAN" "$LIB_RENAME" "$LIB_MISSING" "$LIB_MOVED"
        "$LIB_MOVED_FAVORITE" "$LIB_MOVED_PLAY" "$LIB_LATER_COPIES" "$LIB_SAME_SCAN" "$LIB_FOLDER"
        "$LIB_REVOKED_KEEP" "$LIB_REVOKED_ROW" "$LIB_REVOKED_TAP" "$LIB_GRANTED" "$LIB_GRANTED_PLAY")
    local check dir one_key two_key one_path two_old_id two_new_id detail
    local ONE="$LIB_ST/E2E-Library/E2ELibOne.mp3" TWO="$LIB_ST/E2E-Library/E2ELibTwo.mp3"
    local TWO_MOVED="$LIB_ST/E2E-Moved/E2ELibTwoMoved.mp3" ONE_MOVED="$LIB_ST/E2E-Moved/E2ELibOne.mp3"
    local ONE_COPY="$LIB_ST/E2E-Copies/E2ELibOne.mp3" ONE_EXTRA="$LIB_ST/E2E-Extra/E2ELibOne.mp3"
    local THREE="$LIB_ST/E2E-Library/E2ELibThree.mp3" THREE_COPY="$LIB_ST/E2E-Copies/E2ELibThree.mp3"

    mkdir -p "$LIB_WORK"
    if ! ensure_root ||
        ! make_library_track "$LIB_WORK/one.mp3" "E2E Lib One" 40 440 ||
        ! make_library_track "$LIB_WORK/two.mp3" "E2E Lib Two" 44 554 ||
        ! make_library_track "$LIB_WORK/three.mp3" "E2E Lib Three" 48 659; then
        for check in "${checks[@]}"; do
            fail "$check" "拿不到 adb root 或做不出测试音频，没有执行"
        done
        return 1
    fi

    # 清掉上次留下的，放进 One、Two
    for dir in "${LIB_DIRS[@]}"; do
        adb shell "rm -rf '$LIB_SD/$dir'"
    done
    if ! lib_push "$LIB_WORK/one.mp3" "${ONE/$LIB_ST/$LIB_SD}" || ! lib_push "$LIB_WORK/two.mp3" "${TWO/$LIB_ST/$LIB_SD}" ||
        ! lib_wait_media ready "$ONE" "$TWO"; then
        for check in "${checks[@]}"; do
            fail "$check" "MediaStore 里等不到测试音频，没有执行"
        done
        return 1
    fi

    # 22a. 首次扫描
    if ! lib_scan "扫描系统音乐库（首次）" || ! lib_read first; then
        for check in "${checks[@]}"; do
            fail "$check" "首次扫描没完成，没有执行"
        done
        return 1
    fi
    if detail=$(lib_verify first "E2E Lib One" file="$ONE") && detail="One：$detail；Two：$(lib_verify first "E2E Lib Two" file="$TWO")"; then
        pass "$LIB_FIRST" "$detail"
    else
        fail "$LIB_FIRST" "$detail"
    fi
    one_key=$(lib_key first "E2E Lib One") || one_key=""
    two_key=$(lib_key first "E2E Lib Two") || two_key=""
    if [ -z "$one_key" ] || [ -z "$two_key" ]; then
        for check in "${checks[@]:1}"; do
            fail "$check" "首次扫描后 One、Two 不是各一条，没有执行"
        done
        return 1
    fi
    one_path=$(lib_path first "E2E Lib One")

    # 22b. 加入我喜欢，原样重扫
    restart_app
    if flow "本地音乐里把 One 加入我喜欢" local-music-favorite.yaml -e TITLE="E2E Lib One" &&
        wait_until 10 lib_favorite_is "$one_key" "$one_path"; then
        pass "$LIB_FAVORITE" "$one_key → $one_path"
    else
        fail "$LIB_FAVORITE" "我喜欢里 $one_key 记的是「$(lib_favorite_path "$one_key")」，应当是 $one_path"
    fi
    if lib_scan "扫描系统音乐库（原样重扫）" && lib_read rescan; then
        if detail=$(lib_same first rescan) && lib_favorite_is "$one_key" "$one_path"; then
            pass "$LIB_RESCAN" "$detail"
        else
            fail "$LIB_RESCAN" "${detail}；我喜欢里的 One：「$(lib_favorite_path "$one_key")」"
        fi
    else
        fail "$LIB_RESCAN" "重扫没完成"
    fi

    # 22c. Two 改名移到别的文件夹（走 FUSE 改名，MediaStore 一般保留这一行，只改路径）
    two_old_id=$(lib_uri first "$TWO")
    adb shell "mkdir -p '$LIB_SD/E2E-Moved' && mv '${TWO/$LIB_ST/$LIB_SD}' '${TWO_MOVED/$LIB_ST/$LIB_SD}'"
    if lib_wait_media ready "$TWO_MOVED" && lib_wait_media gone "$TWO" &&
        lib_scan "扫描系统音乐库（Two 改名移动后）" && lib_read renamed; then
        two_new_id=$(lib_uri renamed "$TWO_MOVED")
        log "Two 改名移动前后的 MediaStore 行：$two_old_id → $two_new_id"
        lib_check "$LIB_RENAME" renamed "E2E Lib Two" key="$two_key" file="$TWO_MOVED"
    else
        fail "$LIB_RENAME" "改名移动或重扫没完成"
    fi

    # 22d. One 复制到别处、删掉原文件（MediaStore 里是新的一行，原来那一行没了）
    adb shell "mkdir -p '$LIB_SD/E2E-Moved' && cp '${ONE/$LIB_ST/$LIB_SD}' '${ONE_MOVED/$LIB_ST/$LIB_SD}'"
    if lib_wait_media ready "$ONE_MOVED" && adb shell "rm '${ONE/$LIB_ST/$LIB_SD}'" && lib_wait_media gone "$ONE"; then
        if lib_row "重扫前打开本地音乐看 One" "E2E Lib One" && [ "$LIB_ROW" = missing ]; then
            pass "$LIB_MISSING" "原文件已删，这一行带「文件不存在」"
        else
            fail "$LIB_MISSING" "这一行是 $LIB_ROW"
        fi
        if lib_scan "扫描系统音乐库（One 移动后）" && lib_read moved; then
            lib_check "$LIB_MOVED" moved "E2E Lib One" key="$one_key" file="$ONE_MOVED"
            one_path=$(lib_uri moved "$ONE_MOVED")
            if wait_until 10 lib_favorite_is "$one_key" "$one_path"; then
                pass "$LIB_MOVED_FAVORITE" "$one_key → $one_path"
            else
                fail "$LIB_MOVED_FAVORITE" "我喜欢里的 One 记的是「$(lib_favorite_path "$one_key")」，应当是 $one_path"
            fi
            if lib_row "重扫后打开本地音乐看 One" "E2E Lib One" && [ "$LIB_ROW" = ok ] &&
                flow "点移动后的 One" local-music-tap.yaml -e TITLE="E2E Lib One"; then
                expect_playing "$LIB_MOVED_PLAY" "E2E Lib One"
            else
                fail "$LIB_MOVED_PLAY" "One 这一行是 $LIB_ROW，或者没点到"
            fi
        else
            for check in "$LIB_MOVED" "$LIB_MOVED_FAVORITE" "$LIB_MOVED_PLAY"; do
                fail "$check" "重扫没完成"
            done
        fi
    else
        for check in "$LIB_MISSING" "$LIB_MOVED" "$LIB_MOVED_FAVORITE" "$LIB_MOVED_PLAY"; do
            fail "$check" "复制、删除后 MediaStore 没跟上，没有执行"
        done
    fi

    # 22e. 相同的文件：One 已在库里，后来又多出两份；Three 的两份同一次扫进来
    adb shell "mkdir -p '$LIB_SD/E2E-Copies' '$LIB_SD/E2E-Extra' &&
        cp '${ONE_MOVED/$LIB_ST/$LIB_SD}' '${ONE_COPY/$LIB_ST/$LIB_SD}' &&
        cp '${ONE_MOVED/$LIB_ST/$LIB_SD}' '${ONE_EXTRA/$LIB_ST/$LIB_SD}'"
    if lib_push "$LIB_WORK/three.mp3" "${THREE/$LIB_ST/$LIB_SD}" && lib_push "$LIB_WORK/three.mp3" "${THREE_COPY/$LIB_ST/$LIB_SD}" &&
        lib_wait_media ready "$ONE_COPY" "$ONE_EXTRA" "$THREE" "$THREE_COPY" &&
        lib_scan "扫描系统音乐库（多出相同的文件后）" && lib_read copies; then
        lib_check "$LIB_LATER_COPIES" copies "E2E Lib One" key="$one_key"
        lib_check "$LIB_SAME_SCAN" copies "E2E Lib Three"
    else
        fail "$LIB_LATER_COPIES" "放副本或重扫没完成"
        fail "$LIB_SAME_SCAN" "放副本或重扫没完成"
    fi

    # 22f. 另一条途径：选择文件夹扫描 E2E-Moved（里面的 One、Two 都已经从系统音乐库导入过）
    lib_read before-folder
    restart_app
    if flow "选择文件夹扫描 E2E-Moved" local-music-folder.yaml -e FOLDER="E2E-Moved" && lib_read folder; then
        if detail=$(lib_same before-folder folder); then
            pass "$LIB_FOLDER" "$detail"
        else
            fail "$LIB_FOLDER" "$detail"
        fi
    else
        fail "$LIB_FOLDER" "选择文件夹扫描没完成"
    fi

    # 22g. 撤销音频读取权限（系统会结束应用进程），再恢复
    lib_read before-revoke
    adb shell pm revoke "$PKG" "$AUDIO_PERMISSION"
    if audio_permission_granted; then
        for check in "$LIB_REVOKED_KEEP" "$LIB_REVOKED_ROW" "$LIB_REVOKED_TAP"; do
            fail "$check" "pm revoke 后权限还在，没有执行"
        done
    else
        lib_row "撤销权限后打开本地音乐" "E2E Lib Two"
        if [ "$LIB_ROW" = absent ]; then
            fail "$LIB_REVOKED_ROW" "列表里找不到 Two"
        elif [ "$LIB_ROW" = missing ]; then
            fail "$LIB_REVOKED_ROW" "文件还在，只是没有权限，这一行却带「文件不存在」"
        else
            pass "$LIB_REVOKED_ROW" "这一行不带「文件不存在」"
        fi
        if [ "$LIB_ROW" = absent ] || ! flow "撤销权限后点 Two" local-music-tap.yaml -e TITLE="E2E Lib Two"; then
            fail "$LIB_REVOKED_TAP" "没打开本地音乐或没点到 Two"
        elif wait_until 8 permission_dialog_shown; then
            pass "$LIB_REVOKED_TAP" "弹出了系统授权框"
            shot library-permission-dialog
            # 不在框里选，按返回关掉（等于这次不给）
            adb shell input keyevent KEYCODE_BACK
            sleep 2
        else
            fail "$LIB_REVOKED_TAP" "8 秒内没有系统授权框；界面上：$(maestro hierarchy --compact --no-reinstall-driver 2>/dev/null | grep -oE 'text=[^;"]*(文件|权限)[^;"]*' | head -n 3 | tr '\n' ' ')"
            shot failed-library-revoked-tap
        fi
        if lib_read revoked && detail=$(lib_same before-revoke revoked); then
            pass "$LIB_REVOKED_KEEP" "$detail"
        else
            fail "$LIB_REVOKED_KEEP" "${detail:-读不出本地音乐}"
        fi
    fi

    adb shell pm grant "$PKG" "$AUDIO_PERMISSION"
    if ! audio_permission_granted; then
        fail "$LIB_GRANTED" "pm grant 后还是没有权限"
        fail "$LIB_GRANTED_PLAY" "pm grant 后还是没有权限"
        return 1
    fi
    lib_row "恢复权限后打开本地音乐" "E2E Lib Two"
    if [ "$LIB_ROW" = ok ] && lib_read granted && detail=$(lib_same before-revoke granted); then
        pass "$LIB_GRANTED" "$detail"
    else
        fail "$LIB_GRANTED" "Two 这一行是 $LIB_ROW；${detail:-}"
    fi
    # lib_row 停在本地音乐列表上
    if [ "$LIB_ROW" != absent ] && flow "恢复权限后点 Two" local-music-tap.yaml -e TITLE="E2E Lib Two"; then
        expect_playing "$LIB_GRANTED_PLAY" "E2E Lib Two"
    else
        fail "$LIB_GRANTED_PLAY" "没打开本地音乐或没点到 Two"
    fi
}
