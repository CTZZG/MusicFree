#!/usr/bin/env python3
"""Read actual public UI bounds and raw injected-touch evidence; no player calls."""
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def node(path, label):
    nodes = [n for n in ET.parse(path).iter("node")
             if n.get("content-desc") == label and n.get("enabled") == "true"
             and n.get("package") == "fun.upup.musicfree"]
    if len(nodes) != 1 or nodes[0].get("clickable") != "true":
        raise ValueError("expected one enabled clickable public UI node")
    values = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", nodes[0].get("bounds", ""))
    if not values:
        raise ValueError("missing real UI bounds")
    left, top, right, bottom = map(int, values.groups())
    if not 0 <= left < right <= 10000 or not 0 <= top < bottom <= 10000:
        raise ValueError("invalid real UI bounds")
    return left, top, right, bottom


def coordinates(path, kind):
    left, top, right, bottom = node(path, "歌曲: E2E Tone B 歌手: E2E Artist")
    width = right - left
    if width < 200 or bottom - top < 20:
        raise ValueError("clipped mini-player")
    start, end = {"right": (.2, .75), "left": (.75, .2), "short": (.4, .5)}[kind]
    return [round(left + start * width), round(left + end * width), (top + bottom) // 2]


def result(directory, kind):
    root = Path(directory)
    text = (root / f"gesture-{kind}-instrumentation.txt").read_text()
    if not re.search(r"(?m)^INSTRUMENTATION_CODE: -1\s*$", text):
        raise ValueError("native touch instrument did not complete")
    points = json.loads(re.search(r"(?m)^INSTRUMENTATION_RESULT: points=(.+)$", text)[1])
    velocity = float(re.search(r"(?m)^INSTRUMENTATION_RESULT: injectedVelocityX=([^\r\n]+)", text)[1])
    if len(points) != 82 or points[0]["action"] != 0 or points[-1]["action"] != 1 or not all(p["accepted"] is True for p in points):
        raise ValueError("incomplete/rejected actual injected touch stream")
    if any(p["action"] != 2 for p in points[1:-1]) or any(a["time"] > b["time"] for a, b in zip(points, points[1:])):
        raise ValueError("invalid actual event sequence")
    if any(p["x"] != points[-1]["x"] or p["y"] != points[-1]["y"] for p in points[31:]):
        raise ValueError("missing stationary release")
    if points[-1]["time"] - points[30]["time"] < 700:
        raise ValueError("stationary hold too short")
    # The raw hold has exactly repeated coordinates. Android's fitted tracker
    # can still return a tiny signed residual (-.019198854 in diagnostic123).
    # Keep it as data, not an invented near-zero acceptance threshold.
    if not math.isfinite(velocity):
        raise ValueError("invalid Android tracker reading")
    before = json.loads((root / f"gesture-{kind}-before.json").read_text())
    after = json.loads((root / f"gesture-{kind}-after.json").read_text())
    if before.get("title") != "E2E Tone B" or before.get("state") != "PAUSED" or after.get("title") not in ("E2E Tone A", "E2E Tone B", "E2E Tone C"):
        raise ValueError("missing actual before/after track evidence")
    if kind == "short" and (after.get("state") != "PAUSED" or after.get("position") != before.get("position")):
        raise ValueError("short control unexpectedly changed paused playback")
    node(root / f"gesture-{kind}-after.xml", f"歌曲: {after['title']} 歌手: E2E Artist")
    expected = {"right": "E2E Tone A", "left": "E2E Tone C", "short": "E2E Tone B"}[kind]
    report = dict(kind=kind, expected=expected, observed=after["title"], matches=expected == after["title"],
                  acceptedEvents=len(points), injectedVelocityX=velocity, before=before, after=after,
                  scope="native injected touch/Android VelocityTracker and public UI/session; not RNGH callback velocity or physical audio")
    (root / f"gesture-{kind}-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        mode = sys.argv[1]
        if mode == "coordinates":
            print(*coordinates(sys.argv[2], sys.argv[3]))
        elif mode == "row":
            left, top, right, bottom = node(sys.argv[2], "E2E Tone B, E2E Artist")
            print((left + right) // 2, (top + bottom) // 2)
        elif mode == "result":
            result(sys.argv[2], sys.argv[3])
        else:
            raise ValueError("unknown mode")
    except (ValueError, OSError, KeyError, TypeError, IndexError, AttributeError, ET.ParseError) as error:
        print(f"gesture observation rejected: {error}", file=sys.stderr)
        sys.exit(1)
