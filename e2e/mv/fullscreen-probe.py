"""Collect controlled-state facts; a complete diagnostic is not MV acceptance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)
root = Path(sys.argv[1])
phases = ['fullscreen-paused', 'fullscreen-wait', 'fullscreen-playing',
          'fullscreen-paused-again', 'inline-paused', 'fullscreen-playing-entry']
states = ['PAUSED', 'PAUSED', 'PLAYING', 'PAUSED', 'PAUSED', 'PLAYING']
facts = []
for phase, state in zip(phases, states):
    target = evidence.node((root / f'ui-probe-{phase}.txt').read_text(), 'MV 视频画面')
    session = json.loads((root / f'session-probe-{phase}.json').read_text())
    assert session['state'] == state and session['title'] == 'E2E MV Song A · MV'
    left, top, right, bottom = target['bounds']
    crop = root / f'probe-{phase}-video.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-y', '-i', str(root / f'probe-{phase}.png'),
                    '-vf', f'crop={right-left}:{bottom-top}:{left}:{top}', '-frames:v', '1',
                    '-update', '1', str(crop)], check=True)
    # Missing codes are a recorded outcome, never turned into normal-MV PASS.
    frame, error = None, None
    try:
        frame = evidence.frames.decode_frame(crop)[0]
    except (ValueError, AssertionError) as failure:
        error = str(failure)
    facts.append(dict(phase=phase, session=session, frame=frame, imageError=error,
                      hostMs=int((root / f'probe-{phase}-host-ms.txt').read_text()), bounds=target['bounds']))
source = json.loads((root / 'source.json').read_text())
assert source['apkCommit'] == 'd550f15d96899cf925be653efe5ef497f4723be2'
assert source['apkSha256'] == 'aa14a07e041c654f019b1dbcc6d92c39a4bc8601a1a4d1c753fff7346b3122e0'
assert facts[1]['hostMs'] - facts[0]['hostMs'] >= 2000
result = dict(diagnosticOnly=True, fullNormalMvAcceptance=False, source=source, observations=facts)
raw = (root / 'native-stream.txt').read_text(errors='replace')
commits = evidence.commits(raw)
assert len({v['instance'] for v in commits}) == 1
assert len([v for v in commits if v['kind'] == 'mv']) == 1
result['nativeCommits'] = commits
result['outputBindings'] = evidence.LEASE.findall(raw)
(root / 'fullscreen-diagnostic.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
