#!/usr/bin/env python3
"""性能基线（e2e/perf.sh）用的解析和统计。只记录，不设门限。

应用把时间点写到 logcat（标签 MusicFreePerf），每行 “名字 at=<墙钟毫秒> 键=值 …”：
  process-start       应用进程起来（原生 Application.onCreate 的开头）
  first-screen        冷启动后主页标签栏第一次排好版（JS；这时开屏页可能还盖着）
  splash-hidden       启动初始化做完、JS 叫开屏页收起（JS）
  first-draw          应用界面第一次真正画出来（原生；开屏页撑着时不画，所以这是用户看到主页的时刻）
  play-request        TrackPlayer.play 被调用（JS，skip=true 是切歌流程自己发起的）
  track-load          取到地址、交给播放器装载（JS）
  engine-load         原生发出 loadfile（gen=装载代次）
  engine-file-loaded  mpv 报告文件装好（gen=）
  engine-progress     这次装载后 time-pos 第一次自然往前走（gen=）。不代表扬声器已经出声
  search-start / search-first-result / search-done   搜索开始、第一个有结果的来源返回、所有来源第一页都返回

  adb logcat -d -v epoch -s ActivityTaskManager:I MusicFreePerf:I | perf_stats.py cold <包名>
      冷启动：从系统收到启动请求（ActivityTaskManager 的 “START u0 … cmp=<包名>/…” 那一行的时间）
      到主页可见（first-screen 和 splash-hidden 中较晚的那个）、到 first-screen 的毫秒数，输出一行 JSON
  adb logcat -d -s MusicFreePerf:I | perf_stats.py play
      点歌：play-request 到各阶段的毫秒数，输出一行 JSON
  adb logcat -d -s MusicFreePerf:I | perf_stats.py search
      搜索：search-start 到第一个结果、到全部返回的毫秒数，输出一行 JSON
  perf_stats.py summary <jsonl 文件>
      每个指标的样本数、中位数、P95（最近秩）、最小、最大；warmup=true 的不算。输出 Markdown 表格，
      统计结果的 JSON 写到 stderr
  perf_stats.py describe <统计结果 JSON 文件> <指标>
      一行说明（“中位数 … ms，P95 … ms（n 次，最小 …，最大 …）”）；这个指标没有样本时什么也不输出
  perf_stats.py --self-test

解析不出（缺时间点、顺序不对）时输出原因、返回 1。
"""
import json
import math
import re
import sys

MARK = re.compile(r"MusicFreePerf\s*:\s*(\S+) at=(\d+)(.*)$")
# logcat -v epoch：行首是 “秒.毫秒”
EPOCH_LINE = re.compile(r"^\s*(\d+)\.(\d{3})\d*\s")

# 指标的中文名和顺序（summary 按这个顺序输出）
METRICS = [
    ("cold_home_visible_ms", "冷启动：到主页可见（界面第一次画出来，标签栏含“资料库”已排好版）"),
    ("cold_first_screen_ms", "冷启动：主页标签栏在开屏页下面排好版"),
    ("cold_splash_hidden_ms", "冷启动：JS 叫开屏页收起"),
    ("cold_first_frame_ms", "冷启动：系统报告的启动完成（am start -W TotalTime）"),
    ("cold_launch_to_process_ms", "冷启动：启动请求到应用进程起来"),
    ("cold_process_to_home_ms", "冷启动：应用进程起来到主页可见"),
    ("search_first_result_ms", "搜索：开始到第一个有结果的来源返回"),
    ("search_done_ms", "搜索：开始到所有来源第一页都返回"),
    ("online_engine_start_ms", "在线点歌：点歌到引擎开始推进（time-pos 前进）"),
    ("online_resolve_ms", "在线点歌：点歌到取到地址交给播放器"),
    ("online_load_to_file_loaded_ms", "在线点歌：loadfile 到文件装好（含下载）"),
    ("online_file_loaded_to_progress_ms", "在线点歌：文件装好到开始推进"),
    ("local_engine_start_ms", "本地点歌：点歌到引擎开始推进（time-pos 前进）"),
    ("local_resolve_ms", "本地点歌：点歌到交给播放器"),
    ("local_load_to_file_loaded_ms", "本地点歌：loadfile 到文件装好"),
    ("local_file_loaded_to_progress_ms", "本地点歌：文件装好到开始推进"),
]


