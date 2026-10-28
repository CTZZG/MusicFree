#!/usr/bin/env python3
"""Independent checks of real native PNG pixels and public accessibility trees."""
import json
from pathlib import Path
import re
import subprocess
import sys


def tree(path):
    text = Path(path).read_text()
    if not re.search(r'(?m)^INSTRUMENTATION_CODE: -1\s*$', text):
        raise ValueError('incomplete public UI snapshot')
    match = re.search(r'(?m)^INSTRUMENTATION_RESULT: tree=([^\r\n]*)', text)
    nodes = json.loads(match[1])
    if not any(n.get('package') == 'fun.upup.musicfree' and n.get('visible') is True for n in nodes):
        raise ValueError('wrong foreground')
    return nodes


def card_pixels(pixels, width, height):
    if width != 1000 or not 900 <= height <= 1300 or len(pixels) != width * height * 3:
        raise ValueError('incomplete or unexpected four-line card')

    def rgb(x, y):
        start = (y * width + x) * 3
        return pixels[start:start + 3]

    # The four fixed inputs produce these six white-text baselines. The emoji
    # row at610 is retained for human inspection; colored glyphs need not be white.
    rows = [294, 359, 452, 517, 703, 768]
    ink = [sum(min(rgb(x, y)) > 210 for y in range(b - 50, b + 8)
               for x in range(65, 935)) for b in rows]
    if any(n < 80 for n in ink):
        raise ValueError(f'missing actual W/CJK/long-word rows: {ink}')
    # The background is a smooth dark gradient. High-frequency edges in the
    # external gutters identify text clipping, including colored emoji, without
    # confusing the gradient with ink or simply cropping overflowing letters.
    for y in range(60, height - 90):
        for x in list(range(1, 40)) + list(range(960, 999)):
            if max(abs(a - b) for a, b in zip(rgb(x, y), rgb(x - 1, y))) > 20 or \
               max(abs(a - b) for a, b in zip(rgb(x, y), rgb(x, y - 1))) > 20:
                raise ValueError(f'clipped glyph edge in gutter at{x},{y}')
    return {'width': width, 'height': height, 'actualWhiteInkPerRow': ink,
            'guttersHaveNoGlyphEdges': True}


def card(path):
    import struct
    data = Path(path).read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not PNG')
    width, height = struct.unpack('>II', data[16:24])
    pixels = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                                      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return card_pixels(pixels, width, height)


def font(root):
    root = Path(root)
    if float((root / 'boundary-info-font-scale.txt').read_text().strip()) != 2:
        raise ValueError('device system font was not2x')
    def header(phase):
        nodes = tree(root / f'ui-boundary-info-{phase}-instrumentation.txt')
        titles = [n for n in nodes if n.get('visible') is True and
                  '当前播放信息' in [n.get('text'), n.get('description')]]
        if not titles:
            raise ValueError('actual title missing')
        boxes = [n['bounds'] for n in titles]
        return min(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    a, b = header('1x'), header('2x')
    h1, h2 = a[3] - a[1], b[3] - b[1]
    if not 0 < h1 < h2 or h2 < h1 * 1.3:
        raise ValueError(f'title did not actually scale: {a} -> {b}')
    return {'systemFontScale': 2, 'titleBounds1x': a, 'titleBounds2x': b,
            'heightRatio': h2 / h1, 'refreshTargets': 'see successful raw snapshots'}


def empty(path):
    nodes = tree(path)
    if any(str(n.get('description', '')).startswith('选择歌词：') for n in nodes):
        raise ValueError('panel opened after lyrics were ready; no empty-snapshot scenario')
    return {'emptyFrozenSnapshot': True}


def self_test():
    import unittest
    class Checks(unittest.TestCase):
        def test_pixels_reject_clipped_and_empty(self):
            p = bytearray([10, 20, 30] * 1000 * 961)
            for b in [294, 359, 452, 517, 703, 768]:
                for y in range(b - 30, b - 20):
                    for x in range(100, 200):
                        i = (y * 1000 + x) * 3; p[i:i + 3] = b'\xff\xff\xff'
            self.assertTrue(card_pixels(p, 1000, 961)['guttersHaveNoGlyphEdges'])
            i = (300 * 1000 + 980) * 3; p[i:i + 3] = b'\xff\xff\xff'
            with self.assertRaises(ValueError): card_pixels(p, 1000, 961)
            with self.assertRaises(ValueError): card_pixels(bytes([10, 20, 30] * 1000 * 961), 1000, 961)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Checks))
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        try:
            print(json.dumps({'card': card, 'font': font, 'empty': empty}[sys.argv[1]](sys.argv[2])))
        except (ValueError, KeyError, IndexError, TypeError, OSError, subprocess.CalledProcessError) as error:
            print(str(error), file=sys.stderr); sys.exit(1)
