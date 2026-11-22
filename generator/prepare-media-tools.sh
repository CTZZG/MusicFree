#!/usr/bin/env bash
# CI host tools only. A bounded, checksum-pinned download avoids apt's optional
# system packages consuming the emulator job's regression budget.
set -euo pipefail

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null &&
    ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1; then
    ffmpeg -version | sed -n '1p'
    ffprobe -version | sed -n '1p'
    exit 0
fi

test "$(uname -sm)" = 'Linux x86_64'
tools_root=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
work=$(mktemp -d "$tools_root/mf-media-tools.XXXXXX")
archive="$work/tools.tar.xz"
trap 'rm -f "$archive"' EXIT
# BtbN retains month-end builds for two years; daily builds expire after 14 days.
curl -fsSL --connect-timeout 20 --max-time 120 --retry 1 --retry-max-time 250 \
    https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz \
    -o "$archive"
echo "41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380  $archive" | sha256sum -c -
python3 - "$archive" "$work/bin" <<'PYTOOLS'
import os, shutil, sys, tarfile
from pathlib import Path, PurePosixPath
out = Path(sys.argv[2]); out.mkdir()
found = set()
with tarfile.open(sys.argv[1], 'r:xz') as archive:
    for member in archive:
        path = PurePosixPath(member.name)
        if path.name not in {'ffmpeg', 'ffprobe'} or path.parent.name != 'bin':
            continue
        if not member.isfile() or path.name in found or path.is_absolute() or '..' in path.parts:
            raise SystemExit('invalid pinned media tool archive')
        with archive.extractfile(member) as source, (out / path.name).open('wb') as target:
            shutil.copyfileobj(source, target)
        os.chmod(out / path.name, 0o755); found.add(path.name)
if found != {'ffmpeg', 'ffprobe'}:
    raise SystemExit('missing pinned media tools')
PYTOOLS
"$work/bin/ffmpeg" -version | sed -n '1p'
"$work/bin/ffprobe" -version | sed -n '1p'
if [ -n "${GITHUB_PATH:-}" ]; then
    printf '%s\n' "$work/bin" >> "$GITHUB_PATH"
else
    echo "Media tools: $work/bin (add this directory to PATH for subsequent commands)"
fi
