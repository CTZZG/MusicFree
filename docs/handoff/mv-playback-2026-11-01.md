# MV implementation — P0/P1/P2

## Normal App UI implementation — 2026-11-03 (device acceptance pending)

The current core checkpoint ff450 is independently accepted by CI250
`41601281631` and API154 `41601281788`. Quality212/1624/40/1437/ESLint0/215;
actual Debug JVM1414tasks executed, new digested XML37suites182tests all0.
API APK cache miss and new app/test Kotlin compile780tasks;97native methods
allcode0, original25/73/70normal0/UI20 plus both images inspected/freeze5.
RAW_STALLED raw0/session4403ms;7normal+2UI pause windows0;source12/7/focus.
Six clock rounds288samples worst+.000106367s/gap26ms; actual old
75.71431967696923→first75.71431200396826/maxpoll84ms. API153's loading-null
fixture NPE and missing normal/UI/freeze evidence remain a real historical
failure. Only the nullable poll was fixed, with the same15s/50ms and immediate
rejection of the first bad ready sample. This is not UI device evidence.

P2 now uses the original player route, optional-provider More entry, explicit
candidate selection and a cover shortcut only after a positive lookup for the
current plugin revision. There is no discovery autoplay. One MpvVideo View
changes bounds for same-route fullscreen. Hardware Back exits fullscreen before
navigation; route blur/App background release output while MV audio can continue.
MV options explain background data use; download still means original song
audio, timed song lyrics/rate controls are hidden, mini gestures use the original
song queue. Unknown MV duration is never replaced by song duration. A drag from
an old rendition cannot seek a replacement. PlaybackInfo separates MV provider/
quality label from actual decoded audio and rejects late same-song generations.

Fresh network consent reserves the existing source request before it awaits UI.
Cancel only dismisses its own dialog; a late approval cannot override a newer
pause/focus event or song. Duplicate returns share one native transition; a late
return source cannot steal the checkpoint from a newly selected video. Explicit
replay works outside single-repeat mode; old EOF cannot cancel a new selection.
Named keep-awake activation leases cannot release one another after late async
completion. Short landscape uses side-by-side video/controls and compact actions;
fullscreen controls overlay the same view, auto-hide while playing and remain
available while paused. The existing reduced-motion configuration is unchanged.

Actual component checks reject late-pause and shared-keep-awake-tag mutants;
old ff450 controller fails seven of the new29cases. New layout checks cover
three languages, small/short-landscape windows and1–2x fonts. Initial test/type/
mock/short-layout failures were fixed and preserved in scratch. SDK36 module/
View compilation and lease JUnit2 pass; this is not a whole App build or device
render. Bounded native rendition commit/ready logs contain scalar ownership/
clock facts, not URLs or credentials, to diagnose actual transitions.

P3 still requires one stable normal Release Beta/all, reuse for the new MV suite,
actual public App controls/pixels/recording, exact checkpoint return, and rendered
video EOF into prepared audio. P0 diagnostic recordings do not substitute for
normal App UI. No physical ARM/audio/car/hardware-decoder/battery or new independent
production-certificate proof. Keep draft/unmerged/unreleased; version/API intact.

## Actual App core wiring (historical checkpoint) — 2026-11-03

The10137foundation is independently accepted: CI41568241929 executes1414JVM
tasks and its digested XML has37suites/182tests with no failure/error/skip.
Quality209suites/1584Jest/40generator/1437layout/ESLint0/215 passes. API41568241994
has real cache-miss app/test Kotlin compilation/780executed tasks and96native
methods code0, including the failed-MV return case. All original25/73/70normal0/
UI20/freeze5 checkers pass, both PNGs inspected; RAW_STALLED raw0/session4405ms,
7normal+2UI paused windows0,source12/7. Six clock rounds288samples have
worst-.031787774s/gap27ms. Actual stop110.43550307396944→first110.32499950396827
is-.110503570s/maxpoll87ms. This is foundation evidence, not a later UI build.

