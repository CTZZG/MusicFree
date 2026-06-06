# Round 20 Restart Anchor

更新时间：2026-06-06

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文是 Round 20 后续开发的单一恢复锚点。上下文压缩、断线续跑、切换任务后，先读本文。若本文与旧聊天记录或其他 Round 20 文档冲突，以本文为准。

## 当前四个收口结论

1. WMA v2 / ASF 默认启用。
   - 本地与 HTTP Gate 已通过，默认注册 `AsfWmaExtractor`。
   - 回滚开关是 `-PmusicfreeEnableWmaExtractor=false`。
   - `-PmusicfreeEnableExperimentalWmaExtractor=false` 仅保留为旧脚本兼容禁用别名。
   - WMA Pro / Lossless / Voice 尚无样本覆盖，记录为未验收变体，不阻塞 WMA v2 / ASF 默认启用。

2. DSF 专项 seek / 强停记录已补。
   - 样本：`/sdcard/music/神様になった日.dsf`
   - 打开后：`PLAYING position=0 buffered=2925 error=null`
   - fast-forward 后：`PLAYING position=26573 buffered=47132 error=null`
   - pause/play 后：`PAUSED` 再回 `PLAYING`
   - 强停重开后：恢复为同一 DSF 的 `PAUSED position=0 buffered=14952 error=null`
   - logcat 未见 Media3、FFmpeg、direct-buffer、source 或崩溃错误。

3. Nitro 原始 Media3 错误 payload 暂不 fork spec。
   - native logcat 已记录 `errorCode`、`errorCodeName`、`message` 和 cause。
   - JS 侧仍用通用 `nitro-playback-error`。
   - 只有以后 UI/插件策略需要 raw error，或上游 Nitro 暴露 `onPlaybackError`，才进入 fork/codegen。

4. RNTP v4 已进入 Nitro-only 删除清理。
   - `react-native-track-player` 依赖已移除。
   - `patches/react-native-track-player+4.1.1.patch` 已删除。
   - `TrackPlayerV4Adapter` 已删除。
   - 播放器后端固定为 `nitro-player`。
   - remote 控制固定为 `native-session`。
   - MusicFree service 不再订阅 RNTP JS remote events。

## 恢复硬规则

继续工作时先做：

1. 看 `git status`，不要覆盖未理解的改动。
2. 读 `docs/round20-current-state-baseline.md`。
3. 跑残留搜索，确认没有把旧口径当当前事实。
4. 不重复 Gate 1/2 手机测试，除非用户明确要求回归。
5. 先跑静态/原生/build 验证，再判断是否能标记目标完成。

当前不再说：

- “RNTP v4 现在冻结保留，不能删。”
- “WMA extractor 还是实验关闭状态。”
- “DSF 还缺专项 seek/强停。”
- “HTTP WMA/ASF/ALAC 还没测。”

当前仍要保守说：

- Nitro 全部 spec 已清点，但非核心模块仍是 deferred/platform-scoped，不等于所有 Nitro 产品能力都接入 MusicFree UI。
- WMA Pro / Lossless / Voice 未验收。
- DFF/DSDIFF 目标外。
- 普通 M4A/AAC 是回归 smoke，不是 ALAC 支持硬门禁。

## 当前审计命令

```powershell
npm run audit:round20-static
npm run audit:round20-native
android\gradlew.bat :app:assembleRelease --no-daemon --console=plain
```

`audit:round20-static` 覆盖 Nitro operation mapping、Media3/FFmpeg 格式扩展、升级边界、样本矩阵口径、TrackPlayer 队列不可变处理和 TypeScript。

`audit:round20-native` 覆盖 Nitro 默认 FFmpeg + WMA 编译，以及 `-PmusicfreeEnableWmaExtractor=false` 回滚编译。

## Gate 证据摘要

### Gate 1：基础体验

用户已连续使用数小时验证：

- 通知栏
- 蓝牙
- 播放详情页
- 歌词页
- 长时间播放

ADB 已补：

- 系统媒体 pause/play
- 系统媒体 fast-forward/seek 类动作
- 强停重开无崩溃并恢复保存队列

Gate 1 当前不是阻塞项，只作为发布回归清单保留。

### Gate 2：HTTP 格式样本

显式 MainActivity `ACTION_VIEW` 入口已通过：

- WMA：`Bangles 01 - Walk Like An Egyptian.wma`，`PLAYING position=33231 buffered=205031 error=null`
- ASF：`Alice Deejay - Back In My Life.asf`，`PLAYING position=43963 buffered=131942 error=null`
- ALAC：`snoop_try.m4a`，`PLAYING position=51985 buffered=123158 error=null`

Manifest 仍没有 `http/https` VIEW intent-filter；这些测试验证的是 App 内显式入口、decoder、DataSource 和 MediaSession 链路。

### Gate 3：格式目标

- ALAC：`D:\Downloads\snoop_try.m4a` 已识别为 `alac`，本地与 HTTP 基础链路通过。
- WMA/ASF：两份 WMA v2/ASF 样本本地与 HTTP 基础链路通过，默认启用。
- DSF：设备样本本地可听，专项 seek/强停记录已补。
- MP3/FLAC/OGG 和普通 M4A/AAC 仍可作为发布前 smoke，不是本轮四件事收口阻塞项。

## 仍要守住的设计边界

- MusicFree native 扩展留在 `com.margelo.nitro.nitroplayer.musicfree`。
- Nitro 上游接缝限制在 `android/build.gradle`、`ExoPlayerBuilder.kt`、`TrackPlayerQueueBuild.kt`、`TrackPlayerListener.kt`。
- 不手改 `nitrogen/generated` 或 `lib` 产物来伪造 error payload。
- 不恢复 JS 自动下一曲、fake-next 或 RNTP proposed-audio 路径。
- 旧 ExoPlayer FFmpeg AAR 不作为 App packaged extension，但可继续作为 patched Media3 FFmpeg AAR 的 generator native base。

## 下一步

1. 本轮四件收口任务已完成。
2. 已通过 `npm run audit:round20-static`，其中包含 RNTP v4 removal guard。
3. 已通过 `npm run audit:round20-native`，覆盖默认 WMA/FFmpeg 和禁用 WMA 回滚编译。
4. 已通过 release build，并安装 `app-arm64-v8a-release.apk` 到设备 `A4UF6R6317000876`。
5. 真机 smoke 已确认：包服务只剩 Nitro `NitroPlayerPlaybackService`，冷启动无崩溃，系统媒体 play 可恢复 DSF 队列，默认 release 构建 WMA HTTP 可 `PLAYING error=null`。

后续进入发布前常规回归和更多样本补强。
