#!/usr/bin/env python3
"""Check actual Release DEX reflection contracts and run legacy-tag files through
the project's own R8 in classfile mode. The host smoke is not Android execution;
the packaged DEX checks and Beta's real downloads cover the delivered code too.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, **kwargs):
    result = subprocess.run([str(x) for x in command], text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise ValueError(f"Command failed: {command[0]}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def dex_constructors(data):
    if not data.startswith(b"dex\n"):
        raise ValueError("Not a standard DEX file")
    u = lambda p: struct.unpack_from('<I', data, p)[0]
    h = lambda p: struct.unpack_from('<H', data, p)[0]

    def leb(p):
        value = shift = 0
        while True:
            byte = data[p]
            p += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, p
            shift += 7
            if shift > 35:
                raise ValueError("Invalid DEX ULEB128")

    strings = []
    for i in range(u(56)):
        _, start = leb(u(u(60) + i * 4))
        strings.append(data[start:data.index(b'\0', start)].decode('utf8', 'replace'))
    types = [strings[u(u(68) + i * 4)] for i in range(u(64))]
    methods = []
    for i in range(u(88)):
        p = u(92) + i * 8
        proto = u(76) + h(p + 2) * 12
        off = u(proto + 8)
        args = ''.join(types[h(off + 4 + j * 2)] for j in range(u(off))) if off else ''
        methods.append((strings[u(p + 4)], '(' + args + ')' + types[u(proto + 4)]))
    classes = {}
    for i in range(u(96)):
        p = u(100) + i * 32
        name, off = types[u(p)], u(p + 24)
        constructors = {}
        if off:
            counts = []
            for _ in range(4):
                count, off = leb(off)
                counts.append(count)
            for count in counts[:2]:
                for _ in range(count):
                    _, off = leb(off)
                    _, off = leb(off)
            for count in counts[2:]:
                index = 0
                for _ in range(count):
                    diff, off = leb(off)
                    index += diff
                    flags, off = leb(off)
                    _, off = leb(off)
                    method, descriptor = methods[index]
                    if method == '<init>':
                        constructors[descriptor] = flags
        classes[name] = constructors
    return classes


def contracts(jar, javap):
    # Ask the actual dependency JAR for constructor descriptors; do not keep a
    # guessed list of field/reader names that drifts from the bundled version.
    with zipfile.ZipFile(jar) as z:
        names = [n[:-6].replace('/', '.') for n in z.namelist() if n.endswith('.class') and
                 (n.startswith('org/jaudiotagger/tag/datatype/') or
                  n.startswith('org/jaudiotagger/audio/asf/io/') and n.endswith('Reader.class'))]
    text = run([javap, '-p', '-s', '-classpath', jar, *names])
    expected = {}
    current = previous = ''
    for line in text.splitlines():
        match = re.search(r'\b(?:class|interface) ([\w.$]+)', line)
        if match:
            current = match[1]
        descriptor = re.search(r'descriptor: (\(.*\)V)', line)
        if descriptor and current + '(' in previous:
            family = 'datatype' if '.tag.datatype.' in current else 'asf'
            if (family == 'datatype' and previous.strip().startswith('public ')) or (family == 'asf' and descriptor[1] == '()V'):
                expected.setdefault('L' + current.replace('.', '/') + ';', {})[descriptor[1]] = family
        previous = line
    if not expected or not any(v == 'asf' for rows in expected.values() for v in rows.values()):
        raise ValueError('Dependency constructor inventory is empty')
    return expected


def inspect(apk, expected):
    classes = {}
    with zipfile.ZipFile(apk) as z:
        for name in z.namelist():
            if re.fullmatch(r'classes\d*\.dex', name):
                classes.update(dex_constructors(z.read(name)))
    checked = {'datatype': 0, 'asf': 0}
    errors = []
    for name, signatures in expected.items():
        # Unreachable field types may be removed entirely. A live type's public
        # constructors must remain callable through reflection at runtime.
        if name not in classes:
            if 'asf' in signatures.values():
                errors.append('Missing registered ASF reader ' + name)
            continue
        for signature, family in signatures.items():
            if signature not in classes[name] or family == 'datatype' and not classes[name][signature] & 1:
                errors.append(name + '::<init>' + signature)
            checked[family] += 1
    required_asf = sum(family == 'asf' for rows in expected.values() for family in rows.values())
    if not classes or checked['datatype'] == 0 or checked['asf'] != required_asf or 'Lorg/jaudiotagger/tag/datatype/NumberHashMap;' not in classes:
        errors.append('Missing tagging families or unexpectedly incomplete contract inventory')
    return {'apk': apk.name, 'definedClasses': len(classes), 'constructorsChecked': checked, 'errors': errors}


def independent_roundtrip(original, written):
    # A library reading its own output can miss stale duplicate ASF fields.
    # Require an independent reader and decode every audio packet as well.
    probe = json.loads(run(['ffprobe', '-v', 'error', '-show_entries',
                            'format_tags=title,artist,album', '-of', 'json', written]))
    tags = {key.lower(): value for key, value in probe.get('format', {}).get('tags', {}).items()}
    expected = {'title': 'After Title', 'artist': 'After Artist', 'album': 'After Album'}
    if any(tags.get(key) != value for key, value in expected.items()):
        raise ValueError(f'Independent tag read failed for {written.name}: {tags}')
    command = ['ffmpeg', '-v', 'error', '-xerror', '-i']
    options = ['-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-']
    original_pcm = run([*command, original, *options]).strip()
    written_pcm = run([*command, written, *options]).strip()
    if not original_pcm.startswith('SHA256=') or original_pcm != written_pcm:
        raise ValueError(f'Tagging changed decoded audio in {written.name}')
    return {'file': written.name, 'tags': tags, 'pcm': written_pcm}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apks', nargs='+', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--apk-only', action='store_true', help='Diagnostic: omit host smoke')
    args = parser.parse_args()
    java = Path(os.environ['JAVA_HOME']) / 'bin'
    cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'
    version = re.search(r"net\.jthink:jaudiotagger:([^'\"]+)", (ROOT / 'android/app/build.gradle').read_text())[1]
    jar, = (cache / 'net.jthink/jaudiotagger' / version).glob('*/*.jar')
    expected = contracts(jar, java / 'javap')
    report = {'dependencyVersion': version, 'apks': [inspect(p, expected) for p in args.apks]}
    if not args.apk_only:
        for path, header in [('tests/fixtures/tagging/id3v23.mp3', b'ID3\x03'),
                             ('tests/fixtures/tagging/id3v24.mp3', b'ID3\x04'),
                             ('e2e/fixtures/tone-b.mp3', b'ID3\x03'),
                             ('e2e/fixtures/tagged.wma', bytes.fromhex('3026b2758e66cf11a6d900aa0062ce6c'))]:
            if not (ROOT / path).read_bytes().startswith(header):
                raise ValueError('Regression fixture lost its required tag/container version: ' + path)
        agp = tomllib.loads((ROOT / 'node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml').read_text())['versions']['agp']
        builder, = (cache / 'com.android.tools.build/builder' / agp).glob('*/*.jar')
        r8version = run([java / 'java', '-cp', builder, 'com.android.tools.r8.R8', '--version']).strip()
        mapping = (ROOT / 'android/app/build/outputs/mapping/release/mapping.txt').read_text()
        compiler = re.search(r'^# compiler_version: (\S+)', mapping, re.M)[1]
        if not r8version.startswith('R8 ' + compiler + ' '):
            raise ValueError('Smoke compiler differs from the actual Release R8')
        sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
        compile_sdk = re.search(r'compileSdkVersion\s*=\s*(\d+)', (ROOT / 'android/build.gradle').read_text())[1]
        with tempfile.TemporaryDirectory(prefix='musicfree-tagging-') as tmp:
            tmp = Path(tmp)
            (tmp / 'classes').mkdir()
            run([java / 'javac', '--release', '17', '-cp', jar, '-d', tmp / 'classes',
                 ROOT / 'tests/native/tagging/TaggingRoundTrip.java',
                 ROOT / 'android/app/src/main/java/fun/upup/musicfree/mp3Util/MediaTagFieldWriter.java'])
            run([java / 'jar', 'cf', tmp / 'driver.jar', '-C', tmp / 'classes', '.'])
            (tmp / 'driver.pro').write_text('-keep class TaggingRoundTrip { public static void main(java.lang.String[]); }\n')
            run([java / 'java', '-Xmx1024m', '-cp', builder, 'com.android.tools.r8.R8', '--classfile', '--release',
                 '--lib', java.parent, '--lib', sdk / f'platforms/android-{compile_sdk}/android.jar',
                 '--pg-conf', ROOT / f'android/app/build/intermediates/default_proguard_files/global/proguard-android.txt-{agp}',
                 '--pg-conf', ROOT / 'android/app/proguard-rules.pro', '--pg-conf', tmp / 'driver.pro',
                 '--output', tmp / 'shrunk.jar', jar, tmp / 'driver.jar'])
            fixtures = [ROOT / 'tests/fixtures/tagging/id3v23.mp3', ROOT / 'tests/fixtures/tagging/id3v24.mp3', ROOT / 'e2e/fixtures/tagged.wma']
            for fixture in fixtures:
                shutil.copy2(fixture, tmp / fixture.name)
            output = run([java / 'java', '-Djava.awt.headless=true', '-cp', tmp / 'shrunk.jar', 'TaggingRoundTrip',
                          ROOT / 'tests/fixtures/tagging/cover.png', *[tmp / f.name for f in fixtures]])
            if len([line for line in output.splitlines() if line.startswith('PASS ')]) != 3:
                raise ValueError('Incomplete legacy-tag smoke results')
            report['hostSmoke'] = {'r8': r8version, 'passedFiles': [p.name for p in fixtures], 'output': output.strip(),
                                   'independentFiles': [independent_roundtrip(f, tmp / f.name) for f in fixtures],
                                   'scope': 'actual project R8 classfile smoke, not Android execution'}
    report['passed'] = all(not row['errors'] for row in report['apks'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError, IndexError, struct.error, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
