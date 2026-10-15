#!/usr/bin/env python3
"""性能基线（e2e/perf.sh）用的解析和统计。只记录，不设门限。

应用把时间点写到 logcat（标签 MusicFreePerf），每行 “名字 at=<墙钟毫秒> 键=值 …”：
  process-start       应用进程起来（原生 Application.onCreate 的开头）
  first-screen        冷启动后主页标签栏第一次排好版（JS；这时开屏页可能还盖着）
  splash-hidden       启动初始化做完、JS 叫开屏页收起（JS）
  first-draw          应用窗口第一次出帧（原生）。开屏页撑着时内容先藏着（patches/expo-splash-screen），
                      窗口照常出帧；修之前 expo 取消绘制，这一帧要等 JS 叫收起，之后同步还要等满 1 秒超时
                      （见 Beta #144 的冷启动追踪、docs/handoff/cold-start-splash-2026-10-15.md）
  home-drawn          开屏页（SplashScreenView）从窗口里拿掉之后的第一帧画好、交给系统合成（原生，API 31 起）：
                      用户看到主页。渲染线程还在画前面的帧时（主页第一次画），它比系统日志里的开屏页移除晚，
                      这段时间屏幕上还是开屏页
  play-request        TrackPlayer.play 被调用（JS，skip=true 是切歌流程自己发起的）
  track-load          取到地址、交给播放器装载（JS）
  engine-load         原生发出 loadfile（gen=装载代次）
  engine-file-loaded  mpv 报告文件装好（gen=）
  engine-progress     这次装载后 time-pos 第一次自然往前走（gen=）。不代表扬声器已经出声
  search-start / search-first-result / search-done   搜索开始、第一个有结果的来源返回、所有来源第一页都返回

  adb logcat -d -v epoch -s ActivityTaskManager:I MusicFreePerf:I | perf_stats.py cold <包名>
      冷启动：从系统收到启动请求（ActivityTaskManager 的 “START u0 … cmp=<包名>/…” 那一行的时间）
      到各时间点的毫秒数，输出一行 JSON。主页出现在屏幕上以 home-drawn 为准，另记开屏页移除（系统日志
      “SplashScreenView: remove starting view”）；系统认为画好以 “Displayed <包名>/…” 那一行为准。
      这两行是系统写的，要 logcat 带上 SplashScreenView 标签（开屏页移除是系统的调试日志，模拟器的 userdebug
      系统里有，user 版系统可能没有）
  adb logcat -d -s MusicFreePerf:I | perf_stats.py play
      点歌：play-request 到各阶段的毫秒数，输出一行 JSON
  adb logcat -d -s MusicFreePerf:I | perf_stats.py search
      搜索：search-start 到第一个结果、到全部返回的毫秒数，输出一行 JSON
  perf_stats.py summary <jsonl 文件>
      每个指标的样本数、中位数、P95（最近秩）、最小、最大；warmup=true 的不算。输出 Markdown 表格，
      统计结果的 JSON 写到 stderr
  perf_stats.py describe <统计结果 JSON 文件> <指标>
      一行说明（“中位数 … ms，P95 … ms（n 次，最小 …，最大 …）”）；这个指标没有样本时什么也不输出
  adb logcat -d -v epoch -b main -b system -b events | perf_stats.py trace <包名> <截屏目录> <输出目录>
      冷启动追踪（诊断，不进统计）：启动请求前后的相关日志（窗口管理、同步超时、焦点、性能时间点），
      每行前面是相对启动请求的毫秒数；截屏目录里的 <n>.raw（screencap 原始格式，设备上截屏前后各写一行
      “MusicFreeShot b<n>/e<n>”）缩小 4 倍转成 cold-trace-<n>-<起>-<止>ms.png 写到输出目录
  perf_stats.py --self-test

解析不出（缺时间点、顺序不对）时输出原因、返回 1。
"""
import json
import math
import os
import re
import struct
import sys
import tempfile
import zlib

MARK = re.compile(r"MusicFreePerf\s*:\s*(\S+) at=(\d+)(.*)$")
# logcat -v epoch：行首是 “秒.毫秒”
EPOCH_LINE = re.compile(r"^\s*(\d+)\.(\d{3})\d*\s")

