# shellcheck shell=bash
# Stop only the two installed test-driver packages. Android14's
# `dumpsys activity instrumentation` prints an unsupported-command message with
# exit0; absence of a name in that message cannot prove the driver has stopped.
stop_maestro_ui_driver() {
    local prefix=$1 mode=${2:-installed} driver
    if [ "$mode" = allow-uninstalled ]; then
        # A CLI without --no-reinstall-driver removes its drivers on exit.
        # Prove a working PackageManager response before accepting absence;
        # an empty/unsupported query is not proof of an uninstalled driver.
        adb shell pm list packages | tr -d '\r' > "$prefix-packages.txt" || return 1
        grep -Fxq 'package:fun.upup.musicfree' "$prefix-packages.txt" || return 1
        if grep -Ev '^package:[a-zA-Z0-9_.]+$' "$prefix-packages.txt"; then return 1; fi
    fi
    for driver in dev.mobile.maestro dev.mobile.maestro.test; do
        if [ "$mode" = allow-uninstalled ] && ! grep -Fxq "package:$driver" "$prefix-packages.txt"; then
            continue
        fi
        adb shell pm path "$driver" > "$prefix-$driver-path.txt" || return 1
        grep -q '^package:' "$prefix-$driver-path.txt" || return 1
        adb shell am force-stop "$driver" || return 1
    done
    for _ in {1..20}; do
        adb shell ps -A -o NAME > "$prefix-handoff.txt" || return 1
        if [ "$(head -n 1 "$prefix-handoff.txt" | tr -d ' \r')" != NAME ]; then
            echo 'Expected actual process names, not an unsupported query response' >&2
            return 1
        fi
        if ! grep -Eq '^[[:space:]]*dev[.]mobile[.]maestro([.]test)?(:[^[:space:]]+)?[[:space:]]*$' "$prefix-handoff.txt"; then
            return 0
        fi
        sleep .25
    done
    echo 'Maestro test-driver process did not stop' >&2
    return 1
}
