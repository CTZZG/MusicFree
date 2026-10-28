#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/boundary_environment.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
adb() {
    printf '%s\n' "$*" >> "$OUT/commands.txt"
    if [ "$1 $2 $3 $4" = 'shell settings put global' ]; then
        [ "$CASE" != write-failed ] || return 1
        printf '%s\n' "$6" > "$OUT/$5"
    elif [ "$1 $2 $3 $4" = 'shell settings get global' ]; then
        if [ "$CASE" = ignored ]; then printf '0\n'
        elif [ "$CASE" = unsupported ]; then printf 'Unknown query\n'
        elif [ -f "$OUT/$5" ]; then cat "$OUT/$5"
        elif [ "$CASE" = null ]; then printf 'null\n'
        else printf '0\n'; fi
    else return 1; fi
}
for CASE in null disabled write-failed ignored unsupported; do
    OUT="$WORK/$CASE"; mkdir "$OUT"; result=0
    prepare_boundary_startup_motion || result=$?
    if [ "$CASE" = null ] || [ "$CASE" = disabled ]; then
        [ "$result" -eq 0 ]
        [ "$(wc -l < "$OUT/boundary-animation-before-start.txt")" -eq 3 ]
        [ "$(grep -c '^shell settings put global .* 1$' "$OUT/commands.txt")" -eq 3 ]
        ! grep -Ev '^[a-z_]+=1$' "$OUT/boundary-animation-before-start.txt"
    else [ "$result" -ne 0 ]; fi
done
echo 'Boundary startup:5 actual-function cases passed; null is established, failed writes and incorrect readbacks rejected'
