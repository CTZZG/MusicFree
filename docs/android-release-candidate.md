# Android Release Candidate

Round 18 turns the migration branch into a stable Android release candidate.

## Baseline

- App package: `fun.upup.musicfree`
- App version: `0.6.3-beta.1`
- Android `versionCode`: `400011`
- React Native: `0.76.5`
- Expo SDK: `52`
- React: `18.3.1`
- Private player fork: `github:CTZZG/react-native-track-player#v4.1.1`
- Hermes: enabled
- New Architecture: disabled

## Build Status

- Local TypeScript check: `npx tsc --noEmit --pretty false` passed on 2026-06-01.
- Local release build: `npm run build-android` passed on 2026-06-01.
- Local release APKs generated under `android/app/build/outputs/apk/release/`.
- Local `app-arm64-v8a-release.apk` signature verified with `apksigner`.
- Local `aapt2 dump badging` confirmed package, version, SDK, and ABI metadata.
- GitHub Actions workflow verification is still pending until this branch is pushed and `.github/workflows/android-build.yml` is run through manual dispatch, a `v*` tag, or a merged PR.

## Release Changelog Draft

- Redesigned the Android home page around discovery, continue listening, recent playback, quick access, and personal library management.
- Improved multi-source search and browsing with source-aware tabs, artwork in song results, quality badges, duration display, and clearer partial-failure states.
- Added deeper discovery/chart browsing while keeping home startup network-light.
- Improved album, artist, playlist, and GD Music fallback navigation so plugin-provided identifiers are preferred when available.
- Upgraded the playback detail experience with richer cover-page song information, mini lyrics, word-by-word lyric rendering, lyric alignment controls, blank-line handling, and Android-safe cover gestures.
- Added square/circle cover style support with Android-safe circular rotation.
- Strengthened Android download handling with notification permission checks, native download progress states, metadata writing, optional sidecar lyric files, OGG metadata support, and special-format diagnostics.
- Added plugin lazy-load/import controls, cache clearing, clearer import diagnostics, and Android-compatible GD Music plugin guidance.
- Preserved CTZZG's private `react-native-track-player` fork for broader audio-format playback.

## Plugin Compatibility Notes

- Android plugins should stay near ES8 syntax. Avoid optional chaining, nullish coalescing, class fields, and other newer syntax unless the plugin is transpiled before distribution.
- `async function name() {}` is safer on Android than `const fn = async () => {}`.
- Desktop plugins can often run newer syntax, but Android plugin imports run through a stricter mobile JS path.
- If a plugin imports successfully on desktop but not Android, first check syntax, then unsupported globals, then network/API differences.
- Use the Android-compatible GD Music plugin build for GD Studio API testing.
- The app now exposes lazy-load controls, cache clearing, and import diagnostics so a stale cache or parse failure can be distinguished from a runtime plugin error.

## Diagnostics Checklist

- Plugin import failure: check import diagnostics, plugin cache state, source URL/path, syntax level, and Android-specific globals.
- Lyric loading failure: check whether the plugin provides `getLyric`, whether returned LRC/QRC is parseable, and whether translation/romanization timing is present.
- Playback failure: check media source URL, quality fallback, private player format support, encrypted-source guards, and plugin `getMediaSource` errors.
- Download failure: distinguish permission, notification, network, unsupported encrypted format, and metadata write failures.
- Metadata write failure: check file format support. MP3, FLAC, and OGG are taggable; Opus and M4A/MP4 are currently playback/download paths without verified tag writing.
- Crash regression: collect `adb logcat` and `adb shell dumpsys dropbox --print`, especially for Reanimated `CppException` and native player errors.

## Real-Device Regression Checklist

- Startup and cold restore.
- Resume previous queue/progress, then play/pause from restored state.
- Bottom music bar opens playback detail without crashing.
- Continue-listening card opens/plays without crashing.
- Previous/next/play mode controls.
- Cover tap switches to lyrics; cover long-press opens image viewer.
- Cover-page mini lyric: word-by-word highlight, blank lines, no visible dark rectangle, no return-transition flash.
- Full lyric page: alignment picker, five-line density, translation/romanization toggles, repeated lyric lines.
- Search page: multi-source tabs, artwork, quality badges, duration, partial source failure.
- Album/artist/playlist navigation: direct plugin detail when ids exist, search fallback when not.
- Home discovery: multiple enabled chart sources, disabled sources filtered out, no-top-list plugins excluded.
- Download flow: permission prompt, notification state, pause/resume/cancel/retry, metadata/sidecar lyric write.
- Local playback and downloaded-file diagnostics.
- Notification playback controls and background/foreground restore.

