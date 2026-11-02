"""Read actual RN geometry and decode the rendered fixture, not reported time-pos."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import re
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('frame_checker', Path(__file__).parents[1] / 'mv-probe/verify.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def screen_rect(xml, reported):
    """Match the real Android MV container by identity and RN-reported size.

    Fabric measureInWindow includes viewport offsets; a screencap is in physical
    screen coordinates. Never add a guessed status-bar/viewport constant.
    """
    tree = ET.fromstring(xml)
    parents = {child: parent for parent in tree.iter() for child in parent}
    expected = tuple(round(reported[k] * reported['density']) for k in ('width', 'height'))
    found = set()
    for label in tree.iter('node'):
        if label.get('package') != 'fun.upup.musicfree.mvprobe' or label.get('text') != 'MV':
            continue
        parent = parents.get(label)
        while parent is not None:
            bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', parent.get('bounds', ''))
            if bounds and parent.get('package') == 'fun.upup.musicfree.mvprobe':
                x1, y1, x2, y2 = map(int, bounds.groups())
                width, height = x2 - x1, y2 - y1
                if all(abs(a - b) <= 2 for a, b in zip((width, height), expected)):
                    found.add((x1, y1, width, height))
            parent = parents.get(parent)
    assert len(found) == 1, ('MV container screen bounds missing or ambiguous', sorted(found), expected)
    return next(iter(found))


def overlay_rect(xml, container):
    nodes = [n for n in ET.fromstring(xml).iter('node')
             if n.get('package') == 'fun.upup.musicfree.mvprobe' and n.get('text') == 'MV']
    assert len(nodes) == 1, 'MV overlay label missing or ambiguous'
    bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', nodes[0].get('bounds', ''))
    assert bounds, 'missing actual MV overlay bounds'
    left, top, right, bottom = map(int, bounds.groups())
    x, y, width, height = container
    assert x <= left < right <= x + width and y <= top < bottom <= y + height
    return left - x, top - y, right - x, bottom - y


def check_overlay(raw, width, rect):
    # Sample the actual RN label, not yellow elsewhere in the fixture's color bars.
    left, top, right, bottom = rect
    yellow = sum(raw[i] > 200 and raw[i+1] > 200 and raw[i+2] < 70
                 for row in range(top, bottom)
                 for i in range((row * width + left) * 3, (row * width + right) * 3, 3))
    assert yellow >= 30, 'RN overlay hidden behind native texture'


def capture(root, phase, expected=None):
    result = json.loads((root / 'result.json').read_text())
    event = next(e for e in result['events'] if e['phase'] == phase)
    rect = event['rect']
    xml = (root / (phase + '-ui.xml')).read_text()
    x, y, width, height = screen_rect(xml, rect)
    reported = {k: round(rect[k] * rect['density']) for k in ('x', 'y', 'width', 'height')}
    (root / (phase + '-geometry.json')).write_text(json.dumps({
        'source': 'Android UI hierarchy', 'screen': {'x': x, 'y': y, 'width': width, 'height': height},
        'fabricWindow': reported,
    }, indent=2) + '\n')
    assert width >= 320 and height >= 180
    cropped = root / (phase + '-video.png')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-y', '-i', str(root / (phase + '.png')),
                    '-vf', f'crop={width}:{height}:{x}:{y}', '-frames:v', '1', '-update', '1', str(cropped)], check=True)
    index, _, _ = checker.decode_frame(cropped)
    if expected is not None:
        assert abs(index - expected) <= 1, ('wrong rendered seek frame', phase, index, expected)
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(cropped), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    # Parent clipping, and a real RN overlay above TextureView.
    assert all(abs(a-b) < 18 for a,b in zip(raw[:3], (32,48,64))), ('corner not clipped', phase, list(raw[:3]))
    check_overlay(raw, width, overlay_rect(xml, (x, y, width, height)))
    return index


if __name__ == '__main__':
    root, phase = Path(sys.argv[1]), sys.argv[2]
    target = int(sys.argv[3]) if len(sys.argv) > 3 else None
    print(json.dumps({'phase':phase,'actualFrame':capture(root,phase,target)}))
