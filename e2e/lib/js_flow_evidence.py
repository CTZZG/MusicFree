#!/usr/bin/env python3
"""Validate real-JS API36 evidence; raw JNI clocks, not notification projections."""
import copy
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

PAUSED = {
    "slow-skip-wait", "timeout-wait", "quality-interrupted-old", "quality-interrupted-new",
    "user-pause-old", "user-pause-new", "user-pause-after-focus",
}
PLAYING = {"baseline", "slow-skip-playing", "timeout-rollback", "quality-focus-resumed", "explicit-play"}
HELD = {"quality-interrupted-old", "quality-interrupted-new", "user-pause-old", "user-pause-new"}
ANCHORED = {"timeout-rollback", "quality-interrupted-new", "user-pause-new"}
RESUMES = {
    "quality-focus-resumed": "quality-interrupted-new",
    "explicit-play": "user-pause-after-focus",
}
CLASS = "fun.upup.musicfree.mpvplayer.RealJsEngineProgressTest"
METHOD = "realJsFlowsPreserveEngineAndPauseIntent"
FOCUS = "fun.upup.musicfree.e2e.focus"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_samples(rows, control=False):
    groups = defaultdict(list)
    for row in rows:
        groups[row["phase"]].append(row)
    expected = {"baseline"} if control else PLAYING | PAUSED
    require(set(groups) == expected, f"PHASES: got {set(groups)}, expected {expected}")
    for phase, samples in groups.items():
        require(len(samples) == 5, f"{phase}: require five samples")
        for row in samples:
            require(row["sameTrack"] is True and row["sameTitle"] is True, f"{phase}: wrong track/title")
            require(row["idle"] is False and row["buffering"] is False, f"{phase}: idle/buffering")
            require(isinstance(row["rawSeconds"], (int, float)) and not isinstance(row["rawSeconds"], bool)
                    and math.isfinite(row["rawSeconds"]) and row["rawSeconds"] >= 0, f"{phase}: missing/invalid raw read")
            if phase in HELD:
                require(row["focusOwner"] == FOCUS, f"{phase}: focus taken from helper")
                require(row["foregroundPackage"] == "fun.upup.musicfree", f"{phase}: foreground fixture suspended")
        span = samples[-1]["elapsedMs"] - samples[0]["elapsedMs"]
        require(span >= 4000, f"{phase}: insufficient window")
        if phase in ANCHORED:
            anchor = samples[0]["resumeAnchor"]
            require(isinstance(anchor, (int, float)) and not isinstance(anchor, bool)
                    and math.isfinite(anchor) and anchor >= 3, f"{phase}: missing/nonzero resume anchor")
            require(all(s["resumeAnchor"] == anchor for s in samples), f"{phase}: inconsistent resume anchor")
            require(abs(samples[0]["rawSeconds"] - anchor) <= 2, f"{phase}: resume jumped/reset")
        for a, b in zip(samples, samples[1:]):
            gap = (b["elapsedMs"] - a["elapsedMs"]) / 1000
            require(.75 <= gap <= 5, f"{phase}: invalid interval")
            if phase in PLAYING and not control:
                require(gap*.25 <= b["rawSeconds"] - a["rawSeconds"] <= gap*1.75+.25, f"{phase}: raw stalled/jumped")
                require(b["sessionMs"] - a["sessionMs"] >= gap*250, f"{phase}: session stalled")
        if phase in PAUSED or control:
            require(all(s["paused"] is True for s in samples), f"{phase}: engine unpaused")
            require(max(s["rawSeconds"] for s in samples)-min(s["rawSeconds"] for s in samples) <= .15, f"{phase}: engine moved while paused")
            if control:
                require(all(s["sessionState"] == 3 for s in samples), "control: projection must claim PLAYING")
                require(samples[-1]["sessionMs"] - samples[0]["sessionMs"] >= 2500, "control: projection must really move")
            else:
                require(all(s["sessionState"] == 2 for s in samples), f"{phase}: session not paused")
                require(max(s["sessionMs"] for s in samples)-min(s["sessionMs"] for s in samples) <= 250, f"{phase}: paused session moved")
        else:
            require(all(s["paused"] is False and s["sessionState"] == 3 for s in samples), f"{phase}: wrong playing state")
        if not control:
            require(all(abs(s["rawSeconds"] - s["sessionMs"]/1000) <= 1.5 for s in samples), f"{phase}: projection drift")
    if not control:
        for resumed, paused in RESUMES.items():
            advance = groups[resumed][0]["rawSeconds"] - groups[paused][-1]["rawSeconds"]
            require(-.15 <= advance <= 2, f"{resumed}: resume reset/jumped from paused source")
    return {phase: len(samples) for phase, samples in groups.items()}


