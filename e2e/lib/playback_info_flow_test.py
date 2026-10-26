#!/usr/bin/env python3
"""Use the actual Beta217 full-player hierarchy to reject a mini-player selector."""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def check(ref=None):
    path = "e2e/flows/playback-info.yaml"
    source = (subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"]).decode()
              if ref else (ROOT / path).read_text())
    taps = [json.loads(v) for v in re.findall(r'^- tapOn: ("[^"\n]+")\s*$', source, re.M)]
    nodes = json.loads((ROOT / "e2e/fixtures/playback-info-entry-hierarchy.json").read_text())["nodes"]
    def match(label):
        return next((n["attributes"] for n in nodes if any(re.fullmatch(label, n["attributes"].get(k, ""))
                    for k in ("text", "accessibilityText"))), None)
    assert match("歌曲: E2E Tone C 歌手: E2E Artist") is None, "recorded full-player scene changed"
    entry = match(taps[0])
    assert entry and entry.get("clickable") == "true" and entry.get("enabled") == "true", "entry is not the real full-player control"
    assert taps[:2] == ["更多操作", "当前播放信息"], "must enter information through full-player menu"
    share = match(taps[-1])
    assert taps[-1] == "分享歌曲与歌词" and share and share.get("clickable") == "true", "must return through the real full-player share button"
    print("playback-info entry: 4 checks passed against recorded Beta217 hierarchy")


if __name__ == "__main__":
    try:
        check(sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--flow-ref" else None)
    except (AssertionError, OSError, KeyError, IndexError, ValueError) as error:
        print(f"playback-info entry rejected: {error}", file=sys.stderr)
        sys.exit(1)
