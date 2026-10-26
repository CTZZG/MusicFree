#!/usr/bin/env python3
"""Host boundary checks only, never substitutes for native injected touches."""
from contextlib import redirect_stdout
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("probe_inspect", Path(__file__).with_name("inspect.py"))
impl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(impl)


class Checks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.xml(self.root / "before.xml", "E2E Tone B")

    def xml(self, path, title):
        path.write_text(f'<hierarchy><node package="fun.upup.musicfree" enabled="true" clickable="true" content-desc="歌曲: {title} 歌手: E2E Artist" bounds="[32,1981][776,2138]"/></hierarchy>')

    def points(self):
        return [dict(action=0, time=0, x=100, y=200, accepted=True)] + [
            dict(action=2, time=i * 16, x=100 + i * 10 if i <= 30 else 400, y=200, accepted=True)
            for i in range(1, 81)] + [dict(action=1, time=1296, x=400, y=200, accepted=True)]

    def prepare(self, points=None, code=-1, velocity=0):
        for edge, title, state in [("before", "E2E Tone B", "PAUSED"), ("after", "E2E Tone C", "PLAYING")]:
            (self.root / f"gesture-right-{edge}.json").write_text(json.dumps(dict(title=title, state=state)))
            self.xml(self.root / f"gesture-right-{edge}.xml", title)
        (self.root / "gesture-right-instrumentation.txt").write_text(
            f'INSTRUMENTATION_RESULT: points={json.dumps(points if points is not None else self.points())}\n'
            f'INSTRUMENTATION_RESULT: injectedVelocityX={velocity}\nINSTRUMENTATION_CODE: {code}\n')

    def test_actual_bounds_choose_distance_and_short_controls(self):
        path = self.root / "before.xml"
        for kind, sign in [("right", 1), ("left", -1), ("short", 1)]:
            start, end, y = impl.coordinates(path, kind)
            self.assertGreater((end - start) * sign, 0)
            self.assertEqual(y, 2059)
            self.assertEqual(abs(end - start) > 744 * .3, kind != "short")

    def test_wrong_ui_or_clipped_node_rejected(self):
        path = self.root / "before.xml"
        self.xml(path, "E2E Tone C")
        with self.assertRaises(ValueError): impl.coordinates(path, "right")
        self.xml(path, "E2E Tone B")
        path.write_text(path.read_text().replace("[776,2138]", "[100,2138]"))
        with self.assertRaises(ValueError): impl.coordinates(path, "right")

    def test_wrong_direction_is_reported_as_observation(self):
        self.prepare()
        with redirect_stdout(io.StringIO()): impl.result(self.root, "right")
        report = json.loads((self.root / "gesture-right-result.json").read_text())
        self.assertFalse(report["matches"])
        self.assertEqual(report["observed"], "E2E Tone C")

    def test_incomplete_or_moving_injection_rejected(self):
        rejected = deepcopy(self.points()); rejected[30]["accepted"] = False
        no_hold = deepcopy(self.points())
        for p in no_hold: p["time"] //= 10
        for points, code, velocity in [(self.points()[:-1], -1, 0), (rejected, -1, 0),
                                        (no_hold, -1, 0), (self.points(), 0, 0),
                                        (self.points(), -1, 10), (self.points(), -1, float("nan"))]:
            self.prepare(points, code, velocity)
            with self.assertRaises(ValueError): impl.result(self.root, "right")


if __name__ == "__main__":
    unittest.main()
