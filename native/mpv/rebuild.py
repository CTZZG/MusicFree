#!/usr/bin/env python3
"""Rebuild libmpv only, retaining the checked-in FFmpeg/JNI/runtime payloads.

Requires Linux, git, pkg-config, gperf, a C compiler, Ninja, Meson 1.6.1,
Jinja2, and Android NDK 27.1.12297006. No SDK/tool downloads or signing keys.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LOCK = json.loads((HERE / "sources.lock.json").read_text())
ARCHES = {
    "arm64-v8a": ("aarch64-linux-android26", "aarch64"),
    "armeabi-v7a": ("armv7a-linux-androideabi26", "arm"),
    "x86": ("i686-linux-android26", "x86"),
    "x86_64": ("x86_64-linux-android26", "x86_64"),
}
INPUTS = ["audiotrack_latency.h", "audiotrack-startup-delay.patch", "sources.lock.json", "rebuild.py"]


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_if_changed(path, content):
    data = content.encode() if isinstance(content, str) else content
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)


def copy_if_changed(source, destination):
    write_if_changed(destination, source.read_bytes())


def prepare_sources(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, pin in LOCK["sources"].items():
        dest = directory / name
        if not dest.exists():
            dest.mkdir()
            run(["git", "init", dest])
            run(["git", "-C", dest, "remote", "add", "origin", pin["url"]])
            run(["git", "-C", dest, "fetch", "--depth=1", "origin", pin["commit"]])
            run(["git", "-C", dest, "checkout", "--detach", "FETCH_HEAD"])
        actual = subprocess.check_output(["git", "-C", str(dest), "rev-parse", "HEAD"], text=True).strip()
        if actual != pin["commit"]:
            raise RuntimeError(f"{name}: existing checkout differs from pinned source; refusing to reset it")
        changed = subprocess.check_output(["git", "-C", str(dest), "diff", "--name-only", "HEAD"], text=True).splitlines()
        allowed = ["audio/out/ao_audiotrack.c"] if name == "mpv" else []
        if any(path not in allowed for path in changed):
            raise RuntimeError(f"{name}: tracked source changes are not part of the pinned build")
    placebo = directory / "libplacebo"
    run(["git", "-C", placebo, "submodule", "update", "--init", "--recursive", "--depth=1"])
    lua = directory / "lua"
    if not lua.exists():
        archive = directory / "lua-5.2.4.tar.gz"
        if not archive.exists():
            urllib.request.urlretrieve(LOCK["lua"]["url"], archive)
        if sha(archive) != LOCK["lua"]["sha256"]:
            raise RuntimeError("Lua archive checksum differs")
        with tarfile.open(archive) as src:
            src.extractall(directory, filter="data")
        (directory / "lua-5.2.4").rename(lua)
    digest = hashlib.sha256()
    for path in sorted((lua / "src").iterdir()):
        if path.suffix in [".c", ".h"]:
            digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    if digest.hexdigest() != LOCK["lua"]["sourceSha256"]:
        raise RuntimeError("existing Lua source differs from the pinned release")
    mpv = directory / "mpv"
    # Never reset a caller's checkout. Only the exact upstream or patched driver is accepted.
    driver = mpv / "audio/out/ao_audiotrack.c"
    original = subprocess.check_output(["git", "-C", str(mpv), "show", "HEAD:audio/out/ao_audiotrack.c"])
    if driver.read_bytes() == original:
        run(["git", "-C", mpv, "apply", "--check", HERE / "audiotrack-startup-delay.patch"])
        run(["git", "-C", mpv, "apply", HERE / "audiotrack-startup-delay.patch"])
    if sha(driver) != LOCK["patchedDriverSha256"]:
        raise RuntimeError("mpv driver contains unrecognized changes")
    header = mpv / "audio/out/audiotrack_latency.h"
    if header.exists() and header.read_bytes() != (HERE / header.name).read_bytes():
        raise RuntimeError("existing AudioTrack helper differs; refusing to overwrite it")
    copy_if_changed(HERE / header.name, header)


def setup_prefix(abi, source, work, ndk, base):
    prefix = work / "prefix" / abi
    for sub in ["include", "lib/pkgconfig", "obj"]:
        (prefix / sub).mkdir(parents=True, exist_ok=True)
    for link in ["usr", "local"]:
        if not (prefix / link).exists():
            (prefix / link).symlink_to(".")
    triple, family = ARCHES[abi]
    tools = ndk / "toolchains/llvm/prebuilt/linux-x86_64/bin"
    cc = tools / (triple + "-clang")
    cross = prefix / "crossfile.txt"
    write_if_changed(cross, f"""[built-in options]
