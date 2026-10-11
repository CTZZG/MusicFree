#!/usr/bin/env python3
"""从 dumpsys 和 Maestro 的界面树里读出锁屏、省电测试要看的设备状态。

  adb shell dumpsys power | device_state.py wakefulness
      屏幕状态：Awake（亮屏）、Asleep（灭屏）、Dozing（灭屏显示时钟）

  adb shell dumpsys window policy | device_state.py keyguard
      锁屏界面：showing 或 hidden

  adb shell dumpsys deviceidle | device_state.py deep-idle
      深度休眠（Doze）的状态：ACTIVE、IDLE_PENDING……IDLE 是已经进入

  maestro hierarchy --compact | device_state.py player-time
      播放页进度条下面的时间：输出“已播放秒数 剩余秒数”，例如 "83 97"

读不出来时把原因写到 stderr、返回 1。

  device_state.py --self-test
"""
import re
import sys

WAKEFULNESS = re.compile(r"^\s*mWakefulness=(\w+)", re.M)
# 不同版本的写法：KeyguardServiceDelegate 的 showing=、KeyguardStateMonitor 的 mIsShowing=、
# KeyguardController 的 mKeyguardShowing=
KEYGUARD = [
    re.compile(r"^\s*mKeyguardShowing=(true|false)", re.M),
    re.compile(r"^\s*mIsShowing=(true|false)", re.M),
    re.compile(r"^\s*showing=(true|false)", re.M),
]
DEEP_IDLE = re.compile(r"^\s*mState=(\w+)", re.M)
TEXT = re.compile(r"text=([^;\"]*)")
BOUNDS = re.compile(r"bounds=\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
ELAPSED = re.compile(r"^(?:(\d+):)?(\d{2}):(\d{2})$")
REMAINING = re.compile(r"^-(?:(\d+):)?(\d{2}):(\d{2})$")


def wakefulness(text):
    match = WAKEFULNESS.search(text)
    if not match:
        raise ValueError("dumpsys power 里没有 mWakefulness=")
    return match.group(1)


def keyguard(text):
    for pattern in KEYGUARD:
        match = pattern.search(text)
        if match:
            return "showing" if match.group(1) == "true" else "hidden"
    raise ValueError("dumpsys 里没有锁屏状态（mKeyguardShowing= / mIsShowing= / showing=）")


def deep_idle(text):
    match = DEEP_IDLE.search(text)
    if not match:
        raise ValueError("dumpsys deviceidle 里没有 mState=")
    return match.group(1)


def seconds(match):
    hours, minutes, secs = match.groups()
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(secs)


def player_time(text):
    """返回 (已播放秒数, 剩余秒数)：同一行（y 最接近）的“mm:ss”和“-mm:ss”"""
    elapsed, remaining = [], []
    for line in text.splitlines():
        label = TEXT.search(line)
        bounds = BOUNDS.search(line)
        if not label or not bounds:
            continue
        value = label.group(1).strip()
        middle = (int(bounds.group(2)) + int(bounds.group(4))) / 2
        if match := ELAPSED.match(value):
            elapsed.append((middle, seconds(match)))
        elif match := REMAINING.match(value):
            remaining.append((middle, seconds(match)))
    if not remaining:
        raise ValueError("界面上没有剩余时间（-mm:ss），不在播放页？")
    if not elapsed:
        raise ValueError("界面上没有已播放时间（mm:ss）")
    rest_y, rest = remaining[0]
    _, played = min(elapsed, key=lambda item: abs(item[0] - rest_y))
    return played, rest


SAMPLE_POWER = """POWER MANAGER (dumpsys power)

Power Manager State:
  mDirty=0x0
  mWakefulness=Asleep
  mWakefulnessChanging=false
"""

SAMPLE_POLICY = """WINDOW MANAGER POLICY STATE (dumpsys window policy)
    KeyguardServiceDelegate
      showing=true
      showingAndNotOccluded=true
      inputRestricted=true
    KeyguardStateMonitor
      mIsShowing=true
"""

SAMPLE_DEVICEIDLE = """  Settings:
    flex_time_short=+1m0s0ms
  mLightEnabled=true  mDeepEnabled=true
  mForceIdle=true
  mState=IDLE mLightState=OVERRIDE
"""

SAMPLE_PLAYER = """120,30,"accessibilityText=播放进度; bounds=[18,1900][1062,1996]; enabled=true; class=android.widget.SeekBar",119
121,31,"text=01:23; bounds=[60,2000][160,2032]; enabled=true; class=android.widget.TextView",119
122,31,"text=-01:37; bounds=[920,2000][1020,2032]; enabled=true; class=android.widget.TextView",119
130,40,"text=00:10; bounds=[60,800][160,832]; enabled=true; class=android.widget.TextView",129
"""


def self_test():
    assert wakefulness(SAMPLE_POWER) == "Asleep"
    assert wakefulness(SAMPLE_POWER.replace("Asleep", "Awake")) == "Awake"
    assert keyguard(SAMPLE_POLICY) == "showing"
    assert keyguard(SAMPLE_POLICY.replace("true", "false")) == "hidden"
    assert keyguard("  KeyguardController:\n    mKeyguardShowing=false\n") == "hidden"
    assert deep_idle(SAMPLE_DEVICEIDLE) == "IDLE"
    assert player_time(SAMPLE_PLAYER) == (83, 97)
    assert player_time(SAMPLE_PLAYER.replace("01:23", "1:02:03").replace("-01:37", "-1:00:00")) == (3723, 3600)
    for broken, parse in (("", wakefulness), ("", keyguard), ("", deep_idle), ("", player_time),
                          (SAMPLE_PLAYER.replace("-01:37", "x"), player_time)):
        try:
            parse(broken)
        except ValueError:
            continue
        raise AssertionError(f"应当读不出来：{parse.__name__} {broken!r}")
    print("device_state.py self-test ok")


COMMANDS = {
    "wakefulness": wakefulness,
    "keyguard": keyguard,
    "deep-idle": deep_idle,
    "player-time": lambda text: " ".join(str(value) for value in player_time(text)),
}


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    if len(argv) != 2 or argv[1] not in COMMANDS:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        print(COMMANDS[argv[1]](sys.stdin.read()))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
