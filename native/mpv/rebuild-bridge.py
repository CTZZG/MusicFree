#!/usr/bin/env python3
"""Rebuild only the pinned JNI/Java bridge; preserve engine/FFmpeg/runtime payloads."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BRIDGE = HERE / 'bridge'
ABIS = {'arm64-v8a': 'aarch64-linux-android', 'armeabi-v7a': 'armv7a-linux-androideabi',
        'x86': 'i686-linux-android', 'x86_64': 'x86_64-linux-android'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def build_inputs():
    upstream = json.loads((BRIDGE / 'upstream.lock.json').read_text())
    if {p.relative_to(BRIDGE/'upstream').as_posix() for p in (BRIDGE/'upstream').rglob('*') if p.is_file()} != set(upstream['files']):
        raise ValueError('Unexpected files in pinned bridge sources')
    for name, expected in upstream['files'].items():
        if sha((BRIDGE / 'upstream' / name).read_bytes()) != expected:
            raise ValueError('Pinned bridge source changed: '+name)
    headers = json.loads((BRIDGE / 'include.lock.json').read_text())
    if {p.relative_to(BRIDGE/'include').as_posix() for p in (BRIDGE/'include').rglob('*') if p.is_file()} != set(headers):
        raise ValueError('Unexpected files in pinned bridge headers')
    for name, record in headers.items():
        if sha((BRIDGE / 'include' / name).read_bytes()) != record['sha256']:
            raise ValueError('Pinned bridge header changed: '+name)
    names = ['rebuild-bridge.py', 'bridge/upstream.lock.json', 'bridge/include.lock.json',
             'bridge/build.lock.json', 'bridge/file-events.patch']
    return {name: sha((HERE / name).read_bytes()) for name in names}

def prepare_sources(destination):
    build_inputs()
    with tempfile.TemporaryDirectory(prefix='musicfree-bridge-source-') as directory:
        expected = Path(directory)/'source'
        shutil.copytree(BRIDGE/'upstream', expected)
        subprocess.run(['git', 'apply', '--check', str(BRIDGE/'file-events.patch')], cwd=expected, check=True)
        subprocess.run(['git', 'apply', str(BRIDGE/'file-events.patch')], cwd=expected, check=True)
        if not destination.exists(): shutil.copytree(expected, destination)
        def entries(root):
            return {p.relative_to(root).as_posix(): sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
        if entries(destination) != entries(expected):
            raise ValueError('Unrecognized changes in bridge work directory; use a clean work directory')
    return destination

def check_elf(data, abi=None):
    if data[:4] != b'\x7fELF' or data[5] != 1 or data[4] not in (1, 2):
        raise ValueError('Expected little-endian ELF')
    wide = data[4] == 2
    machines = {'arm64-v8a': (183, True), 'armeabi-v7a': (40, False), 'x86': (3, False), 'x86_64': (62, True)}
    if struct.unpack_from('<H', data, 16)[0] != 3:
        raise ValueError('Expected a shared ELF library')
    if abi is not None and machines[abi] != (struct.unpack_from('<H', data, 18)[0], wide):
        raise ValueError('Bridge ELF architecture disagrees with '+abi)
    phoff = struct.unpack_from('<Q' if wide else '<I', data, 32 if wide else 28)[0]
    entsize, count = struct.unpack_from('<HH', data, 54 if wide else 42)
    loads = 0
    segments = []
    dynamic = None
    for i in range(count):
        start = phoff + i * entsize
        kind = struct.unpack_from('<I', data, start)[0]
        offset, address = struct.unpack_from('<QQ' if wide else '<II', data, start + (8 if wide else 4))
        size = struct.unpack_from('<Q' if wide else '<I', data, start + (32 if wide else 16))[0]
        if kind == 1:
            loads += 1
            segments.append((address, size, offset))
            alignment = struct.unpack_from('<Q' if wide else '<I', data, start + (48 if wide else 28))[0]
            if alignment < 16384: raise ValueError('Bridge LOAD segment is not 16KiB aligned')
        elif kind == 2:
            dynamic = (offset, size)
    if loads == 0: raise ValueError('Bridge contains no ELF LOAD segments')
    if dynamic is None: raise ValueError('Bridge contains no ELF dynamic section')
    tags = {}
    stride = 16 if wide else 8
    for offset in range(dynamic[0], sum(dynamic), stride):
        tag, value = struct.unpack_from('<qQ' if wide else '<iI', data, offset)
        if tag == 0: break
        tags[tag] = value
    table = next((offset + tags.get(5, -1) - address for address, size, offset in segments
                  if address <= tags.get(5, -1) < address + size), None)
    if table is None or 14 not in tags or tags[14] >= tags.get(10, 0):
        raise ValueError('Bridge ELF SONAME is missing')
    start = table + tags[14]
    end = data.find(b'\0', start, table + tags[10])
    if end < 0 or data[start:end] != b'libplayer.so':
        raise ValueError('Bridge ELF SONAME must be libplayer.so')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', required=True, type=Path)
    parser.add_argument('--jdk', required=True, type=Path)
    parser.add_argument('--kotlin-dir', required=True, type=Path)
    parser.add_argument('--work-dir', required=True, type=Path)
    parser.add_argument('--no-assemble', action='store_true')
    args = parser.parse_args()
    inputs = build_inputs()
    lock = json.loads((BRIDGE / 'build.lock.json').read_text())
    android_jar = args.sdk / lock['androidJar']['path']
    if sha(android_jar.read_bytes()) != lock['androidJar']['sha256']:
        raise ValueError('Unrecognized Android SDK compilation input')
    ndk = args.sdk / 'ndk' / lock['ndk']
    if 'Pkg.Revision = '+lock['ndk'] not in (ndk/'source.properties').read_text():
        raise ValueError('Unexpected NDK revision')
    for name, record in lock['compilerJars'].items():
        if sha((args.kotlin_dir/name).read_bytes()) != record['sha256']:
            raise ValueError('Unrecognized Kotlin compiler input: '+name)
    version = subprocess.check_output([str(args.jdk/'bin/java'), '-version'], stderr=subprocess.STDOUT).decode()
    if 'version "21.' not in version: raise ValueError('Use Java 21 for the bridge')
    fingerprint = sha(json.dumps(inputs, sort_keys=True).encode())[:16]
    work = args.work_dir / fingerprint
    work.mkdir(parents=True, exist_ok=True)
    source = prepare_sources(work/'source')
    aar = ROOT / 'android/app/libs/libmpv-release.aar'
    manifest_path = HERE / 'bundle.json'
    manifest = json.loads(manifest_path.read_text())
    with zipfile.ZipFile(aar) as archive:
        actual = {info.filename: sha(archive.read(info)) for info in archive.infolist() if not info.is_dir()}
        if actual != manifest['entries']: raise ValueError('Input AAR differs from reviewed manifest')
        base_jar = archive.read('classes.jar')
        for abi in ABIS:
            libdir = work/'base'/abi
            libdir.mkdir(parents=True, exist_ok=True)
            for name in ['libmpv.so', 'libavcodec.so']:
                (libdir/name).write_bytes(archive.read('jni/'+abi+'/'+name))
    java_source = source/'libmpv/src/main/java/dev/jdtech/mpv/MPVLib.kt'
    classes = work/'classes'
    classes.mkdir(exist_ok=True)
    classpath = ':'.join(str(p) for p in [android_jar,
        args.kotlin_dir/'kotlin-stdlib-2.1.20.jar', args.kotlin_dir/'annotations-13.0.jar'])
    compiler_classpath = ':'.join(str(args.kotlin_dir/name) for name in sorted(lock['compilerJars']))
    subprocess.run([str(args.jdk/'bin/java'), '-cp', compiler_classpath,
        'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', str(lock['jvmTarget']),
        '-Xjvm-default=all-compatibility', '-module-name', 'libmpv_release', '-classpath', classpath,
        '-d', str(classes), str(java_source)], check=True)
    import io
    jar_entries = {}
    with zipfile.ZipFile(io.BytesIO(base_jar)) as old:
        for info in old.infolist():
            if not info.filename.startswith('dev/jdtech/mpv/MPVLib') and not info.filename.endswith('.kotlin_module') and not info.is_dir():
                jar_entries[info.filename] = old.read(info)
    for file in classes.rglob('*'):
        if file.is_file(): jar_entries[file.relative_to(classes).as_posix()] = file.read_bytes()
    output = work/'output'
    output.mkdir(exist_ok=True)
    with zipfile.ZipFile(output/'classes.jar', 'w', compression=zipfile.ZIP_DEFLATED) as jar:
        for name, data in sorted(jar_entries.items()):
            info = zipfile.ZipInfo(name, (1980,1,1,0,0,0)); info.compress_type = zipfile.ZIP_DEFLATED
            jar.writestr(info, data)
    toolchain = ndk/'toolchains/llvm/prebuilt/linux-x86_64'
    cpp = source/'libmpv/src/main/cpp'
    def compile_abi(item):
        abi, triple = item
        target = output/abi/'libplayer.so'
        target.parent.mkdir(exist_ok=True)
        command = [str(toolchain/'bin/clang++'), '--target='+triple+str(lock['api']),
            '-shared', '-fPIC', '-O2', '-Werror', '-fvisibility=hidden', '-std=c++11',
            '-Wl,--no-undefined', '-Wl,-soname,libplayer.so', '-Wl,-z,max-page-size=16384',
            '-I'+str(BRIDGE/'include'), '-I'+str(cpp), '-L'+str(work/'base'/abi)]
        command += [str(cpp/name) for name in ['main.cpp','render.cpp','log.cpp','jni_utils.cpp','property.cpp','event.cpp']]
        command += ['-lmpv', '-lavcodec', '-llog', '-o', str(target)]
        subprocess.run(command, check=True)
        data = target.read_bytes(); check_elf(data, abi)
        return 'jni/'+abi+'/libplayer.so', data
    replacements = dict(ThreadPoolExecutor(max_workers=4).map(compile_abi, ABIS.items()))
    replacements['classes.jar'] = (output/'classes.jar').read_bytes()
    bridge_record = {'protocolVersion': 2, 'inputs': inputs,
        'entries': {name: sha(data) for name,data in replacements.items()},
        'ndk': lock['ndk'], 'api': lock['api'], 'kotlin': lock['kotlin'], 'jvmTarget': lock['jvmTarget'],
        'javaVersion': version.splitlines()[0], 'upstream': json.loads((BRIDGE/'upstream.lock.json').read_text())['commit']}
    (output/'bridge.json').write_text(json.dumps(bridge_record, indent=2, sort_keys=True)+'\n')
    if args.no_assemble:
        print('Bridge compiled:',output);return
    partial = aar.with_suffix('.aar.partial')
    with zipfile.ZipFile(aar) as src, zipfile.ZipFile(partial, 'w') as dst:
        for info in src.infolist():
            data = replacements.get(info.filename, src.read(info))
            dst.writestr(info, data)
            if not info.is_dir(): manifest['entries'][info.filename] = sha(data)
    manifest['bridge'] = bridge_record
    manifest_temp = manifest_path.with_suffix('.json.partial')
    manifest_temp.write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    partial.replace(aar)
    manifest_temp.replace(manifest_path)
    print('Rebuilt four JNI ABIs and Java; existing mpv, FFmpeg and C++ runtime preserved')

if __name__ == '__main__': main()
