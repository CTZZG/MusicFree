# 播放会话、暂停和“视频”打断的判断，run.sh 和 pause_checks_test.sh 都 source 这个文件。
#
# 用到的变量：SESSION（media_session.py）、FOCUS（audio_focus.py）、PKG（应用包名）、
# FOCUS_PKG（“视频”替身的包名）。返回结果的函数只输出说明、用返回值表示通过与否，
# 记 PASS/FAIL 由调用方决定。
#
# “一直停着”是每秒左右采样一次媒体会话：持续的误播（放了一秒以上，或者进度往前走了）
# 抓得住，不到一次采样间隔的短暂出声抓不住。

# 时钟（秒）。自检里换成假的
clock() { date +%s; }

session() {
    adb shell dumpsys media_session | python3 -I "$SESSION" parse "$PKG"
}

# position_text <JSON>：采样里的进度，例如 8.6s
position_text() {
    python3 -I -c 'import json,sys; p = json.loads(sys.argv[1])["position"]; print(f"{p / 1000:.1f}s")' "$1"
}

# sample_text <JSON>：一次采样写成一行，例如 "PLAYING E2E Tone B 12.3s"
sample_text() {
    python3 -I "$SESSION" brief-sample "$1"
}

# progress_text <第一次的 JSON> <第二次的 JSON>：例如“进度 9.1s → 13.2s”
progress_text() {
    python3 -I -c 'import json,sys; a,b=(json.loads(x)["position"] for x in sys.argv[1:]); print(f"进度 {a/1000:.1f}s → {b/1000:.1f}s")' "$1" "$2"
}

# stays_paused <标题> <秒>：这段时间里每秒看一次，一直是暂停的这首；最后进度和开始时比没往前走
#   （见 media_session.py still-paused）。没问题时输出停在哪里、返回 0；中途被放出来过，输出原因、返回 1
stays_paused() {
    local title=$1 seconds=$2 start now problem deadline samples=0
    start=$(session)
    if ! problem=$(python3 -I "$SESSION" still-paused "$title" "$start" "$start"); then
        echo "开始时就不对：$problem"
        return 1
    fi
    now=$start
    deadline=$(( $(clock) + seconds ))
    while [ "$(clock)" -lt "$deadline" ]; do
        sleep 1
        now=$(session)
        samples=$((samples + 1))
        if ! python3 -I "$SESSION" is-state PAUSED "$title" "$now"; then
            echo "第 $samples 次采样不是暂停的「$title」：$(python3 -I "$SESSION" still-paused "$title" "$start" "$now")"
            return 1
        fi
    done
    if ! problem=$(python3 -I "$SESSION" still-paused "$title" "$start" "$now"); then
        echo "$problem"
        return 1
    fi
    echo "$seconds 秒里采样 $samples 次，一直停在 $(position_text "$start")"
}

# focus_owner：现在拿着音频焦点的应用（焦点栈最上面）
focus_owner() {
    adb shell dumpsys audio | tr -d '\r' | python3 -I "$FOCUS" top
}

# watch_video <transient|full> <秒> <标记>：打开“视频”替身，占用音频焦点这么多秒后放下、自己关掉。
#   标记用来在日志里认出这一段视频（见 video_released）
watch_video() {
    adb shell am start -n "$FOCUS_PKG/.HoldFocusActivity" \
        --es mode "$1" --ei seconds "$2" --es tag "$3" > /dev/null
}

# video_released <标记>：这一段视频已经开始放下焦点。替身在放下焦点之前先打这行日志，所以看到它时，
#   音乐只可能是在这之后才接着放的
video_released() {
    adb logcat -d -s E2EFocus | tr -d '\r' | grep -q "releasing focus tag=$1\$"
}

# held_until_video_ends <标题> <视频标记> <最多等几秒>：视频放下焦点之前，每秒看一次：音乐一直是暂停的
#   这首、焦点一直在视频那边。视频放下焦点后返回 0；之前音乐放了、焦点被拿走、进度往前走了，或者等这么
#   久视频还没放下焦点，返回 1
held_until_video_ends() {
    local title=$1 tag=$2 max=$3 start last sample owner problem deadline samples=0
    start=$(session)
    if ! problem=$(python3 -I "$SESSION" still-paused "$title" "$start" "$start"); then
        echo "视频开始时音乐没停：$problem"
        return 1
    fi
    last=$start
    deadline=$(( $(clock) + max ))
    while [ "$(clock)" -lt "$deadline" ]; do
        # 先采样、再看视频有没有放下焦点：放下之后音乐接着放是对的，这次采样不算
        sample=$(session)
        owner=$(focus_owner)
        if video_released "$tag"; then
            if ! problem=$(python3 -I "$SESSION" still-paused "$title" "$start" "$last"); then
                echo "视频期间$problem"
                return 1
            fi
            echo "视频放下焦点前采样 $samples 次，音乐一直停在 $(position_text "$start")，焦点一直在视频那边"
            return 0
        fi
        samples=$((samples + 1))
        if ! python3 -I "$SESSION" is-state PAUSED "$title" "$sample"; then
            echo "视频还没放下焦点（第 $samples 次采样），音乐却是 $(sample_text "$sample")"
            return 1
        fi
        if [ "$owner" != "$FOCUS_PKG" ]; then
            echo "视频还没放下焦点（第 $samples 次采样），焦点却在 $owner"
            return 1
        fi
        last=$sample
        sleep 1
    done
    echo "等了 $max 秒视频还没放下焦点"
    return 1
}

# resumes_after_video <标题> <最多等几秒>：视频放下焦点后，这么多秒内接着放这首，而且 4 秒里进度往前走了
resumes_after_video() {
    local title=$1 max=$2 started now="" second problem deadline
    started=$(clock)
    deadline=$((started + max))
    while [ "$(clock)" -lt "$deadline" ]; do
        now=$(session)
        if python3 -I "$SESSION" is-playing "$title" "$now"; then
            local waited=$(( $(clock) - started ))
            sleep 4
            second=$(session)
            if problem=$(python3 -I "$SESSION" playing "$title" "$now" "$second"); then
                echo "视频放下焦点后 $waited 秒内接着放，$(progress_text "$now" "$second")"
                return 0
            fi
            echo "接着放了但进度没走：$problem"
            return 1
        fi
        sleep 1
    done
    echo "视频放下焦点后 $max 秒还没接着放：$(sample_text "${now:-$(session)}")，焦点在 $(focus_owner)"
    return 1
}
