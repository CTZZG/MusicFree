#!/usr/bin/env python3
"""Independently recompute the six bundled-AudioTrack replacement windows."""
import copy
import json
import math
from pathlib import Path
import sys

FIXTURE = "416b824e4a3ca8e25ffb9ae46c2fcdb99442fb15e6040fdd7ccfa116857297f4"
TARGETS = [90.66106863696946, 120.85412625996968]


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate(rows):
    if len(rows) != 6 or [r.get("case") for r in rows] != list(range(1, 7)):
        raise ValueError("INCOMPLETE: expected six distinct ordered replacements")
    for row in rows:
        if row.get("phase") != "audiotrack-seek-clock" or row.get("fixtureSha256") != FIXTURE:
            raise ValueError("FIXTURE: missing or unexpected source evidence")
        if row.get("ao") != "audiotrack":
            raise ValueError("BACKEND: test did not use AudioTrack")
        target = row.get("target")
        nominal = TARGETS[(row["case"] - 1) // 3]
        if not number(target) or target < nominal or row.get("nominalTarget") != nominal:
            raise ValueError("TARGET: old source did not reach the intended position")
        samples = row.get("samples", [])
        if len(samples) < 10:
            raise ValueError("INCOMPLETE: fewer than ten raw samples")
        started = row.get("startedAtMs")
        if not number(started):
            raise ValueError("CLOCK: missing resume request time")
        positions, times = [], []
        for sample in samples:
            if not number(sample.get("raw")) or not number(sample.get("elapsedMs")) or sample.get("seeking") is not False:
                raise ValueError("RAW: unavailable or seeking sample")
            if not row.get("newPath") or sample.get("path") != row["newPath"]:
                raise ValueError("PATH: sample is not from the replacement file")
            positions.append(sample["raw"])
            times.append(sample["elapsedMs"])
        gaps = [b - a for a, b in zip(times, times[1:])]
        if times[-1] - times[0] < 1000 or any(gap <= 0 or gap > 250 for gap in gaps):
            raise ValueError("WINDOW: insufficient duration or observation gap over 250ms")
        if row.get("maxGapMs") != max(gaps) or not number(row.get("minimum")) or abs(row["minimum"] - min(positions)) > 1e-9:
            raise ValueError("SUMMARY: reported bounds differ from raw samples")
        if min(positions) < target - .25:
            raise ValueError("SOURCE_REWIND: raw clock precedes the restore target by over 0.25s")
        if any(t < started or p > target + (t - started) / 1000 + .25 for t, p in zip(times, positions)):
            raise ValueError("CLOCK_FUTURE: raw clock advanced faster than elapsed playback time")
        if positions[-1] < positions[0] + .25:
            raise ValueError("PROGRESS: restored source did not advance")
    return {"cases": len(rows), "samples": sum(len(r["samples"]) for r in rows),
            "worstDelta": min(r["minimum"] - r["target"] for r in rows),
            "maxGapMs": max(r["maxGapMs"] for r in rows)}


def self_test():
    rows = []
    for case in range(1, 7):
        target = TARGETS[(case - 1) // 3]
        path = f"/data/user/0/test/next-{case}.mp3"
        samples = [{"elapsedMs": 1000 + n * 100, "raw": target + n * .1,
                    "seeking": False, "path": path} for n in range(13)]
        rows.append({"phase": "audiotrack-seek-clock", "case": case, "target": target,
                     "nominalTarget": target, "fixtureSha256": FIXTURE, "ao": "audiotrack",
                     "newPath": path, "minimum": target, "maxGapMs": 100, "samples": samples, "startedAtMs": 1000})
    validate(rows)

    def rejects(mutator, reason):
        changed = copy.deepcopy(rows)
        mutator(changed)
        try:
            validate(changed)
        except ValueError as error:
            assert str(error).startswith(reason), error
        else:
            raise AssertionError(f"accepted {reason}")

    rejects(lambda r: r.pop(), "INCOMPLETE")
    rejects(lambda r: r[1].update(case=1), "INCOMPLETE")
    rejects(lambda r: r[0].update(ao="null"), "BACKEND")
    rejects(lambda r: r[0].update(fixtureSha256="incorrect"), "FIXTURE")
    rejects(lambda r: r[0].update(target=0), "TARGET")
    rejects(lambda r: r[0].update(samples=[]), "INCOMPLETE")
    rejects(lambda r: r[0]["samples"][0].update(raw=None), "RAW")
    rejects(lambda r: r[0]["samples"][0].update(seeking=True), "RAW")
    rejects(lambda r: r[0]["samples"][0].update(path="/old.mp3"), "PATH")
    rejects(lambda r: r[0]["samples"][2].update(elapsedMs=1400), "WINDOW")
    rejects(lambda r: r[0]["samples"][1].update(elapsedMs=1000), "WINDOW")
    rejects(lambda r: r[0].update(minimum=r[0]["target"] + .5), "SUMMARY")
    rejects(lambda r: r[0].update(maxGapMs=50), "SUMMARY")

    def rewind(r):
        r[0]["samples"][0]["raw"] -= .36
        r[0]["minimum"] -= .36
    rejects(rewind, "SOURCE_REWIND")

    def stalled(r):
        for sample in r[0]["samples"]:
            sample["raw"] = r[0]["target"]
    rejects(stalled, "PROGRESS")

    boundary = copy.deepcopy(rows)
    boundary[0]["samples"][0]["raw"] -= .25
    boundary[0]["minimum"] -= .25
    validate(boundary)
    boundary = copy.deepcopy(rows)
    for index, sample in enumerate(boundary[0]["samples"]):
        sample["elapsedMs"] = 1000 + index * 250
    boundary[0]["maxGapMs"] = 250
    validate(boundary)
    rejects(lambda r: r[0].update(samples=r[0]["samples"][:10]), "WINDOW")

    def just_over(r):
        r[0]["samples"][0]["raw"] -= .250001
        r[0]["minimum"] -= .250001
    rejects(just_over, "SOURCE_REWIND")

    def future(r):
        for sample in r[0]["samples"]:
            sample["raw"] += 1
        r[0]["minimum"] += 1
    rejects(future, "CLOCK_FUTURE")
    print("AudioTrack raw evidence self-test: 21 checks passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        print(json.dumps(validate([json.loads(s) for s in Path(sys.argv[1]).read_text().splitlines()])))
