#!/usr/bin/env python3
"""Check required slow-file scenarios; no engine estimates or skipped prerequisites."""
import copy
import json
import math
import sys
from pathlib import Path


CASES = {
    "internalPauseWhileWaitingForTheFileKeepsBufferingAndThePauseAction": {
        "internal-loading": ({6}, "暂停"), "loaded-playing": None,
    },
    "theNotificationPauseDuringSlowLoadingSurvivesFileLoaded": {
        "notification-before-click": None, "notification-command": None,
        "user-paused-loading": ({2}, "播放"), "loaded-paused": None,
        "explicitly-resumed": None,
    },
    "aTemporaryFocusLossDuringLoadingReportsPauseAndCanResumeAfterFocusReturns": {
        "focus-paused-loading": ({2}, "播放"),
        "focus-resumed-loading": ({3, 6}, "暂停"), "loaded-playing": None,
    },
    "anExplicitPauseDuringTheInterruptionWinsAfterFocusReturnsAndTheFileLoads": {
        "user-paused-after-focus": ({2}, "播放"), "loaded-paused": None,
        "explicitly-resumed": None,
    },
}


def validate(rows):
    if {row["scenario"] for row in rows} != set(CASES):
        raise ValueError("missing or unexpected slow-loading scenario")
    for scenario, phases in CASES.items():
        selected = [row for row in rows if row["scenario"] == scenario]
        if {row["phase"] for row in selected} != set(phases):
            raise ValueError(f"{scenario}: missing or unexpected phase")
        for phase, expected in phases.items():
            samples = [row for row in selected if row["phase"] == phase]
            if expected is None:
                if len(samples) != 1:
                    raise ValueError(f"{phase}: expected exactly one checkpoint")
                row = samples[0]
                if phase.startswith("loaded-") or phase == "explicitly-resumed":
                    paused = phase == "loaded-paused"
                    if (row["enginePaused"] is not paused or row["loadingGeneration"] != -1
                            or row["sessionState"] != (2 if paused else 3)
                            or row["action"] != ("播放" if paused else "暂停")):
                        raise ValueError(f"{phase}: file completion/resume not proven")
                    raw, target = row["rawSeconds"], row["restoreTarget"]
                    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)
                               for x in (raw, target)):
                        raise ValueError(f"{phase}: missing real engine position")
                    if (paused and abs(raw - target) > 0.25) or (not paused and raw <= target + 0.25):
                        raise ValueError(f"{phase}: engine restoration/progress not proven")
                continue
            if len(samples) != 13 or samples[-1]["elapsedMs"] - samples[0]["elapsedMs"] < 1000:
                raise ValueError(f"{phase}: incomplete observation window")
            allowed, action = expected
            for row in samples:
                if (row["enginePaused"] is not True or row["loadingGeneration"] != 2
                        or row["sessionState"] not in allowed or row["action"] != action):
                    raise ValueError(f"{phase}: wrong engine, generation, session or action")
            if phase == "internal-loading" and any(
                    "paused" in row["jsStates"] or 2 in row["sessionStates"] for row in samples):
                raise ValueError("internal pause leaked to JS or media-session events")
        if "notification-command" in phases:
            checkpoint = next(row for row in selected if row["phase"] == "notification-command")
            if "pause" not in checkpoint["commands"] or "play" in checkpoint["commands"]:
                raise ValueError("notification toggle requested play instead of pause")
    return {scenario: len([row for row in rows if row["scenario"] == scenario]) for scenario in CASES}


def self_test():
    good = []
    for scenario, phases in CASES.items():
        for phase, expectation in phases.items():
            count = 1 if expectation is None else 13
            for i in range(count):
                row = dict(scenario=scenario, phase=phase, elapsedMs=i * 100,
                           enginePaused=True, loadingGeneration=2,
                           sessionState=next(iter(expectation[0])) if expectation else 2,
                           action=expectation[1] if expectation else "播放",
                           rawSeconds=30.0, restoreTarget=30.0,
                           jsStates=["buffering"], sessionStates=[6], commands=["pause"])
                if phase.startswith("loaded-") or phase == "explicitly-resumed":
                    paused = phase == "loaded-paused"
                    row.update(enginePaused=paused, loadingGeneration=-1,
                               sessionState=2 if paused else 3, action="播放" if paused else "暂停",
                               rawSeconds=30.0 if paused else 30.5)
                good.append(row)
    validate(good)
    bad = []
    for scenario in CASES:
        bad.append([row for row in good if row["scenario"] != scenario])
    for key, value in [("enginePaused", False), ("loadingGeneration", -1),
                       ("sessionState", 2), ("action", "播放"),
                       ("jsStates", ["buffering", "paused"]), ("sessionStates", [6, 2])]:
        rows = copy.deepcopy(good)
        rows[0][key] = value
        bad.append(rows)
    rows = copy.deepcopy(good)
    next(row for row in rows if row["phase"] == "notification-command")["commands"] = ["play"]
    bad.append(rows)
    for value in [None, 30.0]:
        rows = copy.deepcopy(good)
        next(row for row in rows if row["phase"] == "loaded-playing")["rawSeconds"] = value
        bad.append(rows)
    bad.append(good[1:])
    rows = copy.deepcopy(good)
    next(row for row in rows if row["phase"] == "loaded-playing")["enginePaused"] = True
    bad.append(rows)
    rows = copy.deepcopy(good)
    next(row for row in rows if row["phase"] == "explicitly-resumed")["loadingGeneration"] = 2
    bad.append(rows)
    for phase, state in [("loaded-playing", 6), ("explicitly-resumed", 6), ("loaded-paused", 3)]:
        rows = copy.deepcopy(good)
        next(row for row in rows if row["phase"] == phase)["sessionState"] = state
        bad.append(rows)
    rows = copy.deepcopy(good)
    for row in rows:
        row["elapsedMs"] //= 10
    bad.append(rows)
    for rows in bad:
        try:
            validate(rows)
        except (ValueError, KeyError):
            continue
        raise AssertionError("bad slow-loading evidence accepted")
    print(f"Slow quality evidence self-test: {1 + len(bad)} checks passed")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        self_test()
    else:
        try:
            print(json.dumps(validate([json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()])))
        except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
            print(f"Slow quality evidence rejected: {error}", file=sys.stderr)
            sys.exit(1)
