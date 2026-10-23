#!/usr/bin/env python3
"""Inject a trace library into a copy of a debuggable APK, using only the public debug key."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

SIGNATURE = re.compile(r'META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))$', re.I)
ENTRY = 'lib/x86_64/libmpv.so'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def payload(path):
    with zipfile.ZipFile(path) as archive:
        return {x.filename: sha(archive.read(x)) for x in archive.infolist()
                if not x.is_dir() and not SIGNATURE.fullmatch(x.filename)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--test', type=Path, required=True)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--build-info', type=Path, required=True)
    parser.add_argument('--sdk-tools', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    meta = json.loads(args.build_info.read_text())
    assert meta['diagnosticOnly'] is True
    assert sha(args.library.read_bytes()) == meta['librarySha256']
    assert b'AO_CLOCK_DIAGNOSTIC' in args.library.read_bytes()
    badging = subprocess.check_output([str(args.sdk_tools / 'aapt2'), 'dump', 'badging', str(args.app)], text=True)
    assert 'application-debuggable' in badging, 'refusing to modify a non-debuggable app'
    before = payload(args.app)
    assert ENTRY in before
    args.output.parent.mkdir(parents=True, exist_ok=True)
    unsigned = args.output.with_suffix('.unsigned.apk')
    aligned = args.output.with_suffix('.aligned.apk')
    with zipfile.ZipFile(args.app) as source, zipfile.ZipFile(unsigned, 'w') as target:
        for entry in source.infolist():
            if not SIGNATURE.fullmatch(entry.filename):
                target.writestr(entry, args.library.read_bytes() if entry.filename == ENTRY else source.read(entry))
    subprocess.run([str(args.sdk_tools / 'zipalign'), '-f', '-P', '16', '4', str(unsigned), str(aligned)], check=True)
    key = Path(__file__).resolve().parents[3] / 'android/app/debug.keystore'
    signer = ['java', '-jar', str(args.sdk_tools / 'lib/apksigner.jar')]
    subprocess.run([*signer, 'sign', '--ks', str(key),
                    '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android',
                    '--key-pass', 'pass:android', '--v4-signing-enabled', 'false',
                    '--out', str(args.output), str(aligned)], check=True)
    after = payload(args.output)
    assert before.keys() == after.keys()
    assert [name for name in before if before[name] != after[name]] == [ENTRY], 'unexpected APK payload changes'
    certificates = []
    for file in [args.output, args.test]:
        proof = subprocess.check_output([*signer, 'verify', '--verbose',
                                         '--print-certs', str(file)], text=True)
        certificates.append(re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', proof).group(1))
    assert certificates[0] == certificates[1], 'test APK and diagnostic target must share the debug certificate'
    report = {'diagnosticOnly': True, 'changedPayloads': [ENTRY], 'librarySha256': after[ENTRY],
              'sourceApkSha256': sha(args.app.read_bytes()), 'diagnosticApkSha256': sha(args.output.read_bytes()),
              'testApkSha256': sha(args.test.read_bytes()), 'debugCertificateSha256': certificates[0]}
    args.output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