buildtype = 'release'
default_library = 'static'
wrap_mode = 'nodownload'
b_staticpic = true
c_link_args = ['-Wl,-z,max-page-size=16384']
cpp_link_args = ['-Wl,-z,max-page-size=16384']
[binaries]
c = '{cc}'
cpp = '{cc}++'
ar = '{tools}/llvm-ar'
nm = '{tools}/llvm-nm'
strip = '{tools}/llvm-strip'
pkg-config = 'pkg-config'
[host_machine]
system = 'android'
cpu_family = '{family}'
cpu = '{family}'
endian = 'little'
""")

    def pc(name, version, libs):
        write_if_changed(prefix / f"lib/pkgconfig/{name}.pc",
            f"prefix=/usr/local\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include\n"
            f"Name: {name}\nDescription: pinned native build dependency\nVersion: {version}\n"
            f"Libs: -L${{libdir}} {libs}\nCflags: -I${{includedir}}\n")

    # Link the exact bundled shared FFmpeg libraries, never rebuild or substitute them.
    with zipfile.ZipFile(base) as archive:
        for entry in archive.namelist():
            if entry.startswith(f"jni/{abi}/") and entry.endswith(".so") and not entry.endswith("/libmpv.so"):
                write_if_changed(prefix / "lib" / Path(entry).name, archive.read(entry))
    ff = source / "ffmpeg"
    for name in ["avcodec", "avdevice", "avfilter", "avformat", "avutil", "swresample", "swscale"]:
        lib = "lib" + name
        dest = prefix / "include" / lib
        dest.mkdir(exist_ok=True)
        for header in (ff / lib).glob("*.h"):
            copy_if_changed(header, dest / header.name)
        version = "\n".join(p.read_text() for p in [ff / lib / "version.h", ff / lib / "version_major.h"] if p.exists())
        numbers = [re.search(r"#define\s+" + lib.upper() + "_VERSION_" + part + r"\s+(\d+)", version).group(1)
                   for part in ["MAJOR", "MINOR", "MICRO"]]
        pc(lib, ".".join(numbers), "-l" + name)
    write_if_changed(prefix / "include/libavutil/avconfig.h",
        "#ifndef AVUTIL_AVCONFIG_H\n#define AVUTIL_AVCONFIG_H\n"
        "#define AV_HAVE_BIGENDIAN 0\n#define AV_HAVE_FAST_UNALIGNED 1\n#endif\n")
    version = subprocess.check_output(["sh", str(ff / "ffbuild/version.sh"), str(ff)], text=True).strip()
    write_if_changed(prefix / "include/libavutil/ffversion.h",
        "#ifndef AVUTIL_FFVERSION_H\n#define AVUTIL_FFVERSION_H\n"
        f"#define FFMPEG_VERSION {json.dumps(version)}\n#endif\n")

    def static(name, directory, sources, flags=()):
        objects = []
        for item in sources:
            obj = prefix / "obj" / (name + "-" + Path(item).stem + ".o")
            run([cc, "-O2", "-fPIC", *flags, "-c", directory / item, "-o", obj])
            objects.append(obj)
        run([tools / "llvm-ar", "rcs", prefix / f"lib/lib{name}.a", *objects])

    unibreak = source / "libunibreak/src"
    static("unibreak", unibreak, [n + ".c" for n in ["unibreakbase", "unibreakdef", "linebreak", "linebreakdata",
           "linebreakdef", "eastasianwidthdef", "emojidef", "graphemebreak", "wordbreak"]])
    for header in unibreak.glob("*.h"):
        copy_if_changed(header, prefix / "include" / header.name)
    pc("libunibreak", "6.1", "-lunibreak")
    lua = source / "lua/src"
    static("lua", lua, [p.name for p in sorted(lua.glob("*.c")) if p.name not in ["lua.c", "luac.c"]],
           ["-Dgetlocaledecpoint()=('.')"])
    for name in ["lua.h", "luaconf.h", "lauxlib.h", "lualib.h"]:
        copy_if_changed(lua / name, prefix / "include" / name)
    pc("lua", "5.2.4", "-llua -lm")
    return prefix, cross, tools


def build(abi, source, work, ndk, base):
    inputs = {name: sha(HERE / name) for name in INPUTS}
    if sha(source / "mpv/audio/out/ao_audiotrack.c") != LOCK["patchedDriverSha256"]:
        raise RuntimeError("patched driver differs from pinned build")
    if sha(source / "mpv/audio/out/audiotrack_latency.h") != inputs["audiotrack_latency.h"]:
        raise RuntimeError("copied helper differs from source")
    prefix, cross, tools = setup_prefix(abi, source, work, ndk, base)
    env = os.environ.copy()
    for key in ["CC", "CXX", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "CPATH", "LIBRARY_PATH", "PKG_CONFIG_PATH"]:
        env.pop(key, None)
    env.update(PKG_CONFIG_SYSROOT_DIR=str(prefix), PKG_CONFIG_LIBDIR=str(prefix / "lib/pkgconfig"),
               LDFLAGS="-Wl,-O1,--icf=safe -Wl,-z,max-page-size=16384 -Wl,-rpath-link," + str(prefix / "lib"))
    options = {
        "freetype": ["-Dharfbuzz=disabled"],
        "fribidi": ["-Dtests=false", "-Ddocs=false"],
        "harfbuzz": ["-Dtests=disabled", "-Ddocs=disabled"],
        "libxml2": ["-Dminimum=true", "-Dpush=enabled", "-Dreader=enabled", "-Dsax1=enabled", "-Diso8859x=enabled", "-Dpattern=enabled"],
        "fontconfig": ["-Dtests=disabled", "-Ddoc=disabled", "-Dtools=disabled", "-Dnls=disabled", "-Dxml-backend=libxml2"],
        "libass": ["-Dtest=disabled", "-Dcompare=disabled", "-Dprofile=disabled", "-Dfuzz=disabled", "-Dcheckasm=disabled", "-Dfontconfig=enabled", "-Dlibunibreak=enabled"],
        "libplacebo": ["-Dvulkan=disabled", "-Ddemos=false"],
        "mpv": ["--default-library=shared", "-Diconv=disabled", "-Dlua=enabled", "-Dlibmpv=true", "-Dcplayer=false", "-Dmanpage-build=disabled"],
    }
    for name, args in options.items():
        src = source / name
        dest = src / ("_musicfree-" + abi)
        command = ["meson", "setup", dest, src, "--cross-file", cross, "--prefix=/usr/local", "--libdir=lib", *args]
        if (dest / "build.ninja").exists():
            command.append("--reconfigure")
        run(command, env=env)
        # libmpv links the shaping library, not HarfBuzz's separate subset/tools targets.
        target = ["src/libharfbuzz.a"] if name == "harfbuzz" else []
        run(["ninja", "-C", dest, "-j2", *target], env=env)
        if name == "harfbuzz":
            headers = prefix / "include/harfbuzz"
            headers.mkdir(exist_ok=True)
            for directory in [src / "src", dest / "src"]:
                for header in directory.glob("*.h"):
                    copy_if_changed(header, headers / header.name)
            shutil.copyfile(dest / "src/libharfbuzz.a", prefix / "lib/libharfbuzz.a")
            copy_if_changed(dest / "meson-private/harfbuzz.pc", prefix / "lib/pkgconfig/harfbuzz.pc")
        else:
            run(["ninja", "-C", dest, "install"], env=env | {"DESTDIR": str(prefix)})
        if name == "libplacebo":
            pc = prefix / "lib/pkgconfig/libplacebo.pc"
            pc.write_text(pc.read_text().replace("Libs: -L${libdir} -lplacebo", "Libs: -L${libdir} -lplacebo -lc++"))
    output = work / "output" / abi / "libmpv.so"
    output.parent.mkdir(parents=True, exist_ok=True)
    run([tools / "llvm-strip", "--strip-unneeded", "-o", output, source / "mpv" / ("_musicfree-" + abi) / "libmpv.so"])
    if inputs != {name: sha(HERE / name) for name in INPUTS}:
        raise RuntimeError("build inputs changed during compilation")
    output.with_suffix(".json").write_text(json.dumps({"abi": abi, "inputs": inputs, "sha256": sha(output),
        "ndk": LOCK["ndk"], "mpv": LOCK["sources"]["mpv"]["commit"]}, indent=2) + "\n")
    print("BUILT", abi, sha(output), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME"))
    parser.add_argument("--abis", choices=ARCHES, nargs="+", default=list(ARCHES))
    parser.add_argument("--base-aar", type=Path)
    args = parser.parse_args()
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    base = args.base_aar.resolve() if args.base_aar else work / "base.aar"
    if not base.exists() and args.base_aar is None:
        with base.open("wb") as out:
            run(["git", "-C", ROOT, "show", LOCK["baseCommit"] + ":android/app/libs/libmpv-release.aar"], stdout=out)
    if sha(base) != LOCK["baseAarSha256"]:
        raise RuntimeError("base AAR differs from the reviewed bundled dependency")
    if args.sdk is None:
        parser.error("--sdk or ANDROID_HOME is required")
    ndk = args.sdk.resolve() / "ndk" / LOCK["ndk"]
    if not ndk.is_dir():
        raise RuntimeError("pinned NDK is not installed")
    revision = re.search(r"^Pkg.Revision\s*=\s*(\S+)", (ndk / "source.properties").read_text(), re.M)
    if revision is None or revision.group(1) != LOCK["ndk"]:
        raise RuntimeError("installed NDK revision differs from the pinned compiler")
    source = args.source_dir.resolve() if args.source_dir else work / "sources"
    prepare_sources(source)
    for abi in args.abis:
        build(abi, source, work, ndk, base)


if __name__ == "__main__":
    main()
