"""Run the actual scenario function with host command boundaries, never a device claim."""
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
sys.dont_write_bytecode = True
source = Path(__file__).parents[1] / 'mv.sh'
script = r'''
set -uo pipefail
source SOURCE
OUT=OUTDIR; mkdir -p "$OUT/mv"; ACTIVITY=fun.upup.musicfree/.MainActivity
call() { printf '%s\n' "$1" >> "$OUT/calls"; test "$1" != "$FAIL_AT"; }
mv_pause() { call pause; }
mv_seek() { call "seek-$2"; }
mv_tap() { call "tap-$2"; }
mv_snapshot() { call "snapshot-$2"; }
mv_wait_ready() { call "ready-$1"; }
mv_capture() { call "capture-$1"; }
mv_record_session() { call "session-$1"; }
mv_persist() { call "persist-$1"; }
mv_ready_count() { echo 0; }
adb() { call "adb-$*"; }
shot() { call "shot-$1"; }
sleep() { :; }
wait_for_state() { call "state-$2"; }
pass() { printf '%s\n' "$1" >> "$OUT/pass"; }
mv_app_scenarios
'''
phases = ['inline', 'fullscreen', 'returned-inline', 'landscape', 'portrait', 'before-home', 'foreground', 'quality', 'alternate', 'hevc']
cases = [''] + ['capture-' + p for p in phases] + ['ready-h264-seek', 'tap-alternate-confirm', 'state-E2E MV Song B']
for fail in cases:
    with tempfile.TemporaryDirectory() as temp:
        code = script.replace('SOURCE', shlex.quote(str(source))).replace('OUTDIR', shlex.quote(temp))
        run = subprocess.run(['bash', '-c', code], env=dict(os.environ, FAIL_AT=fail), capture_output=True, text=True)
        calls = (Path(temp) / 'calls').read_text().splitlines()
        if not fail:
            assert run.returncode == 0, run.stderr
            assert [c for c in calls if c.startswith('capture-')] == ['capture-' + p for p in phases]
        else:
            assert run.returncode != 0, (fail, calls)
            assert calls[-1] == fail, (fail, calls[-3:])
print(f'Actual MV scenario success/first-failure boundaries: {len(cases)} host cases passed')
