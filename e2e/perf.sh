# shellcheck shell=bash
# 性能基线（run.sh 的第 23 步，E2E_SUITE=perf）：冷启动、搜索、在线点歌、本地点歌，各跑 1 次预热 +
# PERF_RUNS 次，记中位数和 P95。只记录，不设门限：项目“失败”只表示没测出来（缺时间点），不表示慢。
# run.sh source 这个文件，用它的 pass、fail、flow、log、open_link 等函数，storage.sh 的 wait_until、
# restart_app，library.sh 的 make_library_track、lib_push、lib_wait_media、lib_scan、lib_row。
#
# 时间点由应用写到 logcat（标签 MusicFreePerf，见 lib/perf_stats.py），都是设备上的墙钟毫秒；
# 冷启动的起点是系统 ActivityTaskManager 记下的启动请求。点歌的终点是引擎 time-pos 第一次往前走，
# 不等于扬声器出声。测试源的搜索是本地数据，不走网络；在线点歌要从 raw.githubusercontent.com 下载音频。
# 模拟器（固定配置，见 build-beta.yml）上的数字只能和同一配置的数字比，不能当真机耗时。

PERF_STATS="$HERE/lib/perf_stats.py"
PERF_RUNS=${E2E_PERF_RUNS:-10}
PERF_JSONL="$OUT/perf.jsonl"

perf_logcat() {
    adb logcat -d -v epoch -s ActivityTaskManager:I MusicFreePerf:I 2>/dev/null
}

# perf_has <时间点>：logcat 里有这个时间点
perf_has() {
    perf_logcat | grep -q "MusicFreePerf.*: $1 at="
}

# perf_record <阶段> <第几次> <JSON>：记一行结果；第 0 次是预热，不进统计
perf_record() {
    python3 -I -c 'import json,sys; row=json.loads(sys.argv[3]); row.update(phase=sys.argv[1], run=int(sys.argv[2]), warmup=sys.argv[2]=="0"); print(json.dumps(row, ensure_ascii=False))' \
        "$1" "$2" "$3" >> "$PERF_JSONL"
    log "性能 $1 #$2：$3"
}

# perf_plugin_state <时刻>：记下插件文件、插件缓存和元数据的键、错误日志的最后几行（查搜索测不出的原因）
perf_plugin_state() {
    log "插件状态（$1）：插件文件 $(adb shell "ls -1 '$EXT_FILES/plugins' 2>/dev/null" | tr -d '\r' | tr '\n' ' ')"
    log "插件状态（$1）：plugin.cache 的键 $(kv plugin.cache keys 2>&1 | tr '\n' ' ')"
    log "插件状态（$1）：plugin-meta 的键 $(kv plugin-meta keys 2>&1 | tr '\n' ' ')"
    log "插件状态（$1）：错误日志最后几行："
    adb shell "cat '$EXT_FILES'/log/error-log-*.log 2>/dev/null" | tr -d '\r' | tail -n 15
}

perf_cold_start() {
    local i output frame result
    for i in $(seq 0 "$PERF_RUNS"); do
        adb shell am force-stop "$PKG"
        sleep 3
        adb logcat -c
        output=$(adb shell am start -W -n "$ACTIVITY" | tr -d '\r')
        frame=$(printf '%s\n' "$output" | sed -n 's/^TotalTime: *//p')
        if ! wait_until 60 perf_has first-screen || ! wait_until 60 perf_has splash-hidden; then
            log "冷启动 #$i：60 秒内没有 first-screen 或 splash-hidden"
            continue
        fi
        # 界面第一次画出来（first-draw）在开屏页收起之后；旧版 APK 没有这个时间点
        wait_until 10 perf_has first-draw || log "冷启动 #$i：没有 first-draw（旧版 APK？），主页可见按 JS 时间点算"
        if result=$(perf_logcat | python3 -I "$PERF_STATS" cold "$PKG"); then
            if [ -n "$frame" ]; then
                result=$(python3 -I -c 'import json,sys; r=json.loads(sys.argv[1]); r["cold_first_frame_ms"]=int(sys.argv[2]); print(json.dumps(r))' "$result" "$frame")
            fi
            perf_record cold "$i" "$result"
        else
            log "冷启动 #$i：$result"
        fi
    done
}

