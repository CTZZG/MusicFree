#!/usr/bin/env python3
"""Reproduce pull-AO short-read accounting in the pinned, unmodified mpv source.

Host diagnostic only: the real ao_read_data_locked() is compiled with a queue
boundary shim. This does not run Android, decode audio, establish that a device
hit this branch, or change the bundled libraries or any acceptance threshold.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile


def function(source, signature):
    start = source.index(signature)
    end = source.index("{", start) + 1
    depth = 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


PREFIX = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
struct buffer_state { int64_t end_time_ns; bool playing, paused; int wakeup; };
struct driver { bool write; };
struct ao { struct buffer_state *buffer_state; struct driver *driver;
            void (*wakeup_cb)(void *); void *wakeup_ctx; };
static int available;
#define mp_assert assert
static int read_buffer(struct ao *ao, void **data, int samples,
                       bool *eof, bool pad_silence) { return available; }
static void mp_cond_broadcast(int *p) {}
static void wake(void *p) {}
'''

MAIN = r'''
int main(void) {
    struct buffer_state buffer = {.playing = true};
    struct driver driver = {0};
    struct ao ao = {&buffer, &driver, wake, NULL};
    const int rate = 16000, requested = 2400;
    const int64_t now_ns = 1000000000;
    for (int count = 0; count < 2; count++) {
        available = count == 0 ? 1024 : requested;
        bool eof = false;
        const int64_t predicted_end = now_ns + (int64_t)requested * 1000000000 / rate;
        int copied = ao_read_data_locked(&ao, NULL, requested, predicted_end, &eof, false);
        double actual_duration = copied / (double)rate;
        double reported_duration = (buffer.end_time_ns - now_ns) / 1e9;
        printf("requested=%d copied=%d expected=%.6f reported=%.6f excess=%.6f\n",
               requested, copied, actual_duration, reported_duration,
               reported_duration - actual_duration);
        assert(copied == available);
        // These assertions confirm reproduction, not a successful product fix.
        if (copied < requested)
            assert(reported_duration - actual_duration > 0.0859);
        else
            assert(reported_duration == actual_duration);
    }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="mpv checkout at sources.lock.json's pinned commit")
    args = parser.parse_args()
    path = args.source / "audio/out/buffer.c"
    source = path.read_bytes()
    # Whole-file identity prevents silently testing a similarly named model.
    expected = "e053296cdfe58a07b6bd2aa5554774ff5c54ca57c622a56636fb6fe8f0fed105"
    if hashlib.sha256(source).hexdigest() != expected:
        parser.error("audio/out/buffer.c differs from pinned mpv 0.41.0")
    actual = function(source.decode(), "static int ao_read_data_locked(")
    with tempfile.TemporaryDirectory(prefix="mpv-short-read-") as directory:
        path = Path(directory)
        c = path / "repro.c"
        c.write_text(PREFIX + actual + MAIN)
        binary = path / "repro"
        subprocess.run(["cc", "-std=c11", str(c), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    print("Host accounting reproduction only; device short-read counts and audible output remain unmeasured.")


if __name__ == "__main__":
    main()
