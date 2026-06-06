# Round 20 Nitro Player Migration

更新时间：2026-06-06

本文记录 Nitro Player 迁移路线的当前状态。旧的并存期计划已经收敛，当前以 `docs/round20-restart-anchor.md` 和 `docs/round20-current-state-baseline.md` 为准。

## 目标

把 MusicFree 播放器底座收敛到：

```text
react-native-nitro-player + Media3 + FFmpeg decoder + MusicFree custom extractors
```

目标格式：

- M4A/ALAC
- WMA/ASF
- DSF

普通 M4A/AAC 是 Media3 原生回归 smoke，不作为 ALAC 目标硬门禁。DFF/DSDIFF 当前目标外。

## 当前实现

- 播放器后端固定为 Nitro。
- RNTP v4 依赖、patch 和 adapter 已删除。
- MusicFree 业务层仍保留 `src/core/trackPlayer` facade，但底层调用固定转到 `nitroPlayerAdapter`。
- remote 控制策略固定为 Nitro/Media3 `native-session`。
- JS service 不再订阅 RNTP remote callbacks。
- Nitro queue、skip、seek、progress、state、track change、tracksNeedUpdate 和 queue 生命周期能力已通过 `PlayerAdapter` 对接。

## Native 扩展

MusicFree 的 Nitro Android 扩展位于：

```text
node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/musicfree
```

主要文件：

- `MusicFreePlayerExtensions.kt`
- `MusicFreeExtractorsFactory.kt`
- `MusicFreeAudioExtractorRegistry.kt`
- `MusicFreeAudioFormatRegistry.kt`
- `DsfExtractor.kt`
- `AsfWmaHeaderParser.kt`
- `AsfWmaPacketParser.kt`
- `AsfWmaPayloadAssembler.kt`
- `AsfWmaExtractor.kt`

允许的 Nitro 上游接缝见 `docs/round20-upgrade-boundary.md`。

## 格式状态

| 格式 | 当前状态 |
| --- | --- |
| M4A/ALAC | FFmpeg ALAC 样本 `snoop_try.m4a` 本地与 HTTP 基础链路通过 |
| WMA/ASF | WMA v2/ASF 本地与 HTTP 基础链路通过，默认启用；WMA Pro/Lossless/Voice 未覆盖 |
| DSF | 设备样本可听，fast-forward/seek 类动作、pause/play 和强停重开通过 |
| DFF/DSDIFF | 目标外，不扫描入库 |

## WMA 默认策略

默认启用：

```text
MUSICFREE_ENABLE_WMA_EXTRACTOR = true
```

回滚：

```powershell
-PmusicfreeEnableWmaExtractor=false
```

兼容旧脚本：

```powershell
-PmusicfreeEnableExperimentalWmaExtractor=false
```

旧 experimental 属性只作为禁用别名，不再代表实验阶段开关。

## 错误 payload 策略

Round 20 不 fork Nitro spec/codegen 来补 raw Media3 JS error payload。当前 native logcat 已记录 Media3 error code/name/message/cause；JS 侧保留通用 `nitro-playback-error`。

若未来要把 raw error 暴露给 UI 或插件策略，再在 Nitro fork 中改 `src/specs` 并重新生成 nitrogen 产物。

## 验证

本轮收口必须通过：

```powershell
npm run audit:round20-static
npm run audit:round20-native
android\gradlew.bat :app:assembleRelease --no-daemon --console=plain
```

通过后，本迁移文档对应的 Nitro-only 代码路径可视为收口完成；后续是发布前 smoke、更多格式样本和 Nitro 上游升级维护。
