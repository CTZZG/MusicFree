# shellcheck shell=bash
# Uses run.sh/storage.sh helpers. Runs before the legacy-upgrade step clears app data.
run_download_source_checks() {
    local PLAY="只有备用来源能播的歌：播放并记住来源 B"
    local DOWNLOAD="原来源无地址：通过已记住的来源下载文件"
    local IDENTITY="下载记录保留原歌曲身份和实际来源音质"
    local AUDIO="备用来源下载文件能解码，音频与来源 B 的夹具一致"
    local TAGS="备用来源下载文件的歌曲标签正确"
    local checks=("$PLAY" "$DOWNLOAD" "$IDENTITY" "$AUDIO" "$TAGS")
    local check path detail downloaded="$OUT/fallback-download.mp3" reference_hash download_hash
    if ! ensure_root || ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
        for check in "${checks[@]}"; do fail "$check" "缺少 adb root/ffmpeg/ffprobe，没有执行"; done
        return 1
    fi
    open_link "musicfree://search?keyword=e2e%20$REF"
    if ! flow "下载换源前打开搜索结果" search-results.yaml ||
        ! flow "下载换源前点播 Fallback" fallback-song.yaml; then
        for check in "${checks[@]}"; do fail "$check" "点播准备失败，没有执行"; done
        return 1
    fi
    if ! expect_playing "$PLAY" "E2E Fallback"; then
        for check in "${checks[@]:1}"; do fail "$check" "备用来源播放失败，没有执行"; done
        return 1
    fi
    # Always inspect the actual remembered entry, not just a PLAYING notification.
    if ! kv App.PersistStatus remembered-source "E2E Fallback" > "$OUT/fallback-remembered.txt"; then
        fail "$IDENTITY" "没有有效的来源 B 记录，前提不成立"
        for check in "$DOWNLOAD" "$AUDIO" "$TAGS"; do fail "$check" "没有备用来源记录，没有执行"; done
        return 1
    fi
    # Return from a potentially auto-opened player page through the real search link.
    open_link "musicfree://search?keyword=e2e%20$REF"
    if ! flow "下载换源前重新打开搜索" search-results.yaml ||
        ! flow "下载原来源的 Fallback" download-song.yaml -e TITLE="E2E Fallback" ||
        ! wait_until 90 download_settled "E2E Fallback"; then
        fail "$DOWNLOAD" "90 秒内未完成下载"
        for check in "$IDENTITY" "$AUDIO" "$TAGS"; do fail "$check" "下载失败，没有执行"; done
        return 1
    fi
    path=$(downloaded_path "E2E Fallback")
    pass "$DOWNLOAD" "$path"
    if detail=$(kv music.DownloadTasks download-source "E2E Fallback"); then
        pass "$IDENTITY" "$detail"
    else
        fail "$IDENTITY" "$detail"
    fi
    if ! adb pull "$path" "$downloaded" > "$OUT/fallback-pull.log" 2>&1; then
        fail "$AUDIO" "无法复制下载文件"
        fail "$TAGS" "无法复制下载文件"
        return 1
    fi
    if reference_hash=$(ffmpeg -v error -i "$HERE/fixtures/tone-b.mp3" -map 0:a:0 -f hash -hash sha256 -) &&
        download_hash=$(ffmpeg -v error -i "$downloaded" -map 0:a:0 -f hash -hash sha256 -) &&
        [ -n "$download_hash" ] && [ "$download_hash" = "$reference_hash" ]; then
        pass "$AUDIO" "$download_hash"
    else
        fail "$AUDIO" "解码失败或 PCM 哈希不同：${download_hash:-缺失} / ${reference_hash:-缺失}"
    fi
    if ffprobe -v error -show_entries format_tags=title,artist,album -of json "$downloaded" > "$OUT/fallback-tags.json" &&
        detail=$(python3 -I -c '
import json,sys
try:
    with open(sys.argv[1]) as handle:
        tags=json.load(handle).get("format",{}).get("tags",{})
    tags={key.lower():value for key,value in tags.items()}
    expected={"title":"E2E Fallback","artist":"E2E Artist","album":"E2E Album"}
    print(json.dumps(tags,ensure_ascii=False))
    sys.exit(0 if all(tags.get(key)==value for key,value in expected.items()) else 1)
except (ValueError,TypeError,AttributeError,OSError) as error:
    print(str(error).replace("\n"," "))
    sys.exit(1)' "$OUT/fallback-tags.json" 2>&1); then
        pass "$TAGS" "$detail"
    else
        fail "$TAGS" "元数据不符合原歌曲：${detail:-ffprobe 失败}"
    fi
}
