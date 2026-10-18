#!/usr/bin/env python3
"""Replay song selectors against reduced hierarchies from failed API 24/26 runs.

Old Android exposes mini-player child text (including clipped adjacent songs) to
UiAutomation. A bare title can therefore tap the mini-player rather than a list
row. Read the actual flow commands, not a second copy of their selectors.
"""
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FLOW_TITLES = {
    "play-three.yaml": ["E2E Tone A", "E2E Tone B", "E2E Tone C"],
    "hang-song.yaml": ["E2E Tone C"],
    "live-only.yaml": ["E2E Live Only"],
    "broken-song.yaml": ["E2E Broken"],
    "fallback-song.yaml": ["E2E Fallback"],
    "play-stats.yaml": ["E2E Tone A"],
    "offline-song.yaml": ["E2E Tone B"],
    "offline-replay.yaml": ["E2E Tone B"],
    "short-song.yaml": ["E2E Short"],
}


def selectors(text):
    # These flows use quoted scalar tapOn or tapOn's text field. Fail below if a
    # future command shape no longer supplies the required song-row selector.
    return [json.loads(match.group(1)) for match in re.finditer(
        r'^\s*(?:- tapOn:|text:)\s*("[^"\n]+")\s*$', text, re.M)]


def first_match(nodes, selector):
    return next((node for node in nodes if any(
        re.fullmatch(selector, node["attributes"].get(field, ""))
        for field in ("text", "accessibilityText"))), None)


def check(ref=None):
    commands = {}
    checks = 0
    for flow, titles in FLOW_TITLES.items():
        path = f"e2e/flows/{flow}"
        text = (subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"]).decode()
                if ref else (ROOT / path).read_text())
        commands[flow] = selectors(text)
        for title in titles:
            label = f"{title}, E2E Artist"
            assert label in commands[flow], f"{flow}: missing the list-row label {label!r}"
            assert title not in commands[flow], f"{flow}: ambiguous bare title {title!r}"
            checks += 1
    scenes = json.loads((ROOT / "e2e/fixtures/song-selector-hierarchies.json").read_text())
    for scene in scenes:
        title = scene["title"]
        old = first_match(scene["nodes"], title)
        assert old and old["ancestorLabels"], "recorded ambiguity is missing"
        assert old["attributes"]["important-for-accessibility"] == "false"
        actual = next(s for s in commands[scene["flow"]] if s.startswith(title))
        row = first_match(scene["nodes"], actual)
        assert row and row["attributes"]["class"] == "android.widget.Button"
        assert row["attributes"]["clickable"] == "true"
        assert row["attributes"]["accessibilityText"] == f"{title}, E2E Artist"
        assert row is not old
        checks += 1
    print(f"Song target regression checks: {checks} passed (two recorded failure hierarchies)")


if __name__ == "__main__":
    try:
        check(sys.argv[2] if len(sys.argv) == 3 and sys.argv[1] == "--flow-ref" else None)
    except (AssertionError, OSError, ValueError, KeyError, StopIteration) as error:
        print(f"Song target regression rejected: {error}", file=sys.stderr)
        sys.exit(1)
