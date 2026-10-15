#!/usr/bin/env python3
"""Actual React buffering-button taps with a controlled native buffering event, not a network outage."""
import copy
import json
import math
import sys
from pathlib import Path

PHASES = ("page-paused", "page-resumed", "mini-paused", "mini-resumed")


def validate(rows):
    if len(rows) != 20 or [r["phase"] for r in rows] != [p for p in PHASES for _ in range(5)]:
        raise ValueError("require all four UI windows, five readings each")
    for a, b in zip(rows, rows[1:]):
        if b["elapsedMs"] <= a["elapsedMs"]:
            raise ValueError("UI sample times must increase")
    for phase in PHASES:
        window = [r for r in rows if r["phase"] == phase]
        paused = phase.endswith("paused")
        if window[-1]["elapsedMs"] - window[0]["elapsedMs"] < 4000:
            raise ValueError("UI pause/resume observation window too short")
        for a, b in zip(window, window[1:]):
            if not 750 <= b["elapsedMs"] - a["elapsedMs"] <= 5000:
                raise ValueError("invalid UI polling gap")
        for r in window:
            if type(r["rawSeconds"]) not in (int, float) or not math.isfinite(r["rawSeconds"]) or r["rawSeconds"] < 0:
                raise ValueError("missing real engine position")
            if type(r["sessionMs"]) is not int or r["sessionMs"] < 0:
                raise ValueError("missing media-session position")
            if (r["paused"] is not paused or r["nativeHold"] is not paused or
                    r["sessionState"] != (2 if paused else 3) or r["sameTrack"] is not True or
                    r["foregroundPackage"] != "fun.upup.musicfree" or r["bufferingEventInjected"] is not True):
                raise ValueError("UI/engine/intent evidence mismatch")
        raw = [r["rawSeconds"] for r in window]
        session = [r["sessionMs"] for r in window]
        if paused:
            if max(raw) - min(raw) > 0.1 or max(session) - min(session) > 100:
                raise ValueError("explicit UI pause was overwritten")
        elif raw[-1] - raw[0] < 2.5 or session[-1] - session[0] < 2500:
            raise ValueError("UI play did not resume the real engine")
        elif any(b - a < 0.2 for a, b in zip(raw, raw[1:])):
            raise ValueError("UI play stalled or rewound between samples")
    for paused_phase, resumed_phase in (("page-paused", "page-resumed"), ("mini-paused", "mini-resumed")):
        old = next(r for r in reversed(rows) if r["phase"] == paused_phase)
        new = next(r for r in rows if r["phase"] == resumed_phase)
        if new["rawSeconds"] < old["rawSeconds"] - 0.25:
            raise ValueError("UI play restarted instead of resuming")
    return {phase: 5 for phase in PHASES}


def self_test():
    rows = []
    for block, phase in enumerate(PHASES):
        paused = phase.endswith("paused")
        for n in range(5):
            position = (10 if block < 2 else 16) + (0 if paused else 0.4 + 1.1 * n)
            rows.append(dict(phase=phase, elapsedMs=block * 10_000 + n * 1100,
                             rawSeconds=position, sessionMs=round(position * 1000), paused=paused,
                             nativeHold=paused, sessionState=2 if paused else 3, sameTrack=True,
                             foregroundPackage="fun.upup.musicfree", bufferingEventInjected=True))
    assert validate(rows) == dict.fromkeys(PHASES, 5)
    bad = [rows[:-1], rows[5:], list(reversed(rows))]
    for key, value in (("rawSeconds", None), ("rawSeconds", True), ("sessionMs", None),
                       ("paused", False), ("nativeHold", False),
                       ("sameTrack", False), ("sessionState", 3), ("foregroundPackage", "other"),
                       ("bufferingEventInjected", False)):
        altered = copy.deepcopy(rows); altered[0][key] = value; bad.append(altered)
    altered = copy.deepcopy(rows); altered[4]["rawSeconds"] += 0.5; bad.append(altered)
    altered = copy.deepcopy(rows)
    for r in altered[5:10]:
        r["rawSeconds"] = 20; r["sessionMs"] = 20_000
    bad.append(altered)
    altered = copy.deepcopy(rows); altered[1]["elapsedMs"] = 400; bad.append(altered)
    for candidate in bad:
        try:
            validate(candidate)
        except (ValueError, KeyError):
            continue
        raise AssertionError("bad spinner evidence accepted")
    print(f"Loading spinner evidence self-test passed: {len(bad) + 1} checks")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        else:
            print(json.dumps(validate([json.loads(l) for l in Path(sys.argv[1]).read_text().splitlines()])))
    except (ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Loading spinner evidence rejected: {error}", file=sys.stderr)
        sys.exit(1)
