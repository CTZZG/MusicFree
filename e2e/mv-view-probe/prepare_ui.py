"""Dismiss only the known emulator Launcher ANR before any media fixture is supplied."""
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

PACKAGE = 'fun.upup.musicfree.mvprobe'


def inspect(xml):
    nodes = list(ET.fromstring(xml).iter('node'))
    close = [n for n in nodes if n.get('resource-id') == 'android:id/aerr_close']
    if not close:
        assert any(n.get('package') == PACKAGE for n in nodes), 'probe App is not the visible window'
        return None
    # Never dismiss an App ANR, permission prompt or arbitrary system dialog.
    assert any(n.get('package') == 'android' and re.fullmatch(
        r"Pixel Launcher (?:isn't|isn’t|is not) responding", n.get('text', '')
    ) for n in nodes), 'unrecognized ANR: retain it and fail'
    assert len(close) == 1 and close[0].get('package') == 'android'
    bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', close[0].get('bounds', ''))
    assert bounds, 'missing exact Launcher close-button bounds'
    x1, y1, x2, y2 = map(int, bounds.groups())
    assert x2 > x1 and y2 > y1
    return (x1 + x2) // 2, (y1 + y2) // 2


def prepare(out):
    out = Path(out)
    remote = '/sdcard/mv-view-preflight.xml'

    def dump(name):
        subprocess.run(['adb', 'shell', 'uiautomator', 'dump', remote], check=True,
                       timeout=20, stdout=subprocess.DEVNULL)
        path = out / (name + '.xml')
        subprocess.run(['adb', 'pull', remote, str(path)], check=True, timeout=10,
                       stdout=subprocess.DEVNULL)
        with (out / (name + '.png')).open('wb') as image:
            subprocess.run(['adb', 'exec-out', 'screencap', '-p'], check=True,
                           timeout=10, stdout=image)
        return path.read_text()

    point = inspect(dump('preflight-before'))
    if point:
        subprocess.run(['adb', 'shell', 'input', 'tap', *map(str, point)], check=True, timeout=10)
        assert inspect(dump('preflight-after')) is None, 'Launcher obstruction remains'
        print('Closed the exact Android Pixel Launcher ANR; probe App remains visible')
    else:
        print('Probe App visible without a Launcher ANR')


if __name__ == '__main__':
    prepare(sys.argv[1])