def parse(text):
    events = []
    for line in text.splitlines():
        match = MARK.search(line.strip())
        if not match:
            continue
        detail = {}
        for part in match.group(3).split():
            key, sep, value = part.partition("=")
            if sep:
                detail[key] = value
        events.append({"name": match.group(1), "at": int(match.group(2)), "detail": detail})
    return events


def first(events, name, after=None, **detail):
    for event in events:
        if event["name"] != name:
            continue
        if after is not None and event["at"] < after:
            continue
        if any(event["detail"].get(key) != value for key, value in detail.items()):
            continue
        return event
    return None


def launch_start(text, package):
    """系统收到这个包的启动请求的时间（毫秒）；有多行时取最后一行"""
    start = None
    for line in text.splitlines():
        if "ActivityTaskManager" not in line or "START u0" not in line or f"cmp={package}/" not in line:
            continue
        match = EPOCH_LINE.match(line)
        if match:
            start = int(match.group(1)) * 1000 + int(match.group(2))
    if start is None:
        raise ValueError(f"logcat 里没有 {package} 的 START 行")
    return start


def cold(events, start_ms):
    result = {}
    marks = {}
    for name in ("first-screen", "splash-hidden"):
        event = first(events, name)
        if event is None:
            raise ValueError(f"没有 {name}")
        if event["at"] < start_ms:
            raise ValueError(f"{name}（{event['at']}）早于开始（{start_ms}）：读到了上一次启动的")
        marks[name] = event["at"]
    result["cold_first_screen_ms"] = marks["first-screen"] - start_ms
    result["cold_splash_hidden_ms"] = marks["splash-hidden"] - start_ms
    # 界面第一次真正画出来（新版 APK 才有）；没有时退回 JS 的两个时间点
    draw = first(events, "first-draw")
    if draw is not None and draw["at"] >= start_ms:
        marks["first-draw"] = draw["at"]
    result["cold_home_visible_ms"] = max(marks.values()) - start_ms
    # 进程起点用来核对起点：系统的启动请求和应用自己的时钟对不对得上
    process = first(events, "process-start")
    if process is not None and process["at"] >= start_ms:
        result["cold_launch_to_process_ms"] = process["at"] - start_ms
        result["cold_process_to_home_ms"] = max(marks.values()) - process["at"]
    return result


def play(events, prefix):
    request = first(events, "play-request", skip="false")
    if request is None:
        raise ValueError("没有用户点歌的 play-request")
    progress = first(events, "engine-progress", after=request["at"])
    if progress is None:
        raise ValueError("点歌后没有 engine-progress")
    generation = progress["detail"].get("gen")
    load = first(events, "engine-load", after=request["at"], gen=generation)
    loaded = first(events, "engine-file-loaded", after=request["at"], gen=generation)
    if load is None or loaded is None:
        raise ValueError(f"装载代次 {generation} 缺 engine-load 或 engine-file-loaded")
    tracks = [e for e in events if e["name"] == "track-load" and request["at"] <= e["at"] <= load["at"]]
    if not tracks:
        raise ValueError("点歌和 loadfile 之间没有 track-load")
    if not request["at"] <= load["at"] <= loaded["at"] <= progress["at"]:
        raise ValueError("时间点顺序不对")
    return {
        f"{prefix}_engine_start_ms": progress["at"] - request["at"],
        f"{prefix}_resolve_ms": tracks[-1]["at"] - request["at"],
        f"{prefix}_load_to_file_loaded_ms": loaded["at"] - load["at"],
        f"{prefix}_file_loaded_to_progress_ms": progress["at"] - loaded["at"],
    }


def search(events):
    start = None
    for event in events:
        if event["name"] == "search-start":
            start = event
    if start is None:
        raise ValueError("没有 search-start")
    session = start["detail"].get("session")
    done = first(events, "search-done", after=start["at"], session=session)
    if done is None:
        raise ValueError(f"搜索 {session} 没有 search-done")
    result = {"search_done_ms": done["at"] - start["at"]}
    found = first(events, "search-first-result", after=start["at"], session=session)
    if found is None:
        raise ValueError(f"搜索 {session} 没有任何结果")
    result["search_first_result_ms"] = found["at"] - start["at"]
    return result


