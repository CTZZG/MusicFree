# Held mini-player swipe observation (test-only)

This branch preserves a small diagnostic helper. It does not change the app,
version or dependencies. Its own `proxy-subscription-check.yml` is now a manual
diagnostic workflow; NEVER merge that workflow or the temporary
`gesture-observation` suite over the product gate. No new App is built. The
diagnostic reuses Beta217's d775 Release APK and records its build source/hash.

The actual `MusicInfo` pan callback at base `8c56c244` was replayed with only
device/animation boundaries replaced. With a 200-wide view, three controls are
correct: `(translationX=80, velocityX=200)` chooses previous, `(-80, 0)` chooses
next, and `(10, 0)` does nothing. `(80, 0)` chooses next even though the drag
crossed the rightward distance threshold. This proves the JS path; it does not
prove what an Android gesture supplies or establish an audible/device failure.
The current distance branch chooses from velocity rather than displacement.

`review-js.mjs <output.json>` replays the real component in a full checkout using
the existing layout harness/dependencies. It records the last case as an
observation rather than a passing behaviour assertion. The positive controls
must execute correctly. The sparse diagnostic worktree intentionally omits
product sources; run the JS review in a full checkout.

`build.sh <out.apk>` uses the real SDK (min/target34) and a disposable test key.
The helper is a separate `testOnly` package with no Activity and no media,
network or storage permission. It never calls a player API. Its instrumentation
temporarily adopts shell input-injection permission, sends a finger stroke and
50 stationary MOVE events before release, then drops that identity. The
returned Android VelocityTracker value describes the injected events, not
RNGH's callback or a physical finger.

Beta218 navigation/rotation videos have been inspected, with their old 0x/0x
animation limitation preserved. The targeted probe reuses Beta217's d775 app, keeps MusicFree
in front on the mini-player, and derive coordinates from its actual visible
node bounds. Start on fixture B so previous=A and next=C are both valid. Avoid
guessing coordinates or changing production test entry points. Ensure no other
test UiAutomation session is active; stop only verified test-driver packages if
needed, never the player. Save the real before/after session, full UI frames and
the full instrumentation result. Require `INSTRUMENTATION_CODE: -1` and every
injection accepted; a shell exit code alone is insufficient.

Example invocation, with measured physical-pixel coordinates:

```
adb install -r -t probe.apk
adb shell am instrument -w -r -e startX START -e endX END -e y Y \
  fun.upup.musicfree.e2e.gesture/.HeldGestureProbe
```

Record the native UI outcome before any product fix. The helper has been
compiled locally with SDK36/javac/D8/aapt2/zipalign/apksigner, but has not run on a
device. No new app build, physical audio, real phone, performance or production
certificate claim follows from that compilation.

Diagnostic121 (run40313951713) completed no emulator scenarios. It was cancelled
at the 30-minute job boundary while apt downloaded about100 packages, including
optional drivers and a speech model. The missing result artifact is a consequence,
not an App or gesture failure. Raw log is preserved externally. Tool preparation
now uses BtbN's immutable2026-10-25 FFmpeg8.1.3 archive with GitHub asset SHA256
3300aa8c1d68e79e20d22117d3748a6121a49fe09b7eece3dcc38b84a1104e71,
extracts only ffmpeg/ffprobe, checks both executables, and bounds video-tool and
Maestro preparation separately. No input events, APK, sampling or direction
analysis is changed. Metadata/checksum and shell/Python extraction were checked
locally; the150MB tool archive was not downloaded into the disk-limited executor.

Diagnostic123 (run40318451608) reached the real App. Its first right case has82
accepted events/code-1, +409px over the measured744px mini, and1821ms at exactly
the same endpoint. B/PAUSED18700ms became C/PLAYING852ms; expected previous=A.
The raw Android tracker was -.019198854px/s, not exactly zero. The old invented
.001 fitted-velocity threshold rejected this complete raw case and stopped the
remaining two controls. Preserve the failed workflow; do not call all3 complete.
Data quality now uses the actual constant-coordinate hold, finite tracker value,
and complete injection, followed by a required correct A/C/B UI outcome. The old
right case remains a wrong-direction rejection. No engine/pause/window rules change.

The old instrumentation dumpsys query was unsupported on Android14 despite exit0.
The shared handoff function now checks actual process names with a validated
header and rejects live test-driver processes. Its6 host boundary tests are not
a device claim. The original123 native code-1 and accepted input remain real.
The original93 video packets have strictly increasing DTS; preserving demux time
base for null output removes mux timestamp quantization diagnostics while keeping
-xerror complete decoding. No video frames, inputs or negative controls are removed.
