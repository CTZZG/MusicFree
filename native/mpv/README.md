# Bundled mpv AudioTrack startup clock

The app bundles mpv 0.41.0. Its AudioTrack fallback adds the device's estimated
hardware latency when no valid device timestamp is available. Right after an
AudioTrack is created or flushed, that estimate can exceed all submitted audio.
Subtracting it from the audio output clock can report a position before the
restored source's start, even though the native seek target was correct.

`audiotrack-startup-delay.patch` bounds that startup estimate to the duration of
audio submitted since reset. A valid device timestamp or two seconds of submitted
audio ends the startup bound; the latter uses mpv's existing maximum delay. The
bound stays disabled across the eventual 32-bit frame-counter wrap. Encoded
passthrough, valid timestamps and steady-state delay accounting are unchanged.
The AO worker owns the warmup flag; reset callbacks re-arm it through an atomic
request, so an old worker iteration cannot consume a newer reset's warmup state.

This changes driver delay accounting, not the JNI `time-pos` getter or the test's
positions. It does not change the audio backend, decoder, seek target, playback
intent, focus handling or the 250 ms / 0.25 s regression limits. Engine-position
checks do not establish physical audio output or audible continuity.

## Pull-buffer short reads

The same pinned mpv source also recorded the end time of an entire requested
buffer even when AudioTrack read and submitted fewer frames without padding.
That counted unread frames as queued audio and could make the reported position
fall behind the exact restore target. The patch subtracts only this unused tail
when a read returns a positive number of frames and does not pad with silence.
Full reads, empty reads, padded reads and the existing underrun wakeup behavior
are preserved. The earlier AudioTrack startup bound is unchanged.

Counter experiment107 observed a77.125ms partial read without the corresponding
first-position dip after this correction; its original full device gates passed.
This supports the short-read fix, but does not establish physical audio output
or the complete trigger of the older253ms failure. The product build contains
neither those counters nor the temporary manual diagnostic workflow.

## Source and binary scope

- `sources.lock.json` pins all sources, API 26 and NDK 27.1.12297006. Dependency
  versions follow the referenced CTZZG/libmpv-android build recipe.
- mpv and its static subtitle/rendering dependencies are rebuilt. The shared
  FFmpeg 8.1 libraries, player JNI bridge, Java classes and bundled C++ runtime
  are copied byte for byte from the reviewed base AAR. The app's existing NDK
  runtime selection still applies.
- Only the four `jni/<ABI>/libmpv.so` entries in the AAR change. `bundle.json`
  records source/build inputs and every old/new entry digest. The shared quality
  gate rejects stale inputs, a partial ABI update or changes to other payloads.
- The patch is against mpv commit
  `41f6a645068483470267271e1d09966ca3b9f413` (v0.41.0). It retains mpv's LGPL
  licensing; the additional helper is LGPL-2.1-or-later.

## Minimum Android version

The application requires Android 14 / API 34 by product decision (2026-10-18).
The existing, pinned AAR still declares API 26 and uses API 26 build inputs; these
are lower bounds of the dependency, not a promise to support Android 7/8.
Normal manifest merging now enforces the app/dependency relationship. There is
no `tools:overrideLibrary`, bundled legacy trust root or custom API24 linker gate.
Do not rebuild the libraries just to change this app support declaration.

Keep NewApi lint for APIs above 34, the payload/source consistency check, the
startup-clock guard and Android 14/16 device checks. Do not restore old-system
fallbacks without an explicit change to the support policy in
`docs/architecture.md`.

## Rebuild

Use Linux with Python 3.12+, git, a C compiler, pkg-config, gperf, Ninja, Meson
1.6.1 and Jinja2, plus the pinned NDK installed below `ANDROID_HOME`. Keep normal
proxy and CA configuration. These scripts neither download an SDK nor use
signing keys. Use an empty work directory, or existing checkouts matching every
pinned commit; the script refuses to reset unrecognized work.

```sh
python3 native/mpv/rebuild.py --work-dir /tmp/musicfree-mpv --sdk "$ANDROID_HOME"
python3 native/mpv/assemble.py --work-dir /tmp/musicfree-mpv \
  --base-aar /tmp/musicfree-mpv/base.aar
bash native/mpv/test-latency.sh
python3 -I native/mpv/verify-bundle.py
```

The rebuild reads the original AAR from the pinned repository commit. A shallow
checkout must fetch that commit first. `--base-aar` can supply an existing copy;
its checksum is mandatory. `--abis` permits a subset for local iteration, but
assembly requires all four ABIs built from the same current inputs. Output
libraries use 16 KiB ELF segment alignment and retain the `libmpv.so` SONAME.
Build paths and upstream timestamp metadata can affect binary reproducibility;
the manifest verifies the reviewed payload rather than promising identical
archive bytes from arbitrary host environments.

## Validation

`test-latency.sh` compiles the actual helper on the host and checks initial/flush
bounds, timestamps, passthrough, steady state and wraparound. Removing the bound
must fail its assertions.

`check-short-read.py` compiles the actual upstream/patched
`ao_read_data_locked()` function with only queue/wakeup boundaries replaced.
Nine cases cover short/full/empty/padded reads, a second sample rate, and the
existing paused/underrun behavior; upstream and two weakened variants must fail.
The whole upstream file in `tests/mpv-0.41-buffer.c` is a licensed, pinned test
fixture, not app code. Its SHA must match the rebuild checkout's original file;
the same product patch and patched whole-file SHA are checked in both paths.
This keeps the quality check offline without substituting a model of the logic.

`AudioTrackSeekClockTest` uses the real bundled MPVLib and AudioTrack, repeatedly
replaces the real-JS MP3 fixture, and observes a complete raw position window
after each restore. It requires at least ten observations, one second of valid
samples, gaps no larger than 250 ms, no position more than 0.25 s behind the
captured old position, and actual forward progress. Empty or incomplete windows
fail. `check-seek-clock.py` recomputes the six windows from the exported JSONL.
The existing real-JS transition, pause/focus, slow-loading, UI and frozen-engine
checks remain independent gates.
