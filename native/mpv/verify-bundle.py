#!/usr/bin/env python3
"""Reject a stale helper/patch, a partial ABI update, or changed decoder/JNI payloads."""
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
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
base = manifest["baseEntries"]
changed = {name for name in set(actual) | set(base) if actual.get(name) != base.get(name)}
if changed != replacements:
    raise SystemExit(f"Expected exactly four libmpv replacements, found: {sorted(changed)}")
if manifest["baseAarSha256"] != json.loads((HERE / "sources.lock.json").read_text())["baseAarSha256"]:
    raise SystemExit("Native build provenance disagrees with the pinned base AAR")
print("Bundled mpv: four matching ABIs; decoder/JNI/runtime/Java payloads unchanged; source inputs match")