The new MusicVideoController is now connected to the actual TrackPlayer with
its existing QualityChangeCoordinator commitTail. Selection, audio quality,
manual source mutations and error recovery share that tail; network resolution
stays outside it. Candidate browsing is not a playback request. Original song,
queue URL/duration and saved quality are not replaced by a video's URL or clock.
Native onScheduled capture immediately saves the original stop. Paused getters,
seek/persistence/exit, manual rollback, Last.fm/crossfade and lyric publication
are isolated from video time. Same-song late lyric responses are generation
checked; native/status/LiveUpdate/car cues are cleared during MV and hydrated
again after the original audio is actually ready. An explicit play during an
audio return is applied only after readiness and while the latest intent permits.

FILE_LOADED alone cannot complete an audio return. The owned PLAYBACK_RESTART
and actual first raw sample must pass the original-.25s floor. An invalid first
ready sample stays rejected even if a later sample catches up. The exact passing
sample travels in the receipt; hydration does not replace it with another read.
An exact pending/failed audio-return owner may retry only its saved checkpoint;
a successful ready load/new song/stop invalidates that special ownership. A
synchronous native rollback restores old metadata/rate and reports its identity
and any captured original stop so the adapter does not invent a new active owner.

Fresh OS NetInfo plus the existing mobile-data switch and session approval gate
video requests. Native foreground/network checks happen before mutation; a native
ConnectivityManager callback pauses an unapproved MV network even with JS asleep.
This hold is separate from user/focus intent and does not auto-resume on Wi-Fi.
A generation-scoped explicit resume rechecks current network/owner. Pausing is
not a claim of zero transferred bytes, and ordinary audio-before-MV retains its
existing behavior.

Local proof includes actual controller/TrackPlayer/adapter/lyric tests, three
rejected product mutants,43 actual native-preflight/catch cases compiled against
synthetic JNI/dispatch boundaries (old10137fails5), and SDK36 module/View/full
instrument compilation. The new failed-audio-return retry instrumentation still
needs actual device execution. Existing P0 pixels do not prove this new module.
Normal cover/more/candidate/inline/fullscreen/mini UI and final stable Release
Beta/all+MV device acceptance remain unfinished. Actual rendered video EOF into
prepared audio remains required; ordinary audio runway tests are not a substitute.
No new production signature/physical ARM/audio/car/hardware-decoding proof.

## Accepted Fabric path and P1 rendition foundation — 2026-11-03

The ba18 batch is independently accepted. CI41556840337 actually executes
1414JVM tasks; new XML37suites/182tests has no failure/error/skip. API41556840319
has a genuine APK cache miss, app/test Kotlin compilation and780executed tasks;
95native methods pass, together with the original25/73/70+normalcode0/UI20/
freeze5 checks. Both spinner PNGs were inspected. RAW_STALLED is raw0/session
4404ms,7normal+2UI pause windows0,source12begin/7resolved. Six clock rounds
288samples have worst-.037882802s/maxgap27ms; actual old95.40126676196952
to first95.43714464196951 has maxpoll116ms. Original gates remain unchanged.

Fabric41556877856 actually builds R8/JS/Release1244tasks, in the exact ba18
tree. New diagnostic APK29933869bytes/SHA256
2905c1ce31ea6989ddde38a02279eb3e92865aa2ee2516e6b7fef5a9f51f8e77
independently verifies with the public TEST certificate; all10x64JNI payloads
match the actual fixed AAR. Every artifact ZIP digest was verified. All8phases
and unchanged pixel/lifecycle checker pass in instance239907257: H264144 at
seek/remount/actual landscape/portrait, HEVC24, background260→foreground477,
two completed MV identities and audio37→37.756911934666526. All8screens were
inspected and the complete VFR recording decodes. Home BEGIN01:20:17.825,
host pause19.224, detach19.527, END20.760; resume21.240 then attach21.790.
The previous late-detach failure remains retained; its marker was not widened.

P1 now adds a narrow adapter/native foundation, not the normal App feature.
Confirmed active rendition is separate from attempted-load ownership. Same-song
replacement awaits its exact FILE_LOADED identity, resolves the latest logical
queue index, and emits renditionChanged without trackChanged or writing an MV
URL/duration into the audio queue. Native capture is delivered on scheduling,
before activation, for immediate original-audio checkpoint persistence. Unknown
video duration remains0. Extra runtime source/metadata fields cannot override
the host's identity or position policy. MV rate1is separate from the audio rate.

