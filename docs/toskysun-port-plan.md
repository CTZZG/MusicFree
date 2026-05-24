# Toskysun Feature Port Plan

Last updated: 2026-05-24

## Scope

- Base repository: CTZZG/MusicFree `dev-apk2`
- Reference repository: Toskysun/MusicFree `master`
- Keep CTZZG's private `react-native-track-player` fork as the player base.
- Do not wholesale upgrade React Native, Expo, React, package namespace, signing, or Android/iOS project metadata.
- Preserve CTZZG's extended local audio format support, including private-player behavior and extra file intent filters.

## Current Baseline

- [x] Compared CTZZG `dev-apk2` with Toskysun `master`.
- [x] Confirmed CTZZG uses `github:CTZZG/react-native-track-player#v4.1.1`.
- [x] Confirmed the local workspace is a zip-style checkout with an empty `.git` history and all files currently untracked.
- [ ] Create or restore a real git baseline before large native/download migrations.

## Verification Log

- [x] 2026-05-24: `buffer@6.0.3` and `pako@2.1.0` are present in `package-lock.json`.
- [x] 2026-05-24: esbuild syntax check passed for Round 1 touched TS/TSX files. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: esbuild syntax check passed for Round 2 lyric parser/decrypter files and `lyricManager`. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: esbuild syntax check passed for Round 2 file naming and metadata primitives. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: Native `LyricUtilModule.kt` QRC/Kuwo port passed text checks: braces are balanced and no Toskysun desktop lyric/native-event dependencies were introduced.
- [ ] 2026-05-24: Android Gradle/Kotlin compile is still pending because this machine has no `JAVA_HOME`/`java` on `PATH`.
- [x] 2026-05-24: esbuild syntax check passed again after trimming metadata types so unported native download/mflac APIs are not declared as available.

## Round 1

Goal: stabilize plugin compatibility and introduce the new quality model without touching the private player core.

### Phase 0: Baseline Notes

- [x] Record repository comparison and migration constraints.
- [x] Record local git state.
- [x] Run lightweight TypeScript checks after code changes.

### Phase 1: Plugin Runtime Compatibility

- [x] Add plugin sandbox packages for `pako` and `buffer`.
- [x] Preserve CTZZG mobile runtime fixes: `musicfree/storage`, `URLSearchParams`, safe `_require`, longer axios timeout, and Promise/Array polyfills.
- [x] Normalize plugin music item qualities after search/detail/list imports.
- [x] Pass `ekey` through media source results for later encrypted-resource support.
- [x] Add plugin type support for `supportedQualities`, `getWordByWordLyric`, and `ekey`.
- [x] Keep old plugin quality keys compatible.

### Phase 2: Quality Model Foundation

- [x] Expand quality keys to the Toskysun-style model: `96k`, `128k`, `192k`, `320k`, `flac`, `flac24bit`, `hires`, `vinyl`, `dolby`, `atmos`, `atmos_plus`, `master`.
- [x] Map legacy `low`, `standard`, `high`, `super` to the new model.
- [x] Add quality text, abbreviation, sort, and availability helpers.
- [x] Update quality selection UI to show available qualities per track.
- [x] Keep app defaults compatible with existing CTZZG settings.

## Round 2

Goal: improve lyrics and downloaded file quality.

- [x] Add `romanization` and word-by-word lyric types.
- [x] Port richer LRC parser and timestamp merging.
- [x] Port QRC XML conversion.
- [x] Add encrypted lyric detection/decryption helper wrappers with safe fallback when native decrypt methods are unavailable.
- [x] Port native Android QRC/Kuwo decryption methods into CTZZG's `LyricUtilModule.kt`.
- [x] Port metadata writing primitives for title, artist, album, cover, and lyrics.
- [x] Port file naming formatter.

## Round 3

Goal: migrate high-risk native download features after the data model is stable.

Entry notes:

- CTZZG currently has `Mp3UtilModule.kt` but no `NativeDownload` module or Android download package.
- Toskysun's native download queue requires the Android `download` package, `NativeDownloadModule`, notification manager, JS native wrapper changes, and downloader rewrite.
- Toskysun's mflac support is tied to native `Mp3UtilModule.kt` additions plus `nanohttpd`/`okhttp`; keep this separate from the native queue so CTZZG's private track-player support can be evaluated first.
- Do not start this round until Android can compile locally (`JAVA_HOME`/`java` available) and a real git baseline exists.

- [ ] Port native Android download queue.
- [ ] Port download progress, pause, resume, cancel, and retry events.
- [ ] Port download notification lifecycle.
- [ ] Integrate metadata writing after download completion.
- [ ] Evaluate mflac handling against CTZZG's private track-player support before enabling proxy/decrypt behavior.

## Later / Optional

- [ ] Play-by-ID panel.
- [ ] Quality translation settings panel.
- [ ] Music metadata settings panel.
- [ ] Mini lyric / song detail enhancements.
- [ ] Announcement dialog/service.

## Do Not Port Directly

- [ ] Public `react-native-track-player` dependency.
- [ ] Toskysun's postinstall patch for public track-player unless CTZZG's private fork has the same issue.
- [ ] React Native `0.79`, Expo `53`, React `19` upgrade.
- [ ] Android package name, signing, app icon, or manifest wholesale replacement.
- [ ] Removal of CTZZG's extra audio-format support.
