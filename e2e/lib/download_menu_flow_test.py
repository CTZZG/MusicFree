#!/usr/bin/env python3
"""Reject the no-scroll download command against Beta218's actual menu viewport."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def check(ref=None):
    path = "e2e/flows/download-song.yaml"
    flow = (subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"]).decode()
            if ref else (ROOT / path).read_text())
    nodes = json.loads((ROOT / "e2e/fixtures/download-menu-hierarchy.json").read_text())["nodes"]
    assert any(n["attributes"].get("scrollable") == "true" for n in nodes), "recorded menu must scroll"
    labels = {n["attributes"].get("accessibilityText") for n in nodes}
    assert "当前播放信息" in labels and "下载" not in labels, "the recorded download is outside the visible menu"
    commands = re.split(r"(?m)^- ", flow.split("---", 1)[1])[1:]
    tap = next(i for i, command in enumerate(commands) if command.strip() == 'tapOn: "下载"')
    wait, swipe = commands[tap - 1], commands[tap - 2]
    assert wait.startswith("extendedWaitUntil:") and 'visible: "下载"' in wait and 'timeout: 10000' in wait, "keep the exact target and existing 10-second menu wait limit"
    assert swipe.startswith("swipe:"), "automatic scrolling left the recorded menu unmoved in Beta219"
    points = [tuple(map(float, p)) for p in re.findall(r'"([0-9.]+)%, ([0-9.]+)%"', swipe)]
    assert len(points) == 2 and points[0][1] > points[1][1], "must swipe upwards inside the modal list"
    scroll = next(n['attributes'] for n in nodes if n['attributes'].get('scrollable') == 'true')
    left, top, right, bottom = map(int, re.findall(r'\d+', scroll['bounds']))
    assert all(left < x / 100 * 1080 < right and top < y / 100 * 2400 < bottom for x, y in points), "stroke must not enter the page behind the menu"
    print("download menu: 6 checks passed against the recorded Beta218/219 viewport")


if __name__ == "__main__":
    try:
        check(sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--flow-ref" else None)
    except (AssertionError, OSError, KeyError, IndexError, StopIteration, ValueError) as error:
        print(f"download menu rejected: {error}", file=sys.stderr)
        sys.exit(1)
