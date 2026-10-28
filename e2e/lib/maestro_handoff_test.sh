#!/usr/bin/env bash
# Actual handoff function with process/transport boundaries replaced; no device claim.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "${E2E_MAESTRO_HANDOFF_IMPL:-$HERE/maestro_handoff.sh}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
sleep() { :; }
adb() {
    printf '%s\n' "$*" >> "$OUT/commands.txt"
    case "$*" in
        'shell pm path '*)
            [ "$CASE" != missing ] || return 1
            printf 'package:/data/app/test-driver/base.apk\n' ;;
        'shell am force-stop '*) return 0 ;;
        'shell ps -A -o NAME')
            READS=$((READS + 1))
            [ "$CASE" != disconnected ] || return 1
            if [ "$CASE" = unsupported ]; then
                printf 'Unknown command: instrumentation\n'; return 0
            fi
            printf 'NAME\ninit\nfun.upup.musicfree\n'
            if [ "$CASE" = lingering ] || { [ "$CASE" = delayed ] && [ "$READS" -eq 1 ]; }; then
                printf ' dev.mobile.maestro.test:worker\n'
            fi ;;
        *) return 1 ;;
    esac
}
for CASE in normal delayed unsupported lingering disconnected missing; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/commands.txt"; READS=0
    result=0; stop_maestro_ui_driver "$OUT/test" > "$OUT/output.txt" 2>&1 || result=$?
    if [ "$CASE" = normal ] || [ "$CASE" = delayed ]; then
        [ "$result" -eq 0 ] || { cat "$OUT/output.txt"; exit 1; }
        if [ "$CASE" = delayed ]; then [ "$READS" -eq 2 ]; fi
    else
        [ "$result" -ne 0 ] || { echo "accepted invalid handoff: $CASE"; exit 1; }
        if [ "$CASE" = lingering ]; then [ "$READS" -eq 20 ]; fi
    fi
    if grep '^shell am force-stop' "$OUT/commands.txt" | grep -Ev '^shell am force-stop dev[.]mobile[.]maestro([.]test)?$'; then
        echo 'stopped something other than the two test drivers'; exit 1
    fi
done
echo 'Maestro handoff: 6 cases passed; unsupported/active/disconnected states rejected'

# Exercise the actual run.sh wrapper: a second CLI must not launch while its
# predecessor can still own the fixed server port. No assertion is retried.
source <(sed -n '/^flow() {/,/^}$/p' "$HERE/../run.sh")
pass() { :; }
fail() { FAILED=$((FAILED + 1)); }
shot() { :; }
print_screen_text() { :; }
maestro() { printf 'cli\n' >> "$OUT/sequence"; }
stop_maestro_ui_driver() {
    printf 'stop\n' >> "$OUT/sequence"
    [ "$CASE" != wrapper_blocked ]
}
OUT="$WORK/wrapper"; mkdir -p "$OUT/maestro"; : > "$OUT/sequence"
DRIVER_INSTALLED=0; FAILED=0; CASE=wrapper
flow first fixture.yaml
flow second fixture.yaml
[ "$(cat "$OUT/sequence")" = $'cli\nstop\ncli' ]
CASE=wrapper_blocked
if flow third fixture.yaml; then echo 'started over a lingering driver'; exit 1; fi
[ "$(cat "$OUT/sequence")" = $'cli\nstop\ncli\nstop' ]
[ "$FAILED" -eq 1 ]
echo 'Maestro wrapper: ordered driver release and blocked handoff passed'
