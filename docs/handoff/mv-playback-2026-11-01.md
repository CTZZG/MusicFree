# MV implementation — P0

## Plugin contract checkpoint — 2026-11-02

Optional wrapper/source service now supports both the new method pair and the
existing QQ/Bilibili `getMvSource` API. It preserves original association fields,
uses existing URL admission and variables, caches metadata only, resolves fresh
URLs on selection and rejects late results after owner/revision changes. See
[the interface contract](../music-video-plugin-api.md). This is not yet a visible
MV control or a complete rendition coordinator.

Full current local verify208suites1568Jest/40generator/1437layout and
ESLint0/215 passed;32 targeted wrapper/source tests passed. Removing the
disable-enable revision or plugin-instance guard makes the original tests fail.
The source was restored after both controls. The first fake-timer test fixture
accidentally awaited before advancing the clock; corrected without changing
the15second product timeout. No new full local App/device result is claimed.

## Current App integration checkpoint — 2026-11-02

The user supplied a real subscription; its unmodified QQ/Bilibili plugins both
return playable video through the optional `getMvSource(song, quality)` method.
The real QQ sample is HEVC720p+AAC and Bilibili's sample is H264720p+AAC.
Both were fully decoded and their actual frames viewed on the host. QQ's audio
CDN returned403; do not claim that audio path passed or invent the reason.
The private key/temporary media URLs were not committed or sent to Actions.
See the PR's `mv-real-source-validation` record for exact hashes and scope.

This checkpoint adds the narrow product `MusicFreeMpvVideo` ViewManager,
TextureView and Surface lifecycle helper using the existing mpv instance.
View owner/generation and actual SurfaceTexture identity prevent late old
callbacks from detaching or reporting a frame for a new view. The view can
only present an already confirmed native MV generation; it has no URL/load,
seek, focus or unpause authority. GPU output remains off for audio and while
the view is hidden. Native loading now has a separate strict outgoing-file
capture and start-zero/restore-audio position contract. Ordinary audio source
replacement retains its existing fallback behavior.

The explicit `-PmvViewProbe=true` build uses a separate applicationId and test
certificate, a separate JS entry, Release R8/Hermes and the actual product
module/ViewManager. The diagnostic entry is absent from normal App bundles.
Its manual workflow verifies actual Fabric, rendered frame barcodes, RN
overlay/clipping, replacement owner, portrait/landscape, Home/return,
H264/HEVC decoding and audio restoration. It does not add a product menu.

Local results: full verify207suites1545Jest/40generator/1437layout,
ESLint0errors215warnings; actual SDK36 full changed native module/view
compilation and2real JVM lease tests passed. Removing owner-release or
generation guards makes the same tests fail. Ten independent checker
controls and actual encoded H264/HEVC PNG crop/barcode/overlay controls pass.
The first native compile lacked an AndroidX media classpath entry; the first
target lint found the diagnostic's JS global and inline-style issue. Both
were corrected before the complete successful checks. Host/compiler results
are not Android/Fabric mounting or physical audio evidence.

**Next gate remains actual Fabric Release device acceptance.** The plugin
contract above is independently tested; the rendition coordinator and visible
MV entry still follow the device gate. Keep PR draft until current
device evidence and the final product candidate are independently verified.

Base: v0.14.0 / `91fa2b98046078fe65303ee28c5b7ad83750e9fa`.
Keep version400037/API34; no merge/tag/release. Full design pack is at
`/workspace/MusicFree-MV-Sol-handoff-20261101` in the current workspace.

## Historical standalone P0 checkpoint (before the App view and plugin additions)

- An isolated Android capability probe using the exact bundled AAR, two real
  Android Surface implementations and original generated media.
- Raw capture, bounded stage waits, real home/return orchestration and an
  independent frame/state checker with28 host controls.
- A separate manual API34/36 workflow, leaving normal product regressions intact.

There are no MusicFree playback implementation changes, plugin API additions,
AAR replacements or visible MV buttons in this first checkpoint. Two compatible
transitive lockfile patches address the newly blocking CI advisories below.

## Actual local evidence

SDK36 compiled the probe's real Java code, D8 packaged unchanged JNI libraries,
and apksigner verified the test APK. Host checker self-tests: ten passed.
The AAR SHA256 is
`4944f8d00546aa2bf2d5b4d0510ef6aa209300c5c6707b44f3b8829e8c691d4c`.

Initial toolchain failures are retained: JDK17 cannot consume the AAR's
class-version65; Android bootclasspath's LambdaMetafactory stub lacks the
bootstrap method; the local trimmed JDK21 has no Java8 ct.sym. Using the actual
JDK21 compiler module with source/target8 and D8 resolved compilation without
changing the AAR. The cloud uses the complete JDK21 setup.

No local Android device/KVM is available. This local result is a build and
checker result, not actual video output or app regression acceptance.

## Review repairs after run4

