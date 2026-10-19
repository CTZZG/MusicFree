# shellcheck shell=bash
# Real Release download/tagging path; no test API in the product. The WMA fixture
# starts with "Before Title", so completing a download without writing tags fails.
run_wma_tagging_checks() {
    local DOWNLOAD="WMA：原始标签文件下载完成"
    local AUDIO="WMA：下载后完整音频与夹具一致"
    local TAGS="WMA：实际写入原歌曲标签"
    local check detail path reference_hash download_hash
    local downloaded="$OUT/tagged-download.wma"
    if ! ensure_root || ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
        for check in "$DOWNLOAD" "$AUDIO" "$TAGS"; do fail "$check" "缺少前提，未执行"; done
        return 1
    fi
    open_link "musicfree://search?keyword=e2e%20wma%20$REF"
    if ! flow "下载带原始标签的 WMA" download-song.yaml -e TITLE="E2E Tagged WMA" ||
        ! wait_until 90 download_settled "E2E Tagged WMA"; then
        for check in "$DOWNLOAD" "$AUDIO" "$TAGS"; do fail "$check" "WMA 下载未完成，未执行"; done
        return 1
    fi
    path=$(downloaded_path "E2E Tagged WMA")
    pass "$DOWNLOAD" "$path"
    if ! adb pull "$path" "$downloaded" > "$OUT/tagged-wma-pull.log" 2>&1; then
        fail "$AUDIO" "无法取回下载文件"
        fail "$TAGS" "无法取回下载文件"
        return 1
    fi
    if reference_hash=$(ffmpeg -v error -xerror -i "$HERE/fixtures/tagged.wma" -map 0:a:0 -f hash -hash sha256 -) &&
        download_hash=$(ffmpeg -v error -xerror -i "$downloaded" -map 0:a:0 -f hash -hash sha256 -) &&
        [ -n "$download_hash" ] && [ "$reference_hash" = "$download_hash" ]; then
        pass "$AUDIO" "$download_hash"
    else
        fail "$AUDIO" "WMA 解码失败或 PCM 不同"
    fi
    if ffprobe -v error -show_entries format_tags=title,artist,album -of json "$downloaded" > "$OUT/tagged-wma-tags.json" &&
        detail=$(python3 -I - "$OUT/tagged-wma-tags.json" <<'PY'
import json,sys
tags=json.load(open(sys.argv[1])).get("format",{}).get("tags",{})
tags={key.lower():value for key,value in tags.items()}
expected={"title":"E2E Tagged WMA","artist":"E2E Artist","album":"E2E Album"}
print(json.dumps(tags,ensure_ascii=False))
sys.exit(0 if all(tags.get(key)==value for key,value in expected.items()) else 1)
PY
        ); then
        pass "$TAGS" "$detail"
    else
        fail "$TAGS" "标签仍旧或不完整：${detail:-ffprobe 失败}"
    fi
}
