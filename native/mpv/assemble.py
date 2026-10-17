#!/usr/bin/env python3
"""Assemble all four reviewed libmpv builds; preserve every other AAR entry."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LOCK = json.loads((HERE / "sources.lock.json").read_text())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--work-dir", required=True, type=Path)
parser.add_argument("--base-aar", required=True, type=Path)
args = parser.parse_args()
if hashlib.sha256(args.base_aar.read_bytes()).hexdigest() != LOCK["baseAarSha256"]:
    raise SystemExit("unexpected base AAR")
inputs = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
          for name in ["audiotrack_latency.h", "audiotrack-startup-delay.patch", "sources.lock.json", "rebuild.py"]}
libraries = {}
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
(HERE / "bundle.json").write_text(json.dumps({"baseAarSha256": LOCK["baseAarSha256"], "inputs": inputs,
    "baseEntries": base_entries, "entries": entries}, indent=2, sort_keys=True) + "\n")
print("Assembled four libmpv ABIs; all other entries preserved byte for byte")
