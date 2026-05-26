# Toskysun Feature Port Plan

Last updated: 2026-05-26

## Scope

- Base repository: CTZZG/MusicFree `dev-apk2`
- Reference repository: Toskysun/MusicFree `master`
- Keep CTZZG's private `react-native-track-player` fork as the player base.
- Do not wholesale upgrade React Native, Expo, React, package namespace, signing, or Android/iOS project metadata.
- Preserve CTZZG's extended local audio format support, including private-player behavior and extra file intent filters.

## Current Baseline

- [x] Compared CTZZG `dev-apk2` with Toskysun `master`.
- [x] Confirmed CTZZG uses `github:CTZZG/react-native-track-player#v4.1.1`.
- [x] Confirmed the local workspace started as a zip-style checkout with an empty `.git` history and all files untracked.
- [x] Created git branch `codex/round3-native-download` and committed baseline `5f9c9c6 Baseline after round 2 migration` before native/download migrations.

## Verification Log

- [x] 2026-05-24: `buffer@6.0.3` and `pako@2.1.0` are present in `package-lock.json`.
- [x] 2026-05-24: esbuild syntax check passed for Round 1 touched TS/TSX files. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: esbuild syntax check passed for Round 2 lyric parser/decrypter files and `lyricManager`. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: esbuild syntax check passed for Round 2 file naming and metadata primitives. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: Native `LyricUtilModule.kt` QRC/Kuwo port passed text checks: braces are balanced and no Toskysun desktop lyric/native-event dependencies were introduced.
- [x] 2026-05-25: Installed and configured Temurin JDK 17 plus Android SDK command-line tools, platform-tools 37.0.0, Android 35, Build Tools 35.0.0/34.0.0, and NDK 26.1.10909125. `android\gradlew.bat :app:compileDebugKotlin --console=plain --stacktrace --no-daemon` passed in 10m 34s; remaining output is third-party/native deprecation warnings plus Expo's expected `NODE_ENV` notice.
- [x] 2026-05-24: esbuild syntax check passed again after trimming metadata types so unported native download/mflac APIs are not declared as available.
- [x] 2026-05-24: Round 3 Android native download package passed text checks: copied package uses `fun.upup.musicfree`, no `fun.xwj` imports remain, and Kotlin braces are balanced.
- [x] 2026-05-24: esbuild syntax check passed for the `NativeDownload` JS wrapper and downloader integration. The only warning was the expected missing `@react-native/typescript-config` base config because `node_modules` is not installed in this workspace.
- [x] 2026-05-24: esbuild syntax check passed for download pause/resume/cancel/retry UI integration and downloader task-state changes. i18n JSON parse checks passed.
- [x] 2026-05-24: Checked CTZZG's pinned `react-native-track-player` fork commit `6344bd1`; it enables ExoPlayer extension renderers for normal formats but has no QMCv2/mflac decrypt or local proxy implementation. Added esbuild-checked guards so encrypted `.mflac`/`.mgg`/`.mmp4` sources are skipped for playback and rejected clearly for download until native decrypt/proxy is ported.
- [x] 2026-05-24: esbuild syntax check passed for the Round 4 play-by-ID panel, panel registry, and home sheet-menu integration. i18n JSON parse checks passed.
- [x] 2026-05-25: esbuild syntax check passed for the Round 5 quality-management panel, panel registry, and basic-settings entry. i18n JSON parse checks passed, and language JSON keys now match `ILanguageData`.
- [x] 2026-05-25: Round 6 metadata settings and native tag bridge passed esbuild checks, language JSON key consistency checks, and full `npx tsc --noEmit --pretty false`. Android `:app:compileDebugKotlin` passed after adding the MP3/FLAC cover/tag bridge.
- [x] 2026-05-26: Round 7 music-detail enhancements passed `npx tsc --noEmit --pretty false`, zh-CN/zh-TW/en-US JSON parse checks, and Android `assembleRelease`.
- [x] 2026-05-26: Round 8 download notification/permission lifecycle passed `npx tsc --noEmit --pretty false`, zh-CN/zh-TW/en-US JSON parse checks, and Android `assembleRelease` from the `android/` Gradle root.
- [x] 2026-05-26: Round 9 OGG metadata path passed `npx tsc --noEmit --pretty false`, Android `:app:compileReleaseKotlin`, and Android `assembleRelease`.
- [x] 2026-05-26: Round 10 plugin lazy-load/import controls passed `npx tsc --noEmit --pretty false`, zh-CN/zh-TW/en-US JSON parse checks, `node -c` syntax checks for both gdmusic plugin builds, and Android `assembleRelease`.

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
- Proceed with static-checkable native queue pieces after the git baseline; as of 2026-05-25, the local JDK/Android SDK setup is available and `:app:compileDebugKotlin` passes.

