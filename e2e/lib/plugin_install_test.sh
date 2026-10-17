#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
REF=$(git -C "$HERE/.." rev-parse HEAD)
PKG=fun.upup.musicfree
KV_DIR=/data/data/$PKG/files/kvstore
PLUGIN_BASE=https://example.com/$REF
source "$HERE/lib/plugin_install.sh"
python3 -I "$HERE/lib/plugin_install.py" --self-test
HASH=$(python3 -I "$HERE/lib/plugin_install.py" hash "$HERE/.." "$REF" e2e-source-a.js)
python3 - "$WORK" "$HASH" <<'PY'
import json,sys,pathlib
p=pathlib.Path(sys.argv[1]);key='/data/user/0/test/plugins/a.js'
item={'name':'E2E 测试源 A','path':key,'hash':sys.argv[2],
      'instance':{'platform':'E2E 测试源 A','supportedSearchType':['music']},'supportedMethods':['search']}
def save(name,entries): (p/name).write_text(json.dumps({'version':1,'entries':entries}))
def cache(name,value): save(name,{key:{'t':'s','v':json.dumps(value)}})
cache('normal.json',item)
cache('wrong-hash.json',{**item,'hash':'0'*64})
cache('no-search.json',{**item,'supportedMethods':[]})
save('empty.json',{})
save('meta.json',{'disabledPlugins':{'t':'s','v':'[]'}})
save('disabled.json',{'disabledPlugins':{'t':'s','v':json.dumps(['E2E 测试源 A'])}})
save('diagnostics.json',{'events':{'t':'s','v':json.dumps([{'method':'install:network','message':'DNS failed'}])}})
PY
ensure_root() { [ "$CASE" != no_root ]; }
clock() { echo "$FAKE_NOW"; }
sleep() { FAKE_NOW=$((FAKE_NOW + $1)); }
open_link() { [ "$CASE" != open_failed ]; }
mktemp() {
    if [ "$CASE" = no_directory ]; then return 1; fi
    command mktemp "$@"
}
pass() { printf 'PASS\t%s\n' "$1" >> "$OUT/results.tsv"; }
fail() { printf 'FAIL\t%s\n' "$1" >> "$OUT/results.tsv"; FAILED=$((FAILED + 1)); }
flow() {
    if [ "$CASE" = confirmation_failed ]; then fail "$1"; return 1; fi
    pass "$1"
}
adb() {
    case "${3:-}" in
        */plugin.cache.json)
            case "$CASE" in
                missing|missing_diagnostics|broken_diagnostics) cat "$WORK/empty.json" ;;
                delayed)
                    if [ "$FAKE_NOW" -lt 3 ]; then cat "$WORK/empty.json"; else cat "$WORK/normal.json"; fi ;;
                wrong_hash) cat "$WORK/wrong-hash.json" ;;
                no_search) cat "$WORK/no-search.json" ;;
                broken_cache) printf '{' ;;
                read_failed) return 1 ;;
                *) cat "$WORK/normal.json" ;;
            esac ;;
        */plugin-meta.json)
            case "$CASE" in
                disabled) cat "$WORK/disabled.json" ;;
                broken_meta) printf '{' ;;
                *) cat "$WORK/meta.json" ;;
            esac ;;
        */plugin-diagnostics.json)
            case "$CASE" in
                missing_diagnostics) return 1 ;;
                broken_diagnostics) printf '{' ;;
                *) cat "$WORK/diagnostics.json" ;;
            esac ;;
        *) return 1 ;;
    esac
}
for CASE in normal delayed missing wrong_hash no_search disabled broken_cache broken_meta read_failed no_root confirmation_failed missing_diagnostics broken_diagnostics open_failed no_directory; do
    OUT=$WORK/$CASE
    mkdir -p "$OUT"
    : > "$OUT/results.tsv"
    FAKE_NOW=0
    FAILED=0
    status=0
    install_plugin e2e-source-a.js > "$OUT/helper.log" 2>&1 || status=$?
    if [ "$CASE" = normal ] || [ "$CASE" = delayed ]; then
        [ "$status" -eq 0 ] && [ "$FAILED" -eq 0 ]
        [ "$(grep -c '^PASS' "$OUT/results.tsv")" -eq 2 ]
        grep -q $'^PASS\t验证插件安装' "$OUT/results.tsv"
        [ -n "$(find "$OUT" -name verified.json -print -quit)" ]
        if [ "$CASE" = delayed ]; then [ "$FAKE_NOW" -eq 3 ]; fi
    else
        [ "$status" -ne 0 ] && [ "$FAILED" -eq 1 ]
        ! grep -q $'^PASS\t验证插件安装' "$OUT/results.tsv"
        [ "$(grep -c '^FAIL' "$OUT/results.tsv")" -eq 1 ]
        if [ "$CASE" != no_root ] && [ "$CASE" != no_directory ]; then
            python3 - "$OUT" "$CASE" <<'PY'
import json,pathlib,sys
files=list(pathlib.Path(sys.argv[1]).rglob('install-errors.json'))
assert len(files)==1
value=json.loads(files[0].read_text())
unavailable=sys.argv[2] in ('missing_diagnostics','broken_diagnostics')
assert value['available'] is not unavailable
assert value['events']==([] if unavailable else [{'method':'install:network','pluginName':None,'message':'DNS failed','createdAt':None,'severity':None}])
PY
        fi
    fi
    [ -z "$(find "$OUT" -name 'cache*' -o -name 'meta*')" ]
done
# Reinstalling after the legacy upgrade must produce distinct, checked verdicts too.
CASE=normal
OUT=$WORK/upgrade-context
mkdir -p "$OUT"
: > "$OUT/results.tsv"
FAKE_NOW=0
FAILED=0
install_plugin e2e-source-a.js > "$OUT/helper.log" 2>&1
install_plugin e2e-source-a.js "升级后" >> "$OUT/helper.log" 2>&1
[ "$(cut -f2 "$OUT/results.tsv" | sort -u | wc -l)" -eq 4 ]
grep -q $'^PASS\t升级后：验证插件安装' "$OUT/results.tsv"
# Also protect the production caller, not only a helper that could become unused.
grep -Fq 'source "$HERE/lib/plugin_install.sh"' "$HERE/run.sh"
! grep -q '^install_plugin()' "$HERE/run.sh"
grep -Fq 'install_plugin e2e-source-a.js "升级后"' "$HERE/storage.sh"
echo 'plugin-install shell self-test: 16 cases passed'
