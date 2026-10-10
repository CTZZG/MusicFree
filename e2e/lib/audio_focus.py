#!/usr/bin/env python3
"""从 `adb shell dumpsys audio` 里读出现在是谁拿着音频焦点。

用来确认看“视频”（e2e/focus-app）期间，MusicFree 的自动播放补偿没有把焦点
抢回来：焦点栈最上面一直是视频替身。

  adb shell dumpsys audio | audio_focus.py top
      输出焦点栈最上面那个应用的包名；栈是空的输出 "-"

  adb shell dumpsys audio | audio_focus.py entry <包名>
      输出这个应用在焦点栈里的那一行（gain、loss 等），没有输出 "-"

  audio_focus.py --self-test
"""
import re
import sys

STACK_HEADER = "Audio Focus stack entries"
ENTRY_PACKAGE = re.compile(r"-- pack: (\S+)")


def stack_entries(text):
    """焦点栈里的每一行，从栈底到栈顶。"""
    entries = []
    in_stack = False
    for line in text.splitlines():
        if STACK_HEADER in line:
            in_stack = True
            entries = []
            continue
        if not in_stack:
            continue
        stripped = line.strip()
        if stripped.startswith("source:") and "-- pack: " in stripped:
            entries.append(stripped)
        elif entries and stripped:
            # 栈后面接着的是别的段落
            in_stack = False
    return entries


def package_of(entry):
    match = ENTRY_PACKAGE.search(entry)
    return match.group(1) if match else ""


def top(text):
    entries = stack_entries(text)
    return package_of(entries[-1]) if entries else "-"


def entry(text, package):
    for line in stack_entries(text):
        if package_of(line) == package:
            return line
    return "-"


SAMPLE = """
Audio Focus stacks:

Audio Focus stack entries (last is top of stack):
  source:android.os.BinderProxy@1 -- pack: fun.upup.musicfree -- client: android.media.AudioManager@2fun.upup.musicfree.mpvplayer.MpvPlaybackService$1@3 -- gain: GAIN -- flags:  -- loss: LOSS_TRANSIENT -- notified: true -- limbo false -- uid: 10190 -- attr: AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_UNKNOWN flags=0x800 tags= bundle=null -- sdk:34
  source:android.os.BinderProxy@4 -- pack: fun.upup.musicfree.e2e.focus -- client: android.media.AudioManager@5fun.upup.musicfree.e2e.focus.HoldFocusActivity$1@6 -- gain: GAIN_TRANSIENT -- flags:  -- loss: none -- notified: true -- limbo false -- uid: 10191 -- attr: AudioAttributes: usage=USAGE_MEDIA content=CONTENT_TYPE_MOVIE flags=0x800 tags= bundle=null -- sdk:34


Notify on duck:  true

In ring or call: false
"""


def self_test():
    assert top(SAMPLE) == "fun.upup.musicfree.e2e.focus", top(SAMPLE)
    assert "loss: LOSS_TRANSIENT" in entry(SAMPLE, "fun.upup.musicfree")
    assert entry(SAMPLE, "com.example.none") == "-"
    only_music = SAMPLE.replace(SAMPLE.splitlines()[5], "")
    assert top(only_music) == "fun.upup.musicfree", top(only_music)
    assert top("no focus here") == "-"
    print("audio_focus.py self-test ok")


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    if argv[1:2] == ["top"]:
        print(top(sys.stdin.read()))
        return 0
    if argv[1:2] == ["entry"] and len(argv) == 3:
        print(entry(sys.stdin.read(), argv[2]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
