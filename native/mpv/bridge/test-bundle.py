#!/usr/bin/env python3
"""Exercise real bundle validation with isolated corruptions, never the product AAR."""
from pathlib import Path
import hashlib
import io
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

class BundleGuardTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='musicfree-bundle-test-')
        self.root = Path(self.temporary.name)
        shutil.copytree(ROOT/'native/mpv', self.root/'native/mpv', ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        self.aar = self.root/'android/app/libs/libmpv-release.aar'
        self.aar.parent.mkdir(parents=True)
        shutil.copyfile(ROOT/'android/app/libs/libmpv-release.aar', self.aar)
        self.path = self.root/'native/mpv/bundle.json'
        self.manifest = json.loads(self.path.read_text())

    def tearDown(self):
        self.temporary.cleanup()

    def verify(self):
        self.path.write_text(json.dumps(self.manifest))
        return subprocess.run([sys.executable,'-I',str(self.root/'native/mpv/verify-bundle.py')],capture_output=True,text=True)

    def replace_entry(self, name, transform):
        partial = self.aar.with_suffix('.partial')
        with zipfile.ZipFile(self.aar) as src, zipfile.ZipFile(partial,'w') as dst:
            for info in src.infolist():
                data = src.read(info)
                if info.filename == name: data = transform(data)
                dst.writestr(info,data)
                if not info.is_dir(): self.manifest['entries'][info.filename] = hashlib.sha256(data).hexdigest()
        partial.replace(self.aar)
        if name in self.manifest['bridge']['entries']:
            self.manifest['bridge']['entries'][name] = self.manifest['entries'][name]

    def test_current_bundle(self):
        result = self.verify()
        self.assertEqual(0,result.returncode,result.stdout+result.stderr)

    def test_stale_bridge_source(self):
        self.manifest['bridge']['inputs']['bridge/file-events.patch'] = '0'*64
        self.assertNotEqual(0,self.verify().returncode)

    def test_incomplete_bridge_abi_set(self):
        self.manifest['bridge']['entries'].pop('jni/x86/libplayer.so')
        self.assertNotEqual(0,self.verify().returncode)

    def test_downgraded_protocol(self):
        self.manifest['bridge']['protocolVersion'] = 1
        self.assertNotEqual(0,self.verify().returncode)

    def test_decoder_changes_cannot_be_hidden_in_the_bridge_update(self):
        self.replace_entry('jni/arm64-v8a/libavcodec.so',lambda data:data[:-1]+bytes([data[-1]^1]))
        result = self.verify()
        self.assertNotEqual(0,result.returncode)
        self.assertIn('Unexpected native bundle replacements',result.stdout+result.stderr)

    def test_wrong_elf_architecture_even_if_entry_digests_are_rewritten(self):
        def change(data):
            changed = bytearray(data); struct.pack_into('<H',changed,18,183); return bytes(changed)
        self.replace_entry('jni/x86_64/libplayer.so',change)
        result = self.verify()
        self.assertNotEqual(0,result.returncode)
        self.assertIn('architecture',result.stdout+result.stderr)

    def test_java_newer_than_ci_jdk_even_if_entry_digests_are_rewritten(self):
        def change(data):
            output = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(output,'w') as dst:
                for info in src.infolist():
                    content = src.read(info)
                    if info.filename == 'dev/jdtech/mpv/MPVLib.class':
                        altered = bytearray(content); struct.pack_into('>H',altered,6,65); content = bytes(altered)
                    dst.writestr(info,content)
            return output.getvalue()
        self.replace_entry('classes.jar',change)
        result = self.verify()
        self.assertNotEqual(0,result.returncode)
        self.assertIn('Java target',result.stdout+result.stderr)

    def test_unpinned_header_is_rejected(self):
        (self.root/'native/mpv/bridge/include/jni.h').write_text('unreviewed header')
        result = self.verify()
        self.assertNotEqual(0,result.returncode)
        self.assertIn('Unexpected files',result.stdout+result.stderr)

    def test_invalid_load_alignment_even_if_digests_are_rewritten(self):
        def change(data):
            changed = bytearray(data)
            phoff = struct.unpack_from('<Q', changed, 32)[0]
            stride, count = struct.unpack_from('<HH', changed, 54)
            for index in range(count):
                offset = phoff + index * stride
                if struct.unpack_from('<I', changed, offset)[0] == 1:
                    struct.pack_into('<Q', changed, offset + 48, 4096)
            return bytes(changed)
        self.replace_entry('jni/arm64-v8a/libplayer.so', change)
        result = self.verify()
        self.assertNotEqual(0, result.returncode)
        self.assertIn('16KiB aligned', result.stdout + result.stderr)

    def test_invalid_soname_even_if_digests_are_rewritten(self):
        def change(data):
            self.assertIn(b'libplayer.so\0', data)
            return data.replace(b'libplayer.so\0', b'badplayer.so\0')
        self.replace_entry('jni/x86_64/libplayer.so', change)
        result = self.verify()
        self.assertNotEqual(0, result.returncode)
        self.assertIn('SONAME', result.stdout + result.stderr)

    def test_every_nested_java_class_uses_the_supported_target(self):
        def change(data):
            output = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(output, 'w') as dst:
                for info in src.infolist():
                    content = src.read(info)
                    if info.filename == 'dev/jdtech/mpv/MPVLib$Companion.class':
                        altered = bytearray(content)
                        struct.pack_into('>H', altered, 6, 65)
                        content = bytes(altered)
                    dst.writestr(info, content)
            return output.getvalue()
        self.replace_entry('classes.jar', change)
        result = self.verify()
        self.assertNotEqual(0, result.returncode)
        self.assertIn('Java target', result.stdout + result.stderr)

    def test_engine_assembly_cannot_drop_the_bridge_record(self):
        lock_path = self.root / 'native/mpv/sources.lock.json'
        lock = json.loads(lock_path.read_text())
        lock['baseAarSha256'] = hashlib.sha256(self.aar.read_bytes()).hexdigest()
        lock_path.write_text(json.dumps(lock))
        self.manifest.pop('bridge')
        self.path.write_text(json.dumps(self.manifest))
        result = subprocess.run([sys.executable, str(self.root / 'native/mpv/assemble.py'),
            '--work-dir', str(self.root / 'work'), '--base-aar', str(self.aar)], capture_output=True, text=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn('Missing reviewed file-event bridge', result.stdout + result.stderr)

if __name__ == '__main__': unittest.main()
