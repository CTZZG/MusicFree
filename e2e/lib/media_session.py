#!/usr/bin/env python3
"""从 `adb shell dumpsys media_session` 里读出 MusicFree 播放会话的状态。

通知栏、锁屏和耳机按键都通过这个系统媒体会话控制播放；会话里的进度由 mpv
直接上报，所以它能说明歌是不是真的在往前播，而不只是界面上显示在播。

  adb shell dumpsys media_session | media_session.py parse [包名]
      输出一行 JSON：found / state / position(毫秒) / title / artist / album

  adb shell dumpsys media_session | media_session.py brief [包名]
      输出一行简要状态，例如 "PLAYING E2E Tone A 12.3s"，用来记时间线

  media_session.py is-playing <标题> <JSON>
      这次采样正在播这首歌才返回 0

  media_session.py playing <标题> <第一次的 JSON> <第二次的 JSON> [最少前进毫秒]
      两次采样都在播这首歌、而且进度前进了才返回 0，否则打印原因并返回 1

  media_session.py --self-test
"""
import json
import re
import sys

DEFAULT_PACKAGE = "fun.upup.musicfree"
STATE_NAMES = {
    0: "NONE", 1: "STOPPED", 2: "PAUSED", 3: "PLAYING", 4: "FAST_FORWARDING",
    5: "REWINDING", 6: "BUFFERING", 7: "ERROR", 8: "CONNECTING",
    9: "SKIPPING_TO_PREVIOUS", 10: "SKIPPING_TO_NEXT", 11: "SKIPPING_TO_QUEUE_ITEM",
}
# 每个会话的第一行都以 "(userId=0)" 结尾；不同 Android 版本中间的写法不一样
SESSION_HEADER = re.compile(r"\(userId=\d+\)\s*$")
STATE_LINE = re.compile(r"PlaybackState \{state=([^,]+), position=(-?\d+)")
METADATA_LINE = re.compile(r"metadata:\s*size=\d+, description=(.*)$")


def _state_name(raw):
    raw = raw.strip()
    number = re.search(r"\d+", raw)
    name = re.match(r"[A-Z_]+", raw)
    if name:
        return name.group(0)
    if number:
        return STATE_NAMES.get(int(number.group(0)), raw)
    return raw


def parse(text, package=DEFAULT_PACKAGE):
    sessions = []
    for line in text.splitlines():
        if SESSION_HEADER.search(line) and "=" not in line.split("(userId=")[0]:
            sessions.append({"lines": []})
        elif sessions:
            sessions[-1]["lines"].append(line.strip())

    found = []
    for session in sessions:
        lines = session["lines"]
        if f"package={package}" not in lines:
            continue
        info = {"found": True, "active": "active=true" in lines}
        for line in lines:
            state = STATE_LINE.search(line)
            if state:
                info["state"] = _state_name(state.group(1))
                info["position"] = int(state.group(2))
            metadata = METADATA_LINE.search(line)
            if metadata:
                parts = metadata.group(1).split(", ")
                info["title"] = parts[0] if parts else ""
                info["artist"] = parts[1] if len(parts) > 1 else ""
                info["album"] = ", ".join(parts[2:])
        found.append(info)
    if not found:
        return {"found": False}
    # 同一个包可能有多个会话，取正在用的那个
    found.sort(key=lambda info: (info["active"], info.get("state") == "PLAYING"), reverse=True)
    return found[0]


def brief(sample):
    if not sample.get("found"):
        return "-"
    return f"{sample.get('state')} {sample.get('title')} {sample.get('position', 0) / 1000:.1f}s"


def check_playing(title, first, second, min_advance_ms=2000):
    for label, sample in (("第一次", first), ("第二次", second)):
        if not sample.get("found"):
            return f"{label}采样没找到播放会话"
        if sample.get("title") != title:
            return f"{label}采样在播「{sample.get('title')}」，应该是「{title}」"
        if sample.get("state") != "PLAYING":
            return f"{label}采样的状态是 {sample.get('state')}，应该是 PLAYING"
    advanced = second.get("position", 0) - first.get("position", 0)
    if advanced < min_advance_ms:
        return f"进度只前进了 {advanced} 毫秒（至少 {min_advance_ms}）"
    return None