- [x] Port native Android download queue.
- [x] Port download progress events into the existing JS downloader.
- [x] Port pause, resume, cancel, and retry controls into the UI/task model.
- [x] Port download notification lifecycle.
- [x] Integrate metadata writing after native download completion through the existing Round 2 metadata manager.
- [x] Evaluate mflac handling against CTZZG's private track-player support before enabling proxy/decrypt behavior.

Implementation notes:

- Android `NativeDownloadModule` and its queue/database/executor/notification helpers were ported under `fun.upup.musicfree.download`.
- `Mp3UtilPackage` now registers both `Mp3UtilModule` and `NativeDownloadModule`.
- `src/native/mp3Util/index.ts` exposes a guarded `NativeDownload` bridge and emitter; desktop/unsupported runtimes still fall back safely.
- `src/core/downloader.ts` now prefers native downloading when available and falls back to the old `react-native-fs` path when it is not.
- `src/pages/downloading/downloadingList.tsx` now exposes per-task pause, resume, cancel/remove, and retry actions where supported by the current task state.
- CTZZG's private player fork does not replace Toskysun's QMCv2 decrypt/proxy path. This round intentionally does not enable the proxy; instead, encrypted sources are blocked with a clear download status so the app does not save encrypted data under a normal audio extension.
- To actually support encrypted mflac playback/download later, port Toskysun's `Mp3UtilModule.kt` QMCv2 decrypt/proxy section plus `org.nanohttpd:nanohttpd`, then verify on Android with a real JDK/device build.

## Round 4

Goal: port small plugin-facing workflow improvements that help test and use the new media-source compatibility layer without touching native playback internals.

- [x] Port play-by-ID panel.
- [x] Add a home sheet-menu entry for play-by-ID while keeping CTZZG's existing compact `+` / overflow menu layout.
- [x] Limit plugin choices to enabled plugins that can resolve media sources.
- [x] Add zh-CN, zh-TW, and en-US copy plus i18n type entries.

Implementation notes:

- `src/components/panels/types/playById.tsx` builds a broad id payload (`id`, `songid`, `songmid`, `mid`, `hash`, `copyrightId`) so QQ/Kugou/Migu-style plugins can resolve by their preferred key.
- If a plugin supports `getMusicInfo`, the panel hydrates title/artist/album/artwork before playback; otherwise it falls back to a minimal playable item and lets `TrackPlayer.play` resolve the media source.

## Round 5

Goal: expose the quality key/label/abbreviation customization that Round 1 already made available in the data model.

- [x] Port quality-management panel.
- [x] Add entry under basic playback settings.
- [x] Allow adding custom quality keys, reordering keys, editing display labels, editing abbreviations, deleting keys, and restoring built-ins.
- [x] Add zh-CN, zh-TW, and en-US copy plus i18n type entries.
- [x] Fix pre-existing i18n gaps for playlist sync keys in zh-TW/en-US while auditing language consistency.

Implementation notes:

- `src/components/panels/types/qualityTranslation.tsx` writes `basic.qualityKeysList`, `basic.qualityTranslations`, and `basic.qualityAbbreviations`.
- Existing playback/download quality selectors already read from `getQualityKeys()` and `getQualityText(...)`, so the panel takes effect without changing the private player or downloader core.

## Round 6

Goal: expose download-time music metadata controls and complete the native Android bridge needed by those controls.

- [x] Add music metadata settings panel.
- [x] Add entry under basic download settings.
- [x] Wire settings to existing download metadata config.
- [x] Add native Android cover/tag bridge for MP3/FLAC cover writing and extended tag fields.
- [x] Add zh-CN, zh-TW, and en-US copy plus i18n type entries.
- [x] Fix the existing `color` package type usage so full TypeScript checking can pass.

Implementation notes:

- `MusicMetadataSettingsPanel` controls `basic.writeMetadata`, `basic.writeMetadataCover`, `basic.writeMetadataLyric`, `basic.lyricOrder`, and `basic.enableWordByWordLyric`.
- `Mp3UtilModule` now exposes `setMediaCover` and `setMediaTagWithCover`; cover writing currently targets MP3/FLAC. Unsupported cover formats still keep text tag writing intact through `setMediaTagWithCover`.
- Full TypeScript checking now passes after removing the ignored temporary Toskysun reference clone from `tmp/` and fixing `src/utils/colorUtil.ts`.

## Round 7

Goal: port the lower-risk music-detail experience improvements from Toskysun without reintroducing Android gesture crashes.

- [x] Add song title, artist, platform, and album information below the cover.
- [x] Add clickable artist navigation when plugins provide `singerList`.
- [x] Add multi-artist selection panel for songs with more than one artist.
- [x] Add clickable album navigation using plugin album identifiers when available.
- [x] Add a compact mini lyric preview on the cover page.
- [x] Keep cover tap / long-press implemented with React Native `Pressable` instead of Toskysun's `Gesture.Race`.
- [x] Add zh-CN, zh-TW, and en-US copy plus i18n type entries.

Implementation notes:

- `AlbumCover` keeps the Android-safe long-press guard from the prior crash fix, and only opens the image viewer when artwork is a non-empty string.
- `MiniLyric` intentionally uses the current CTZZG lyric state and simple `Pressable` handling instead of porting Toskysun's masked/reanimated lyric renderer wholesale.
- `SongInfo` only jumps to artist detail when the current plugin supplies full singer metadata. If that metadata is absent, the artist text is displayed but not treated as a fake artist id.
- `ArtistSelectPanel` resolves the plugin by platform before navigating, so multi-artist songs stay compatible with the existing artist-detail route.

## Round 8

Goal: complete the Android download notification and permission lifecycle around the native download queue.

- [x] Add Android 13+ notification permission checks and request flow for downloads.
- [x] Detect app/channel-level notification blocking through the native download bridge.
- [x] Add native methods to open notification settings, clear notifications, cancel a single notification, and refresh active download notifications.
- [x] Refresh native download notifications when the app returns to the foreground.
- [x] Add a notification-permission entry to the permissions page.
- [x] Surface common download task failure reasons through user-facing toasts.
- [x] Keep the native download queue and CTZZG private `react-native-track-player` fork untouched.

Implementation notes:

- `notificationPermissionManager` owns Android notification permission state, settings fallback, and permission-copy i18n.
- `downloadNotificationManager` coordinates JS lifecycle state while native code remains responsible for actual progress/completed/error notifications.
- `notificationLifecycleManager` refreshes active notifications after app foreground transitions, which helps Android restore visible progress after permission/settings changes.
- Native notification cancellation is now separate from native download task removal, so clearing notification UI does not accidentally delete download tasks.

## Round 9

Goal: extend downloaded-file metadata writing to match the broader playback format goals.

- [x] Audit Toskysun's OGG/extended metadata implementation against CTZZG's private player fork.
- [x] Add OGG cover/lyric/metadata writing where Android libraries and file formats allow it.
- [x] Preserve existing MP3/FLAC metadata behavior and fail gracefully for unsupported formats.
- [x] Add focused Android/Kotlin verification for the metadata bridge.

Implementation notes:

- Added `OggCoverWriter`, a pure Kotlin Vorbis comment writer that injects `METADATA_BLOCK_PICTURE` without relying on jaudiotagger's OGG artwork path.
- `Mp3UtilModule.setMediaCover` now writes OGG Vorbis cover art directly through `OggCoverWriter`.
- `Mp3UtilModule.setMediaTagWithCover` commits text tags first, then writes OGG cover art; if OGG cover writing fails, text metadata still survives.
- MP3 and FLAC cover/tag behavior stays on the existing Round 6 code path.
- Opus and MP4/M4A cover writing remain intentionally unsupported until a verified native writer is added for those container formats.

## Round 10

Goal: make plugin import and lazy loading more controllable for Android compatibility.

- [x] Add a user-facing lazy-load plugin switch.
- [x] Add plugin cache clearing and import diagnostics.
- [x] Add safer Android import failure details for syntax/runtime errors.
- [x] Evaluate optional Babel transpilation at import time for ES10+ plugin syntax.

Implementation notes:

- `basic.lazyLoadPlugin` now controls whether startup uses cached plugin metadata or parses plugin files immediately.
- Basic settings exposes a plugin lazy-load switch plus a lazy-load cache clearing action with the current cache entry count.
- Corrupted plugin cache entries are discarded automatically and the plugin file is parsed directly instead of failing the whole plugin setup.
- Plugin parse/version errors now include clearer `Error.name`, message, and an estimated line/column from Android `Function(...)` stack traces where available.
- On-device Babel transpilation remains intentionally disabled for now: adding Babel to the mobile runtime would increase bundle size and make plugin import slower/riskier. The safer path is to keep import diagnostics clear and distribute Android-compatible plugin builds.

## Round 11

Goal: upgrade the lyric experience without destabilizing the detail page.

- [ ] Port richer lyric display options such as romanization/sub-line ordering and size ratios.
- [ ] Evaluate word-by-word lyric animation separately from the current stable cover-page gesture path.
- [ ] Add desktop-lyric options that fit CTZZG's current native support.
- [ ] Verify long-press/tap interactions on Android after lyric UI changes.

## Round 12

Goal: make the GitHub Actions Android release workflow closer to a reproducible release pipeline.

- [ ] Add manual/tag release inputs and build metadata.
- [ ] Improve npm/Gradle/Metro cache usage.
- [ ] Preserve signing-secret handling and current private dependency assumptions.
- [ ] Upload release APK artifacts with clearer names and build summaries.

## Later / Optional

- [x] Mini lyric / song detail enhancements.
- [ ] Announcement dialog/service.

## Do Not Port Directly

- [ ] Public `react-native-track-player` dependency.
- [ ] Toskysun's postinstall patch for public track-player unless CTZZG's private fork has the same issue.
- [ ] React Native `0.79`, Expo `53`, React `19` upgrade.
- [ ] Android package name, signing, app icon, or manifest wholesale replacement.
- [ ] Removal of CTZZG's extra audio-format support.
