#!/usr/bin/env python3
"""Check that the bundled libmpv libraries can load on the app's minimum Android version.

The AAR declares minSdk 26. The app merges it with tools:overrideLibrary, which also turns
off the manifest merger's minSdk check, so this script checks what the native libraries
actually need instead of the declared number. For every ABI, at the app's minSdk:

- every system library a bundled .so links against exists in the NDK's stub libraries;
- every symbol version it requires from a system library is defined there;
- every strong symbol it imports is defined by those stubs or by another bundled library.

Weak imports may resolve to null on older devices; they are listed, not rejected. The Java
side (classes.jar) is not covered here.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AAR = ROOT / "android/app/libs/libmpv-release.aar"
ROOT_GRADLE = ROOT / "android/build.gradle"
TRIPLES = {
    "arm64-v8a": "aarch64-linux-android",
    "armeabi-v7a": "arm-linux-androideabi",
    "x86": "i686-linux-android",
    "x86_64": "x86_64-linux-android",
}
CLANG_TARGETS = dict(TRIPLES, **{"armeabi-v7a": "armv7a-linux-androideabi"})


def min_sdk_from_gradle(path=ROOT_GRADLE):
    match = re.search(r"^\s*minSdkVersion\s*=\s*(\d+)\s*$", path.read_text(), re.M)
    if not match:
        raise SystemExit(f"minSdkVersion not found in {path}")
    return int(match.group(1))


def find_ndk(explicit):
    candidates = [explicit] if explicit else [
        os.environ.get(name) for name in
        ("ANDROID_NDK_LATEST_HOME", "ANDROID_NDK_HOME", "ANDROID_NDK_ROOT", "ANDROID_NDK")
    ]
    for sdk in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT")):
        if sdk and (Path(sdk) / "ndk").is_dir():
            versions = sorted((Path(sdk) / "ndk").iterdir(), key=lambda p: [
                int(part) if part.isdigit() else 0 for part in p.name.split(".")])
            candidates += [str(p) for p in reversed(versions)]
    for candidate in candidates:
        if candidate and list(Path(candidate).glob("toolchains/llvm/prebuilt/*/sysroot")):
            return Path(candidate)
    raise SystemExit("No Android NDK found: pass --ndk or set ANDROID_NDK_HOME / ANDROID_HOME")


class Ndk:
    def __init__(self, path):
        prebuilt = sorted(path.glob("toolchains/llvm/prebuilt/*"))[0]
        self.bin = prebuilt / "bin"
        self.sysroot = prebuilt / "sysroot"

    def tool(self, name):
        return str(self.bin / name)

    def stub_dir(self, abi, api):
        return self.sysroot / "usr/lib" / TRIPLES[abi] / str(api)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def needed(ndk, so):
    out = run([ndk.tool("llvm-readelf"), "--dynamic-table", "--wide", str(so)])
    return re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", out)


def symbols(ndk, so, kind, *, keep_versions=False):
    """kind: 'defined' -> {name}; 'undefined' -> {name: weak}."""
    flag = "--defined-only" if kind == "defined" else "--undefined-only"
    out = run([ndk.tool("llvm-nm"), "--dynamic", flag, str(so)])
    result = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        name = (parts[-1].replace("@@", "@") if keep_versions else
                re.split(r"@+", parts[-1], maxsplit=1)[0])
        result[name] = parts[-2] in ("w", "v") or result.get(name, False)
    return set(result) if kind == "defined" else result


def version_needs(ndk, so):
    """{library: {version names}} from the .gnu.version_r section."""
    out = run([ndk.tool("llvm-readelf"), "--version-info", "--wide", str(so)])
    needs, current, in_needs = {}, None, False
    for line in out.splitlines():
        if line.startswith("Version needs section"):
            in_needs = True
            continue
        if line.startswith("Version ") and "section" in line:
            in_needs = False
        if not in_needs:
            continue
        file_match = re.search(r"File: (\S+)", line)
        if file_match:
            current = needs.setdefault(file_match.group(1), set())
            continue
        name_match = re.search(r"Name: (\S+)", line)
        if name_match and current is not None:
            current.add(name_match.group(1))
    return needs


def version_definitions(ndk, so):
    out = run([ndk.tool("llvm-readelf"), "--version-info", "--wide", str(so)])
    names, in_defs = set(), False
    for line in out.splitlines():
        if line.startswith("Version definition section"):
            in_defs = True
            continue
        if line.startswith("Version ") and "section" in line:
            in_defs = False
        if in_defs and "Flags: BASE" not in line:
            match = re.search(r"Name: (\S+)", line)
            if match:
                names.add(match.group(1))
    return names


def is_elf(path):
    with open(path, "rb") as f:
        return f.read(4) == b"\x7fELF"


def check_abi(ndk, abi, libs, api):
    """libs: {soname: path}. Returns (problems, weak imports {symbol: [libs]})."""
    stub_dir = ndk.stub_dir(abi, api)
    if not stub_dir.is_dir():
        return [f"{abi}: the NDK has no API {api} stubs at {stub_dir}"], {}
    stubs = {p.name: p for p in stub_dir.glob("*.so") if is_elf(p)}
    stub_symbols, stub_versions, stub_versioned_symbols = {}, {}, {}
    bundled_symbols = set()
    bundled_versioned_symbols = set()
    for path in libs.values():
        exports = symbols(ndk, path, "defined", keep_versions=True)
        bundled_versioned_symbols |= exports
        bundled_symbols |= {s.split("@", 1)[0] for s in exports}
    problems, weak = [], {}
    for name, path in sorted(libs.items()):
        deps = needed(ndk, path)
        system = []
        for dep in deps:
            if dep in libs:
                continue
            if dep not in stubs:
                problems.append(f"{abi}/{name}: needs {dep}, which API {api} does not have")
                continue
            system.append(dep)
            if dep not in stub_symbols:
                exports = symbols(ndk, stubs[dep], "defined", keep_versions=True)
                stub_versioned_symbols[dep] = exports
                stub_symbols[dep] = {s.split("@", 1)[0] for s in exports}
                stub_versions[dep] = version_definitions(ndk, stubs[dep])
        for dep, versions in version_needs(ndk, path).items():
            missing = versions - stub_versions.get(dep, set()) if dep in system else set()
            for version in sorted(missing):
                problems.append(f"{abi}/{name}: needs symbol version {version} of {dep}, "
                                f"not defined at API {api}")
        available = set(bundled_symbols)
        versioned_available = set(bundled_versioned_symbols)
        for dep in system:
            available |= stub_symbols[dep]
            versioned_available |= stub_versioned_symbols[dep]
        imports = symbols(ndk, path, "undefined", keep_versions=True)
        for symbol, is_weak in sorted(imports.items()):
            # A version node existing somewhere in libc does not mean every
            # libc symbol has that version: malloc@LIBC_N cannot bind to
            # malloc@@LIBC. Keep each imported symbol's version attached.
            if (symbol in versioned_available if "@" in symbol else symbol in available):
                continue
            if is_weak:
                weak.setdefault(symbol, []).append(name)
            else:
                problems.append(f"{abi}/{name}: imports {symbol}, not available at API {api}")
    return problems, weak


def check_aar(ndk, aar, api):
    problems, report = [], []
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(aar) as archive:
        entries = [n for n in archive.namelist() if re.fullmatch(r"jni/[^/]+/[^/]+\.so", n)]
        abis = sorted({n.split("/")[1] for n in entries})
        if not abis:
            return [f"{aar}: no native libraries"], report
        for abi in abis:
            if abi not in TRIPLES:
                problems.append(f"{abi}: unknown ABI")
                continue
            libs = {}
            for entry in (n for n in entries if n.split("/")[1] == abi):
                target = Path(tmp) / entry
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(entry))
                libs[target.name] = target
            abi_problems, weak = check_abi(ndk, abi, libs, api)
            problems += abi_problems
            weak_text = "; ".join(f"{s} ({', '.join(sorted(set(l)))})" for s, l in sorted(weak.items()))
            report.append(f"{abi}: {len(libs)} libraries"
                          + (f"; weak imports that may be missing: {weak_text}" if weak else ""))
    return problems, report


# name: (source, API that introduced what it uses, extra link flags, weak symbol it imports)
FIXTURES = {
    "plain": ("#include <string.h>\nsize_t f(const char *s) { return strlen(s); }\n", None, [], None),
    "newer-symbol": ("#include <stdlib.h>\n"
                     "int f(char **o, char *const *t, char **v) { return getsubopt(o, t, v); }\n",
                     26, [], None),
    "newer-library": ("#include <aaudio/AAudio.h>\n"
                      "int f(void) { AAudioStreamBuilder *b; return AAudio_createStreamBuilder(&b); }\n",
                      26, ["-laaudio"], None),
    # Built at the floor, the way code using __ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__ is.
    "weak-newer-symbol": ("#include <stddef.h>\n"
                          "extern int pthread_getname_np(long, char *, size_t) __attribute__((weak));\n"
                          "int f(char *b) { return pthread_getname_np ? pthread_getname_np(0, b, 16) : 0; }\n",
                          26, [], "pthread_getname_np"),
}


def self_test(ndk, api):
    """Build tiny libraries with the NDK and check that only the expected ones pass."""
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        for abi in TRIPLES:
            for name, (source, introduced, flags, weak_symbol) in FIXTURES.items():
                newer = introduced is not None and introduced > api
                build_api = api if weak_symbol or not newer else introduced
                src = Path(tmp) / f"{name}.c"
                src.write_text(source)
                out = Path(tmp) / abi / f"lib{name}.so"
                out.parent.mkdir(parents=True, exist_ok=True)
                subprocess.run([ndk.tool("clang"), f"--target={CLANG_TARGETS[abi]}{build_api}",
                                "-shared", "-fPIC", "-o", str(out), str(src), *flags], check=True)
                problems, weak = check_abi(ndk, abi, {out.name: out}, api)
                should_pass = bool(weak_symbol) or not newer
                if bool(problems) == should_pass:
                    failures.append(f"{abi}/{name}: expected {'pass' if should_pass else 'failure'}, "
                                    f"got {problems or 'pass'}")
                if weak_symbol and newer and weak_symbol not in weak:
                    failures.append(f"{abi}/{name}: weak import not reported")
            # Link against a deliberately wrong provider so the resulting ELF
            # requires malloc@LIBC_N. Real API 24 libc has LIBC_N (for other
            # symbols), but malloc is exported only at LIBC. Checking the node
            # and the unversioned symbol separately used to accept this ELF.
            folder = Path(tmp) / abi
            provider = folder / "provider.c"
            provider.write_text("void *malloc(__SIZE_TYPE__ n) { return (void *)0; }\n")
            version_map = folder / "provider.map"
            version_map.write_text("LIBC_N { global: malloc; local: *; };\n")
            compiler = [ndk.tool("clang"), f"--target={CLANG_TARGETS[abi]}{api}",
                        "-shared", "-fPIC", "-fno-builtin", "-nostdlib"]
            subprocess.run([*compiler, str(provider), "-Wl,-soname,libc.so",
                            f"-Wl,--version-script={version_map}",
                            "-o", str(folder / "libwrong-provider.so")], check=True)
            consumer = folder / "consumer.c"
            consumer.write_text("extern void *malloc(__SIZE_TYPE__);\n"
                                "void *f(void) { return malloc(1); }\n")
            out = folder / "libwrong-version.so"
            subprocess.run([*compiler, str(consumer), f"-L{folder}",
                            "-l:libwrong-provider.so", "-o", str(out)], check=True)
            problems, _ = check_abi(ndk, abi, {out.name: out}, api)
            if not any("malloc@LIBC_N" in p for p in problems):
                failures.append(f"{abi}/wrong-version: accepted a symbol at the wrong version")
    if failures:
        print("Self-test failed:\n  " + "\n  ".join(failures))
        return 1
    print(f"Self-test passed: {len(FIXTURES) + 1} fixtures x {len(TRIPLES)} ABIs at API {api}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--aar", type=Path, default=DEFAULT_AAR)
    parser.add_argument("--api", type=int, help="default: minSdkVersion in android/build.gradle")
    parser.add_argument("--ndk", help="NDK directory (default: ANDROID_NDK_* or ANDROID_HOME/ndk)")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    api = args.api or min_sdk_from_gradle()
    ndk_path = find_ndk(args.ndk)
    ndk = Ndk(ndk_path)
    if args.self_test:
        return self_test(ndk, api)
    problems, report = check_aar(ndk, args.aar, api)
    print(f"{args.aar.name} against API {api} stubs from {ndk_path}:")
    for line in report:
        print(f"  {line}")
    if problems:
        print("Problems:\n  " + "\n  ".join(problems))
        return 1
    print("Checked dependencies and strong symbol/version bindings are available at the app's minSdk; "
          "runtime behavior and guarded weak calls still need device tests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
