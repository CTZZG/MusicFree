"""Read actual RN geometry and decode the rendered fixture, not reported time-pos."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('frame_checker', Path(__file__).parents[1] / 'mv-probe/verify.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def capture(root, phase, expected=None):
    result = json.loads((root / 'result.json').read_text())
    event = next(e for e in result['events'] if e['phase'] == phase)
    rect = event['rect']
    density = rect['density']
    x, y, width, height = (round(rect[k] * density) for k in ('x', 'y', 'width', 'height'))
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
    yellow = sum(raw[i] > 200 and raw[i+1] > 200 and raw[i+2] < 70 for i in range(0,len(raw),3))
    assert yellow >= 30, ('RN overlay hidden behind native texture', phase)
    return index


if __name__ == '__main__':
    root, phase = Path(sys.argv[1]), sys.argv[2]
    target = int(sys.argv[3]) if len(sys.argv) > 3 else None
    print(json.dumps({'phase':phase,'actualFrame':capture(root,phase,target)}))