SAMPLE_NEW = """MEDIA SESSION SERVICE (dumpsys media_session)

  Sessions Stack - have 2 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv/12 (userId=0)
      ownerPid=4242, ownerUid=10190, userId=0
      package=fun.upup.musicfree
      launchIntent=null
      mediaButtonReceiver=null
      active=true
      flags=3
      rating type=0
      controllers: 3
      state=PlaybackState {state=PLAYING(3), position=12345, buffered position=30000, speed=1.0, updated=987654, actions=3669, custom actions=[], active item id=2, error=null}
      audioAttrs=AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_MUSIC flags=0x800 tags= bundle=null
      volumeType=LOCAL, controlType=ABSOLUTE, max=0, current=0, volumeControlId=null
      metadata: size=7, description=E2E Tone C, E2E Artist, E2E Album
      queueTitle=MusicFree Playback Queue, size=3
    Other fun.example.other/Other/3 (userId=0)
      package=fun.example.other
      active=false
      state=PlaybackState {state=PAUSED(2), position=1, buffered position=0, speed=0.0, updated=1, actions=0, custom actions=[], active item id=-1, error=null}
      metadata: size=1, description=Other, null, null
"""

SAMPLE_OLD = """  Sessions Stack - have 1 sessions:
    MusicFreeMpv fun.upup.musicfree/MusicFreeMpv (userId=0)
      ownerPid=4242, ownerUid=10190, userId=0
      package=fun.upup.musicfree
      active=true
      state=PlaybackState {state=2, position=4000, buffered position=0, speed=0.0, updated=10, actions=0, custom actions=[], active item id=0, error=null}
      metadata: size=3, description=E2E Tone A, E2E Artist, E2E Album
"""


def self_test():
    new = parse(SAMPLE_NEW)
    assert new == {
        "found": True, "active": True, "state": "PLAYING", "position": 12345,
        "title": "E2E Tone C", "artist": "E2E Artist", "album": "E2E Album",
    }, new
    old = parse(SAMPLE_OLD)
    assert old["state"] == "PAUSED" and old["title"] == "E2E Tone A", old
    assert parse("nothing here") == {"found": False}

    later = dict(new, position=new["position"] + 3900)
    assert check_playing("E2E Tone C", new, later) is None
    assert "进度只前进了" in check_playing("E2E Tone C", new, dict(new, position=12500))
    assert "应该是「E2E Tone A」" in check_playing("E2E Tone A", new, later)
    assert "PAUSED" in check_playing("E2E Tone A", old, old)
    assert brief(new) == "PLAYING E2E Tone C 12.3s", brief(new)
    assert brief({"found": False}) == "-"
    assert main(["", "is-playing", "E2E Tone C", json.dumps(new)]) == 0
    assert main(["", "is-playing", "E2E Tone A", json.dumps(new)]) == 1
    assert main(["", "is-playing", "E2E Tone A", json.dumps(old)]) == 1
    print("media_session.py self-test ok")


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    if argv[1:2] == ["parse"]:
        package = argv[2] if len(argv) > 2 else DEFAULT_PACKAGE
        print(json.dumps(parse(sys.stdin.read(), package), ensure_ascii=False))
        return 0
    if argv[1:2] == ["brief"]:
        package = argv[2] if len(argv) > 2 else DEFAULT_PACKAGE
        print(brief(parse(sys.stdin.read(), package)))
        return 0
    if argv[1:2] == ["is-playing"] and len(argv) == 4:
        sample = json.loads(argv[3])
        return 0 if sample.get("title") == argv[2] and sample.get("state") == "PLAYING" else 1
    if argv[1:2] == ["playing"] and len(argv) >= 5:
        min_advance = int(argv[5]) if len(argv) > 5 else 2000
        problem = check_playing(argv[2], json.loads(argv[3]), json.loads(argv[4]), min_advance)
        if problem:
            print(problem)
            return 1
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
