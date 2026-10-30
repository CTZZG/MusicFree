#!/usr/bin/env bash
# Real orchestration and report parser; adb/chooser/image decode are host stand-ins.
# Actual UID/URI grant and decoded pixels remain mandatory device evidence.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
source "${E2E_EXPERIENCE_IMPL:-$HERE/experience.sh}"
E2E_SHARE_RECEIVER_APK="$WORK/receiver.apk"
printf 'stand-in APK' > "$E2E_SHARE_RECEIVER_APK"
pass() { printf 'PASS\t%s\n' "$1" >> "$OUT/results"; }
fail() { printf 'FAIL\t%s\n' "$1" >> "$OUT/results"; }
wait_until() { shift; "$@"; }
sleep() { :; }
flow() {
    printf '%s\n' "$2" >> "$OUT/flows"
    case "$2" in
        share-receiver.yaml) PHASE=first ;;
        share-receiver-again.yaml) PHASE=second ;;
    esac
    [ "$CASE" != chooser_failed ]
}
python3() {
    # Metadata uses the actual independent parser. The real image decoder is
    # exercised separately against pulled bytes on the emulator.
    if [ "${3:-}" = image ]; then [ "$CASE" != bad_pixels ];
    else command python3 "$@"; fi
}
adb() {
    case "$*" in
        install*) [ "$CASE" != install_failed ] ;;
        *am\ start*) PHASE=missing ;;
        *KEYCODE_BACK) : ;;
        *files/received.png) printf 'stand-in PNG' ;;
        *files/result.json)
            if [ "$PHASE" = missing ]; then
                if [ "$CASE" = accepted_missing ]; then printf '{"success":true}';
                else printf '{"success":false,"category":"missing-stream"}'; fi
            else
                local reads=1 uid=10002 grant=true
                [ "$PHASE" = first ] || reads=2
                [ "$CASE" != missing_grant ] || grant=false
                [ "$CASE" != same_uid ] || uid=10001
                [ "$CASE" != bad_second_read ] || reads=1
                printf '{"success":true,"mime":"image/png","scheme":"content","readGrant":%s,"senderUid":10001,"receiverUid":%s,"reads":%s,"width":1000,"height":802,"bytes":4000,"sha256":"%s"}' "$grant" "$uid" "$reads" "$(printf 'a%.0s' {1..64})"
            fi ;;
        *) return 1 ;;
    esac
}
for CASE in normal install_failed accepted_missing missing_grant same_uid bad_second_read chooser_failed bad_pixels missing_apk; do
    OUT="$WORK/$CASE"; mkdir -p "$OUT"; : > "$OUT/results"; : > "$OUT/flows"
    PHASE=missing
    apk=$E2E_SHARE_RECEIVER_APK
    [ "$CASE" != missing_apk ] || E2E_SHARE_RECEIVER_APK="$WORK/absent.apk"
    result=0; run_share_receiver_checks > "$OUT/check.log" 2>&1 || result=$?
    E2E_SHARE_RECEIVER_APK=$apk
    if [ "$CASE" = normal ]; then
        [ "$result" -eq 0 ] && [ "$(wc -l < "$OUT/flows")" -eq 4 ] &&
            [ "$(grep -c '^PASS' "$OUT/results")" -eq 2 ] || { cat "$OUT/check.log"; exit 1; }
    else
        [ "$result" -ne 0 ] || { echo "incorrect pass: $CASE"; exit 1; }
    fi
done
echo 'share receiver orchestration: 9 cases passed'
