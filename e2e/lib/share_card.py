#!/usr/bin/env python3
"""Check real exported pixels, not an SVG mock or a successful save toast."""
import json
import struct
import subprocess
import sys
from pathlib import Path


def inspect(path):
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not PNG")
    width, height = struct.unpack(">II", data[16:24])
    if width != 1000 or not 600 <= height <= 2000:
        raise ValueError(f"unexpected size {width}x{height}")
    pixels = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
                             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                            check=True, stdout=subprocess.PIPE).stdout
    if len(pixels) != width * height * 3:
        raise ValueError("incomplete decoded image")

    def rgb(x, y):
        start = (y * width + x) * 3
        return tuple(pixels[start:start + 3])

    # The real remote fixture's two halves must both survive SVG capture.
    for x, expected in [(100, (32, 100, 180)), (170, (220, 70, 80))]:
        if any(abs(a - b) > 4 for a, b in zip(rgb(x, 130), expected)):
            raise ValueError(f"cover pixels absent at {x}: {rgb(x, 130)}")
    white = sum(min(rgb(x, y)) > 210 for y in range(240, height - 130)
                for x in range(65, 935))
    return {"width": width, "height": height, "bodyWhitePixels": white}


def compare(song, lyric):
    if song["height"] != 600 or song["bodyWhitePixels"] > 25:
        raise ValueError("song card has unexpected lyric pixels")
    if lyric["height"] <= song["height"] or lyric["bodyWhitePixels"] < 1000:
        raise ValueError("selected/translated lyrics missing from PNG")
    return {"song": song, "lyric": lyric}


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        import unittest

        class Checks(unittest.TestCase):
            def test_realistic_cards(self):
                compare({"height": 600, "bodyWhitePixels": 0}, {"height": 802, "bodyWhitePixels": 10000})

            def test_blank_and_unselected_images_rejected(self):
                for height, pixels in [(600, 10000), (802, 0)]:
                    with self.assertRaises(ValueError):
                        compare({"height": 600, "bodyWhitePixels": 0}, {"height": height, "bodyWhitePixels": pixels})

        unittest.main(argv=[sys.argv[0]])
    else:
        print(json.dumps(compare(inspect(sys.argv[1]), inspect(sys.argv[2]))))