# 指标的中文名和顺序（summary 按这个顺序输出）
METRICS = [
    ("cold_home_drawn_ms", "冷启动：到主页出现在屏幕上（开屏页拿掉后的第一帧交给系统合成，标签栏含“资料库”）"),
    ("cold_home_visible_ms", "冷启动：到开屏页移除（系统日志）"),
    ("cold_first_frame_ms", "冷启动：系统报告的启动完成（am start -W TotalTime）"),
    ("cold_first_draw_ms", "冷启动：应用窗口第一次出帧（开屏页还盖着）"),
    ("cold_first_screen_ms", "冷启动：主页标签栏在开屏页下面排好版"),
    ("cold_splash_hidden_ms", "冷启动：JS 叫开屏页收起"),
    ("cold_launch_to_process_ms", "冷启动：启动请求到应用进程起来"),
    ("cold_draw_to_displayed_ms", "冷启动：应用第一次出帧到系统认为画好（Displayed）"),
    ("cold_blank_ms", "冷启动：开屏页走后到主页排好版之间的空白（应为 0）"),
    ("cold_displayed_to_visible_ms", "冷启动：系统认为画好到开屏页移除"),
    ("cold_removed_to_drawn_ms", "冷启动：开屏页移除到下一帧交给系统合成"),
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


# logcat -v epoch 的一行：“秒.毫秒 进程 线程 级别 标签: 内容”（events 缓冲区也是这个格式）
LOG_LINE = re.compile(r"^\s*(\d+)\.(\d{3})\d*\s+\d+\s+\d+\s+[VDIWEF]\s+(.*)$")
SHOT_LINE = re.compile(r"MusicFreeShot\s*:\s*([be])(\d+)\s*$")
# 冷启动追踪要留下的日志：系统启动记录、窗口管理、同步超时、焦点切换、应用自己的性能时间点
TRACE_WORDS = re.compile(
    r"ActivityTaskManager|MusicFreePerf|SurfaceSyncGroup|[Tt]imed out|[Tt]imeout|Displayed|[Ss]plash|"
    r"[Ss]tarting ?[Ww]indow|BLAST|DrawFinished|finishDrawing|wm_activity_launch_time|input_focus|"
    r"wm_set_resumed_activity|wm_on_resume_called|[Tt]ransition"
)


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


def system_times(text, package, start_ms):
    """启动请求之后系统日志里的两个时刻：Displayed（系统认为应用窗口画好）、开屏页移除"""
    times = {}
    for line in text.splitlines():
        match = EPOCH_LINE.match(line)
        if not match:
            continue
        at = int(match.group(1)) * 1000 + int(match.group(2))
        if at < start_ms:
            continue
        if "ActivityTaskManager" in line and f"Displayed {package}/" in line:
            times.setdefault("displayed", at)
        elif "SplashScreenView" in line and "remove starting view" in line:
            times.setdefault("splash-removed", at)
    return times


def cold(events, start_ms, system=None):
    system = system or {}
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
    # 应用窗口第一次出帧（新版 APK 才有）；这时开屏页还盖着
    draw = first(events, "first-draw")
    if draw is not None and draw["at"] < start_ms:
        draw = None
    if draw is not None:
        result["cold_first_draw_ms"] = draw["at"] - start_ms
    # 进程起点用来核对起点：系统的启动请求和应用自己的时钟对不对得上
    process = first(events, "process-start")
    if process is not None and process["at"] >= start_ms:
        result["cold_launch_to_process_ms"] = process["at"] - start_ms
    # 用户看到主页：开屏页移除。它不会早于 JS 叫开屏页收起，早了说明读错了行
    removed = system.get("splash-removed")
    if removed is not None:
        if removed < marks["splash-hidden"]:
            raise ValueError(f"开屏页移除（{removed}）早于 JS 叫收起（{marks['splash-hidden']}）")
        result["cold_home_visible_ms"] = removed - start_ms
        # 开屏页走了主页还没排好版：中间露出的是空白
        result["cold_blank_ms"] = max(0, marks["first-screen"] - removed)
    displayed = system.get("displayed")
    if displayed is not None and draw is not None:
        result["cold_draw_to_displayed_ms"] = displayed - draw["at"]
    if displayed is not None and removed is not None:
        result["cold_displayed_to_visible_ms"] = removed - displayed
    # 开屏页拿掉后的第一帧交给系统合成（新版 APK、API 31 起才有）：用户看到主页
    drawn = first(events, "home-drawn")
    if drawn is not None and drawn["at"] >= start_ms:
        result["cold_home_drawn_ms"] = drawn["at"] - start_ms
        if removed is not None:
            result["cold_removed_to_drawn_ms"] = drawn["at"] - removed
    return result


def timeline(text, package, before_ms=500, after_ms=6000):
    """冷启动追踪：启动请求前后的相关日志行（相对启动请求的毫秒数，内容）和每张截屏的起止"""
    start = launch_start(text, package)
    lines, shots = [], {}
    for line in text.splitlines():
        match = LOG_LINE.match(line)
        if not match:
            continue
        offset = int(match.group(1)) * 1000 + int(match.group(2)) - start
        if not -before_ms <= offset <= after_ms:
            continue
        message = match.group(3).strip()
        shot = SHOT_LINE.search(message)
        if shot:
            shots.setdefault(int(shot.group(2)), {})[shot.group(1)] = offset
        elif TRACE_WORDS.search(message):
            lines.append((offset, message))
    return lines, {n: s for n, s in shots.items() if "b" in s and "e" in s}


def raw_to_png(raw, scale=4):
    """screencap 原始格式（宽、高、像素格式，Android 12 起多一个色彩空间，然后每像素 4 字节）转成缩小的 RGB PNG。
    像素格式 1 是 RGBA_8888，2 是 RGBX_8888，前 3 个字节都是 RGB"""
    width, height, pixel_format = struct.unpack_from("<III", raw)
    header = len(raw) - width * height * 4
    if header not in (12, 16) or pixel_format not in (1, 2):
        raise ValueError(f"不是 RGBA/RGBX 的 screencap 原始截屏（{width}x{height}，格式 {pixel_format}，文件头 {header} 字节）")
    columns = range(0, width, scale)
    rows = []
    for y in range(0, height, scale):
        row = raw[header + y * width * 4:header + (y + 1) * width * 4]
        rows.append(b"\0" + b"".join(row[x * 4:x * 4 + 3] for x in columns))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header_chunk = struct.pack(">IIBBBBB", len(columns), len(rows), 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header_chunk) +
            chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def trace(text, package, shot_dir, out_dir):
    """冷启动追踪的文字结果；截屏转成 PNG 写到 out_dir"""
    lines, shots = timeline(text, package)
    entries = list(lines)
    for number, window in sorted(shots.items()):
        path = os.path.join(shot_dir, f"{number}.raw")
        name = f"cold-trace-{number:02d}-{window['b']}-{window['e']}ms.png"
        try:
            with open(path, "rb") as file:
                png = raw_to_png(file.read())
            with open(os.path.join(out_dir, name), "wb") as file:
                file.write(png)
        except (OSError, ValueError, struct.error) as error:
            name = f"（没转成：{error}）"
        entries.append((window["b"], f"截屏 {number} 开始（到 +{window['e']} ms 截完）{name}"))
    entries.sort(key=lambda entry: entry[0])
    return "\n".join(f"{offset:+6d} ms  {message}" for offset, message in entries)


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
        "1760000000.170  1  1 I MusicFreePerf: home-drawn at=1760000005400",
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
    assert len(events) == 14, events
    assert events[5]["detail"]["key"] == "E2E_测试源_A@tone-a"
    system_log = "\n".join([
        "1759999999.000  9  9 I ActivityTaskManager: Displayed fun.upup.musicfree/.MainActivity for user 0: +2s0ms",
        "1760000004.300  9  9 I ActivityTaskManager: Displayed fun.upup.musicfree/.MainActivity for user 0: +4s300ms",
        "1760000004.400  9  9 I ActivityTaskManager: Displayed com.other/.Main for user 0: +1s",
        "1760000004.900  7  7 D SplashScreenView: remove starting view",
        "1760000005.000  7  7 D SplashScreenView: remove starting view",
    ])
    system = system_times(system_log, "fun.upup.musicfree", 1760000000000)
    assert system == {"displayed": 1760000004300, "splash-removed": 1760000004900}, system
    assert cold(events, 1760000000000, system) == {
        "cold_home_drawn_ms": 5400,
        "cold_removed_to_drawn_ms": 500,
        "cold_home_visible_ms": 4900,
        "cold_blank_ms": 0,
        "cold_first_draw_ms": 3300,
        "cold_first_screen_ms": 1900,
        "cold_splash_hidden_ms": 2300,
        "cold_launch_to_process_ms": 300,
        "cold_draw_to_displayed_ms": 1000,
        "cold_displayed_to_visible_ms": 600,
    }
    # 没有系统那两行（logcat 没带上）：不报主页出现在屏幕上，不拿应用自己的时间点顶替
    assert cold(events, 1760000000000) == {
        "cold_home_drawn_ms": 5400,
        "cold_first_draw_ms": 3300,
        "cold_first_screen_ms": 1900,
        "cold_splash_hidden_ms": 2300,
        "cold_launch_to_process_ms": 300,
    }
    # 旧版 APK 没有进程起点和第一次绘制：只缺跟它们有关的
    old_apk = [e for e in events if e["name"] not in ("process-start", "first-draw", "home-drawn")]
    assert cold(old_apk, 1760000000000, system) == {
        "cold_home_visible_ms": 4900,
        "cold_blank_ms": 0,
        "cold_first_screen_ms": 1900,
        "cold_splash_hidden_ms": 2300,
        "cold_displayed_to_visible_ms": 600,
    }
    # JS 先叫收起、主页后排好版：开屏页走后露出 200 ms 空白
    late_home = [dict(e, at=1760000002600) if e["name"] == "first-screen" else e for e in events]
    assert cold(late_home, 1760000000000, {"splash-removed": 1760000002400})["cold_blank_ms"] == 200
    try:
        cold(events, 1760000000000, {"splash-removed": 1760000002000})
    except ValueError:
        pass
    else:
        raise AssertionError("早于 JS 叫收起的开屏页移除被接受")
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
    trace_log = "\n".join([
        "1760000009.000  9  9 I ActivityTaskManager: START u0 {cmp=fun.upup.musicfree/.MainActivity} from uid 2000",
        "1760000010.000  9  9 I ActivityTaskManager: START u0 {cmp=fun.upup.musicfree/.MainActivity} from uid 2000",
        "1760000009.950  5  5 I MusicFreeShot: b1",
        "1760000010.120  5  5 I MusicFreeShot: e1",
        "1760000010.130  5  5 I MusicFreeShot: b2",
        "1760000010.900  7  7 I MusicFreePerf: first-draw at=1760000010900",
        "1760000011.910  9  9 E SurfaceSyncGroup: Failed to receive transaction ready in 1000ms",
        "1760000011.920  9  9 I ActivityTaskManager: Displayed fun.upup.musicfree/.MainActivity for user 0: +1s920ms",
        "1760000011.921  9  9 I wm_activity_launch_time: [0,1,fun.upup.musicfree/.MainActivity,1920]",
        "1760000011.930  9  9 D Unrelated: noise",
        "1760000020.000  9  9 I ActivityTaskManager: Displayed com.other/.Main",
    ])
    lines, shots = timeline(trace_log, "fun.upup.musicfree")
    assert [offset for offset, _ in lines] == [0, 900, 1910, 1920, 1921], lines
    assert shots == {1: {"b": -50, "e": 120}}, shots
    # 3x2 的 RGBA 原始截屏（16 字节文件头），缩小 2 倍是 2x1，取第 0、2 列
    pixels = bytes(range(1, 25))
    raw = struct.pack("<IIII", 3, 2, 1, 0) + pixels
    png = raw_to_png(raw, scale=2)
    assert png.startswith(b"\x89PNG\r\n\x1a\n") and struct.unpack_from(">II", png, 16) == (2, 1)
    idat = png.index(b"IDAT")
    size = struct.unpack_from(">I", png, idat - 4)[0]
    assert zlib.decompress(png[idat + 4:idat + 4 + size]) == b"\0" + pixels[0:3] + pixels[8:11]
    try:
        raw_to_png(struct.pack("<III", 3, 2, 5) + pixels)
    except ValueError:
        pass
    else:
        raise AssertionError("不是 RGBA 的截屏被接受")
    with tempfile.TemporaryDirectory() as shot_dir, tempfile.TemporaryDirectory() as out_dir:
        with open(os.path.join(shot_dir, "1.raw"), "wb") as file:
            file.write(raw)
        text = trace(trace_log + "\n1760000010.300  5  5 I MusicFreeShot: e2", "fun.upup.musicfree", shot_dir, out_dir)
        assert os.listdir(out_dir) == ["cold-trace-01--50-120ms.png"], os.listdir(out_dir)
        assert text.splitlines()[0] == "   -50 ms  截屏 1 开始（到 +120 ms 截完）cold-trace-01--50-120ms.png", text
        assert "截屏 2 开始（到 +300 ms 截完）（没转成：" in text and "+1910 ms  E SurfaceSyncGroup" not in text, text
        assert "+1910 ms  SurfaceSyncGroup: Failed" in text, text
    print("perf_stats.py self-test ok")


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "--self-test":
            self_test()
        elif command == "cold" and len(argv) == 3:
            text = sys.stdin.read()
            start = launch_start(text, argv[2])
            print(json.dumps(cold(parse(text), start, system_times(text, argv[2], start))))
        elif command == "play" and len(argv) == 3 and argv[2] in ("online", "local"):
            print(json.dumps(play(parse(sys.stdin.read()), argv[2])))
        elif command == "search" and len(argv) == 2:
            print(json.dumps(search(parse(sys.stdin.read()))))
        elif command == "trace" and len(argv) == 5:
            print(trace(sys.stdin.read(), argv[2], argv[3], argv[4]))
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
