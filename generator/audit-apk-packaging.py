#!/usr/bin/env python3
"""Report built APK sizes, reject accidentally uncompressed DEX files and
64-bit native libraries that cannot load on 16 KB page-size devices."""

import argparse
import hashlib
import json
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

# 16 KB page-size devices are 64-bit only; 32-bit libraries never load there.
PAGE_ALIGNED_ABIS = {"arm64-v8a", "x86_64"}
MIN_LOAD_ALIGNMENT = 16 * 1024
PT_LOAD = 1


def load_alignments(data):
    """p_align of every PT_LOAD segment of an ELF shared library."""
    if data[:4] != b"\x7fELF":
        raise ValueError("not an ELF file")
    is_64 = data[4] == 2
    endian = "<" if data[5] == 1 else ">"
    if is_64:
        phoff = struct.unpack_from(endian + "Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from(endian + "HH", data, 0x36)
        align_at, align_format = 48, "Q"
    else:
        phoff = struct.unpack_from(endian + "I", data, 0x1C)[0]
        phentsize, phnum = struct.unpack_from(endian + "HH", data, 0x2A)
        align_at, align_format = 28, "I"
    alignments = []
    for index in range(phnum):
        entry = phoff + index * phentsize
        if struct.unpack_from(endian + "I", data, entry)[0] == PT_LOAD:
            alignments.append(struct.unpack_from(endian + align_format, data, entry + align_at)[0])
    if not alignments:
        raise ValueError("no PT_LOAD segments")
    return alignments


def inspect_apk(filename):
    path = Path(filename)
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        dex = [entry for entry in entries if entry.filename.endswith(".dex")]
        native = [
            entry for entry in entries
            if entry.filename.startswith("lib/") and entry.filename.endswith(".so")
        ]
        errors = []
        if not dex:
            errors.append("APK contains no DEX files")
        for entry in dex:
            if entry.compress_type != zipfile.ZIP_DEFLATED:
                errors.append(f"{entry.filename} is not compressed")
        page_aligned = 0
        for entry in native:
            abi = entry.filename.split("/")[1]
            if abi not in PAGE_ALIGNED_ABIS:
                continue
            try:
                alignment = min(load_alignments(archive.read(entry.filename)))
            except (ValueError, struct.error) as error:
                errors.append(f"{entry.filename} could not be read as ELF: {error}")
                continue
            if alignment < MIN_LOAD_ALIGNMENT:
                errors.append(
                    f"{entry.filename} LOAD segments are {alignment}-byte aligned; "
                    f"16 KB page-size devices need {MIN_LOAD_ALIGNMENT}"
                )
            else:
                page_aligned += 1
        return {
            "apk": path.name,
            "bytes": path.stat().st_size,
            "dexBytes": sum(entry.file_size for entry in dex),
            "dexPackagedBytes": sum(entry.compress_size for entry in dex),
            "nativePackagedBytes": sum(entry.compress_size for entry in native),
            "pageAlignedNativeLibraries": page_aligned,
            "nativeLibraries": sorted(entry.filename for entry in native),
            "mpvPayloadSha256": {
                entry.filename: hashlib.sha256(archive.read(entry)).hexdigest()
                for entry in native if entry.filename.endswith("/libmpv.so")
            },
            "errors": errors,
        }


def elf64(alignment):
    """Smallest ELF64 header with one PT_LOAD program header, for the self-test."""
    header = bytearray(64)
    header[:6] = b"\x7fELF\x02\x01"
    struct.pack_into("<Q", header, 0x20, 64)
    struct.pack_into("<HH", header, 0x36, 56, 1)
    program = bytearray(56)
    struct.pack_into("<I", program, 0, PT_LOAD)
    struct.pack_into("<Q", program, 48, alignment)
    return bytes(header + program)


def elf32(alignment):
    header = bytearray(52)
    header[:6] = b"\x7fELF\x01\x01"
    struct.pack_into("<I", header, 0x1C, 52)
    struct.pack_into("<HH", header, 0x2A, 32, 1)
    program = bytearray(32)
    struct.pack_into("<I", program, 0, PT_LOAD)
    struct.pack_into("<I", program, 28, alignment)
    return bytes(header + program)


def self_test():
    cases = [
        ("16 KB 64-bit libraries pass", {"lib/arm64-v8a/liba.so": elf64(0x4000),
                                         "lib/x86_64/liba.so": elf64(0x10000)}, 0),
        ("a 4 KB arm64 library fails", {"lib/arm64-v8a/libold.so": elf64(0x1000)}, 1),
        ("a 4 KB x86_64 library fails", {"lib/x86_64/libold.so": elf64(0x1000)}, 1),
        ("4 KB 32-bit libraries are not page-size checked", {"lib/armeabi-v7a/liba.so": elf32(0x1000),
                                                             "lib/x86/liba.so": elf32(0x1000)}, 0),
        ("an unreadable 64-bit library fails", {"lib/arm64-v8a/libbad.so": b"not elf"}, 1),
        ("uncompressed DEX still fails", {"classes.dex": None}, 1),
    ]
    with tempfile.TemporaryDirectory(prefix="apk-packaging-") as directory:
        for index, (name, files, expected) in enumerate(cases):
            apk = Path(directory) / f"case{index}.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                if "classes.dex" not in files:
                    archive.writestr("classes.dex", b"dex\n", compress_type=zipfile.ZIP_DEFLATED)
                for entry, data in files.items():
                    if entry == "classes.dex":
                        archive.writestr(entry, b"dex\n", compress_type=zipfile.ZIP_STORED)
                    else:
                        archive.writestr(entry, data, compress_type=zipfile.ZIP_STORED)
            errors = inspect_apk(apk)["errors"]
            if len(errors) != expected:
                print(f"FAIL {name}: {errors}")
                return 1
            print(f"ok   {name}")
        # The report must identify the decompressed native payload, so a build
        # cache or packaging mismatch can be checked without the large APK ZIP.
        for compression in [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED]:
            apk = Path(directory) / f"mpv-{compression}.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("classes.dex", b"dex\n", compress_type=zipfile.ZIP_DEFLATED)
                archive.writestr("lib/x86_64/libmpv.so", elf64(0x4000), compress_type=compression)
            report = inspect_apk(apk)
            expected = {"lib/x86_64/libmpv.so": "02191e9aaabd95888f8a33bbda819193c9ba84d6cba734c02b54a8adfd5e0ce6"}
            if report["errors"] or report.get("mpvPayloadSha256") != expected:
                print(f"FAIL mpv payload identity (ZIP method {compression})")
                return 1
            print(f"ok   mpv payload identity (ZIP method {compression})")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apks", nargs="*")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--report-only", action="store_true", help="Measure an older baseline without enforcing the checks"
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.apks:
        parser.error("no APKs given")
    reports = []
    for filename in args.apks:
        try:
            reports.append(inspect_apk(filename))
        except (OSError, zipfile.BadZipFile, NotImplementedError) as error:
            reports.append({"apk": Path(filename).name, "errors": [str(error)]})
    passed = all(not report["errors"] for report in reports)
    result = {"passed": passed, "reportOnly": args.report_only, "apks": reports}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    for report in reports:
        print(json.dumps({key: value for key, value in report.items() if key != "nativeLibraries"}))
    return 0 if passed or args.report_only else 1


if __name__ == "__main__":
    sys.exit(main())
