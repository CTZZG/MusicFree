# Owned file-event bridge (protocol 2)

The JNI/Java bridge is rebuilt from CTZZG/libmpv-android commit
`cd1a92a39ae78622925351226368075932927db2`. `upstream/` contains the original
sources and MIT license, checked against `upstream.lock.json`. `file-events.patch`
is applied to a separate build directory. mpv and FFmpeg headers are pinned by
URL and SHA-256 in `include.lock.json`; existing engine, FFmpeg and C++ libraries
are read from the reviewed AAR and preserved during a bridge-only rebuild.

## Contract

- `loadFile` returns mpv's actual signed 64-bit `playlist_entry_id` from
  `mpv_command_ret`. Negative command results throw after releasing JNI strings
  and mpv result nodes. Callers do not infer entry IDs from URLs or counters.
- START_FILE, FILE_LOADED and PLAYBACK_RESTART carry their file's entry ID.
  END_FILE carries reason, raw error, entry ID, redirect insertion ID and count.
  Borrowed mpv event data is consumed before the next `mpv_wait_event` call.
- IDs stay as Kotlin `Long` and JNI `jlong`. Any diagnostic ID crossing into JS
  is a decimal string so values above 2^53 remain exact.
- Numeric-only observers keep working through Java interface defaults. Older
  Java classes receive the numeric callback when optional methods are absent;
  optional JNI lookups clear their lookup exception. MV admission requires the
  complete protocol rather than guessing EOF from numeric END_FILE.
- No raw mpv log message is implicitly written to Android logs; explicitly
  registered log observers still receive messages. Source-transition diagnostics
  must not include URLs, request headers or plugin credentials.

## Application ownership

`MpvFileEvents` maps explicitly loaded, prepared and redirected entries to the
accepted media/generation and root. Duplicate terminals, unknown IDs, old engine
epochs and superseded roots cannot advance the current queue. Only validated
EOF enters natural-end handling; STOP/QUIT are cancellation, redirects retain
lineage, and ERROR/unknown terminals fail the owned source. An error may cancel
automatic successors of its root, but cannot stop a newer explicit selection.
After promotion, current audio is removed from the set of discardable prepared
entries; redirected prepared sources are validated by lineage, not URL equality.

Paired progress and periodic progress share one native readiness test. It needs
the current generation, active entry, completed loading and PLAYBACK_RESTART.
`OwnedMpvClock` checks entry ownership before and after reading the real clock.
Protocol negotiation precedes MV admission and survives a rejected MV attempt;
the JS adapter reconciles late receipts against that actual paired snapshot.

The network gate tracks the default network and explicit metered permission.
Denial suspends the owned MV by cancelling pending seeks/unpauses and stopping
the native source. A failed stop retires the engine. Its private checkpoint is
separate from the original audio return position. Network recovery does not
resume playback: an explicit authorized action resolves a fresh source and
generation, and may use a checkpoint only for the same video and timeline.
Missing checkpoints or a different timeline require explicit restart approval.

## Build and verify

On Linux, supply JDK 21, Android SDK platform 36 revision 2, the pinned NDK and the JARs
listed in `build.lock.json`. Java output targets 17 for the CI runtime.
The SDK `android.jar` digest is pinned as a compiler input too. JUnit/Hamcrest
are test dependencies, not bridge compiler inputs.

```sh
python3 native/mpv/rebuild-bridge.py --sdk "$ANDROID_HOME" --jdk "$JAVA_HOME" \
  --kotlin-dir /path/to/locked-kotlin-jars --work-dir /tmp/musicfree-bridge
python3 -I native/mpv/verify-bundle.py
python3 -I native/mpv/bridge/check-events.py
python3 -I native/mpv/bridge/test-bundle.py
```

The builder compiles all four JNI ABIs and matching Java as a group, checks 16 KiB
ELF alignment and the `libplayer.so` SONAME, and records the source/build fingerprint and entry digests in
`bundle.json`. Cached work directories must exactly match the patched sources;
unrecognized edits are rejected. `--no-assemble` compiles without repacking.

`check-events.py` compiles the actual patched event loop and command function
against synthetic JNI/mpv boundaries. It checks all five END reasons, scoped
events, exact large IDs, legacy delivery, resource cleanup and command errors.
`test-bundle.py` corrupts isolated copies to check stale sources, missing ABIs,
downgraded protocol, decoder tampering, wrong architecture/alignment/SONAME, Java
target mismatch in every class, unpinned headers and assembly that drops the bridge
record (12 cases: one positive and 11 negative). These are host checks; they do not establish physical audio,
rendered pixels or metered-network byte counts on an Android device.