The review found three P0 coverage gaps. Run4's target clock reached6s while
three of four seek PNGs still showed3.625/2.167/5.250s. Return-audio sought to
the captured position but stayed paused before the next video replaced it.
The old checker accepted a copied trace with its background detach/foreground
attach removed. Those raw artifacts and the original review remain retained;
the prior green summary is insufficient for completeP0 acceptance.

The repaired probe now waits for this SEEK followed by PLAYBACK_RESTART within
the existing10s wait, then reads a ten-bit frame number actually rendered in
the generated clip. The seek PNG must be within one24fps frame of6s; the
original .25s native-clock criterion also remains. Old pending frames are
logged and the first is saved. The independent checker decodes the PNG rather
than trusting the frame number reported by Java.

Return-audio now explicitly unpauses and samples the same audio file900ms
apart, requiring more than0.5s real native progress, pause=false, vid=no and no
attached Surface. This adds the previously missing playing-intent coverage;
it is not the future product controller's paused-intent implementation.
Surface evidence now includes the one mpv instance, Surface identity and binding
generation. The checker reconstructs ordered ownership and the background
interval, reconciles raw counters, and rejects a stale reattached frame.

Local results:28 checker cases pass. The same eight selected cases against the
old checker pass only the complete control and fail seven rejection cases.
Actual generated H.264 frames0/87/144/575 survive codec/letterboxing/PNG and
match both the independent Python decoder and the actual Java helper. Initial
host compiler selection failed because this environment has a Java21 compiler
module without a javac launcher; the same explicit JAVAC selector as build.sh
resolves it. Real SDK36/Java21/D8 test APK assembly and test-certificate
apksigner verification passed; all10 original x64 JNI payloads match the AAR.
These repairs have not yet been accepted on Android devices; one focused
API34/36 standalone workflow is required for the changed probe/fixtures.

## Source investigation

Reviewed official MusicFreePlugins at
`3fa57cf37c100f32ca96e9199c6b008e79db28c1`:

- Yinyuetai provides MV-derived `fullClip.urls` through the existing audio API,
  but has neither proposed MV method. One standard-proxy request failed with
  `Tunnel connection failed: 403 Forbidden`; no live stream verified.
- Bilibili's existing source selects a DASH audio track; that must not be
  assumed to be combined video. One public metadata request returned HTTP412;
  no playable MV verified.
- Navidrome requires a configured user server; no credentials or private user
  files were read to find one.

Do not claim these old plugins implement the new API or that a test clip is
real content-provider acceptance. The standalone output observations below are subject to the review repairs above. Real content and RN/Fabric
composition remain unverified, so there is no visible MV entry or completed
product MV feature yet.

## Device run2 and diagnosed harness corrections

`41278370119` built and test-signed both probe APKs, then failed on both devices.
Recovery runs `41278852881` and `41279114209` only repack the original artifacts;
they do not repeat a device or build. The first archive exceeded the32MiB
transfer limit; one standard CLI attempt was also denied. Original archives
remain on GitHub. Recovered ZIP digests were checked, and43 raw files matched
the recovery manifest. Actual coloured H.264 frames were viewed on API34/36,
using gpu-next and software decode.

- API34 TextureView's original Activity was relaunched. Its old worker later
  wrote a failure while the new Activity had already rendered video. The
  helper now cancels destroyed Activity work and records lifecycle events.
- API36's first AudioTrack failed with AudioFlinger `unknown uid` immediately
  after install. The helper now requires a real Android PCM track preflight
  before creating mpv; it does not retry failed mpv loads or use ao=null.
- Both SurfaceView runs detached video while real audio advanced0.832/0.863s.
  Reattachment selectedgpu-next, but PixelCopy was requested before its first
  new buffer (ERROR_SOURCE_NO_DATA); later screenshots show real video. The
  helper now waits boundedly for actual copy/TextureView frame readiness.
- Native zero position is recorded while the new MV is initially paused. A
  PNG's encoding time must not be treated as the first engine timestamp.

These are partial observations, not fullP0 acceptance: return-audio and appended
EOF were not reached. Fixed helper compilation and ten host controls passed;
the new device batch must prove the remaining steps.

## New audit blockers

CI237 passed the functional quality checks, then correctly blocked
follow-redirects GHSA-mrwp-f3q8-3g9p and joi GHSA-4528-x5fx-h6hg.
Only two lock entries change: follow-redirects1.16.1 to1.16.2 and joi17.13.8
to17.13.9, both within existing parent ranges. Root package.json and audit
exceptions are unchanged. The local production audit now passes with the same
three documented exceptions (critical0/high3/moderate20/low4).
An isolated actual-package HTTP redirect control reproduces the old cross-realm
header leak and verifies the fixed package strips it; representative Joi schema
and multi-email validation passed. Shared node_modules were not modified.

## Standalone device result (run4)

