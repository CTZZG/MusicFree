#!/usr/bin/env bash

# adb exec-out does not reliably convey the remote command's exit status.
# Check existence via shell v2, then validate a temporary copy before replacing
# the saved evidence. A cleanup attempt must preserve any earlier valid copy.
export_engine_progress_samples() {
    local destination=$1
    local temporary="${destination}.partial"
    if ! adb shell run-as fun.upup.musicfree test -f files/engine-progress-samples.jsonl \
        > /dev/null 2>&1; then
        return 1
    fi
    if ! adb exec-out run-as fun.upup.musicfree cat files/engine-progress-samples.jsonl \
        > "$temporary" 2>/dev/null; then
        rm -f "$temporary"
        return 1
    fi
    # Partial instrumentation runs are useful evidence too; completeness is
    # checked by the main flow. Reject error text, empty output and broken JSON.
    if ! python3 - "$temporary" <<'PY'
import json, sys
from pathlib import Path
try:
    lines = Path(sys.argv[1]).read_text().splitlines()
    rows = [json.loads(line) for line in lines]
    if not rows or any(not isinstance(row, dict) or not isinstance(row.get('phase'), str) for row in rows):
        raise ValueError('No raw sample objects')
except (OSError, UnicodeError, ValueError) as error:
    print(f'Raw sample export rejected: {error}', file=sys.stderr)
    sys.exit(1)
PY
    then
        rm -f "$temporary"
        return 1
    fi
    mv "$temporary" "$destination"
}
