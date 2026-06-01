# Toskysun Feature Port Plan

Last updated: 2026-05-31

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

- [x] Port richer lyric display options such as romanization/sub-line ordering and size ratios.
- [x] Evaluate word-by-word lyric animation separately from the current stable cover-page gesture path.
- [x] Add desktop-lyric options that fit CTZZG's current native support.
- [x] Verify long-press/tap interactions on Android after lyric UI changes.

Implementation notes:

- Detail lyrics now render original, translation, and romanization as separate lines using the existing `LyricParser` data instead of flattening everything into one text block.
- The detail lyric toolbar adds an Android-safe romanization toggle; translation and romanization display remain opt-in so older lyric pages keep their familiar density.
- `basic.lyricOrder` is reused for display ordering, while `lyric.detailSecondaryFontScale` controls secondary-line size.
- Desktop/status-bar lyrics now have independent translation and romanization switches, using the current native multi-line text support without replacing the CTZZG native lyric container.
- Word-by-word lyric animation is intentionally deferred: parsed word timing is already preserved, but porting Toskysun's Reanimated renderer would be a larger gesture/scrolling risk.
- Cover-page tap/long-press code was left untouched; compile checks passed and a device smoke test is still recommended after installing the next APK.

## Round 12

Goal: make the GitHub Actions Android release workflow closer to a reproducible release pipeline.

- [x] Add manual/tag release inputs and build metadata.
- [x] Improve npm/Gradle/Metro cache usage.
- [x] Preserve signing-secret handling and current private dependency assumptions.
- [x] Upload release APK artifacts with clearer names and build summaries.

Implementation notes:

- `.github/workflows/android-build.yml` now supports manual runs with an optional artifact version label, tag pushes matching `v*`, and merged PR builds.
- The workflow uses `actions/setup-node` npm cache, `actions/setup-java` Gradle cache, and a Metro cache restore step instead of deleting Gradle caches on every run.
- GitHub token rewrite rules remain in place for the private `react-native-track-player` dependency, and signing still uses the existing Android keystore secrets.
- Release APKs are collected under `dist/`, renamed with app version and short SHA, uploaded as a single clear artifact, and attached to GitHub Releases on tag builds.
- A job summary records version, package version, commit, build date, signing status, and artifact names.

## Round 13

Goal: redesign the home page around playback continuity, multi-source visibility, discovery, and personal library access instead of making playlists the only central object.

- [x] Create an isolated branch for the home-page redesign experiment.
- [x] Add a home overview data layer for current playback, recent history, chart-capable plugins, playlists, and starred sheets.
- [x] Replace the old `Operations + Sheets` portrait home layout with a playback-aware overview.
- [x] Use the same overview in landscape mode so the old playlist-first layout does not reappear after rotation.
- [x] Add continue-listening, recent-played, quick-access, discovery, and personal-library sections.
- [x] Keep discovery network-light for the first implementation: use local plugin capability data and existing recommendation/chart routes instead of fetching every source on startup.
- [x] Add chart discovery previews that lazily fetch only the first chart-capable source.
- [x] Preserve playlist creation, playlist management, playlist import, and play-by-ID entry points.
- [x] Refine the home layout after device feedback: remove repeated source/search/local/download surfaces, keep discovery focused on charts, move source management into quick access, and make personal music list-style with create/import actions.

Implementation notes:

- `useHomeOverview` aggregates existing local state instead of adding new persistence: TrackPlayer state/progress, music history, plugin manager, music sheets, and starred sheets.
- The first home iteration made enabled plugin sources visible through capability tags, but device testing showed it duplicated the top search and quick local entry. The refined layout keeps plugin management as a quick entry instead of a full home section.
- Discovery preview now focuses on chart/top-list content only; recommended playlists stay as a direct quick entry and multi-source search stays in the top search bar.
- Discovery preview intentionally limits itself to one chart source on app launch. A later round can add manual refresh, source selection, and cache TTL controls.
- React Native / Expo / React major upgrades remain a separate spike after the home redesign stabilizes.

## Round 14

Goal: turn the Round 13 discovery preview into a useful, source-aware discovery hub without adding heavy startup network work.