def percentile(values, fraction):
    """最近秩：排序后第 ceil(fraction × n) 个"""
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[rank - 1]


def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def summarize(rows):
    samples = {}
    for row in rows:
        if row.get("warmup"):
            continue
        for key, value in row.items():
            if key.endswith("_ms") and isinstance(value, (int, float)):
                samples.setdefault(key, []).append(value)
    summary = {}
    for key, values in samples.items():
        summary[key] = {
            "n": len(values),
            "median": median(values),
            "p95": percentile(values, 0.95),
            "min": min(values),
            "max": max(values),
        }
    return summary


def markdown(summary):
    lines = ["| 指标 | 样本 | 中位数 ms | P95 ms | 最小 | 最大 |", "| --- | --- | --- | --- | --- | --- |"]
    for key, label in METRICS:
        if key in summary:
            s = summary[key]
            lines.append(f"| {label} | {s['n']} | {s['median']:.0f} | {s['p95']:.0f} | {s['min']:.0f} | {s['max']:.0f} |")
    return "\n".join(lines)


def describe(summary, key):
    stats = summary.get(key)
    if not stats:
        return ""
    return (
        f"中位数 {stats['median']:.0f} ms，P95 {stats['p95']:.0f} ms"
        f"（{stats['n']} 次，最小 {stats['min']:.0f}，最大 {stats['max']:.0f}）"
    )


