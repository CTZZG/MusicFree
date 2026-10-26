# Held mini-player swipe observation (test-only)

This branch preserves a small diagnostic helper. It does not change the app,
version, dependencies, player state, or normal workflows. No new device run has
been dispatched for it. Do not merge a temporary manual diagnostic workflow into
the product branch.

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

Before using it, wait for the current Beta218 navigation/rotation/reduced-motion
recordings. A future targeted probe must reuse Beta217's d775 app, keep MusicFree
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