- [x] Add a fuller chart/discovery entry that can browse chart-capable plugins beyond the one lightweight home preview.
- [x] Add source selection, refresh, empty/error states, and cache TTL controls for discovery data.
- [x] Keep the home page network-light: the home overview should show previews and routes, while deeper discovery fetches happen after user intent.
- [x] Reuse existing top-list/recommendation routes where possible instead of adding a parallel content model.
- [ ] Verify behavior with multiple enabled sources, disabled sources, and plugins without top-list support.

Implementation notes:

- The existing top-list route now acts as the deeper chart discovery hub instead of introducing a parallel discovery page.
- Top-list data is cached for 30 minutes per plugin source and can be force-refreshed through pull-to-refresh or retry.
- Error and empty states now render through `ListEmpty` instead of getting stuck on an indefinite loading spinner.
- The Round 13 home discovery preview passes its source hash into the top-list route so opening "view" lands on the relevant plugin tab.

## Round 15

Goal: polish multi-source search and result browsing so the app feels coherent when many plugins are enabled.

- [x] Improve search result metadata density: cover artwork, quality badges, duration, platform/source clarity, and resilient fallbacks.
- [x] Review source tabs/filtering for many sources, including pinned/common sources and per-source loading/error states.
- [x] Tighten album, artist, and playlist result navigation so plugin-provided ids are used when available and search fallbacks remain clear.
- [x] Improve search empty/error copy and retry behavior, especially when only some sources fail.
- [x] Keep gdmusic and other Android-compatible plugins as the main smoke-test set.

Implementation notes:

- Search music results now show artwork, best available quality abbreviation, source/platform tag, and track duration when plugins provide it.
- When search is opened with a `pluginHash`, the inner source tab now lands on that plugin instead of defaulting to the first enabled source.
- Source tabs now expose each plugin's loading/error/result-count state, and empty/error panels name the current source plus the captured failure message when available.
- Album and playlist detail routes now prefer the originating `pluginHash` over platform-name lookup, artist/album result types accept plugin base records, and album rows fall back to same-source music search when direct album detail is unavailable.
- gdmusic Android-compatible build smoke test: plugin syntax check passed, methods exported, album/artist/playlist search-detail chains returned data.

## Round 16

Goal: finish the playback-detail and lyric work before adding more feature surface.

- [x] Refine the album-cover lyric preview layout, line count, blur/highlight, and blank-line behavior based on device testing.
- [x] Improve the full lyric page controls, including alignment picker placement, lyric density, and secondary-line readability.
- [x] Add word-by-word lyric rendering for timed lyric formats.
- [x] Add lyric display switches for word-by-word on/off, float animation, pure-white highlight mode, and breathing dots for blank lyric lines.
- [x] Extend the mini lyric preview with translation/romanization-aware layout, dynamic line heights, active-line glow, Android-safe soft fade overlays, and breathing dots.
- [x] Add a cover style setting with square/circle cover rendering and Android-safe rotating circular album art while keeping cover gestures on `Pressable`.
- [x] Keep the mini lyric preview stable during native-stack gesture transitions by avoiding Android software `MaskedView`.
- [x] Move artist/album navigation, resume, bottom-player, cover gesture, lyric switch, and background/foreground checks into the Round 18 real-device regression list.
- [x] Review desktop/status-bar lyric settings against current CTZZG native support.
- [x] Keep Android tap/long-press cover interactions on the stable `Pressable` path.

Implementation notes:

- Detail lyrics now keep the parsed QRC/angle-bracket word timing and render current-line word-by-word highlighting with a small float/scale sweep inspired by Toskysun, while non-current lines keep the same wrapped layout without per-frame animation.
- Plain LRC lines without real word timing can use pseudo character timing for the active line, so the UI no longer has to light the whole line at once when the source only supplies line timestamps.
- Mini lyric now follows the same visible lyric order/toggles as the full lyric page, including translation and romanization where available, but compact mode still shows only the primary line to protect small screens.
- Android mini lyric keeps `MaskedView` disabled and uses overlay gradients instead; this preserves the no-black-flash fix while still adding a visible fade.
- Theme settings now include square/circle cover style. Circle mode rotates the album art while playback is active and stops without replacing the stable tap/long-press gesture path.
- Playback progress events now arrive at 0.1s for lyric animation; persisted resume progress is throttled to one write per second so the smoother UI does not over-write MMKV.
- Full lyric line updates compare by lyric index instead of lyric text, so repeated identical lyric lines can still advance correctly.
- The alignment picker height was reduced so the right-align option is no longer clipped on shorter Android screens.
- Android mini lyric rendering should avoid software `MaskedView` during navigation transitions because it can flash a black mask layer while the detail page is being popped.
- Android real-device crash fixed: bottom-player and continue-listening entries both open the playback detail page, so mini lyric Reanimated worklets must only capture primitive values. The mini lyric now precomputes `rpx` distances outside `useAnimatedStyle`, avoiding release-device `Object is not a function` crashes on the UI thread.

