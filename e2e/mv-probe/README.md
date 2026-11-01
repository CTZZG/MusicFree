# Current-AAR MV output probe (P0)

This standalone, test-signed APK uses the checked-in `libmpv-release.aar`
unchanged. It is not linked into MusicFree and does not expose an app menu or
claim RN integration. No Gradle/npm installation or release signing keys are used.

The probe runs the same sequence with TextureView and SurfaceView:

1. One MPVLib instance plays original generated audio beyond 37.6 seconds.
2. A generated H.264/AAC 720p clip starts at zero; actual frames are captured
   twice, independently decoded and checked for colour and motion.
3. Native pause/seek, actual Android home/return, detached audio progress and
   Surface reattachment are recorded.
4. Original audio resumes at its captured native stop, rather than the video time.
5. A second video naturally advances to an appended audio entry with `vid=no`.

The app records raw events, captured frames and a final report. `verify.py`
recomputes the facts instead of trusting that report. Its ten host self-tests
use explicitly synthetic data and reject missing events, wrong restoration,
inherited audio seek, pause movement, stalled background audio, video policy
leakage, duplicate events, black frames and frozen frames.

## Run

Requirements: JDK21 compiler (the bundled AAR contains Java21 class files),
Android platform/build-tools36, Python3 and FFmpeg. Probe Java code targets
Java8 and D8 compiles it for API34. Kotlin stdlib2.1.0 is test-only, checksum
pinned; `KOTLIN_STDLIB` can provide an existing identical jar. `JAVAC` may select
an equivalent compiler launcher without changing library bytes.

```sh
bash e2e/mv-probe/build.sh /tmp/mv-probe.apk
python3 -I e2e/mv-probe/test_verify.py
bash e2e/mv-probe/run.sh /tmp/mv-probe.apk /tmp/mv-results
```

`.github/workflows/mv-p0-probe.yml` runs this on probe PR changes, or manually,
on API34 and36. It does
not replace the normal proxy/audio regression workflow. Do not dispatch a
duplicate run for the same candidate while it is still active.

This proves only the executed AAR/device/output paths. It does not establish
MusicFree's controller integration, Fabric mounting, production foreground
service/MediaSession behaviour, physical sound, ARM hardware decode or a real
MV content provider. Those are later implementation/acceptance gates.
