# Round 20 Current State Baseline

更新时间：2026-06-06

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文记录 Round 20 的当前真实状态。若旧聊天记录、旧路线图或历史交接文档与本文冲突，以本文和 `docs/round20-restart-anchor.md` 为准。

## 当前结论

Round 20 已从“RNTP v4 与 Nitro 并存验证”进入 “Nitro-only 收口” 阶段。

- WMA v2 / ASF：默认启用。ASF/WMA extractor、完整 WAVEFORMATEX 透传、direct input buffer 和 patched Media3 FFmpeg AAR 已有本地与 HTTP 机器证据。保留 `-PmusicfreeEnableWmaExtractor=false` 作为回滚开关；旧 `-PmusicfreeEnableExperimentalWmaExtractor=false` 仅作为兼容禁用别名。
- DSF：已补专项 seek / 强停记录。设备样本 `/sdcard/music/神様になった日.dsf` 打开后 `PLAYING`，fast-forward 后仍 `PLAYING`，pause/play 正常，强停重开恢复为同一 DSF 的 `PAUSED position=0 error=null`，未见 Media3/FFmpeg 崩溃错误。
- Nitro 原始 Media3 错误 payload：Round 20 不 fork Nitro spec/codegen。当前保留 native logcat 中的 Media3 `errorCode` / `errorCodeName` / `message` / cause 诊断，JS 继续使用通用 `nitro-playback-error`。以后只有 UI/插件策略需要 raw error，或上游 Nitro 暴露 `onPlaybackError` 时再做 fork。
- RNTP v4：已进入删除清理。`react-native-track-player` 依赖、`TrackPlayerV4Adapter` 和 RNTP patch 已删除；播放器后端固定为 Nitro；MusicFree service 不再订阅 RNTP JS remote 事件。

## 当前分支和依赖

- 分支：`codex/round20-nitro-player-spike`
- React Native / Expo / React：`0.85.3` / `56.0.8` / `19.2.3`
- 播放器依赖：`react-native-nitro-player@1.4.1`
- RNTP 依赖：已从 `package.json` / `package-lock.json` 移除
- Nitro patch：`patches/react-native-nitro-player+1.4.1.patch`
- Media3 FFmpeg AAR：`android/app/libs/musicfree-media3-ffmpeg-decoder-1.9.0+1.aar`

旧 `android/app/libs/exoplayer-ffmpeg-extension-v2.19.1.aar` 不再作为 App packaged extension 路径使用；它仍是 `generator/patch-media3-ffmpeg-aar.mjs` 重建 MusicFree Media3 FFmpeg AAR 的 native base 来源，不应直接删除。

## Nitro-only 清理状态

已完成：

- `npm uninstall react-native-track-player`
- 删除 `patches/react-native-track-player+4.1.1.patch`
- 删除 `src/core/playerAdapter/trackPlayerV4Adapter.ts`
- `PlayerBackendName` 固定为 `nitro-player`
- `PlayerAdapterRemoteControlMode` 固定为 `native-session`
- 设置页移除开发用播放器后端选择项
- `src/service/index.ts` 移除 RNTP remote JS event 分支，只保留状态/进度持久化
- `src/core/trackPlayer/index.ts` 固定使用 `nitroPlayerAdapter`
- 删除 Nitro 后端下的 RNTP fake-next / proposed-audio 路径
- `skipToNext()` / `skipToPrevious()` 直接走 Nitro 原生操作
- `handlePlayFail()` 不再执行 JS 自动下一曲
- `buildInfo` 从 `trackPlayer` 改为 `nitroPlayer`

已完成验证：

- `npm run audit:round20-static`：通过；已新增 RNTP v4 removal guard。
- `npm run audit:round20-native`：通过；默认 WMA/FFmpeg 和 `-PmusicfreeEnableWmaExtractor=false` 回滚编译均通过。
- `android\gradlew.bat :app:assembleRelease --no-daemon --console=plain`：从 `android` 目录运行通过。
- 真机安装 `app-arm64-v8a-release.apk`：通过；包服务只剩 Nitro `NitroPlayerPlaybackService`，冷启动无崩溃，系统媒体 play 能恢复 DSF 队列到 `PLAYING error=null`，默认 release 构建 WMA HTTP 达到 `PLAYING position=144287 buffered=205031 error=null`。

## Gate 1 和 Gate 2 证据

Gate 1 不再作为当前阻塞项：

- 用户已长测通知栏、蓝牙、播放详情页、歌词页和长时间播放数小时，未发现问题。
- ADB 已补系统媒体 pause/play、fast-forward 和强停重开记录。
- 系统媒体 pause/play：HTTP WMA 播放中从 `PLAYING` 到 `PAUSED` 再回 `PLAYING`，`error=null`。
- 系统媒体 fast-forward：HTTP ALAC 播放中短暂 `BUFFERING` 后回 `PLAYING`，`error=null`。
- 强停重开：播放中 `am force-stop` 后 session 清空；`monkey -p fun.upup.musicfree 1` 重开不崩溃，并恢复到保存队列的 `PAUSED position=0 error=null`。

