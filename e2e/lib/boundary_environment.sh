# shellcheck shell=bash
prepare_boundary_startup_motion() {
    local key original value
    : > "$OUT/boundary-animation-original.txt"
    : > "$OUT/boundary-animation-before-start.txt"
    for key in window_animation_scale transition_animation_scale animator_duration_scale; do
        original=$(adb shell settings get global "$key" | tr -d '\r') || return 1
        [[ "$original" =~ ^(null|[0-9]+([.][0-9]+)?)$ ]] || return 1
        printf '%s=%s\n' "$key" "$original" >> "$OUT/boundary-animation-original.txt"
        # A fresh emulator may omit animator_duration_scale (null). Establish
        # the intended startup environment; never interpret null as proof of1x.
        adb shell settings put global "$key" 1 || return 1
        value=$(adb shell settings get global "$key" | tr -d '\r') || return 1
        printf '%s=%s\n' "$key" "$value" >> "$OUT/boundary-animation-before-start.txt"
        [[ "$value" =~ ^1([.]0+)?$ ]] || return 1
    done
}
