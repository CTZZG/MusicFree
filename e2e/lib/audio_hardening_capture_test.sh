#!/usr/bin/env bash
# Exercise the actual capture lifecycle with a FIFO-backed adb boundary.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK=$(mktemp -d)
trap 'hardening_capture_cancel; rm -rf "$WORK"' EXIT
OUT="$WORK/out"
mkdir -p "$WORK/bin" "$OUT"
mkfifo "$WORK/stream"
export HARDENING_TEST_WORK="$WORK"
cat > "$WORK/bin/adb" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = logcat ]; then
    if [ -f "$HARDENING_TEST_WORK/stderr" ]; then echo 'capture error' >&2; fi
    exec 3<> "$HARDENING_TEST_WORK/stream"
    exec cat <&3
elif [ "$1 $2" = 'shell log' ]; then
    [ ! -f "$HARDENING_TEST_WORK/marker-fails" ] || exit 1
    timeout 1 bash -c 'printf "%s\n" "$1" > "$HARDENING_TEST_WORK/stream"' -- "${@: -1}"
else
    exit 1
fi
SH
chmod +x "$WORK/bin/adb"
export PATH="$WORK/bin:$PATH"
source "$HERE/audio_hardening.sh"

hardening_capture_start
timeout 1 bash -c 'echo "AudioHardening fun.upup.musicfree blocked earlier" > "$HARDENING_TEST_WORK/stream"'
# The device's current buffer can be empty after Maestro clears it.
: > "$OUT/logcat.txt"
hardening_capture_finish
test "$HARDENING_CAPTURE_COMPLETE" = 1
grep -qF "$HARDENING_CAPTURE_TOKEN:start" "$OUT/audio-hardening-stream.txt"
grep -qF "$HARDENING_CAPTURE_TOKEN:end" "$OUT/audio-hardening-stream.txt"
grep -qF 'blocked earlier' "$OUT/audio-hardening-stream.txt"
echo 'ok   stream preserves an earlier record and observed start/end markers'

hardening_capture_start
kill "$HARDENING_CAPTURE_PID"
wait "$HARDENING_CAPTURE_PID" 2>/dev/null || true
hardening_capture_finish
test "$HARDENING_CAPTURE_COMPLETE" = 0
echo 'ok   dead capture fails closed'

touch "$WORK/stderr"
hardening_capture_start
hardening_capture_finish
test "$HARDENING_CAPTURE_COMPLETE" = 0
rm "$WORK/stderr"
echo 'ok   capture stderr fails closed'

touch "$WORK/marker-fails"
if hardening_capture_start; then
    echo 'FAIL missing readiness marker was accepted'; exit 1
fi
test -z "$HARDENING_CAPTURE_PID"
test "$HARDENING_CAPTURE_COMPLETE" = 0
echo 'ok   readiness failure releases the capture process'