Native event/progress/end scope includes load generation and rendition kind.
After first MV use, queued old property callbacks are rejected and current native
values are read; the ordinary audio-before-MV observed-value path is retained.
Prepared source/chain owners are checked before mutation and linked through native
promotion. A preflight-rejected MV cannot erase genuine prepared-audio promotion;
a cancelled MV's late receipt cannot clear the new song's runway. Both races had
real failing adapter tests before repair. Owned pending/failed MV can explicitly
start zero or return to captured audio, without inventing an outgoing MV clock;
preserve-MV still requires a live clock and a declared matching timeline.

Final local verify209suites/1584Jest/40generator/1437layout, ESLint0/215,
TypeScript/static/cycles/7patch passes with the existing dependency install.
Real adapter tests are62(46original+16new). Actual preflight/catch+latch and
PendingSeek/Unpause pass36synthetic JNI/dispatch cases; ba18 fails3new valid
pending/failed transitions. SDK36 complete module/View and full instrumentation
compile, including the new failed-MV-to-paused-audio test; no new local App/device
result is claimed. The foundation still needs its own cloud execution.

Shared commitTail controller, persistence/lyrics/Last.fm/plugin/network routing,
normal App MV entry/inline/fullscreen/mini UI and final product acceptance are
unfinished. Actual prepared audio after a rendered video EOF also remains a
mandatory integration/device gate. Do not replace it with ordinary audio prepared
tests. Failed audio-return retry must retain its checkpoint and remain bounded.
No production certificate, ARM hardware decoding or physical output is proved.

## Host lifecycle must release video output — 2026-11-03

CI41475773503 and API41475773509 accepted9c2 independently: real JVM
1414tasks executed,37suites/182tests with no failure/error/skip;95native
methods code0, including owned-video EOF and rejected-load ownership.
The original25/73/70+normalcode0/UI20/freeze5 checks all pass. Freeze is
real RAW_STALLED/raw0/session4402ms;7normal+2UI pause windows remain0.
Six clock rounds288samples have worst-.013113158s/maxgap30ms; the actual
old stop125.87798876197024 to first126.01846662596827 has maxpoll98ms.

Fabric41475871797 completed all8phases in one mpv instance: H264 frame144
at seek/remount/real landscape/portrait, HEVC frame24, and both confirmed
video EOF identities. Audio returns to37s and advances by.674915126s.
The raw recording fully decodes and the actual screenshots were inspected.
Its APK bytes, public TEST certificate and all10x64JNI payloads match.
It nevertheless fails the unchanged checker: Surface detach occurs at
16:12:58.293, after Home END16:12:57.047 and3.302s after actual RN host
pause. The view's window-visibility callback arrives only on the way back.
The report's own passed status does not override this lifecycle failure.

The video view now observes RN host lifecycle while attached, releases its
owned output on pause/destroy, and unregisters when detached or disposed.
Texture replacement releases the old Surface without dropping that listener.
Every update reads the actual ReactApplicationContext lifecycle, rather
than the themed wrapper or a cached resume boolean. RN can deliver a queued
resume notification after a later pause, so that callback must not reattach.
Existing owner/generation/window/visibility guards remain. This changes only
video output ownership, with no load/seek/play/pause/focus command.

Actual View/lease source compiled against synthetic Android/RN/module
boundaries passes9host cases. Original9c2 passes4/fails5; removing the
pause guard fails4, removing unregister fails3, and a cached resume-state
implementation fails1. These are not device/JNI/frame proofs. Final SDK36
module/View and complete changed instrumentation compile; local full verify
208/1568/40/1437, ESLint0/215, TypeScript/static/cycles/7patch passes using
the existing dependencies. New native diagnostic bytes and the complete
unchanged device gate are required before P0 is accepted. The normal App
MV controller and user-facing entry remain unfinished.

## END_FILE teardown and paused resize — 2026-11-02

