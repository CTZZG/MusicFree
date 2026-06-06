# Round 20 Context Handoff

更新时间：2026-06-06

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文只保留给上下文交接使用。继续 Round 20 时，优先读：

- `docs/round20-restart-anchor.md`
- `docs/round20-current-state-baseline.md`
- `docs/round20-goal-gap-audit.md`

## 当前交接结论

Round 20 已从 RNTP/Nitro 并存验证推进到 Nitro-only 清理。前一阶段的“RNTP v4 暂时保留”、WMA 实验注册和 DSF 专项未补齐口径已经不是当前口径。

当前四件收口事项：

- WMA v2/ASF 默认启用，回滚开关为 `-PmusicfreeEnableWmaExtractor=false`；旧 `musicfreeEnableExperimentalWmaExtractor=false` 仅作兼容禁用别名。
- DSF 专项 seek/强停记录已写入 `docs/round20-device-media-session-baseline.md`。
- Nitro 原始 Media3 错误 payload 本轮不 fork spec/codegen；native logcat 诊断保留。
- RNTP v4 已从 npm 依赖、patch、adapter、设置项和 service remote 分流中移除。

## 已有关键证据

- Gate 1：用户长测通知栏、蓝牙、详情页、歌词页和长时间播放；ADB 补系统媒体 pause/play、fast-forward 和强停重开。
- Gate 2：HTTP WMA、HTTP ASF、HTTP ALAC 均达到 `PLAYING` 且 `error=null`。
- ALAC：`D:\Downloads\snoop_try.m4a` 识别为 `alac`，本地与 HTTP 基础链路通过。
- WMA/ASF：`Alice Deejay - Back In My Life.asf` 和 `Bangles 01 - Walk Like An Egyptian.wma` 均识别为 WMA v2，离线 packet/sample 审计、本地真机和 HTTP 链路通过。
- DSF：`/sdcard/music/神様になった日.dsf` 当前构建可听；fast-forward/seek 类动作、pause/play 和强停重开均 `error=null`。

## 代码状态

- `react-native-track-player` 已卸载。
- `patches/react-native-track-player+4.1.1.patch` 已删除。
- `src/core/playerAdapter/trackPlayerV4Adapter.ts` 已删除。
- `src/core/trackPlayer/index.ts` 固定走 `nitroPlayerAdapter`。
- `src/service/index.ts` 不再订阅 RNTP JS remote events。
- `PlayerBackendName` 只剩 `nitro-player`。
- `PlayerAdapterRemoteControlMode` 只剩 `native-session`。
- `buildInfo` 使用 `nitroPlayer` 字段。

## 继续工作的第一步

先复跑：

```powershell
npm run audit:round20-static
npm run audit:round20-native
android\gradlew.bat :app:assembleRelease --no-daemon --console=plain
```

如果三者通过，本轮“四件事收口”即可认为完成；后续工作再另开发布前 smoke 和样本补强。