def instrumentation_result(text, control=False):
    fields, completed = {}, []
    for line in text.splitlines():
        if line.startswith("INSTRUMENTATION_STATUS: "):
            key, sep, value = line.removeprefix("INSTRUMENTATION_STATUS: ").partition("=")
            if sep:
                fields[key] = value
        elif line.startswith("INSTRUMENTATION_STATUS_CODE: "):
            code = int(line.split(":", 1)[1])
            if code <= 0 and "class" in fields and "test" in fields:
                completed.append((fields["class"], fields["test"], code))
            fields = {}
    require(set(re.findall(r"^INSTRUMENTATION_STATUS: numtests=(\d+)", text, re.M)) == {"1"}, "require exactly one selected test")
    require(completed == [(CLASS, METHOD, -2 if control else 0)], f"missing/skipped/failed test: {completed}")
    require(re.search(r"^INSTRUMENTATION_CODE: -1\s*$", text, re.M), "instrumentation did not complete")
    if control:
        require(re.search(r"^INSTRUMENTATION_STATUS: stack=java\.lang\.AssertionError: RAW_STALLED:", text, re.M),
                "control must reject raw stall, not fail setup or another assertion")
        require("MultipleFailureException" not in text, "control cleanup also failed")
    return {"passed": True, "control": control, "completed": completed}


def source_events(text):
    events = {}
    for line in text.splitlines():
        if "E2E_JS_FLOW " not in line:
            continue
        # Console/dev-log output can duplicate the same event; do not inflate counts.
        row, _ = json.JSONDecoder().raw_decode(line.split("E2E_JS_FLOW ", 1)[1])
        events[(row["requestId"], row["event"])] = row
    begins = {r["requestId"]: r for r in events.values() if r["event"] == "begin"}
    resolved = [r for r in events.values() if r["event"] == "resolved"]
    require({("b", "192k"), ("c", "192k"), ("c", "320k"), ("hang", "192k")} <= {(r["id"], r["quality"]) for r in begins.values()}, "required real plugin requests absent")
    for row in resolved:
        begin = begins[row["requestId"]]
        require((row["id"], row["quality"]) == (begin["id"], begin["quality"]), "source request mismatch")
        require(row["id"] != "hang", "Hang unexpectedly returned an address")
        if row["id"] == "c":
            require(row["wallMs"] - begin["wallMs"] >= 11500, "slow fixture did not actually wait")
    require({("c", "192k"), ("c", "320k")} <= {(r["id"], r["quality"]) for r in resolved}, "quality sources did not complete")
    return {"begin": len(begins), "resolved": len(resolved)}


