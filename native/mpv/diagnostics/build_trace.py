#!/usr/bin/env python3
"""Build only an explicitly diagnostic x86_64 library in a fresh private directory."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PRODUCT = HERE.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--sdk', type=Path, default=os.environ.get('ANDROID_HOME'))
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    work = args.work_dir.resolve()
    if work.exists() and any(work.iterdir()):
        parser.error('use a fresh work directory; existing work will not be reset')
    work.mkdir(parents=True, exist_ok=True)
    meta = json.loads((HERE / 'trace-source.json').read_text())
    assert meta['diagnosticOnly'] is True and meta['abi'] == 'x86_64'
    assert sha(PRODUCT / 'sources.lock.json') == meta['baseLockSha256']
    assert sha(HERE / 'ao-clock-trace.patch') == meta['tracePatchSha256']
    assert meta['experimentalShortReadFix'] is True
    assert sha(HERE / 'short-read-clock.patch') == meta['bufferPatchSha256']
    producer_dir = work / 'producer'
    producer_dir.mkdir()
    for name in ['rebuild.py', 'audiotrack_latency.h']:
        shutil.copyfile(PRODUCT / name, producer_dir / name)
    shutil.copyfile(HERE / 'ao-clock-trace.patch', producer_dir / 'audiotrack-startup-delay.patch')
    lock = json.loads((PRODUCT / 'sources.lock.json').read_text())
    lock.update(patchedDriverSha256=meta['patchedDriverSha256'], diagnosticOnly=True,
                purpose='Experimental short-read correction with AO counters; not a product AAR')
    (producer_dir / 'sources.lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    if args.prepare_only:
        print('Diagnostic producer prepared; no library built.')
        return
    if args.sdk is None:
        parser.error('--sdk or ANDROID_HOME is required')
    ndk = args.sdk / 'ndk' / lock['ndk']
    revision = re.search(r'^Pkg.Revision\s*=\s*(\S+)', (ndk / 'source.properties').read_text(), re.M)
    assert revision and revision.group(1) == lock['ndk'], 'NDK revision differs from the pinned producer'
    spec = importlib.util.spec_from_file_location('trace_producer', producer_dir / 'rebuild.py')
    producer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(producer)
    producer.ROOT = REPO
    base = work / 'base.aar'
    with base.open('wb') as out:
        subprocess.run(['git', '-C', str(REPO), 'show',
                        lock['baseCommit'] + ':android/app/libs/libmpv-release.aar'], stdout=out, check=True)
    assert sha(base) == lock['baseAarSha256']
    producer.prepare_sources(work / 'sources')
    subprocess.run([sys.executable, str(HERE / 'check_short_read.py'),
                    str(work / 'sources/mpv')], check=True)
    buffer = work / 'sources/mpv/audio/out/buffer.c'
    assert sha(buffer) == meta['upstreamBufferSha256'], 'unexpected upstream buffer source'
    subprocess.run(['git', '-C', str(buffer.parents[2]), 'apply', '--check',
                    str(HERE / 'short-read-clock.patch')], check=True)
    subprocess.run(['git', '-C', str(buffer.parents[2]), 'apply',
                    str(HERE / 'short-read-clock.patch')], check=True)
    assert sha(buffer) == meta['patchedBufferSha256'], 'short-read correction differs'
    producer.build('x86_64', work / 'sources', work, ndk, base)
    assert sha(buffer) == meta['patchedBufferSha256'], 'buffer source changed during build'
    library = work / 'output/x86_64/libmpv.so'
    diagnostic = library.with_name('libmpv-DIAGNOSTIC-ONLY.so')
    library.rename(diagnostic)
    manifest = meta | {'librarySha256': sha(diagnostic), 'library': str(diagnostic),
                       'scriptCommit': subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip(),
                       'producerInputs': json.loads(library.with_suffix('.json').read_text())}
    (work / 'diagnostic-build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('DIAGNOSTIC ONLY:', diagnostic)


if __name__ == '__main__':
    main()
