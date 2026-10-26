#!/usr/bin/env python3
"""The rotation request alone cannot establish that a real landscape image exists."""
import json
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
    files = list((root / "maestro" / "continuity-landscape").rglob("continuity-landscape-page.png"))
    if len(files) != 1:
        raise ValueError("expected one actual Maestro landscape page screenshot")
    result = landscape_png(files[0].read_bytes())
    (root / "player-landscape-image.json").write_text(json.dumps(result))
    print(json.dumps(result))


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
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            check(sys.argv[1])
        except (ValueError, OSError, IndexError) as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
