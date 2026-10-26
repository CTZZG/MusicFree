#!/usr/bin/env python3
"""The rotation request alone cannot establish that a real landscape image exists."""
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
import struct
import sys


def landscape_png(data):
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("not a PNG screenshot")
    width, height = struct.unpack(">II", data[16:24])
    if not 0 < height < width:
        raise ValueError("recorded page did not rotate to landscape")
    return dict(width=width, height=height)


def check(directory):
    root = Path(directory)
    files = list((root / "screens").glob("player-landscape-page.png"))
    if len(files) != 1:
        raise ValueError("expected one actual landscape page screenshot")
    result = landscape_png(files[0].read_bytes())
    result["animationScales"] = animation_evidence(root)
    (root / "player-landscape-image.json").write_text(json.dumps(result))
    print(json.dumps(result))


def animation_evidence(root):
    result = {}
    keys = {"window_animation_scale", "transition_animation_scale", "animator_duration_scale"}
    for phase, expected in (("default", 1), ("landscape", 1), ("reduced", 0)):
        result[phase] = {}
        for edge in ("before", "after"):
            lines = (root / f"player-{phase}-animation-{edge}.txt").read_text().splitlines()
            values = dict(line.split("=", 1) for line in lines)
            if len(lines) != 3 or set(values) != keys or any(Decimal(v) != expected for v in values.values()):
                raise ValueError(f"{phase}/{edge}: expected all three animation scales at {expected}x")
            result[phase][edge] = values
    return result


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        import unittest
        class Checks(unittest.TestCase):
            def image(self, w, h):
                return b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR" + struct.pack(">II", w, h) + b"\x08\x02\x00\x00\x00\x00\x00\x00\x00"
            def test_actual_landscape_shape(self):
                self.assertEqual(dict(width=2400, height=1080), landscape_png(self.image(2400, 1080)))
            def test_portrait_and_empty_are_not_rotation_proof(self):
                for data in [b"", self.image(1080, 2400), self.image(0, 0), self.image(1, 1)]:
                    with self.assertRaises(ValueError): landscape_png(data)
            def test_real_1x_and_0x_boundaries_required(self):
                import tempfile
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    keys = ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]
                    for phase, value in (("default", 1), ("landscape", 1), ("reduced", 0)):
                        for edge in ("before", "after"):
                            (root / f"player-{phase}-animation-{edge}.txt").write_text("".join(f"{k}={value}.0\n" for k in keys))
                    self.assertEqual(set(animation_evidence(root)), {"default", "landscape", "reduced"})
                    path = root / "player-default-animation-before.txt"
                    path.write_text("".join(f"{k}=0.0\n" for k in keys))
                    with self.assertRaises(ValueError): animation_evidence(root)
                    path.unlink()
                    with self.assertRaises(OSError): animation_evidence(root)
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            check(sys.argv[1])
        except (ValueError, InvalidOperation, OSError, IndexError) as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
