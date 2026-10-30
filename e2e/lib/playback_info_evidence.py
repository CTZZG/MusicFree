#!/usr/bin/env python3
"""Check real module/JNI snapshots exported by the audio-information instrument."""
import json
import math
from pathlib import Path
import re
import sys


def validate(rows):
    phases = {r["phase"]: r for r in rows}
    if len(phases) != 5 or len(rows) != 5 or set(phases) != {"unloaded", "paused", "before-replacement", "during-replacement", "after-replacement"}:
        raise ValueError("incomplete audio-info snapshots")
    if phases["unloaded"]["info"] is not None or phases["unloaded"]["initialized"] is not False:
        raise ValueError("query initialized a player")
    expected = {"paused": ("mono", 11, 22050, 1), "before-replacement": ("first", 21, 22050, 1),
                "during-replacement": ("second", 22, 48000, 2), "after-replacement": ("second", 22, 48000, 2)}
    for phase, (media, generation, rate, channels) in expected.items():
        info = phases[phase]["info"]
        if phase == "during-replacement" and info is None:
            continue
        if (not isinstance(info, dict) or set(info) != {"mediaId", "loadGeneration", "codec", "sampleRate", "channelCount", "bitrate"} or
                info["mediaId"] != media or info["loadGeneration"] != generation or
                info["sampleRate"] != rate or info["channelCount"] != channels or
                not isinstance(info["codec"], str) or not re.fullmatch(r"[A-Za-z0-9_.+ -]{1,64}", info["codec"]) or
                "pcm" not in info["codec"].lower()):
            raise ValueError("wrong decoder/identity or private fields exported")
        value = info["bitrate"]
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 1_000_000_000):
            raise ValueError("invalid bitrate")
    paused = phases["paused"]
    positions = [paused["positionBefore"], paused["positionAfter"]]
    if (any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in positions) or
            paused["enginePaused"] is not True or abs(positions[0] - positions[1]) > .001):
        raise ValueError("query moved or unpaused the engine")
    return {"snapshots": len(rows), "realJniGenerations": 3, "pausePreserved": True}


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        import copy
        import unittest

        class Checks(unittest.TestCase):
            def setUp(self):
                def info(media, generation, rate, channels):
                    return dict(mediaId=media, loadGeneration=generation, codec="pcm_s16le", sampleRate=rate, channelCount=channels, bitrate=None)
                self.rows = [dict(phase="unloaded", info=None, initialized=False),
                             dict(phase="paused", info=info("mono", 11, 22050, 1), positionBefore=0, positionAfter=0, enginePaused=True),
                             dict(phase="before-replacement", info=info("first", 21, 22050, 1)),
                             dict(phase="during-replacement", info=None),
                             dict(phase="after-replacement", info=info("second", 22, 48000, 2))]

            def test_complete(self):
                validate(self.rows)

            def test_missing_and_bad_identity(self):
                for field, value in [("loadGeneration", 21), ("sampleRate", 22050), ("mediaId", "first"), ("url", "https://private"), ("codec", None)]:
                    rows = copy.deepcopy(self.rows); rows[-1]["info"][field] = value
                    with self.subTest(field=field), self.assertRaises(ValueError): validate(rows)
                with self.assertRaises(ValueError): validate(self.rows[:-1])

            def test_query_side_effects(self):
                for field, value in [("enginePaused", False), ("positionAfter", 1), ("positionBefore", float('nan')), ("positionAfter", None)]:
                    rows = copy.deepcopy(self.rows); rows[1][field] = value
                    with self.assertRaises(ValueError): validate(rows)

        unittest.main(argv=[sys.argv[0]])
    else:
        print(json.dumps(validate([json.loads(l) for l in Path(sys.argv[1]).read_text().splitlines()])))
