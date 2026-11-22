#!/usr/bin/env python3
"""Assemble four reviewed mpv builds and retain the matching reviewed JNI/Java bridge."""
import importlib.util
import sys
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
ROOT = HERE.parents[1]
LOCK = json.loads((HERE / "sources.lock.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--work-dir", required=True, type=Path)
parser.add_argument("--base-aar", required=True, type=Path)
args = parser.parse_args()
if hashlib.sha256(args.base_aar.read_bytes()).hexdigest() != LOCK["baseAarSha256"]:
    raise SystemExit("unexpected base AAR")
inputs = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
          for name in ["audiotrack_latency.h", "audiotrack-startup-delay.patch", "android-surface-resize.patch", "sources.lock.json", "rebuild.py"]}
libraries = {}
bridge_record = None
current_aar = ROOT / "android/app/libs/libmpv-release.aar"
current_manifest = json.loads((HERE / "bundle.json").read_text())
if (HERE / "bridge/file-events.patch").exists() and current_manifest.get("bridge") is None:
    raise SystemExit("Missing reviewed file-event bridge; refusing engine assembly")
if current_manifest.get("bridge") is not None:
    spec = importlib.util.spec_from_file_location("musicfree_bridge", HERE / "rebuild-bridge.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    bridge_record = current_manifest["bridge"]
    if bridge_record.get("protocolVersion") != 2 or bridge_record.get("inputs") != builder.build_inputs():
        raise SystemExit("Rebuild the file-event bridge before engine assembly")
    with zipfile.ZipFile(current_aar) as previous:
        actual_previous = {info.filename: hashlib.sha256(previous.read(info)).hexdigest()
                           for info in previous.infolist() if not info.is_dir()}
        if actual_previous != current_manifest["entries"]:
            raise SystemExit("Current AAR differs from its reviewed manifest")
        expected_bridge = {f"jni/{abi}/libplayer.so" for abi in ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]} | {"classes.jar"}
        if set(bridge_record["entries"]) != expected_bridge:
            raise SystemExit("Cannot assemble an incomplete JNI/Java bridge")
        for name, expected in bridge_record["entries"].items():
            content = previous.read(name)
            if hashlib.sha256(content).hexdigest() != expected:
                raise SystemExit("Unreviewed bridge payload: " + name)
            libraries[name] = content
for abi in ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]:
    lib = args.work_dir / "output" / abi / "libmpv.so"
    metadata = json.loads(lib.with_suffix(".json").read_text())
    content = lib.read_bytes()
    if metadata["abi"] != abi or metadata["inputs"] != inputs or metadata["sha256"] != hashlib.sha256(content).hexdigest():
        raise SystemExit(f"{abi}: stale or unrecognized build")
    if metadata["ndk"] != LOCK["ndk"] or metadata["mpv"] != LOCK["sources"]["mpv"]["commit"]:
        raise SystemExit(f"{abi}: incorrect source or compiler provenance")
    libraries[f"jni/{abi}/libmpv.so"] = content
aar = ROOT / "android/app/libs/libmpv-release.aar"
temporary = aar.with_suffix(".aar.partial")
base_entries, entries = {}, {}
with zipfile.ZipFile(args.base_aar) as src, zipfile.ZipFile(temporary, "w") as dst:
    if not libraries.keys() <= set(src.namelist()):
        raise SystemExit("base AAR does not contain all four architectures")
    for info in src.infolist():
        original = src.read(info)
        content = libraries.get(info.filename, original)
        dst.writestr(info, content)
        if not info.is_dir():
            base_entries[info.filename] = hashlib.sha256(original).hexdigest()
            entries[info.filename] = hashlib.sha256(content).hexdigest()
temporary.replace(aar)
result = {"baseAarSha256": LOCK["baseAarSha256"], "inputs": inputs, "baseEntries": base_entries, "entries": entries}
if bridge_record is not None: result["bridge"] = bridge_record
(HERE / "bundle.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
print("Assembled four libmpv ABIs; reviewed JNI/Java retained; all other entries preserved")
