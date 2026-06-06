# Round 20 Goal Gap Audit

更新时间：2026-06-06

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文回答：当前离“用 Nitro Player + Media3/FFmpeg + 自定义格式扩展替换 RNTP”还有多远。

## 总体判断

当前已进入 Nitro-only 收口阶段。四个本轮决策项已经落地或记录：

- WMA v2/ASF 默认启用，保留禁用回滚开关。
- DSF 专项 seek/强停证据已补。
- Nitro 原始 Media3 错误 payload 暂不 fork spec/codegen。
- RNTP v4 已从依赖、patch、adapter 和业务分流中移除。

静态审计、native 编译、release 构建和真机安装 smoke 已通过；本轮四件收口任务可以视为完成。

## 目标拆解

| 目标项 | 当前证据 | 状态 |
| --- | --- | --- |
| Nitro 作为唯一播放器后端 | `react-native-track-player` 已卸载；`TrackPlayerV4Adapter` 已删除；后端固定 `nitro-player`；remote 策略固定 `native-session` | 已进入 Nitro-only |
| Nitro operation 定义对齐 | `audit:nitro-adapter` 清点全部 Nitro HybridObject spec；核心 `TrackPlayer + PlayerQueue` 已映射，非核心模块登记为 deferred/platform-scoped | 核心完成，非核心有明确决策 |
| Nitro remote 语义 | 通知栏、蓝牙、系统媒体键交给 Media3 MediaSession；用户长测和 ADB 系统媒体键记录通过 | 当前策略通过 |
| Nitro raw error payload | native logcat 记录 Media3 error code/name/message/cause；Round 20 决定不 fork spec | 决策完成 |
| M4A/ALAC | FFmpeg ALAC 样本 `snoop_try.m4a` 本地与 HTTP 基础链路通过；普通 M4A/AAC 只作为回归 smoke | ALAC 基础目标通过 |
| WMA/ASF | 自写 ASF/WMA parser/assembler/extractor + FFmpeg WAVEFORMATEX 透传已通过 WMA v2/ASF 本地与 HTTP 证据；默认启用，保留 `musicfreeEnableWmaExtractor=false` 回滚 | WMA v2/ASF 通过 |
| DSF | DSF extractor + legacy FFmpeg4 wrapper 可听；专项 fast-forward/seek 类动作、pause/play 和强停重开已记录 | DSF 基础矩阵通过 |
| DFF/DSDIFF | 不在当前目标内，已从本地扫描支持口径移出 | 目标外 |
| 模块化升级边界 | MusicFree native 扩展位于 `musicfree` 命名空间；升级边界审计限制 4 个 Nitro 上游接缝 | 需继续用审计守护 |
| RNTP v4 清理 | 依赖、patch、adapter、设置项、service 分流和 RNTP state 处理已删除 | 代码清理完成，待 build 证明 |

## Gate 状态

### Gate 1：基础体验

通过。用户长测通知栏、蓝牙、详情页、歌词页和长时间播放；ADB 补系统媒体 pause/play、fast-forward 和强停重开。

### Gate 2：HTTP 格式样本

通过。WMA、ASF、ALAC 三条 HTTP 链接都达到 `PLAYING` 且 `error=null`。ALAC 样本服务器 MIME 是 `audio/mpeg`，仍能正确播放。

### Gate 3：目标格式

目标格式基础链路通过：

- ALAC 本地与 HTTP 基础链路通过。
- WMA v2/ASF 本地与 HTTP 基础链路通过。
- DSF 本地可听、seek 类动作和强停重开通过。

未覆盖但不阻塞本轮四件事：

- WMA Pro / Lossless / Voice。
- MP3/FLAC/OGG 发布前 smoke。
- 普通 M4A/AAC smoke。
- 更多 DSF 样本。

### Gate 4：模块化边界

已建立审计，待本轮复跑确认。

### Gate 5：Nitro-only 清理

已闭环。`audit:round20-static`、`audit:round20-native`、release build 和真机安装 smoke 均通过；包服务检查只剩 Nitro `NitroPlayerPlaybackService`，未出现旧 RNTP service。

## 当前验证清单

本轮已复跑：

```powershell
npm run audit:round20-static
npm run audit:round20-native
android\gradlew.bat :app:assembleRelease --no-daemon --console=plain
```

补充真机 smoke：

- `adb install -r android\app\build\outputs\apk\release\app-arm64-v8a-release.apk`：成功。
- 冷启动：进程存在，Nitro/Media3 session active，`error=null`。
- 系统媒体 play：当前 DSF 队列进入 `PLAYING error=null`。
- WMA HTTP 默认构建：`PLAYING position=144287 buffered=205031 error=null`。

建议同时做残留搜索：

```powershell
rg -n "react-native-track-player|TrackPlayerV4|trackPlayerV4|debug\\.playerBackend|MUSICFREE_ENABLE_EXPERIMENTAL_WMA_EXTRACTOR|MUSICFREE_ENABLE_WMA_EXTRACTOR" package.json package-lock.json src generator patches docs android\\app\\build.gradle -S
```

允许残留：

- 历史 `round19-*` 或迁移背景文档中的旧 RNTP 叙述。
- `generator/patch-media3-ffmpeg-aar.mjs` 对 `exoplayer-ffmpeg-extension-v2.19.1.aar` 的引用，因为它仍是 patched Media3 FFmpeg AAR 的 native base。
- `musicfreeEnableExperimentalWmaExtractor` 作为旧脚本兼容禁用别名出现。

不应再出现于当前态文档或运行代码：

- WMA/ASF 被描述成非默认注册。
- RNTP v4 应继续保留。
- DSF 专项记录缺失。
- HTTP WMA/ASF/ALAC 未验收。

## 一句话距离

当前已经完成 Nitro-only 的核心代码迁移、四件收口决策、审计/native/build 验证和真机安装 smoke。后续工作应转入发布前常规回归和更多样本补强。
