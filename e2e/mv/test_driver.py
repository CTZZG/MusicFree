"""Run the actual scenario function with host command boundaries, never a device claim."""
import os
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
source = Path(os.environ.get('MV_SCENARIO_SOURCE', Path(__file__).parents[1] / 'mv.sh'))
# Actual Beta244 More-sheet clickable node, artifact13237779864, App d550.
# Its wording differs from the positive cover shortcut's localized title.
recorded_more_node = dict(package='fun.upup.musicfree', description='观看 MV',
                          visible=True, enabled=True, clickable=True, bounds=[0, 1906, 1080, 2037])
cover_label = json.loads((Path(__file__).parents[2] / 'src/core/i18n/languages/zh-cn.json').read_text())['musicVideo.title']
script = r'''
set -uo pipefail
source SOURCE
OUT=OUTDIR; mkdir -p "$OUT/mv"; ACTIVITY=fun.upup.musicfree/.MainActivity
call() { printf '%s\n' "$1" >> "$OUT/calls"; test "$1" != "$FAIL_AT"; }
mv_pause() { call pause; }
mv_seek() { call "seek-$2"; }
mv_tap() {
    case "$2" in
        h264-open) [ "$1" = "$MORE_LABEL" ] || return 1 ;;
        hevc-open|missing-open) [ "$1" = "$COVER_LABEL" ] || return 1 ;;
    esac
    call "tap-$2"
}
mv_snapshot() { call "snapshot-$2"; }
mv_wait_ready() { call "ready-$1"; }
mv_capture() { call "capture-$1"; }
mv_record_session() { call "session-$1"; }
mv_persist() { call "persist-$1"; }
mv_ready_count() { echo 0; }
clock() { echo 0; }
mv_clock_ms() { echo 0; }
adb() { call "adb-$*"; }
shot() { call "shot-$1"; }
sleep() { :; }
wait_for_state() { call "state-$2"; }
pass() { printf '%s\n' "$1" >> "$OUT/pass"; }
mv_app_scenarios
'''
phases = ['first-h264', 'inline', 'fullscreen', 'returned-inline', 'landscape', 'portrait', 'before-home', 'foreground', 'quality', 'alternate', 'first-hevc', 'hevc']
cases = [''] + ['capture-' + p for p in phases] + ['ready-h264-seek', 'tap-alternate-confirm', 'state-E2E MV Song B', 'snapshot-h264-first-frame', 'snapshot-hevc-first-frame']
for fail in cases:
    with tempfile.TemporaryDirectory() as temp:
        code = script.replace('SOURCE', shlex.quote(str(source))).replace('OUTDIR', shlex.quote(temp))
        run = subprocess.run(['bash', '-c', code], env=dict(os.environ, FAIL_AT=fail,
                             MORE_LABEL=recorded_more_node['description'], COVER_LABEL=cover_label), capture_output=True, text=True)
        calls = (Path(temp) / 'calls').read_text().splitlines()
        if not fail:
            assert run.returncode == 0, run.stderr
            assert [c for c in calls if c.startswith('capture-')] == ['capture-' + p for p in phases]
        else:
            assert run.returncode != 0, (fail, calls)
            assert calls[-1] == fail, (fail, calls[-3:])
print(f'Actual MV scenario success/first-failure boundaries: {len(cases)} host cases passed')

# Actual Beta245 published session title, not a video candidate's title. Exercise
# the real pause helper rather than the scenario's fake device boundary above.
pause_script = r'''
source SOURCE
adb() { return 0; }
wait_for_state() { test "$1" = PAUSED && test "$2" = "$EXPECTED_TITLE" && test "$3" = 15; }
if [ "$ORIGINAL_AUDIO" = yes ]; then mv_pause 'E2E MV Song A'; else mv_pause; fi
'''
for original, expected, ok in [('yes', 'E2E MV Song A', True),
                               ('no', 'E2E MV Song A · MV', True),
                               ('no', 'E2E H264 MV', False)]:
    run = subprocess.run(['bash', '-c', pause_script.replace('SOURCE', shlex.quote(str(source)))],
                         env=dict(os.environ, EXPECTED_TITLE=expected, ORIGINAL_AUDIO=original), capture_output=True)
    assert (run.returncode == 0) is ok, (original, expected, run.stderr)
