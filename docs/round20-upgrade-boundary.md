# Round 20 Upgrade Boundary

更新时间：2026-06-06

本文记录 Round 20 对 `react-native-nitro-player@1.4.1` 的可升级边界。目标是让 MusicFree 的自定义 Media3/FFmpeg 格式扩展在未来 Nitro 升级时可复核、可恢复，而不是散落在上游内部实现里。

## 审计命令

```powershell
npm run audit:round20-upgrade-boundary
```

该命令已接入：

```powershell
npm run audit:round20-static
```

当前通过条件：

- 当前安装的 `react-native-nitro-player` 版本必须是 `1.4.1`。升级 Nitro 时必须先更新本审计边界。
- `patches/react-native-nitro-player+1.4.1.patch` 必须能 reverse apply。
- Nitro patch 只能修改允许的上游接缝文件和 `musicfree` 命名空间文件。
- 不允许 patch `lib/`、`nitrogen/`、`generated/` 或 `android/build/` 产物。
- `musicfree` native 扩展文件清单必须完整，且 package 必须是 `com.margelo.nitro.nitroplayer.musicfree`。
- Media3 FFmpeg AAR 生成脚本和 legacy JNI wrapper 必须保留关键 token，包括 WMA codec 映射、`FfmpegAudioDecoder.getExtraData()` 透传和 DSF legacy wrapper。

## 允许的上游接缝

这些文件是当前唯一允许改动的 Nitro 上游内部接缝：

- `android/build.gradle`
- `android/src/main/java/com/margelo/nitro/nitroplayer/media/ExoPlayerBuilder.kt`
- `android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerQueueBuild.kt`
- `android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerListener.kt`

用途：

- `build.gradle`：加入默认启用的 `musicfreeEnableNitroFfmpeg` / `musicfreeEnableWmaExtractor` 开关；`musicfreeEnableExperimentalWmaExtractor=false` 只作为旧脚本兼容禁用别名。
- `ExoPlayerBuilder.kt`：注入 MusicFree renderer/source factory。
- `TrackPlayerQueueBuild.kt`：登记 track effective URL、headers 和 user agent 的请求元数据。
- `TrackPlayerListener.kt`：补充 Media3 error code/name/message 的 native logcat 诊断。

如果未来需要改更多 Nitro 上游文件，先更新本文和 `generator/audit-round20-upgrade-boundary.mjs`，并说明为什么不能放在 `musicfree` 命名空间内。

## MusicFree Native 扩展

当前允许并要求存在的 MusicFree native 文件：

- `AsfWmaExtractor.kt`
- `AsfWmaHeaderParser.kt`
- `AsfWmaPacketParser.kt`
- `AsfWmaPayloadAssembler.kt`
- `DsfExtractor.kt`
- `MusicFreeAudioExtractorRegistry.kt`
- `MusicFreeAudioFormatRegistry.kt`
- `MusicFreeExtractorsFactory.kt`
- `MusicFreePlayerExtensions.kt`

这些文件都位于：

```text
node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/musicfree
```

这是未来升级 Nitro 时的主要迁移单元。原则上新增格式解析、MIME 注册、extractor 注册、source factory 包装和 MusicFree 请求头逻辑都应优先放在这里。

## Media3 FFmpeg AAR 边界

当前 patched AAR：

```text
android/app/libs/musicfree-media3-ffmpeg-decoder-1.9.0+1.aar
```

重建脚本：

```powershell
node .\generator\patch-media3-ffmpeg-aar.mjs
```

JNI wrapper source：

```text
generator/native/media3_ffmpeg_jni_wrapper_legacy.cc
```

当前 AAR 是过渡方案：Java/API 层基于 Jellyfin Media3 FFmpeg AAR，替换 `FfmpegLibrary.class` / `FfmpegLibrary$1.class` / `FfmpegAudioDecoder.class`；其中 `FfmpegAudioDecoder` 的替换是为了让 WMA 系列 MIME 把 ASF WAVEFORMATEX 的 `initializationData[0]` 作为 FFmpeg extradata。native base 使用 legacy FFmpeg4 `libffmpegJNI.so` 改名后的 `libffmJNIb.so`，Media3 wrapper 继续暴露 `libffmpegJNI.so`。正式长期路线仍应迁移到可发布的 fork 或 CI 产物。

## 升级 Nitro 时的顺序

1. 更新 `react-native-nitro-player`。
2. 先运行 `npm run audit:round20-upgrade-boundary`，让它明确指出边界漂移。
3. 重新同步 `musicfree` native 扩展目录。
4. 重新审视四个上游接缝是否仍是最小改动面。
5. 运行 `npm run audit:round20-static`。
6. 运行 `npm run audit:round20-native`。
7. 最后再进入真机 Gate 1 和格式 Gate 3。

不要在边界审计失败时继续宣称“无缝升级”。失败本身就是升级工作清单。
