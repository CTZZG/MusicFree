# Round 20 Media3 FFmpeg Patched AAR

更新时间：2026-06-05

## 文件

- `android/app/libs/musicfree-media3-ffmpeg-decoder-1.9.0+1.aar`

## 来源

Java/API 层基于 Gradle 缓存中的 Jellyfin Media3 AAR，native base 改用本仓库已有的 CTZZG/Jellyfin dsf 分支产物：

- Maven 坐标：`org.jellyfin.media3:media3-ffmpeg-decoder:1.9.0+1`
- 原始 AAR：`media3-ffmpeg-decoder-1.9.0+1.aar`
- native base：`android/app/libs/exoplayer-ffmpeg-extension-v2.19.1.aar`

当前 patched AAR 做两层修改：

1. 替换 `classes.jar` 内的：

- `androidx/media3/decoder/ffmpeg/FfmpegLibrary.class`
- `androidx/media3/decoder/ffmpeg/FfmpegLibrary$1.class`
- `androidx/media3/decoder/ffmpeg/FfmpegAudioDecoder.class`

2. 替换 `jni/*/libffmpegJNI.so`：

- legacy ExoPlayer AAR 内的 `libffmpegJNI.so` 改名为 `libffmJNIb.so`
- legacy base so 的 ELF SONAME 原地改为 `libffmJNIb.so`
- 新增 Media3 wrapper `libffmpegJNI.so`，导出 Media3 期待的 JNI 符号
- wrapper 运行时 `dlopen("libffmJNIb.so")`，复用 legacy FFmpeg4 decoder 符号

其余 Java class、manifest 和 resources 沿用原 AAR。

## 目的

原版 `FfmpegLibrary.getCodecName(sampleMimeType)` 已支持 `audio/alac -> alac`，但不映射 WMA / DSF。由于 `FfmpegAudioDecoder` 构造器内部硬调用这个方法，MusicFree 不能只在 Nitro 外层加 renderer 或 MIME 注册。

patched AAR 增加以下映射：

| MIME | FFmpeg codec |
| --- | --- |
| `audio/x-ms-wma` | `wmav2` |
| `audio/x-ms-wma-v1` | `wmav1` |
| `audio/x-ms-wma-v2` | `wmav2` |
| `audio/x-ms-wmapro` | `wmapro` |
| `audio/x-ms-wmalossless` | `wmalossless` |
| `audio/x-ms-wmavoice` | `wmavoice` |
| `audio/x-dsf` | `dsd_lsbf_planar` |
| `audio/dsf` | `dsd_lsbf_planar` |
| `audio/x-dsd` | `dsd_lsbf_planar` |

WMA 还需要额外处理。ASF/WMA extractor 会从 ASF WAVEFORMATEX 里解析完整 WAVEFORMATEX 数据，并通过 Media3 `Format.initializationData` 传出；原版 `FfmpegAudioDecoder.getExtraData()` 只转发 AAC/Opus/ALAC/Vorbis/FLAC 的初始化数据，WMA 会以 `null` extradata 初始化。当前 patched AAR 因此也替换 `FfmpegAudioDecoder.class`，对以下 MIME 返回 `initializationData[0]`：

- `audio/x-ms-wma`
- `audio/x-ms-wma-v1`
- `audio/x-ms-wma-v2`
- `audio/x-ms-wmapro`
- `audio/x-ms-wmalossless`
- `audio/x-ms-wmavoice`

参考 `CTZZG/jellyfin-androidx-media` 的 `dsf` 分支后确认：DSF 不能只做 MIME -> codec 映射。旧项目在 `FfmpegAudioDecoder` / `ffmpeg_jni.cc` 中会给 DSD codec 设置 raw sample rate、channel layout，并把高采样率输出重采样到 48k。Jellyfin Media3 base AAR 运行时明确报过 `No dsd_lsbf_planar decoder available`，所以当前方案改为使用 legacy FFmpeg4 native base，再由 Media3 wrapper 接管 decoder context 创建。

当前 wrapper 做的事：

