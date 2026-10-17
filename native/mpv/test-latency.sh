#!/usr/bin/env bash
set -euo pipefail
TASK_NATIVE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TASK_NATIVE_TEMP=$(mktemp -d)
trap 'rm -rf -- "$TASK_NATIVE_TEMP"' EXIT
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  "$TASK_NATIVE_DIR/tests/audiotrack_latency_test.c" -o "$TASK_NATIVE_TEMP/latency-test"
"$TASK_NATIVE_TEMP/latency-test"
