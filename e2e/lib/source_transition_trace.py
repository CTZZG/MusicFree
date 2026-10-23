#!/usr/bin/env python3
"""Print source-replacement evidence to the job log; never decides pass/fail.

The checks that do decide (check-seek-clock.py, js_flow_evidence.py, the
instrumented assertions) keep their rules. This only makes the numbers behind
them readable without downloading the results artifact:

  seek-clock <audiotrack-seek-clock.jsonl>
      Per JNI replacement case: where the new file's raw clock starts relative
      to the restore target, its lowest point, and how fast it advances over
      the first second (1.00 = real time; above 1 means the clock is catching
      up rather than audio repeating).
  transition <logcat.txt>
      The native "source replacement" lines (position captured when the old
      source stopped, and the JS fallback) and the Real-JS 50 ms transition
      polls, compacted to one line each.
"""
import json
import math
import re
import sys
from pathlib import Path


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def first_second_rate(samples):
    """Raw clock advance per second of wall time over the first ~1 s of samples."""
    usable = [s for s in samples if number(s.get("raw")) and number(s.get("elapsedMs"))]
    if len(usable) < 2:
        return None
    start = usable[0]
    window = [s for s in usable if s["elapsedMs"] - start["elapsedMs"] <= 1000]
    end = window[-1]
    span = (end["elapsedMs"] - start["elapsedMs"]) / 1000
    if span <= 0:
        return None
    return (end["raw"] - start["raw"]) / span


def seek_clock_lines(rows):
    lines = []
    for row in rows:
        target = row.get("target")
        samples = row.get("samples") or []
        raws = [s["raw"] for s in samples if number(s.get("raw"))]
        if not number(target) or not raws:
            lines.append(f"case {row.get('case')}: no usable samples")
            continue
        rate = first_second_rate(samples)
        lines.append(
            f"case {row.get('case')}: target={target:.3f} first={raws[0] - target:+.3f} "
            f"min={min(raws) - target:+.3f} rate1s={'n/a' if rate is None else f'{rate:.2f}'} "
            f"samples={len(raws)}"
        )
    return lines


POLL = re.compile(r"E2ETransitionPoll\s*:\s*(\{.*\})\s*$")
REPLACEMENT = re.compile(r"(source replacement\[\d+\]: .*)$")
TIME = re.compile(r"^\d\d-\d\d (\d\d:\d\d:\d\d\.\d+)")


def transition_lines(text):
    lines = []
    for raw in text.splitlines():
        stamp = TIME.match(raw)
        when = stamp.group(1) if stamp else "?"
        replacement = REPLACEMENT.search(raw)
        if replacement:
            lines.append(f"{when} native {replacement.group(1)}")
            continue
        poll = POLL.search(raw)
        if not poll:
            continue
        try:
            row = json.loads(poll.group(1))
        except json.JSONDecodeError:
            continue
        position = row.get("rawSeconds")
        position = f"{position:.3f}" if number(position) else "null"
        lines.append(
            f"{when} poll t={row.get('elapsedMs')} {row.get('source')} raw={position} "
            f"idle={row.get('idle')} buffering={row.get('buffering')} "
            f"seeking={row.get('seekingBefore')}/{row.get('seekingAfter')}"
        )
    return lines


def self_test():
    samples = [{"elapsedMs": 1000 + n * 100, "raw": 89.9 + n * 0.15} for n in range(13)]
    [line] = seek_clock_lines([{"case": 1, "target": 90.0, "samples": samples}])
    assert "first=-0.100" in line and "min=-0.100" in line and "rate1s=1.50" in line, line
    assert seek_clock_lines([{"case": 2, "target": 90.0, "samples": []}]) == ["case 2: no usable samples"]
    log = "\n".join([
        "10-23 02:19:50.100  1  2 D MpvPlayerModule: source replacement[7]: stopped=73.6 fallback=73.4",
        '10-23 02:19:50.150  1  3 I E2ETransitionPoll: {"elapsedMs":10,"rawSeconds":73.39,"source":"new",'
        '"idle":false,"buffering":false,"seekingBefore":false,"seekingAfter":false}',
        "10-23 02:19:50.200  1  3 I E2ETransitionPoll: {not json",
        "10-23 02:19:50.300  1  4 I Other: ignored",
    ])
    out = transition_lines(log)
    assert out == [
        "02:19:50.100 native source replacement[7]: stopped=73.6 fallback=73.4",
        "02:19:50.150 poll t=10 new raw=73.390 idle=False buffering=False seeking=False/False",
    ], out
    print("source_transition_trace self-test passed")


def main(argv):
    if argv == ["--self-test"]:
        self_test()
        return
    if len(argv) != 2 or argv[0] not in ("seek-clock", "transition"):
        raise SystemExit("usage: source_transition_trace.py seek-clock|transition <file> | --self-test")
    path = Path(argv[1])
    if not path.is_file():
        print(f"source transition trace: {path} missing")
        return
    if argv[0] == "seek-clock":
        rows = []
        for line in path.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        lines = seek_clock_lines(rows)
        title = "AudioTrack replacement clock (relative to restore target)"
    else:
        lines = transition_lines(path.read_text(errors="replace"))
        title = "Quality source replacement (native capture and Real-JS polls)"
    print(f"== {title}: {len(lines)} lines")
    for line in lines:
        print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
