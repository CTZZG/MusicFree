#!/usr/bin/env bash
set -euo pipefail
HERE_TEST=$(cd "$(dirname "$0")" && pwd)
source "$HERE_TEST/all_prelude.sh"
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
PKG=fun.upup.musicfree
EVENTS="$OUT/events"
pass() { printf 'PASS %s\n' "$1" >> "$EVENTS"; }
fail() { printf 'FAIL %s\n' "$1" >> "$EVENTS"; }
adb() {
    printf 'ADB %s\n' "$*" >> "$EVENTS"
    [ "${ADB_FAIL:-0}" = 0 ] || return 1
    printf '%s\n' "${ADB_PACKAGES:-}"
}

E2E_SUITE=all E2E_ALL_PRELUDE=audio-first
validate_all_prelude
check_audio_first_install
grep -Fq 'PASS 普通首启：应用此前未安装' "$EVENTS"
ADB_PACKAGES='package:fun.upup.musicfree'
if check_audio_first_install; then exit 1; fi
grep -Fq 'FAIL 普通首启：检查已有安装' "$EVENTS"
ADB_PACKAGES='Error: package manager unavailable'
if check_audio_first_install; then exit 1; fi
ADB_PACKAGES='' ADB_FAIL=1
if check_audio_first_install; then exit 1; fi
ADB_FAIL=0

HERE="$OUT/fake-e2e"
mkdir -p "$HERE"
cat > "$HERE/mv.sh" <<'EOF'
run_post_mv_roundtrip_for_all() { echo mv-prelude >> "$EVENTS"; }
check_post_mv_all_process() { [ "$SAME_PROCESS" = yes ]; }
EOF
run_all_prelude
if grep -q mv-prelude "$EVENTS"; then exit 1; fi
check_all_pre_cold_start
grep -Fq 'PASS 普通首启回归：未执行MV前置步骤' "$EVENTS"
E2E_ALL_PRELUDE=post-mv
run_all_prelude
grep -qx mv-prelude "$EVENTS"
SAME_PROCESS=yes
check_all_pre_cold_start
grep -Fq 'PASS MV后普通回归：冷启动前保持同一进程' "$EVENTS"
SAME_PROCESS=no
check_all_pre_cold_start
grep -Fq 'FAIL MV后普通回归：冷启动前保持同一进程' "$EVENTS"
E2E_ALL_PRELUDE=unknown
if validate_all_prelude; then exit 1; fi
E2E_SUITE=mv E2E_ALL_PRELUDE=audio-first
if validate_all_prelude; then exit 1; fi
if grep -Eq '^ADB .* (clear|uninstall)( |$)' "$EVENTS"; then exit 1; fi
python3 -I - "$HERE_TEST/../run.sh" <<'PY'
from pathlib import Path
import sys
script = Path(sys.argv[1]).read_text()
first_install_check = script.index('check_audio_first_install || finish')
install = script.index('if adb_install ')
plugins = script.index('install_plugin e2e-source-b.js || finish')
prelude = script.index('run_all_prelude || finish')
last_audio_check = script.index('quality-unavailable.yaml')
pre_cold_check = script.index('    check_all_pre_cold_start\n')
cold_start = script.index('adb shell am force-stop "$PKG"')
assert first_install_check < install < plugins < prelude < last_audio_check < pre_cold_check < cold_start
assert 'E2E_ALL_PRELUDE=${E2E_ALL_PRELUDE:-post-mv}' in script
PY
echo 'All-suite prelude host boundary checks passed'