def self_test():
    log = "\n".join([
        "1760000000.090  1  1 I MusicFreePerf: process-start at=1760000000300",
        "1760000000.100  1  1 I MusicFreePerf: first-screen at=1760000001900",
        "1760000000.150  1  1 I MusicFreePerf: splash-hidden at=1760000002300",
        "1760000000.160  1  1 I MusicFreePerf: first-draw at=1760000003300",
        "1760000002.000  1  1 I MusicFreePerf: play-request at=1760000002000 key=E2E_测试源_A@tone-a skip=false",
        "1760000002.010  1  1 I MusicFreePerf: play-request at=1760000002010 key=E2E_测试源_A@tone-a skip=true",
        "1760000002.040  1  1 I MusicFreePerf: track-load at=1760000002040 key=x autoPlay=true",
        "1760000002.050  1  1 I MusicFreePerf: engine-load at=1760000002050 gen=7 source=https",
        "1760000002.400  1  1 I MusicFreePerf: engine-file-loaded at=1760000002400 gen=7",
        "1760000002.600  1  1 I MusicFreePerf: engine-progress at=1760000002600 gen=7 pos=0.05",
        "garbage line",
        "1760000003.000  1  1 I MusicFreePerf: search-start at=1760000003000 session=4 sources=2",
        "1760000003.020  1  1 I MusicFreePerf: search-first-result at=1760000003020 session=4",
        "1760000003.090  1  1 I MusicFreePerf: search-done at=1760000003090 session=4 anyResults=true",
    ])
    events = parse(log)
    assert len(events) == 13, events
    assert events[4]["detail"]["key"] == "E2E_测试源_A@tone-a"
    assert cold(events, 1760000000000) == {
        "cold_home_visible_ms": 3300,
        "cold_first_screen_ms": 1900,
        "cold_splash_hidden_ms": 2300,
        "cold_launch_to_process_ms": 300,
        "cold_process_to_home_ms": 3000,
    }
    # 旧版 APK 没有进程起点和第一次绘制：主页可见退回 JS 的两个时间点中较晚的
    old_apk = [e for e in events if e["name"] not in ("process-start", "first-draw")]
    assert cold(old_apk, 1760000000000) == {
        "cold_home_visible_ms": 2300,
        "cold_first_screen_ms": 1900,
        "cold_splash_hidden_ms": 2300,
    }
    try:
        cold([e for e in events if e["name"] != "splash-hidden"], 1760000000000)
    except ValueError:
        pass
    else:
        raise AssertionError("缺 splash-hidden 的冷启动被接受")
    start_log = "\n".join([
        "1759999990.500  9  9 I ActivityTaskManager: START u0 {flg=0x10000000 cmp=fun.upup.musicfree/.MainActivity} from uid 2000",
        "1760000000.050  9  9 I ActivityTaskManager: START u0 {flg=0x10000000 cmp=fun.upup.musicfree/.MainActivity} from uid 2000",
        "1760000000.060  9  9 I ActivityTaskManager: START u0 {cmp=com.other/.Main} from uid 2000",
    ])
    assert launch_start(start_log, "fun.upup.musicfree") == 1760000000050
    try:
        launch_start("1760000000.050  9  9 I ActivityTaskManager: START u0 {cmp=com.other/.Main}", "fun.upup.musicfree")
    except ValueError:
        pass
    else:
        raise AssertionError("别的包的 START 行被接受")
    for bad in (1760000002000,):
        try:
            cold(events, bad)
        except ValueError:
            pass
        else:
            raise AssertionError("早于开始的 first-screen 被接受")
    assert play(events, "online") == {
        "online_engine_start_ms": 600,
        "online_resolve_ms": 40,
        "online_load_to_file_loaded_ms": 350,
        "online_file_loaded_to_progress_ms": 200,
    }
    assert search(events) == {"search_done_ms": 90, "search_first_result_ms": 20}
    broken = [
        [e for e in events if e["name"] != "engine-progress"],
        [e for e in events if e["name"] != "track-load"],
        [e for e in events if not (e["name"] == "play-request" and e["detail"].get("skip") == "false")],
        [dict(e, detail=dict(e["detail"], gen="8")) if e["name"] == "engine-file-loaded" else e for e in events],
    ]
    for index, case in enumerate(broken):
        try:
            play(case, "online")
        except ValueError:
            continue
        raise AssertionError(f"第 {index} 个缺时间点的点歌被接受")
    for case in ([e for e in events if e["name"] != "search-done"],
                 [e for e in events if e["name"] != "search-first-result"]):
        try:
            search(case)
        except ValueError:
            continue
        raise AssertionError("缺时间点的搜索被接受")

    assert percentile([5, 1, 3, 2, 4], 0.95) == 5
    assert percentile(list(range(1, 21)), 0.95) == 19
    assert median([3, 1, 2]) == 2 and median([4, 1, 2, 3]) == 2.5
    rows = [
        {"warmup": True, "cold_first_screen_ms": 9999},
        {"cold_first_screen_ms": 1000, "cold_first_frame_ms": 400},
        {"cold_first_screen_ms": 1200},
        {"cold_first_screen_ms": 1100, "note": "x"},
    ]
    summary = summarize(rows)
    assert summary["cold_first_screen_ms"] == {"n": 3, "median": 1100, "p95": 1200, "min": 1000, "max": 1200}, summary
    assert summary["cold_first_frame_ms"]["n"] == 1
    assert describe(summary, "cold_first_screen_ms") == "中位数 1100 ms，P95 1200 ms（3 次，最小 1000，最大 1200）"
    assert describe(summary, "search_done_ms") == ""
    table = markdown(summary)
    assert "冷启动：主页标签栏在开屏页下面排好版" in table and "| 3 | 1100 | 1200 |" in table, table
    print("perf_stats.py self-test ok")


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "--self-test":
            self_test()
        elif command == "cold" and len(argv) == 3:
            text = sys.stdin.read()
            print(json.dumps(cold(parse(text), launch_start(text, argv[2]))))
        elif command == "play" and len(argv) == 3 and argv[2] in ("online", "local"):
            print(json.dumps(play(parse(sys.stdin.read()), argv[2])))
        elif command == "search" and len(argv) == 2:
            print(json.dumps(search(parse(sys.stdin.read()))))
        elif command == "describe" and len(argv) == 4:
            with open(argv[2], encoding="utf-8") as file:
                print(describe(json.load(file), argv[3]))
        elif command == "summary" and len(argv) == 3:
            with open(argv[2], encoding="utf-8") as file:
                rows = [json.loads(line) for line in file if line.strip()]
            summary = summarize(rows)
            print(markdown(summary))
            print(json.dumps(summary, ensure_ascii=False), file=sys.stderr)
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except (ValueError, OSError) as error:
        print(str(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