- 对 `AV_CODEC_ID_DSD_LSBF`、`AV_CODEC_ID_DSD_MSBF`、`AV_CODEC_ID_DSD_LSBF_PLANAR`、`AV_CODEC_ID_DSD_MSBF_PLANAR` 设置 `sample_rate` 和 `ch_layout`
- 对 WMA codec 解析完整 WAVEFORMATEX，设置 `codec_tag`、`sample_rate`、channel layout、`bit_rate`、`block_align`、`bits_per_coded_sample`，并把 18-byte WAVEFORMATEX header 后的部分作为 FFmpeg extradata
- 输出采样率高于 48000 时，JNI resampler 输出 48000
- 保持 Java 层 `FfmpegAudioDecoder` 签名不变，不 fork Media3 class
- wrapper 不依赖 `libc++_shared.so`，只依赖 Android 系统库，并运行时加载 `libffmJNIb.so`

## 已验证

- legacy native base so 中能扫描并运行时找到 `wmav1`、`wmav2`、`dsd_lsbf`、`dsd_msbf`、`dsd_lsbf_planar`、`dsd_msbf_planar` 等 decoder。注意：旧 Jellyfin Media3 base 只有字符串不足以证明 decoder 可用，曾在真机报过 `No dsd_lsbf_planar decoder available`。
- wrapper `libffmpegJNI.so` 导出 `JNI_OnLoad`、`FfmpegAudioDecoder_ffmpegInitialize`、`FfmpegAudioDecoder_ffmpegDecode`、`FfmpegLibrary_ffmpegHasDecoder` 等 Media3 JNI 符号。
- 四个 ABI 都包含 `libffmpegJNI.so` wrapper 和 `libffmJNIb.so` base；base SONAME 已改为 `libffmJNIb.so`。
- 反射验证 patched `getCodecName()`：
  - `audio/alac=alac`
  - `audio/x-ms-wma=wmav2`
  - `audio/x-ms-wma-v1=wmav1`
  - `audio/x-ms-wmapro=wmapro`
  - `audio/x-dsf=dsd_lsbf_planar`
  - `audio/dsf=dsd_lsbf_planar`
- `javap` 验证 patched `FfmpegAudioDecoder` 包含 WMA MIME 分支和 `getExtraData()`，WMA 系列 MIME 会把 `initializationData[0]` 作为 FFmpeg extradata。
- `javap` 验证 patched `FfmpegAudioDecoder.createInputBuffer()` 使用 direct input buffer，避免 JNI `GetDirectBufferAddress()` 返回 null。
- `node .\generator\patch-media3-ffmpeg-aar.mjs` 可从 Jellyfin base AAR 重新生成 patched AAR，并编译 wrapper。
- `npm run audit:round20-static` 会检查 Java 映射、wrapper/base so、SONAME、关键 JNI 符号和 TypeScript。
- 2026-06-05 重新验证：`npm run audit:nitro-format-extension`、`npm run audit:round20-upgrade-boundary`、`npm run audit:round20-static` 均通过。
- `android\gradlew.bat :react-native-nitro-player:compileReleaseKotlin -PmusicfreeEnableNitroFfmpeg=true --no-daemon --console=plain --rerun-tasks` 通过。
- `android\gradlew.bat :app:assembleRelease -PmusicfreeEnableNitroFfmpeg=true --no-daemon --console=plain` 通过。
- 最新 arm64 release APK 中已确认同时包含 `lib/arm64-v8a/libffmpegJNI.so` 和 `lib/arm64-v8a/libffmJNIb.so`。
- 2026-06-04 用户真机确认：当前安装包播放本地 DSF 已经能听到声音。
- 2026-06-05 用户真机确认：两份 WMA v2/ASF 本地样本已经能听到声音。
- 2026-06-05 真机观察：FFmpeg ALAC 样本 `snoop_try.m4a` 本地播放达到 `PLAYING`、duration/position、pause/play/fast-forward 和 AudioFlinger output track，实际可听待用户确认。

## 后续

这个 AAR 仍是过渡方案。它已经从“手工 class patch”提升为可重复生成的 wrapper 方案，并已通过 DSF 和 WMA 本地有声复测；正式路线仍应迁移为 Media3 FFmpeg fork 或 CI 产物，并用 ALAC/WMA/DSF 样本完成 duration、seek、后台和强停恢复验证。