print('Actual pause helper: 3 published-session title boundary cases passed')

# adb shell reparses joined arguments on the device. In Beta246 the empty
# absentLabelBase64 consumed the following -e; Android then treated timeoutMs
# as a package instead of the instrumentation component (Invalid userId -2).
# Model that transport + AOSP Am.runInstrument parsing, not an App/device.
snapshot_boundary = r'''
import base64
import json
import os
from pathlib import Path
import shlex
import sys
words = shlex.split(' '.join(sys.argv[1:]))
assert words[:3] == ['shell', 'am', 'instrument'], words
args = {}
i = 3
while i < len(words) and words[i].startswith('-'):
    if words[i] in ['-w', '-r']:
        i += 1
    elif words[i] == '-e':
        args[words[i + 1]] = words[i + 2]
        i += 3
    else:
        raise AssertionError(words[i:])
component = words[i] if i < len(words) else ''
Path(os.environ['PARSED_ARGS']).write_text(json.dumps(dict(component=component, args=args)))
if component != 'fun.upup.musicfree.e2e.ui/.UiSnapshot':
    print('onError: commandError=true message=Invalid userId -2')
    sys.exit(0)
label = base64.b64decode(args['labelBase64']).decode()
absent = base64.b64decode(args.get('absentLabelBase64', '')).decode()
node = dict(package='fun.upup.musicfree', visible=True, enabled=True,
            clickable=args['matchKind'] == 'clickable', text='', description=label, bounds=[0, 0, 100, 120])
tree = [node]
blocked = int(os.environ['BLOCKED'] == 'yes')
if blocked:
    tree.append(dict(package='fun.upup.musicfree', visible=True, text=absent))
for key, value in dict(tree=json.dumps(tree), match=json.dumps(node), matches='1',
                       blockedLabel=absent, blockedMatches=str(blocked)).items():
    print(f'INSTRUMENTATION_RESULT: {key}={value}')
print('INSTRUMENTATION_CODE: -1')
'''
snapshot_script = r'''
source SOURCE
HERE=HEREPATH; OUT=OUTDIR; mkdir -p "$OUT/mv"
adb() { python3 "$ADB_BOUNDARY" "$@"; }
mv_snapshot 'MV 视频画面' actual "$KIND" "$ABSENT" "$BUDGET"
'''
for kind, absent, budget, blocked, ok in [
        ('clickable', '', '15000', False, True),
        ('visible', '', '15000', False, True),
        ('visible', '正在等待 MV 画面…', '7300', False, True),
        ('visible', '正在等待 MV 画面…', '7300', True, False)]:
    with tempfile.TemporaryDirectory() as temp:
        boundary = Path(temp) / 'adb.py'
        boundary.write_text(snapshot_boundary)
        parsed = Path(temp) / 'parsed.json'
        code = snapshot_script.replace('SOURCE', shlex.quote(str(source))).replace(
            'HEREPATH', shlex.quote(str(Path(__file__).parents[1]))).replace('OUTDIR', shlex.quote(temp))
        run = subprocess.run(['bash', '-c', code], env=dict(os.environ, ADB_BOUNDARY=str(boundary),
                             PARSED_ARGS=str(parsed), KIND=kind, ABSENT=absent, BUDGET=budget,
                             BLOCKED='yes' if blocked else 'no'), capture_output=True, text=True)
        assert (run.returncode == 0) is ok, (kind, absent, run.stdout, run.stderr)
        actual = json.loads(parsed.read_text())
        assert actual['component'] == 'fun.upup.musicfree.e2e.ui/.UiSnapshot', actual
        assert actual['args']['timeoutMs'] == budget, actual
        assert ('absentLabelBase64' in actual['args']) is bool(absent), actual
        if ok:
            assert (Path(temp) / 'mv/point-actual.txt').read_text().strip() == '50 60'
print('Actual snapshot helper: 4 adb-shell/Android option boundary cases passed')
