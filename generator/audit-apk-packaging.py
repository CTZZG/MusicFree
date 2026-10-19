#!/usr/bin/env python3
"""Report built APK sizes and reject accidentally uncompressed DEX files."""

import argparse
import json
import sys
import zipfile
from pathlib import Path


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
        return {
            "apk": path.name,
            "bytes": path.stat().st_size,
            "dexBytes": sum(entry.file_size for entry in dex),
            "dexPackagedBytes": sum(entry.compress_size for entry in dex),
            "nativePackagedBytes": sum(entry.compress_size for entry in native),
            "nativeLibraries": sorted(entry.filename for entry in native),
            "errors": errors,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apks", nargs="+")
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--report-only", action="store_true", help="Measure an older baseline without enforcing DEX compression"
    )
    args = parser.parse_args()
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