# perf_cold_trace：冷启动统计之后再冷启动一次（不进统计），启动过程中连续截屏，记下每张截屏的时刻和
# 窗口管理的日志，看主页实际什么时候出现在屏幕上。Beta #143 里应用界面第一次画出来（first-draw）到系统
# 报告启动完成（TotalTime）每次都稳定差约 1 秒，原因未明。结果写到 perf-cold-trace.txt 和 screens/cold-trace-*.png
perf_cold_trace() {
    local device_dir=/data/local/tmp/perf-shots raw_dir loop
    raw_dir=$(mktemp -d)
    adb shell am force-stop "$PKG"
    adb shell "rm -rf $device_dir; mkdir -p $device_dir"
    sleep 3
    adb logcat -b main -b system -b events -c
    # 原始格式截屏（不压 PNG：快，也少抢启动时的 CPU），每张前后各写一行日志记时刻；最多 5 秒、24 张
    adb shell "i=0; end=\$((\$(date +%s) + 5)); while [ \$i -lt 24 ] && [ \$(date +%s) -lt \$end ]; do i=\$((i + 1)); log -t MusicFreeShot b\$i; screencap $device_dir/\$i.raw; log -t MusicFreeShot e\$i; done" &
    loop=$!
    adb shell am start -W -n "$ACTIVITY" | tr -d '\r' | sed -n 's/^TotalTime: */冷启动追踪：TotalTime /p'
    wait "$loop"
    # 本地目录已存在，adb pull 把设备目录整个放进去：$raw_dir/perf-shots
    adb pull "$device_dir" "$raw_dir" > /dev/null
    adb shell "rm -rf $device_dir"
    log "冷启动追踪：取回 $(find "$raw_dir" -name '*.raw' | wc -l) 张截屏"
    if adb logcat -d -v epoch -b main -b system -b events |
        python3 -I "$PERF_STATS" trace "$PKG" "$raw_dir/perf-shots" "$OUT/screens" > "$OUT/perf-cold-trace.txt"; then
        cat "$OUT/perf-cold-trace.txt"
    else
        log "冷启动追踪：$(cat "$OUT/perf-cold-trace.txt")"
    fi
    rm -rf "$raw_dir"
}

perf_search() {
    local i result
    restart_app
    flow "性能：搜索前等首页" home.yaml || return 1
    for i in $(seq 0 "$PERF_RUNS"); do
        adb logcat -c
        # 每次换一个关键字，保证是新的一次搜索（测试源 A 只看提交号）
        open_link "musicfree://search?keyword=e2e%20$REF%20p$i"
        if ! wait_until 30 perf_has search-done; then
            log "搜索 #$i：30 秒内没有 search-done"
            [ "$i" -eq 0 ] && print_screen_text
            continue
        fi
        if result=$(perf_logcat | python3 -I "$PERF_STATS" search); then
            perf_record search "$i" "$result"
        else
            log "搜索 #$i：$result"
        fi
        sleep 1
    done
}

# perf_tap <文字或读屏标签>：点一下（不记成检查项，失败时日志在 maestro/perf-tap.log）
perf_tap() {
    maestro test --no-reinstall-driver -e TITLE="$1" "$HERE/flows/perf-tap.yaml" > "$OUT/maestro/perf-tap.log" 2>&1
}

# perf_play <online|local> <要点的1> <要点的2>：在已经打开的列表里轮流点两首（点正在放的那首不会重新装载）
perf_play() {
    local kind=$1 i title result
    shift
    for i in $(seq 0 "$PERF_RUNS"); do
        title=$1
        [ $((i % 2)) -eq 1 ] && title=$2
        adb logcat -c
        if ! perf_tap "$title"; then
            log "$kind 点歌 #$i：没点到「$title」"
            tail -n 5 "$OUT/maestro/perf-tap.log"
            continue
        fi
        if ! wait_until 40 perf_has engine-progress; then
            log "$kind 点歌 #$i：40 秒内引擎没有开始推进"
            continue
        fi
        if result=$(perf_logcat | python3 -I "$PERF_STATS" play "$kind"); then
            perf_record "$kind-play" "$i" "$result"
        else
            log "$kind 点歌 #$i：$result"
        fi
    done
}