Manual run `41279963118`, exact source
`d5781382aecfae3001133635a872fdb5061232f9`, completed on API34 and36 x86_64.
Both TextureView and SurfaceView used the unchanged AAR/JNI payloads,
`gpu-next`, H.264 and software decoding. Each case created one mpv instance.
Original frame PNGs were fully decoded independently; changing colourful frames
and restored-surface images were actually viewed. Media hashes match the original
fixture manifest. The fixture files were fully decoded with ffmpeg -xerror.

| API / surface | Actual audio stop → restored (s) | MV start | Background audio advanced (s) |
| --- | --- | --- | --- |
| 34 TextureView | 37.691712966 → 37.691712966 | 0 | 0.882853481 |
| 34 SurfaceView | 37.628646760 → 37.628645833 | 0 | 0.753554849 |
| 36 TextureView | 37.643869553 → 37.643854167 | 0 | 1.698134394 |
| 36 SurfaceView | 37.710025698 → 37.710020833 | 0 | 0.803251209 |

All four actual pause deltas were zero. After video EOF the appended audio
became active near0.35s with vid=no. The original checker accepted all four cases,
but it did not establish rendered seek readiness or actual returned-audio resume.
Artifacts13072223587/13073315785 ZIP digests were verified. Detailed evidence is
in the task scratch `p0-final-independent-summary.json` and original GitHub
artifacts. No AAR rebuild is justified by this evidence.

Run3 `41279404773` is retained as a failure: SurfaceView completed on both APIs,
but TextureView queried time-pos after START_FILE before FILE_LOADED. Run4 waits
for the new FILE_LOADED and actual finite progress; it does not substitute zero
for a missing property or relax pause/restore observations.

The provisional product choice is TextureView for rounded clipping/overlays and
its actual frame-update callback. This is a candidate, not proof of correct RN
layering, rotation, Fabric Release mounting or old-view ownership. Those require
the next narrow native-view integration test. This standalone run has raw event
logs and PNGs, not an app interaction recording or physical output test.

## Normal regression result and seek-fixture repair

CI239 `41279464834` at fe165 passed actual fresh-install quality:
207 Jest suites/1545 tests,40 generator/1437 layout, ESLint0 errors/215 warnings,
and the production audit with the same3 exceptions. Actual Debug Gradle executed
all1414 tasks. The new ZIP digest was checked:36 suites/180 cases,
zero failures/errors/skips. These are fe165 results, not the later seek repair.

API143 `41279464833` failed its separate page buffering-button scenario.
Its original70 JS source/focus/transition readings were written, but the whole
normal instrumentation returned code-2; UI20 and freeze were not accepted.
The actual timeout label was ordinary `暂停, busy`, not the injected loading
label. Raw timestamps show setup at06:27:12.292, native seek done12.420 and
PLAYBACK_RESTART12.439: time-pos exposed15 before the real seek finished.
That restart legitimately published playing after the synthetic buffering event.

The test-only setup now observes this seek and its PLAYBACK_RESTART before
injecting buffering, removes its observer in finally, and shares the existing
30-second seek deadline. All original button, pause, raw-progress, first-read,
250ms/.25s and freeze gates remain unchanged. Actual SDK36 compilation of the
whole changed instrument/probe/policy/reader passed, using real project classes
for unchanged neighbours; this is not a local full App/device run.
Seven host boundary cases run the exact observer body: fixed7/7; removing seek
ownership5/7; admitting target-visible before restart2/7. Mutants were only
scratch host sources.

CI240/API144 at f4ba subsequently completed: actual quality207/1545/40/1437,
ESLint0/215; Debug Gradle1414tasks executed and36 suites180tests with no
failure/error/skip. API144 really compiled app/test Kotlin and780tasks;
93native methods code0, native25/slow73/normalJS70 with normal instrumentation0,
UI20 and both PNGs viewed, and freeze5 with actualRAW_STALLED/raw0/session4403ms.
All seven normal plus two UI paused windows stayed still. Six clock rounds
288samples: worstDelta-.149819991s/maxgap28ms; actual old stop100.045203261 ->
first100.165848505, maxpoll99ms. Source12begin/7resolved/focus passed. The
single setup SEEK/RESTART preceded all UI readings. No original gate changed.

## Remaining gates

- Focused device acceptance of the three repaired standalone P0 checks; ordinary
  CI240/API144 passed for the unchanged product/test preparation at f4ba.
- Narrow production native-view/Fabric mounting, owner+load-generation handoff,
  RN layering/clipping/rotation, full app recording and Release evidence.
- One actual provider's MV association and combined playable URL/headers/expiry.
  Current requests did not establish one; do not substitute the generated clips.
- Only then the optional plugin/controller contracts and MV UI according to the
  design pack. Current app menus, playback implementation and AAR remain intact.

No merge, release or version/API change. No ARM/physical phone/hardware-decoder,
physical sound, commercial service or production-signature coverage is claimed.
