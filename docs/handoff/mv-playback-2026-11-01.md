# MV implementation — P0

Base: v0.14.0 / `91fa2b98046078fe65303ee28c5b7ad83750e9fa`.
Keep version400037/API34; no merge/tag/release. Full design pack is at
`/workspace/MusicFree-MV-Sol-handoff-20261101` in the current workspace.

## Implemented

- An isolated Android capability probe using the exact bundled AAR, two real
  Android Surface implementations and original generated media.
- Raw capture, bounded stage waits, real home/return orchestration and an
  independent frame/state checker with ten rejection controls.
- A separate manual API34/36 workflow, leaving normal product regressions intact.

There are no MusicFree product changes, plugin API additions, AAR replacements
or visible MV buttons in this first checkpoint.

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
real content-provider acceptance. Capability/output evidence is pending the
manual device run, followed by RN/controller integration only if the path works.

## Next

Read the current run's real jobs/logs/artifacts, inspect actual frames and
recompute the checker. A rendering/lifecycle failure must be localized before
changing the normal product path. Keep original audio gates, seek-clock rules,
pause windows and negative evidence. Native surface ownership, video/queue
identity and all progress consumers remain the next implementation scope.