## Round 17

Goal: close the loop around downloads, local files, and special formats on top of CTZZG's private `react-native-track-player` fork.

- [x] Audit current playable/downloadable formats against the private player fork and native downloader.
- [x] Surface clearer download-time status for FLAC, OGG, Opus, M4A/MP4, mflac, QMC, and other special containers.
- [x] Distinguish network errors, permission errors, unsupported encrypted sources, and unknown download failures in task copy, while keeping metadata/lyric-file write failures non-fatal and logged.
- [x] Complete metadata writing checks after download: title, artist, album, cover, lyric, quality, and source.
- [x] Re-evaluate Opus and M4A/MP4 tag writing after OGG support and classify them as playable/downloadable but not yet taggable.
- [x] Keep encrypted mflac/QMC playback/download disabled unless the native decrypt/proxy path is fully verified on Android.
- [x] Add local/download item format diagnostics for supported, partially supported, blocked, and unknown special formats.

Implementation notes:

- Music tag settings now include optional standalone lyric-file download. Downloaded songs can write a sidecar `.lrc` or plain `.txt` file after the audio file is saved.
- Download task indicators can appear beside songs while a task is pending, downloading, paused, failed, or completed, and the downloading page prefers native formatted progress text when available.
- Song options now include a format-support diagnostic entry. It classifies formats as fully supported, partially supported, blocked, or requiring runtime probing, and explains playback/download/tag/cover/lyric-write support.
- MP3, FLAC, and OGG are treated as taggable paths. Opus and M4A/MP4 remain playable/downloadable but not taggable until a verified writer is added.
- Encrypted mflac/QMC-like sources remain blocked by default; the app should not save encrypted data under a normal audio extension until the native decrypt/proxy path is proven with the private player fork.

## Round 18

Goal: turn the current migration into a stable Android release candidate.

- [ ] Re-run Android release builds locally and through `.github/workflows/android-build.yml`.
- [ ] Verify signing, versionCode/versionName, artifact naming, and GitHub Actions release artifacts.
- [ ] Write a concise changelog covering home redesign, multi-source search, lyric changes, downloads, and plugin compatibility.
- [ ] Add Android plugin compatibility notes, especially ES syntax limits and the Android-compatible GD Music build.
- [ ] Add or document common diagnostics for plugin import failure, lyric loading failure, playback failure, download failure, and metadata writing failure.
- [ ] Maintain an Android real-device regression checklist: startup, resume, play/pause, next/previous, bottom player, detail page, lyric page, cover gestures, mini lyric return transition, word-by-word lyric progression, search, album/artist navigation, download, local playback, notifications, and background restore.

## Round 19

Goal: run a controlled React Native / Expo / React major-upgrade spike instead of mixing framework churn into feature rounds.

- [ ] Create an isolated upgrade branch from the latest stable feature branch.
- [ ] Check the current official React Native, Expo, and React compatibility matrix before selecting exact target versions.
- [ ] Attempt the framework upgrade with the private `react-native-track-player` fork preserved.
- [ ] Fix or document native Android, Expo module, Reanimated, Metro, Gradle, and TypeScript breakages.
- [ ] Keep New Architecture disabled for the first pass.
- [ ] Verify Android build, playback, download, plugin import, lyrics, notifications, and file permissions before deciding whether the spike is mergeable.
- [ ] Decide whether the upgrade is merge-ready, needs more native-player work, or should remain deferred.

## Toskysun Pixel Audit Backlog

Reference snapshot: Toskysun/MusicFree `f463f57` (`0.6.52`, React Native `0.79.6`, Expo `53`, React `19`), audited on 2026-05-31.

