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
    scroll = commands[tap - 1]
    assert scroll.startswith("scrollUntilVisible:"), "must reveal download before tapping it"
    assert all(re.search(pattern, scroll, re.M) for pattern in (
        r'^    element: "下载"$', r'^    direction: DOWN$', r'^    timeout: 10000$'
    )), "keep the exact target and existing 10-second menu wait limit"
    print("download menu: 4 checks passed against the recorded Beta218 viewport")


if __name__ == "__main__":
    try:
        check(sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--flow-ref" else None)
    except (AssertionError, OSError, KeyError, IndexError, StopIteration, ValueError) as error:
        print(f"download menu rejected: {error}", file=sys.stderr)
        sys.exit(1)