Gate 2 HTTP 样本已通过：

- WMA URL：`Bangles 01 - Walk Like An Egyptian.wma` 达到 `PLAYING position=33231 buffered=205031 error=null`。
- ASF URL：`Alice Deejay - Back In My Life.asf` 达到 `PLAYING position=43963 buffered=131942 error=null`。
- ALAC URL：`snoop_try.m4a` 即使服务器返回 `Content-Type: audio/mpeg`，仍达到 `PLAYING position=51985 buffered=123158 error=null`；系统 fast-forward 后恢复 `PLAYING`。

Manifest 当前没有 `http/https` VIEW intent-filter；HTTP 测试使用显式 `fun.upup.musicfree/.MainActivity` 启动。

## 格式状态

### M4A / ALAC

- 普通 M4A/AAC 属于 Media3 原生容器回归 smoke，不是 ALAC 目标硬门禁。
- FFmpeg ALAC 样本 `D:\Downloads\snoop_try.m4a` 已被审计识别为 `alac`。
- 本地真机播放达到 `PLAYING`，duration/buffered 约 `123158ms`，pause/play/fast-forward 可用，AudioFlinger output track 正常。
- HTTP 显式 MainActivity VIEW 入口达到 `PLAYING`，系统 fast-forward 后恢复 `PLAYING`。

### WMA / ASF

- Media3 `media3-extractor:1.9.0` 原生不含 ASF/WMA extractor，因此本项目自写 `AsfWmaHeaderParser`、`AsfWmaPacketParser`、`AsfWmaPayloadAssembler` 和 `AsfWmaExtractor`。
- patched AAR 让 WMA 系列 MIME 把完整 WAVEFORMATEX 透传给 FFmpeg4 decoder，并使用 direct input buffer。
- 两份 WMA v2 / ASF 样本已完成离线 header、packet 和 sample 重组审计：
  - `D:\Downloads\Alice Deejay - Back In My Life.asf`
  - `D:\Downloads\Bangles 01 - Walk Like An Egyptian.wma`
- 本地真机实验包和 HTTP Gate 均达到 `PLAYING`、duration/position 推进和 AudioFlinger 输出，未见 `avcodec_open2`、direct-buffer、source 或 FFmpeg 错误。
- 当前策略：默认启用 WMA v2 / ASF；WMA Pro / Lossless / Voice 尚未覆盖，记录为未验收变体，不阻塞 v2/ASF 默认启用。

### DSF

- `DsfExtractor` 已实现 sniff、`fmt` / `data` chunk 解析、duration、初始化数据、连续 sample 输出和保守 seek map。
- patched AAR 使用 legacy FFmpeg4 native base + Media3 JNI wrapper，DSF 映射到 `dsd_lsbf_planar`，并给 DSD decoder 设置 raw sample rate/channel layout，高采样率输出重采样到 48k。
- 用户已确认当前构建播放 DSF 有声音。
- 本轮补 DSF 专项：fast-forward/seek 类动作、pause/play 和强停重开均 `error=null`。
- DFF/DSDIFF 不在当前目标内，不扫描入库；若未来支持，需要单独 parser。

## Nitro 操作和错误语义

`npm run audit:nitro-adapter` 会清点 `react-native-nitro-player/src/specs` 下全部 HybridObject operation。当前核心 `TrackPlayer + PlayerQueue` 操作已有 MusicFree `PlayerAdapter` 落点；非核心模块仍登记为 deferred 或 platform-scoped。

当前策略：

- 通知栏、蓝牙、系统媒体键交给 Nitro/Media3 MediaSession 原生处理。
- MusicFree JS 层只同步曲目、状态、进度、错误和持久化状态。
- `remoteDuck`、RNTP 风格 JS remote callbacks 和 Media3 raw error JS payload 不在 Round 20 继续 fork。
- Nitro `onSeek` 是 seek 后通知，对应 MusicFree `playbackSeeked`，不是 RNTP `remoteSeek` 命令事件。

## 模块化和升级边界

升级边界以 `docs/round20-upgrade-boundary.md` 和 `npm run audit:round20-upgrade-boundary` 为准。

允许的 Nitro 上游接缝：

- `android/build.gradle`
- `ExoPlayerBuilder.kt`
- `TrackPlayerQueueBuild.kt`
- `TrackPlayerListener.kt`

MusicFree native 扩展必须留在：

```text
com.margelo.nitro.nitroplayer.musicfree
```

这条边界是后续升级 `riteshshukla04/react-native-nitro-player` 时的主要保护线。

## 当前剩余工作

- 若发布前继续加严 Gate 3，可补 MP3/FLAC/OGG 回归样本和普通 M4A/AAC smoke；它们不改变本轮 Nitro-only 收口结论。