The next device batch exposed two concrete failures in d066; no run was
silently retried or accepted. CI41461221249 really executed1414JVM tasks;
its new XML is37suites/182tests, all failure/error/skip0. API41461221623
completed95native methods:94passed, but the new owned-video-EOF method
timed out. The remaining real-JS/UI/freeze stages were not executed.
The original log shows END_FILE at14:30:51.922, then path/eof-reached
already unavailable at14:30:51.923, before idle-active had settled. An
instantaneous property gate therefore discarded a valid terminal owner.

The existing natural-end path now latches the exact MV identity from
END_FILE without requiring those transient properties. A volatile identity
snapshot is taken at callback receipt, before dispatching to the main
looper; an old queued callback cannot assign completion to a newer load.
Promotion, pending-load/current-generation checks and revocation remain.
Ordinary audio/prepared handling is unchanged. The actual latch and
preflight/catch code with real PendingSeek/Unpause passes28host boundary
cases. Original d066 passes23/fails5, including missing teardown properties
and a queued old callback. This is synthetic JNI/dispatch, not device EOF.

Fabric41461328511 really rotated to landscape, but its paused frame was
cropped, so the frame guard correctly failed and later phases never ran.
The raw viewport changed996x560 to1342x754; measured color bars are302px
instead of about224px, matching the extra1342/996scale of the old render
target. The frame's top barcode and right edge were missing. The output
now recreates only its VO/Surface binding when bounds change, setting the
new size before creating that output. It keeps the same player/file and
issues no load, seek, pause, unpause, rate or volume command. Normal
unchanged-size updates do not rebuild it; stale owner/generation guards
remain. Actual output/lease code passes6host Surface/JNI-boundary cases;
d066 fails2(size-before-VO and paused resize). Real resized pixels remain
the mandatory Fabric gate, not a conclusion of those mocked boundaries.

The failed d066 diagnostic APK is retained:29933761bytes, SHA256
b2e61f880a530fc68a6e394662971471449c367e9cafaf9d88fe4b6468062fe4;
its public TEST certificate verifies independently and all10x64JNI files
match the fixed AAR. It is not the next repair APK or a production-signed
App. The full VFR recording decodes and the actual failed landscape images
were inspected. No pixel/deadline/clock/pause gate was weakened. A new
native diagnostic build is required for these two related product fixes.
The final source passes full local verify208suites/1568Jest/40generator/
1437layout, ESLint0/215, TypeScript/static/cycles/7patch checks using the
existing dependency install. Actual SDK36 module/view and complete changed
instrumentation classes compile. There is no local whole-App/device pass.

## Completed MV ownership — 2026-11-02

Run41449166385 (product172b) built the real Fabric Release variant and
rendered H264 seek144, remounted Surface ownership, and background/foreground
frames266/556 in one mpv instance. It then failed: the24second MV reached
natural EOF while the host captured screenshots; the next explicit MV load
was rejected because mpv no longer had a live path/time-pos. Its claimed
landscape screenshot was also still portrait. Neither incomplete sequence
is accepted as a complete P0 pass.

The module now remembers only an owned, unpromoted MV completion: exact
active identity/current generation, no loading identity, and actual native
idle/EOF at END_FILE. A matching explicit zero-start MV or stored audio
return may replace this terminal generation without an invented old clock.
Audio-to-MV capture and preserve-MV still require the live matching file.
New loads, active identity changes, stop/destroy and playback restart revoke
the terminal identity. Late/wrong generations and pending replacements are
still rejected without modifying the owner. The actual extracted preflight
and catch with real PendingSeek/Unpause pass18host cases; original172b fails
the2new valid EOF replacements. These are synthetic JNI/dispatch boundaries,
not device acceptance. The real-module instrumentation additionally drives
JNI to EOF, rejects a wrong return generation, then restores paused audio37.

The compiled probe now deliberately observes both MV generations at EOF
before the next MV/audio transition, and the host uses WindowManager's
rotation command already used by the App's existing continuity checks.
The checker still requires a real wider landscape image, all original
frames/Surface/intent/clock assertions, and both confirmed EOF identities.
New native/compiled-entry changes need a new diagnostic APK;172b's bytes
are retained as failed evidence. Current local full verify208/1568/40/1437,
ESLint0/215 passes; new real device acceptance is still required.

