#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/engine_progress_artifact.sh"
TASK_TMP=$(mktemp -d)
trap 'rm -rf "$TASK_TMP"' EXIT
DESTINATION="$TASK_TMP/samples.jsonl"
printf '%s\n' '{"phase":"playing","rawSeconds":1}' > "$TASK_TMP/valid.jsonl"
MODE=valid
SOURCE=files/engine-progress-samples.jsonl

adb() {
    echo "$*" >> "$TASK_TMP/calls"
    case "$*" in
        "shell run-as fun.upup.musicfree test -f $SOURCE")
            case "$MODE" in missing) return 1 ;; disconnected) return 255 ;; esac
            ;;
        "exec-out run-as fun.upup.musicfree cat $SOURCE")
            case "$MODE" in
                valid) cat "$TASK_TMP/valid.jsonl" ;;
                missing|removed-after-check) echo 'cat: files/engine-progress-samples.jsonl: No such file or directory' ;;
                broken-json) printf '%s\n' '{"phase":"playing"' ;;
                empty) : ;;
                scalar) echo '42' ;;
                no-phase) echo '{"rawSeconds":1}' ;;
                copy-failed) cat "$TASK_TMP/valid.jsonl"; return 1 ;;
                *) echo "Unexpected copy mode: $MODE" >&2; return 97 ;;
            esac
            ;;
        *) echo "Unexpected adb command: $*" >&2; return 97 ;;
    esac
}

# A failed remote cat can look successful to exec-out. This is a deliberate
# fake-adb condition, not a claim about a particular installed adb version.
MODE=missing
if adb exec-out run-as fun.upup.musicfree cat files/engine-progress-samples.jsonl \
    > "$TASK_TMP/legacy.jsonl"; then
    test -s "$TASK_TMP/legacy.jsonl"
else
    echo 'The exec-out fault fixture did not reproduce a zero-status error' >&2
    exit 1
fi
rm -f "$TASK_TMP/calls"
if export_engine_progress_samples "$DESTINATION"; then
    echo 'Missing device file was accepted' >&2; exit 1
fi
test ! -e "$DESTINATION"
if grep -q '^exec-out ' "$TASK_TMP/calls"; then
    echo 'Attempted copy despite missing file' >&2; exit 1
fi
echo 'PASS missing file: no copy attempted, no misleading artifact'

MODE=valid
export_engine_progress_samples "$DESTINATION"
cmp "$TASK_TMP/valid.jsonl" "$DESTINATION"
echo 'PASS valid partial samples: copied without requiring a complete suite'

for MODE in missing disconnected removed-after-check broken-json empty scalar no-phase copy-failed; do
    if export_engine_progress_samples "$DESTINATION" 2> "$TASK_TMP/error"; then
        echo "Accepted invalid export: $MODE" >&2; exit 1
    fi
    cmp "$TASK_TMP/valid.jsonl" "$DESTINATION"
    test ! -e "${DESTINATION}.partial"
    echo "PASS $MODE: earlier evidence preserved"
done

MODE=valid
SOURCE=files/js-flow-engine-samples.jsonl
export_engine_progress_samples "$DESTINATION" "$SOURCE"
cmp "$TASK_TMP/valid.jsonl" "$DESTINATION"
echo 'PASS explicit source: existence check and copy use the requested fixture file'
