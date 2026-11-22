#!/usr/bin/env python3
"""Reject stale sources, incomplete engine/bridge ABIs, or unreviewed decoder payloads."""
import importlib.util
import io
import struct
import sys
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
ROOT = HERE.parents[1]
manifest = json.loads((HERE / "bundle.json").read_text())
for name, expected in manifest["inputs"].items():
    actual = hashlib.sha256((HERE / name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"Source/build input differs from bundled libmpv: {name}; rebuild the library")
with zipfile.ZipFile(ROOT / "android/app/libs/libmpv-release.aar") as archive:
    actual = {entry.filename: hashlib.sha256(archive.read(entry)).hexdigest()
              for entry in archive.infolist() if not entry.is_dir()}
if actual != manifest["entries"]:
    changed = sorted(name for name in set(actual) | set(manifest["entries"])
                     if actual.get(name) != manifest["entries"].get(name))
    raise SystemExit(f"Bundled native payload differs: {changed}")
replacements = {f"jni/{abi}/libmpv.so" for abi in ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]}
bridge = manifest.get("bridge")
if (HERE / "bridge/file-events.patch").exists() and bridge is None:
    raise SystemExit("Missing reviewed file-event bridge")
if bridge is not None:
    spec = importlib.util.spec_from_file_location("musicfree_bridge", HERE / "rebuild-bridge.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    if bridge.get("protocolVersion") != 2 or bridge.get("inputs") != builder.build_inputs():
        raise SystemExit("Bridge protocol or source inputs are stale; rebuild the bridge")
    lock = json.loads((HERE / "bridge/build.lock.json").read_text())
    upstream = json.loads((HERE / "bridge/upstream.lock.json").read_text())
    if bridge.get("ndk") != lock["ndk"] or bridge.get("api") != lock["api"] or \
            bridge.get("kotlin") != lock["kotlin"] or bridge.get("jvmTarget") != lock["jvmTarget"] or \
            bridge.get("upstream") != upstream["commit"]:
        raise SystemExit("Bridge build provenance disagrees with pinned inputs")
    payloads = {f"jni/{abi}/libplayer.so" for abi in ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]} | {"classes.jar"}
    if set(bridge.get("entries", {})) != payloads or any(bridge["entries"][name] != actual.get(name) for name in payloads):
        raise SystemExit("Bridge requires matching Java and all four JNI ABIs")
    with zipfile.ZipFile(ROOT / "android/app/libs/libmpv-release.aar") as archive:
        for name in payloads - {"classes.jar"}:
            content = archive.read(name)
            builder.check_elf(content, name.split('/')[1])
            for symbol in [b"Java_dev_jdtech_mpv_MPVLib_nativeLoadFile\0", b"Java_dev_jdtech_mpv_MPVLib_nativeEventProtocolVersion\0"]:
                if symbol not in content: raise SystemExit("Missing file-event JNI export in " + name)
        with zipfile.ZipFile(io.BytesIO(archive.read("classes.jar"))) as classes:
            for name in classes.namelist():
                if not name.endswith('.class'): continue
                data = classes.read(name)
                if data[:4] != b'\xca\xfe\xba\xbe' or struct.unpack_from('>H', data, 6)[0] != lock["jvmTarget"] + 44:
                    raise SystemExit("Bridge Java target disagrees with the supported JDK")
            for name in ["dev/jdtech/mpv/MPVLib.class", "dev/jdtech/mpv/MPVLib$EventObserver.class"]:
                data = classes.read(name)
                if b"(IJ)V" not in data or b"(IIJJI)V" not in data:
                    raise SystemExit("Bridge Java is missing scoped file-event methods")
    replacements |= payloads
base = manifest["baseEntries"]
changed = {name for name in set(actual) | set(base) if actual.get(name) != base.get(name)}
if changed != replacements:
    raise SystemExit(f"Unexpected native bundle replacements: {sorted(changed)}; expected {sorted(replacements)}")
if manifest["baseAarSha256"] != json.loads((HERE / "sources.lock.json").read_text())["baseAarSha256"]:
    raise SystemExit("Native build provenance disagrees with the pinned base AAR")
print("Bundled mpv: matching engine/bridge ABIs and Java; decoder/runtime payloads unchanged; source inputs match")