The172b normal checks are independently accepted: CI41449131122 actual
JVM1414tasks executed,37suites182tests failure/error/skip0; API41449131129
cachemiss/new app/test Kotlin,94methods code0 including rejected-load
ownership, native25/slow73/normal70+normalcode0/UI20+two viewed PNGs/freeze5.
Freeze is actual RAW_STALLED/raw0/session4405ms;7normal+2UI pause windows0;
source12begin/7resolved. Six clock rounds288samples worst+.000122678s,
gap32ms; actual old106.621453945 to first106.669750362, maxpoll78ms.
These figures describe172b, not the subsequent EOF repair candidate.

## Rejected-load ownership and diagnostic lifecycle — 2026-11-02

Run41410113207 showed two React surfaces around an Activity recreation, then
two audio generation100 loads from the diagnostic's uncancelled async effects.
The module also had a real defect: rejecting a stale rendition request still
cleared another generation's loading identity, deferred seek and pending
unpause. The error handler now performs rendition rollback only after this
call began mutations. Rejection before that point has no side effects;
ordinary audio failure cleanup and rollback of an owned capture remain.

The real production preflight/catch source and actual PendingSeek/Unpause
were compiled with synthetic dispatch/JNI boundaries: old source4passed/
5failed, repaired source9passed. This is not a whole App/JNI execution.
A new Android instrumentation regression drives the real module/JNI, holds
the actual replacement-window fields and checks that a rejected stale request
cannot erase the pending generation/seek/unpause or replace the old file.
Local full SDK36 module/view, Java test context and both complete changed
instrumentation classes compile; new device execution remains required.

The diagnostic now gives each mounted runner an owner, guards native calls
and waits after unmount, rejects old checkpoint acknowledgements and only
destroys a player while still owning cleanup. Two real helper mutants
(unguarded late call / old-owner destroy) fail the same Node controls.
The helper is a compiled entry dependency and is included in APK-reuse
source checks. These changes require a new diagnostic APK; old2b00 bytes
cannot prove this native/lifecycle repair.

Retained device preparation failures:41403708916 actually rendered H2646s/
frame144 but the system Launcher ANR obscured its pixels;41406564551 never
booted because host6674.02MB was below default userdata7372.80MB;41408342199
closed only the exact Launcher ANR and rendered frame144, but the checker
used Fabric window y784 for a view whose actual screen y was920. The Pixel7
cutout top136 is also present in the original system log. The repaired crop
uses the actual Android MV container bounds, matched against RN size, never
a guessed offset; replaying the original screenshot decodes144 and rejects
the old crop. The RN overlay check now samples its actual label bounds,
so a yellow video bar cannot satisfy it. Original frame/color/corner gates,
15second first-frame and30second checkpoint deadlines remain unchanged.
No incomplete old run is promoted to success. A4G emulator data configuration
and exact system-dialog preflight are diagnostic setup, not product changes.

## Fabric module lookup repair — 2026-11-02

The actual Fabric Release probe41401505452 captured outgoing audio37seconds,
rejected a stale replacement and activated MV101, but timed out waiting for a
real first frame. It produced no Surface attach event. The screenshot also
contains a Pixel Launcher ANR; that alone does not establish the App cause.

RN0.85.3 `ReactInstance.getNativeModule(Class)` returns null unless the class
has `@ReactModule`. This module was only registered by name; the existing
App instrument used by-name lookup while the new view used class lookup.
The repair declares the same module name in its annotation and `getName`,
and the real App instrument now requires both lookups to return the very
same player. Actual SDK-compiled old class fails the lookup-name check;
fixed class passes. The complete module/view and full original JS instrument
with its probe helpers compile against SDK36. This is not device acceptance.

Diagnostic harness history is retained:41396838259 built Release but lacked
ffmpeg before emulator setup;41399045777 launched Fabric but its external
shell exited while `phase.txt` was not ready. That second APK was preserved
and reused unchanged for41401505452 after the missing-file pending check was
fixed. Deadlines and frame/state checkers were unchanged. The current native
repair needs a new diagnostic APK, not another replay of the old bytes.

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

## Remaining gates at the initial P0 checkpoint (superseded by the sections above)

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
