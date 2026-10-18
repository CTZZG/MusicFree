#!/usr/bin/env python3
"""Run the real comparison driver and workflow APK selection against stand-ins."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parents[1]
WORKFLOW = HERE.parent / '.github/workflows/build-beta.yml'


def workflow_command(name):
    text = WORKFLOW.read_text().split('            - name: ' + name + '\n', 1)[1]
    text = text.split('\n            - name:', 1)[0]
    lines = text.split('              run: |\n', 1)[1].splitlines()
    return '\n'.join(line[18:] for line in lines)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'apk').mkdir()
    (root / 'baseline-apk').mkdir()
    candidate = root / 'apk/MusicFree-0.11.6-new-app-x86_64-release.apk'
    baseline = root / 'baseline-apk/MusicFree-0.11.6-old-app-x86_64-release.apk'
    candidate.write_bytes(b'candidate APK')
    baseline.write_bytes(b'baseline APK')
    (candidate.parent / 'android-build-info.txt').write_text('Commit: ' + 'b' * 40 + '\n')
    (baseline.parent / 'android-build-info.txt').write_text('Commit: ' + 'a' * 40 + '\n')
    env_file = root / 'github-env'
    env = {**os.environ, 'GITHUB_ENV': str(env_file), 'SELECTED_SUITE': 'perf'}
    for step in ('Pick the x86_64 APK for Android 14', 'Validate cold-start comparison inputs'):
        subprocess.run(['bash', '-euo', 'pipefail', '-c', workflow_command(step)], cwd=root, env=env, check=True, capture_output=True)
        env.update(dict(line.split('=', 1) for line in env_file.read_text().splitlines()))
    exported = dict(line.split('=', 1) for line in env_file.read_text().splitlines())
    assert exported['E2E_APK'].startswith('apk/')
    assert exported['E2E_PERF_BASELINE_APK'].startswith('baseline-apk/')
    assert exported['E2E_APK_COMMIT'] == 'b' * 40
    assert exported['E2E_PERF_BASELINE_COMMIT'] == 'a' * 40
    print('ok workflow selects distinct candidate/baseline and source commits')

    driver = root / 'e2e'
    (driver / 'lib').mkdir(parents=True)
    shutil.copy(HERE / 'perf-cold-compare.sh', driver)
    shutil.copy(HERE / 'lib/perf_stats.py', driver / 'lib')
    (driver / 'run.sh').write_text('''#!/usr/bin/env bash
set -euo pipefail
out=$3
mkdir -p "$out"
printf '%s\\n' "$(basename "$out")" >> "$TEST_ORDER"
test "$E2E_PERF_COLD_ONLY" = 1
test "$E2E_PERF_RUNS" = 10
if [ "$TEST_MODE" = candidate-fails ] && [ "$(basename "$out")" = candidate ]; then
    printf 'FAIL\\thome did not load\\tfixture\\n' > "$out/results.tsv"
    exit 1
fi
python3 - "$out" <<'INNER'
import json, os, pathlib, sys
p=pathlib.Path(sys.argv[1]); n=10 if os.environ['TEST_MODE']=='missing-sample' and p.name=='candidate' else 11
rows=[{'phase':'cold','run':i,'warmup':i==0,'cold_home_drawn_ms':1000+i} for i in range(n)]
(p/'perf.jsonl').write_text(''.join(json.dumps(row)+'\\n' for row in rows))
(p/'results.tsv').write_text('PASS\\tcold sample collected\\tfixture\\n')
INNER
python3 -I "$(dirname "$0")/lib/perf_stats.py" summary "$out/perf.jsonl" > "$out/perf.md" 2> "$out/perf-summary.json"
''')
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    adb = bin_dir / 'adb'
    adb.write_text('''#!/usr/bin/env bash
if [ "$TEST_MODE" = preparation-fails ]; then exit 1; fi
if [ "${2:-}" = pm ]; then printf 'package:fun.upup.musicfree\\n'; fi
''')
    adb.chmod(0o755)
    for mode in ('normal', 'candidate-fails', 'missing-sample', 'preparation-fails', 'same-apk'):
        out = root / mode
        order = root / (mode + '-order')
        local_env = {**env, **exported, 'PATH': str(bin_dir) + os.pathsep + env['PATH'],
                     'TEST_MODE': mode, 'TEST_ORDER': str(order)}
        picked = baseline if mode == 'same-apk' else candidate
        run = subprocess.run(['bash', str(driver / 'perf-cold-compare.sh'), str(baseline), str(picked),
                              'test-ref', str(out)], env=local_env, capture_output=True, text=True)
        assert (run.returncode == 0) is (mode == 'normal'), (mode, run.stdout, run.stderr)
        if mode == 'normal':
            assert order.read_text().splitlines() == ['baseline-before', 'candidate', 'baseline-after']
            result = json.loads((out / 'compare-summary.json').read_text())
            assert result['passed'] and len(result['metrics']) == 3
        elif mode != 'same-apk':
            assert not json.loads((out / 'compare-summary.json').read_text())['passed']
            assert 'FAIL' in (out / 'results.tsv').read_text()
        print('ok comparison', mode)