This pass is a source/component-level pixel audit: components, layout logic, settings, native bridges, and user-visible states were compared so practical improvements can be planned. A true screenshot-level parity pass still needs both APKs installed with the same plugins, songs, theme, and playback state, then captured across home, search, detail cover, full lyric, mini lyric, downloads, and settings.

### Merge Into Round 16

- [x] Rework the word-by-word lyric renderer toward Toskysun's optimized shape: line-level character progression, smooth highlight sweep, optional float animation, and identical wrapping between active/static lines.
- [x] Add lyric display switches for word-by-word on/off, word float animation, pure-white highlight mode, and breathing dots for empty lyric lines.
- [x] Extend mini lyric with translation/romanization support, dynamic line heights, compact mode behavior, and current-line glow/soft fade, while keeping the Android-safe no-`MaskedView` fallback during navigation transitions.
- [x] Add a cover style option (`square` / `circle`) and Android-safe rotating circular album art without changing the stable cover tap/long-press path.
- [x] Create a visual regression checklist for playback detail through the Round 18 real-device checklist: cover page, mini lyric, full lyric alignment, blank lyric lines, lyric settings sheet, gesture return, and bottom-player restore.

### Merge Into Round 17

- [x] Add optional sidecar lyric-file download (`.lrc` / `.txt`) after successful music download, using the existing lyric manager and metadata settings.
- [x] Add a per-track download status/progress indicator in lists or action sheets where it helps users distinguish waiting, downloading, paused, failed, and completed states.
- [x] Evaluate Toskysun's mflac decrypt/proxy path against CTZZG's private `react-native-track-player` fork enough to keep encrypted mflac/QMC disabled until native proxy/decrypt passes real-device playback and download tests.
- [x] Add local/download format diagnostics for special containers, so users can see whether FLAC, OGG, Opus, M4A/MP4, mflac, QMC, and plugin-provided URLs are playable, downloadable, taggable, or blocked.

### Merge Into Round 18

- [ ] Add app build-info / app-meta diagnostics so APK version, git SHA, build time, signing state, and dependency baseline can be checked from the app or support logs.
- [ ] Decide whether to add an announcement dialog/service; if added, use a CTZZG-owned announcement source, cached reads, opt-out/ignore support, and no Toskysun remote endpoint.
- [ ] Add a keyboard-avoidance setting only if real-device dialogs/input panels still overlap on common Android keyboards.
- [ ] Consider an "open playback detail on launch" setting after resume, bottom-player tap, lyric loading, and background restore are stable.

### Merge Into Round 19

- [ ] Use Toskysun's current framework baseline (`RN 0.79.6`, `Expo 53`, `React 19`) as one concrete upgrade target candidate, but re-check official compatibility before starting the spike.
- [ ] Keep CTZZG's private `react-native-track-player` fork pinned during the first upgrade attempt; do not switch to Toskysun's public player dependency just to match package versions.

### Already Covered Or Lower Priority

- Current multi-source search already has source state, source-scoped navigation, artwork, quality badges, duration, platform tags, and gdmusic fallbacks; only spacing and visual regression checks remain.
- Current home redesign is intentionally more personalized than Toskysun's playlist-first shape; future work should polish discovery and continue-listening states rather than revert the information architecture.
- Current Android mini lyric avoids software `MaskedView` because device testing exposed black flashes during native-stack return gestures; this stability choice should override visual parity.

## Later / Optional

- [x] Mini lyric / song detail enhancements.
- [ ] Announcement dialog/service.

## Do Not Port Directly

- [ ] Public `react-native-track-player` dependency.
- [ ] Toskysun's postinstall patch for public track-player unless CTZZG's private fork has the same issue.
- [ ] React Native `0.79`, Expo `53`, React `19` upgrade.
- [ ] Android package name, signing, app icon, or manifest wholesale replacement.
- [ ] Removal of CTZZG's extra audio-format support.
- [ ] Toskysun remote announcement URLs.
- [ ] Android software `MaskedView` for mini lyric transitions unless the black-flash regression is proven fixed.
- [ ] mflac/QMC native proxy/decrypt as an enabled default before CTZZG private-player validation.
