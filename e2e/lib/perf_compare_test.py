#!/usr/bin/env python3
"""Run the real comparison driver and workflow APK selection against stand-ins."""
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parents[1]
WORKFLOW = HERE.parent / '.github/workflows/build-beta.yml'


def check_cold_capture(source=HERE / 'perf.sh'):
    """Exercise the real sampling loop; missing markers must retain their evidence."""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        bin_dir = root / 'bin'
        bin_dir.mkdir()
        adb = bin_dir / 'adb'
        adb.write_text('''#!/usr/bin/env bash
if [ "${1:-}" = logcat ] && [ "${4:-}" = epoch ]; then cat "$TEST_MARKERS"; exit; fi
if [ "${1:-}" = logcat ] && [ "${2:-}" = -c ]; then echo cleared; exit; fi
if [ "${1:-}" = shell ] && [ "${3:-}" = force-stop ]; then exit; fi
if [ "${1:-}" = shell ] && [ "${3:-}" = start ]; then
    printf 'Status: ok\\nLaunchState: COLD\\nTotalTime: 12\\n'
    exit
fi
echo "captured diagnostic: $*"
if [ "$TEST_MODE" = diagnostics-fail ]; then exit 17; fi
''')
        adb.chmod(0o755)
        events = '''1000.000 1 1 I ActivityTaskManager: START u0 cmp=fun.upup.musicfree/.MainActivity
1000.001 42 42 I MusicFreePerf: process-start at=1000001
1000.005 42 42 I MusicFreePerf: first-draw at=1000005
1000.020 42 42 I MusicFreePerf: first-screen at=1000020
1000.030 42 42 I MusicFreePerf: splash-hidden at=1000030
1000.040 1 1 D SplashScreenView: remove starting view
1000.060 42 42 I MusicFreePerf: home-drawn at=1000060
'''
        command = '''HERE=$1; OUT=$2; PKG=fun.upup.musicfree; ACTIVITY=$PKG/.MainActivity
source "$3"
PERF_RUNS=0
sleep() { :; }
log() { :; }
wait_until() { printf '%s\\n' "$*" >> "$OUT/waits.txt"; shift; "$@"; }
: > "$PERF_JSONL"
perf_cold_start
'''
        for mode in ('normal', 'missing-home', 'missing-splash', 'diagnostics-fail'):
            out = root / mode
            out.mkdir()
            text = events
            if mode == 'missing-home': text = '\n'.join(x for x in text.splitlines() if 'home-drawn' not in x)
            if mode in ('missing-splash', 'diagnostics-fail'): text = '\n'.join(x for x in text.splitlines() if 'splash-hidden' not in x)
            markers = out / 'fixture.log'
            markers.write_text(text)
            env = {**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                   'TEST_MARKERS': str(markers), 'TEST_MODE': mode}
            subprocess.run(['bash', '-u', '-c', command, 'capture', str(HERE), str(out), str(source)],
                           env=env, check=True, capture_output=True)
            saved = out / 'perf-cold/0'
            assert (saved / 'start-activity.txt').is_file(), 'per-attempt launch evidence is missing'
            assert (saved / 'start-exit-code.txt').read_text().strip() == '0'
            assert (saved / 'clear-log.txt').read_text().strip() == 'cleared'
            assert (saved / 'markers.txt').read_text().strip() == text.strip()
            rows = [json.loads(line) for line in (out / 'perf.jsonl').read_text().splitlines()]
            if mode in ('normal', 'missing-home'):
                assert len(rows) == 1 and rows[0]['run'] == 0 and rows[0]['warmup'] is True
                assert rows[0]['cold_first_frame_ms'] == 12
                assert ('cold_home_drawn_ms' in rows[0]) is (mode == 'normal')
                assert (out / 'waits.txt').read_text().splitlines() == [
                    '60 perf_has first-screen', '60 perf_has splash-hidden', '10 perf_has first-draw',
                    '10 perf_splash_removed', '10 perf_has home-drawn']
            else:
                assert rows == [], 'missing markers were replaced with a fabricated sample'
            if mode == 'normal':
                assert not (saved / 'failure.txt').exists()
            else:
                assert (saved / 'failure.txt').is_file(), 'failed-attempt reason is missing'
                assert (saved / 'failure.txt').read_text().strip()
                for name in ('failure-logcat.txt', 'pid.txt', 'activities.txt', 'windows.txt', 'failure.png'):
                    assert (saved / name).is_file(), (mode, name)
                    assert (saved / name).read_bytes(), (mode, name)
            print('ok cold sample capture', mode)


def check_startup_stream():
    run = (HERE / 'run.sh').read_text()
    assert run.index('startup_capture_start\n') < run.index('adb shell am start -W')
    assert run.index('startup_capture_stop\n', run.index('flow "启动后进入首页"')) > run.index('flow "启动后进入首页"')
    traps = [line for line in run.splitlines()
             if line.startswith('trap ') and shlex.split(line)[-1] == 'EXIT']
    assert len(traps) == 1, 'one combined EXIT handler must release both captures'
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        cleanup = root / 'cleanup.txt'
        check = subprocess.run(['bash', '-eu', '-c', '''
startup_capture_stop() { echo startup >> "$CLEANUP_OUT"; }
hardening_capture_cancel() { echo hardening >> "$CLEANUP_OUT"; }
''' + traps[0] + '\nexit 17\n'],
            env={**os.environ, 'CLEANUP_OUT': str(cleanup)}, capture_output=True)
        assert check.returncode == 17, 'cleanup changed the original failure status'
        assert cleanup.read_text().splitlines() == ['startup', 'hardening'], \
            'abnormal exit must release both capture processes'
        adb = root / 'adb'
        adb.write_text('''#!/usr/bin/env bash
if [ "${2:-}" = -c ]; then : > "$OUT/ring.txt"; exit; fi
trap 'exit 0' TERM
echo before-driver-clear
touch "$OUT/reader-ready"
while [ ! -f "$OUT/driver-cleared" ]; do sleep 0.01; done
echo after-driver-clear
while true; do sleep 0.1; done
''')
        adb.chmod(0o755)
        env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'OUT': str(root)}
        command = '''set -eu
source "$1"
startup_capture_start
trap startup_capture_stop EXIT
for i in $(seq 1 200); do [ ! -f "$OUT/reader-ready" ] || break; sleep 0.01; done
test -f "$OUT/reader-ready"
adb logcat -c
touch "$OUT/driver-cleared"
for i in $(seq 1 200); do grep -q after-driver-clear "$OUT/startup-stream-logcat.txt" && break; sleep 0.01; done
startup_capture_stop
startup_capture_stop
'''
        subprocess.run(['bash', '-c', command, 'stream', str(HERE / 'lib/startup_capture.sh')],
                       env=env, check=True, timeout=10, capture_output=True)
        assert (root / 'startup-stream-logcat.txt').read_text().splitlines() == [
            'before-driver-clear', 'after-driver-clear']
        print('ok initial startup stream survives driver logcat clear')


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
    for step in ('Pick the x86_64 APK for the emulator', 'Validate cold-start comparison inputs'):
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
if os.environ['TEST_MODE']=='missing-home-marker' and p.name=='baseline-before': del rows[9]['cold_home_drawn_ms']
if os.environ['TEST_MODE']=='missing-warmup' and p.name=='baseline-after': rows=rows[1:]
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
    for mode in ('normal', 'candidate-fails', 'missing-sample', 'missing-home-marker',
                 'missing-warmup', 'preparation-fails', 'same-apk'):
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

check_cold_capture()
check_startup_stream()
