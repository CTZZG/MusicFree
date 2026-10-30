#!/usr/bin/env bash
# Actual viewport-scroll orchestration; only transport/public snapshots are fake.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
source "$HERE/lyric_boundaries.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
adb() {
    case "$*" in
        'shell wm size') printf 'Physical size: 1080x2400\n' ;;
        'shell wm density') printf 'Physical density: 420\n' ;;
        'shell input swipe '*) [ "$MODE" != disconnected ] ;;
        *) return 1 ;;
    esac
}
public_ui_target() {
    local label=$1 tag=$2 bottom=2400 top=2309 code=-1 visible=true
    POLLS=$((POLLS+1))
    if [ "$MODE" = settles ] && [ "$POLLS" -gt 1 ]; then bottom=2274; top=2100; fi
    if [[ "$MODE" = offscreen* ]] || [ "$MODE" = wrong-panel ]; then
        code=0; top=3154; visible=false
        if [ "$MODE" = offscreen-settles ] && [ "$POLLS" -gt 1 ]; then
            code=-1; bottom=2274; top=2100; visible=true
        fi
    fi
    if [ "$MODE" = bad-code ]; then code=0; fi
    python3 - "$OUT/ui-$tag-instrumentation.txt" "$top" "$bottom" "$code" "$visible" "$MODE" <<'PY'
import json,sys
from pathlib import Path
node=dict(package='fun.upup.musicfree',visible=sys.argv[5]=='true',enabled=True,clickable=True,
          description='刷新音频信息',bounds=[53,int(sys.argv[2]),1028,int(sys.argv[3])])
header=dict(package='fun.upup.musicfree',visible=True,text='当前播放信息')
if sys.argv[6]=='wrong-panel': header['text']='other'
Path(sys.argv[1]).write_text('INSTRUMENTATION_RESULT: tree='+json.dumps([header,node])+
                          '\nINSTRUMENTATION_RESULT: matches='+('1' if sys.argv[4]=='-1' else '0')+
                          '\nINSTRUMENTATION_CODE: '+sys.argv[4]+'\n')
PY
    printf '540 2187\n' > "$OUT/ui-$tag-point.txt"
    [ "$code" = -1 ]
}
shot() { printf '%s\n' "$1" >> "$OUT/shots.txt"; }
for MODE in settles clipped offscreen-settles offscreen-stuck bad-code disconnected wrong-panel; do
    OUT="$WORK/$MODE"; mkdir "$OUT"; POLLS=0; result=0
    boundary_dump_info 2x || result=$?
    if [[ "$MODE" = *settles ]]; then
        [ "$result" -eq 0 ]
        [ "$POLLS" -eq 2 ]
        [ -s "$OUT/ui-font-probe-2x-1-instrumentation.txt" ]
        grep -q 2274 "$OUT/ui-boundary-info-2x-instrumentation.txt"
        [ "$(cat "$OUT/shots.txt")" = boundary-info-2x ]
    else
        [ "$result" -ne 0 ]
        [ ! -e "$OUT/ui-boundary-info-2x-instrumentation.txt" ]
        case "$MODE" in
            clipped|offscreen-stuck) [ "$POLLS" -eq 8 ] ;;
            disconnected) [ "$POLLS" -eq 0 ] ;;
            *) [ "$POLLS" -eq 1 ] ;;
        esac
    fi
done
echo 'Font viewport:7 actual-function cases passed; offscreen scroll remains bounded and no partial target is accepted'