perf_online_play() {
    # 最后一次搜索的结果页还开着
    flow "性能：在线点歌前等搜索结果" search-results.yaml || return 1
    perf_play online "E2E Tone A" "E2E Tone B"
}

perf_local_play() {
    local ONE=$LIB_ST/E2E-Perf/E2ELibOne.mp3 TWO=$LIB_ST/E2E-Perf/E2ELibTwo.mp3
    mkdir -p "$LIB_WORK"
    adb shell "rm -rf '$LIB_SD/E2E-Perf'"
    if ! make_library_track "$LIB_WORK/one.mp3" "E2E Lib One" 40 440 ||
        ! make_library_track "$LIB_WORK/two.mp3" "E2E Lib Two" 44 554 ||
        ! lib_push "$LIB_WORK/one.mp3" "${ONE/$LIB_ST/$LIB_SD}" ||
        ! lib_push "$LIB_WORK/two.mp3" "${TWO/$LIB_ST/$LIB_SD}" ||
        ! lib_wait_media ready "$ONE" "$TWO" ||
        ! lib_scan "性能：本地点歌前扫描系统音乐库" ||
        ! lib_row "性能：本地点歌前打开本地音乐" "E2E Lib One"; then
        log "本地点歌：准备不好，没有执行"
        return 1
    fi
    # 本地音乐的行读屏标签是“歌名, 歌手”（行尾的“歌名 更多操作”不能点）
    perf_play local "E2E Lib One, .*" "E2E Lib Two, .*"
}

# 23. 性能基线
run_perf_checks() {
    local summary label key count wanted=$((PERF_RUNS - 2))
    : > "$PERF_JSONL"
    log "性能基线：每项 1 次预热 + $PERF_RUNS 次；设备 $(adb shell getprop ro.product.model | tr -d '\r')，Android $(adb shell getprop ro.build.version.release | tr -d '\r')，CPU $(adb shell nproc | tr -d '\r') 核，$(adb shell "sed -n 's/^MemTotal: *//p' /proc/meminfo" | tr -d '\r')"
    ensure_root || log "拿不到 adb root，插件状态记不下来"
    perf_plugin_state "装好插件后"
    perf_cold_start
    perf_cold_trace
    perf_plugin_state "冷启动测完后"
    perf_search
    perf_online_play
    perf_local_play

    summary=$(python3 -I "$PERF_STATS" summary "$PERF_JSONL" 2> "$OUT/perf-summary.json")
    {
        echo "## 性能基线（只记录，不设门限）"
        echo
        echo "每项 1 次预热（不计）+ $PERF_RUNS 次，P95 用最近秩。原始数据在 perf.jsonl。"
        echo
        printf '%s\n' "$summary"
        if [ -s "$OUT/perf-cold-trace.txt" ]; then
            echo
            echo "### 冷启动追踪（诊断，不进统计）"
            echo
            echo "相对启动请求的毫秒数；截屏在 screens/cold-trace-*.png（文件名是截屏的起止时刻）。"
            echo
            echo '```'
            cat "$OUT/perf-cold-trace.txt"
            echo '```'
        fi
    } > "$OUT/perf.md"
    cat "$OUT/perf.md"

    # 每个指标一行检查：测出来了就记下数字；样本太少说明测量本身坏了
    while IFS=$'\t' read -r key label; do
        count=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], {}).get("n", 0))' "$OUT/perf-summary.json" "$key" 2>/dev/null || echo 0)
        if [ "$count" -ge "$wanted" ]; then
            pass "基线：$label" "$(python3 -I "$PERF_STATS" describe "$OUT/perf-summary.json" "$key")"
        else
            fail "基线：$label" "只测出 $count 次（要至少 $wanted 次），见日志里的原因"
        fi
    done < <(python3 -I -c 'import sys; sys.path.insert(0, sys.argv[1]); import perf_stats; [print(f"{k}\t{v}") for k, v in perf_stats.METRICS]' "$HERE/lib")
}
