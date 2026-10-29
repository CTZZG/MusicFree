#!/usr/bin/env python3
"""Exercise the real backup suite/entry/finish with synthetic device boundaries.

The real snapshot checker runs; adb, UI and PNG decoding are stand-ins. This
checks failure propagation, not Android permissions or actual rendered pixels.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parents[1]
RUN = (HERE / 'run.sh').read_text()


def function(name):
    match = re.search(r'^' + re.escape(name) + r'\(\) \{[^\n]*\}', RUN, re.M)
    if not match:
        match = re.search(r'^' + re.escape(name) + r'\(\) \{.*?^\}', RUN, re.M | re.S)
    assert match, name
    return match[0]


ENTRY = re.search(r'^if \[ "\$E2E_SUITE" = backup \]; then.*?^fi', RUN, re.M | re.S)
assert ENTRY, 'missing real backup suite entry'
SCRIPT = r'''
set -uo pipefail
OUT=$1; CASE=$2; HERE=$3; REF=synthetic; APK=synthetic.apk
PKG=fun.upup.musicfree; ACTIVITY=$PKG/.MainActivity
E2E_SUITE=backup; E2E_AUDIO_HARDENING=''; TIMELINE_PID=''
RESULTS=$OUT/results.tsv; FAILED=0
: > "$RESULTS"
ensure_root() { return 0; }
kv_path() { printf '/synthetic/%s\n' "$1"; }
kv_sha() { printf '%064d\n' 0; }
flow() {
    if [ "$CASE" = flow-fails ] && [ "$2" = storage-read-failed.yaml ]; then
        fail "$1" 'synthetic UI failure'; return 1
    fi
    pass "$1"
}
open_link() { :; }
wait_for_state() { :; }
list_share_images() { :; }
wait_until() {
    [ "$CASE" != image-missing ] || return 1
    echo synthetic.png > "$OUT/share-image-latest.txt"
}
python3() {
    if [[ "${2:-}" = */lyric_boundaries.py ]] && [ "${3:-}" = card ]; then
        [ "$CASE" != pixels-rejected ] || return 1
        echo '{"syntheticPixelBoundary":true}'
    else command python3 "$@"; fi
}
adb() {
    printf '%s\n' "$*" >> "$OUT/adb-calls.txt"
    case "$*" in
        'exec-out cat /synthetic/LocalSheet.music-sheets') cat "$OUT/index.json";;
        'exec-out cat /synthetic/App.config') cat "$OUT/config.json";;
        'exec-out cat /synthetic/LocalSheet.new-id') cat "$OUT/songs.json";;
        'shell stat -c %a '*) echo 700;;
        'shell chmod 000 '*) [ "$CASE" != chmod-zero-fails ];;
        'shell chmod 700 '*) [ "$CASE" != chmod-restore-fails ];;
        'shell am force-stop '*|'shell am start -W -n '*|'shell input '*) :;;
        'pull '*)
            [ "$CASE" != pull-fails ] && [ "$CASE" != prior-failure-and-pull ] || return 1
            printf synthetic > "$3";;
        'shell getprop ro.product.model') echo synthetic;;
        'shell getprop ro.build.version.release') echo 14;;
        'logcat '*) :;;
        *) echo "unexpected adb call: $*" >&2; return 1;;
    esac
}
'''
SCRIPT += '\n' + '\n'.join(function(n) for n in ('log', 'pass', 'fail', 'write_summary', 'finish'))
SCRIPT += '\nif [ "$CASE" = prior-failure-and-pull ]; then fail prior-failure; fi\n' + ENTRY[0]


def snapshot(entries):
    return json.dumps({'version': 1, 'entries': entries})


def value(obj):
    return {'t': 's', 'v': json.dumps(obj)}


def main():
    cases = ('normal', 'chmod-zero-fails', 'chmod-restore-fails', 'flow-fails',
             'image-missing', 'pull-fails', 'pixels-rejected', 'prior-failure-and-pull')
    errors = []
    with tempfile.TemporaryDirectory(prefix='mf-backup-flow-') as temporary:
        root = Path(temporary)
        implementation = root / 'e2e'
        (implementation / 'lib').mkdir(parents=True)
        shutil.copy(os.environ.get('E2E_BACKUP_IMPL', HERE / 'backup.sh'), implementation / 'backup.sh')
        shutil.copy(HERE / 'lyric_boundaries.sh', implementation)
        shutil.copy(HERE / 'lib/backup_restore.py', implementation / 'lib')
        for case in cases:
            out = root / case
            out.mkdir()
            (out / 'config.json').write_text(snapshot({
                'theme.homeSectionOrder': value(['shortcuts', 'recent', 'continue', 'discovery']),
                'library.playlistView': value('list'),
                'library.playlistOrganization': value({'pinnedIds': ['new-id'], 'groupBySheetId': {'new-id': 'E2E Backup Group'}}),
            }))
            (out / 'index.json').write_text(snapshot({'data': value([
                {'id': 'new-id', 'title': 'E2E Backup Playlist', 'description': 'E2E backup description',
                 'artist': 'E2E Backup Artist', 'coverImg': 'https://example.org/e2e-backup-cover.png', 'createAt': 1234},
                {'id': 'legacy-new', 'title': 'E2E Legacy Playlist', 'description': 'E2E legacy description'},
            ])}))
            (out / 'songs.json').write_text(snapshot({
                'data': value([
                    {'id': 'e2e-backup-old', 'title': 'Z Old Song', '$timestamp': 100, '$sortIndex': 0},
                    {'id': 'e2e-backup-new', 'title': 'A New Song', '$timestamp': 200, '$sortIndex': 0},
                ]), 'meta.sort': {'t': 's', 'v': 'time-rev'},
            }))
            run = subprocess.run(['bash', '-c', SCRIPT, 'backup-flow', str(out), case, str(implementation)],
                                 capture_output=True, text=True, timeout=15)
            rows = (out / 'results.tsv').read_text().splitlines()
            failures = [row for row in rows if row.startswith('FAIL\t')]
            # The existing flow and its file-protection check report separate
            # failures. The new wrapper must not append a third one.
            expected = 0 if case == 'normal' else 2 if case in ('flow-fails', 'prior-failure-and-pull') else 1
            try:
                assert run.returncode == (0 if case == 'normal' else 1), f'exit={run.returncode}'
                assert len(failures) == expected, failures
                assert f'{expected} 项失败' in (out / 'summary.md').read_text()
                if case == 'normal':
                    assert (out / 'backup-recovered-verified.json').is_file()
                    assert (out / 'boundary-wide-pixels.json').is_file()
                if case == 'flow-fails':
                    assert 'shell chmod 700 /synthetic/App.config' in (out / 'adb-calls.txt').read_text()
                    assert not any('专项完整性' in row for row in failures), 'duplicate failure'
                print(f'ok backup suite {case}: exit={run.returncode}, failures={len(failures)}')
            except AssertionError as error:
                errors.append(f'{case}: {error}\n{run.stdout}\n{run.stderr}')
    assert not errors, '\n'.join(errors)
    print(f'backup suite failure propagation: {len(cases)} cases passed')


if __name__ == '__main__':
    main()