def self_test():
    rows = []
    for phase in sorted(PLAYING | PAUSED):
        for n in range(5):
            paused = phase in PAUSED
            rows.append({"phase": phase, "elapsedMs": n*1100, "rawSeconds": 12 if paused else 12+n*1.1,
                         "paused": paused, "idle": False, "buffering": False, "sessionMs": 12000 if paused else 12000+n*1100,
                         "sessionState": 2 if paused else 3, "sameTrack": True, "sameTitle": True,
                         "focusOwner": FOCUS if phase in HELD else None, "foregroundPackage": "fun.upup.musicfree",
                         "resumeAnchor": 12 if phase in ANCHORED else None})
    validate_samples(rows)
    checks = 1
    def rejects(value):
        nonlocal checks
        try:
            validate_samples(value)
        except (ValueError, KeyError, TypeError):
            checks += 1
            return
        raise AssertionError("bad evidence accepted")
    for phase in PLAYING | PAUSED:
        rejects([r for r in rows if r["phase"] != phase])
        altered = copy.deepcopy(rows)
        selected = [r for r in altered if r["phase"] == phase]
        if phase in PLAYING:
            for r in selected: r["rawSeconds"] = 12
        else:
            selected[2]["rawSeconds"] = 13
        rejects(altered)
    for phase in HELD:
        altered = copy.deepcopy(rows)
        next(r for r in altered if r["phase"] == phase)["focusOwner"] = "music"
        rejects(altered)
        altered = copy.deepcopy(rows)
        next(r for r in altered if r["phase"] == phase)["foregroundPackage"] = FOCUS
        rejects(altered)
    for phase in ANCHORED:
        for anchor in [None, 0, 30]:
            altered = copy.deepcopy(rows)
            for row in altered:
                if row["phase"] == phase: row["resumeAnchor"] = anchor
            rejects(altered)
    # These windows still move normally and match the media session after a reset/jump.
    # Only comparing to the preceding paused source catches the lost resume position.
    for phase in RESUMES:
        for start in [0, 30]:
            altered = copy.deepcopy(rows)
            for n, row in enumerate(r for r in altered if r["phase"] == phase):
                row["rawSeconds"] = start+n*1.1
                row["sessionMs"] = (start+n*1.1)*1000
            rejects(altered)
    for field, value in [("sameTrack", False), ("sameTitle", False), ("rawSeconds", None), ("rawSeconds", float("nan")), ("idle", True), ("buffering", True)]:
        altered = copy.deepcopy(rows); altered[0][field] = value; rejects(altered)
    normal = f"INSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS: class={CLASS}\nINSTRUMENTATION_STATUS: test={METHOD}\nINSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_CODE: -1\n"
    instrumentation_result(normal)
    for bad in [normal.replace("CODE: 0", "CODE: -3"), normal.replace("numtests=1", "numtests=0"), normal.replace("INSTRUMENTATION_CODE: -1", ""), normal.replace(METHOD, "other")]:
        try: instrumentation_result(bad)
        except ValueError: checks += 1
        else: raise AssertionError("bad instrumentation accepted")
    control = [dict(r, paused=True, rawSeconds=12) for r in rows if r["phase"] == "baseline"]
    validate_samples(control, True)
    stalled = normal.replace("INSTRUMENTATION_STATUS_CODE: 0", "INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: RAW_STALLED: frozen\nINSTRUMENTATION_STATUS_CODE: -2")
    instrumentation_result(stalled, True)
    for bad in [normal.replace("CODE: 0", "CODE: -2") + "setup failed",
                normal.replace("CODE: 0", "CODE: -3") + "RAW_STALLED:",
                stalled.replace("stack=java.lang.AssertionError: RAW_STALLED:", "stack=org.junit.internal.runners.model.MultipleFailureException: RAW_STALLED:"),
                stalled + "MultipleFailureException: cleanup also failed",
                normal.replace("CODE: 0", "CODE: -2") + "unrelated log mentions RAW_STALLED:"]:
        try: instrumentation_result(bad, True)
        except ValueError: checks += 1
        else: raise AssertionError("control accepted a setup failure/skip")
    events = [
        {"event": "begin", "id": "b", "quality": "192k", "requestId": 1, "wallMs": 0},
        {"event": "begin", "id": "c", "quality": "192k", "requestId": 2, "wallMs": 0},
        {"event": "resolved", "id": "c", "quality": "192k", "requestId": 2, "wallMs": 12000},
        {"event": "begin", "id": "c", "quality": "320k", "requestId": 3, "wallMs": 0},
        {"event": "resolved", "id": "c", "quality": "320k", "requestId": 3, "wallMs": 12000},
        {"event": "begin", "id": "hang", "quality": "192k", "requestId": 4, "wallMs": 0},
    ]
    def trace(items): return "\n".join("E2E_JS_FLOW " + json.dumps(x) for x in items)
    source_events(trace(events) + "\n" + trace(events))
    altered = copy.deepcopy(events); altered[2]["wallMs"] = 100
    for bad in [altered, events[:-1], events + [dict(events[-1], event="resolved")], events[:3]]:
        try: source_events(trace(bad))
        except ValueError: checks += 1
        else: raise AssertionError("bad source timing accepted")
    print(f"Real-JS evidence self-test passed: {checks} checks")


if __name__ == "__main__":
    try:
        command = sys.argv[1]
        if command == "--self-test":
            self_test()
        else:
            text = Path(sys.argv[2]).read_text()
            control = "--control" in sys.argv[3:]
            if command == "samples":
                rows = [json.loads(line) for line in text.splitlines()]
                result = validate_samples(rows, control)
                # Keep the validated raw evidence reviewable when artifact storage is unreachable.
                for row in rows:
                    print("REAL_JS_SAMPLE " + json.dumps(dict(row, control=control), ensure_ascii=False))
            elif command == "instrumentation": result = instrumentation_result(text, control)
            elif command == "sources": result = source_events(text)
            else: raise ValueError(f"unknown command: {command}")
            print(json.dumps(result, ensure_ascii=False))
    except (ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Real-JS evidence rejected: {error}", file=sys.stderr)
        sys.exit(1)
