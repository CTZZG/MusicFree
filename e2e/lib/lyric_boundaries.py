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


def offscreen(path):
    text = Path(path).read_text()
    fields = dict(re.findall(r'(?m)^INSTRUMENTATION_RESULT: ([a-zA-Z]+)=([^\r\n]*)', text))
    if (not re.search(r'(?m)^INSTRUMENTATION_CODE: 0\s*$', text)
            or fields.get('matches') != '0' or 'errorType' in fields or 'match' in fields):
        raise ValueError('not a completed offscreen-target snapshot')
    nodes = json.loads(fields['tree'])
    own = [n for n in nodes if n.get('package') == 'fun.upup.musicfree']
    if not any(n.get('visible') is True and '当前播放信息' in [n.get('text'), n.get('description')]
               for n in own):
        raise ValueError('playback information panel is not visible')
    targets = [n for n in own if '刷新音频信息' in [n.get('text'), n.get('description')]
               and n.get('clickable') is True]
    if (len(targets) != 1 or targets[0].get('enabled') is not True
            or targets[0].get('visible') is not False):
        raise ValueError('expected exactly one offscreen refresh control')
    return {'panelVisible': True, 'refreshOffscreen': True, 'bounds': targets[0]['bounds']}


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
        refresh = [n for n in nodes if n.get('visible') is True and n.get('enabled') is True
                   and n.get('clickable') is True and
                   '刷新音频信息' in [n.get('text'), n.get('description')]]
        if len(refresh) != 1:
            raise ValueError('refresh button is missing or ambiguous')
        import struct
        image = (root / f'screens/boundary-info-{phase}.png').read_bytes()
        if image[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError('actual font screenshot missing')
        width, height = struct.unpack('>II', image[16:24])
        # isVisibleToUser includes partially clipped controls. Require actual
        # safe geometry, not just the framework's visible flag (Beta229).
        refresh_box(refresh[0]['bounds'], width, height,
                    float((root / 'boundary-display-density.txt').read_text()))
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


def mode(path):
    labels = {n.get('description') for n in tree(path) if n.get('visible') is True
              and n.get('enabled') is True and n.get('clickable') is True}
    showing = labels.intersection({'显示歌词', '显示封面'})
    if len(showing) != 1:
        raise ValueError('actual detail mode is missing or ambiguous')
    return 'lyric' if '显示封面' in showing else 'cover'


def refresh_box(bounds, width, height, dpi):
    left, top, right, bottom = bounds
    minimum = 48 * dpi / 160
    if not (0 <= left < right <= width and 0 <= top < bottom <= height - minimum
            and bottom - top >= minimum and right - left >= minimum):
        raise ValueError(f'refresh target clipped or too small: {bounds}, display{width}x{height}@{dpi}')
    return {'bounds': bounds, 'minimum48dpPixels': minimum, 'wholeTargetInsideSafeArea': True}


def geometry(path, width, height, dpi):
    nodes = tree(path)
    found = [n for n in nodes if n.get('visible') and n.get('enabled') and n.get('clickable')
             and '刷新音频信息' in [n.get('description'), n.get('text')]]
    if len(found) != 1:
        raise ValueError('refresh target not unique')
    return refresh_box(found[0]['bounds'], width, height, dpi)


def self_test():
    import unittest
    import tempfile
    class Checks(unittest.TestCase):
        def test_offscreen_probe_only_allows_known_panel_and_hidden_target(self):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'probe.txt'
                nodes = [dict(package='fun.upup.musicfree', visible=True, text='当前播放信息'),
                         dict(package='fun.upup.musicfree', enabled=True, visible=False, clickable=True,
                              description='刷新音频信息', bounds=[53, 3154, 1028, 2400])]
                def raw(tree=nodes, code=0, matches=0, extra=''):
                    return ('INSTRUMENTATION_RESULT: tree=' + json.dumps(tree) +
                            f'\nINSTRUMENTATION_RESULT: matches={matches}\n{extra}INSTRUMENTATION_CODE: {code}\n')
                path.write_text(raw())
                self.assertTrue(offscreen(path)['refreshOffscreen'])
                for bad in [raw(code=-1), raw(matches=1), raw(extra='INSTRUMENTATION_RESULT: errorType=IOException\n'),
                            raw(tree=nodes[1:]), raw(tree=nodes + [nodes[1]]), raw(tree=[]), '',
                            raw(tree=[nodes[0], dict(nodes[1], visible=True)]),
                            raw(tree=[nodes[0], dict(nodes[1], enabled=False)]),
                            raw(tree=[dict(n, package='other') for n in nodes])]:
                    path.write_text(bad)
                    with self.assertRaises((ValueError, KeyError)):
                        offscreen(path)

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
        def test_real_tree_contract_and_font_growth(self):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                def write(phase, height):
                    nodes = [{'package': 'fun.upup.musicfree', 'visible': True, 'text': '当前播放信息',
                              'bounds': [20, 100, 500, 100 + height]},
                             {'package': 'fun.upup.musicfree', 'visible': True, 'enabled': True, 'clickable': True,
                              'description': '刷新音频信息', 'bounds': [20, 1500, 500, 1600]}]
                    (root / f'ui-boundary-info-{phase}-instrumentation.txt').write_text(
                        'INSTRUMENTATION_RESULT: tree=' + json.dumps(nodes) + '\nINSTRUMENTATION_CODE: -1\n')
                    # Only the dimensions are consumed here; full screenshot
                    # decode is independently performed on device artifacts.
                    import struct
                    (root / 'screens').mkdir(exist_ok=True)
                    (root / f'screens/boundary-info-{phase}.png').write_bytes(
                        b'\x89PNG\r\n\x1a\n' + bytes(8) + struct.pack('>II', 1080, 2400))
                (root / 'boundary-info-font-scale.txt').write_text('2.0')
                (root / 'boundary-display-density.txt').write_text('320')
                write('1x', 30); write('2x', 60)
                self.assertEqual(font(root)['heightRatio'], 2)
                write('2x', 30)
                with self.assertRaises(ValueError): font(root)
                (root / 'boundary-info-font-scale.txt').write_text('1.0')
                with self.assertRaises(ValueError): font(root)
        def test_partial_target_from_beta229_rejected(self):
            with self.assertRaises(ValueError): refresh_box([53, 2309, 1028, 2400], 1080, 2400, 420)
            for box in [[0, 0, 50, 50], [-1, 100, 800, 400]]:
                with self.assertRaises(ValueError): refresh_box(box, 1080, 2400, 420)
            self.assertTrue(refresh_box([53, 2100, 1028, 2274], 1080, 2400, 420)['wholeTargetInsideSafeArea'])
        def test_empty_and_cover_mode_are_actual_node_properties(self):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'ui.txt'
                def write(labels, code=-1):
                    path.write_text('INSTRUMENTATION_RESULT: tree=' + json.dumps([
                        {'package': 'fun.upup.musicfree', 'visible': True, 'enabled': True,
                         'clickable': True, 'description': label} for label in labels]) +
                        f'\nINSTRUMENTATION_CODE: {code}\n')
                write(['重新载入歌词']); self.assertTrue(empty(path)['emptyFrozenSnapshot'])
                write(['选择歌词：already ready'])
                with self.assertRaises(ValueError): empty(path)
                write(['显示封面']); self.assertEqual(mode(path), 'lyric')
                write(['显示歌词']); self.assertEqual(mode(path), 'cover')
                for labels in [[], ['显示歌词', '显示封面']]:
                    write(labels)
                    with self.assertRaises(ValueError): mode(path)
                write(['显示歌词'], code=0)
                with self.assertRaises(ValueError): mode(path)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Checks))
    if not result.wasSuccessful():
        raise SystemExit(1)


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        self_test()
    else:
        try:
            if sys.argv[1] == 'geometry':
                result = geometry(sys.argv[2], *map(int, sys.argv[3:6]))
            else:
                result = {'card': card, 'font': font, 'empty': empty, 'mode': mode, 'offscreen': offscreen}[sys.argv[1]](sys.argv[2])
            print(json.dumps(result))
        except (ValueError, KeyError, IndexError, TypeError, OSError, subprocess.CalledProcessError) as error:
            print(str(error), file=sys.stderr); sys.exit(1)
