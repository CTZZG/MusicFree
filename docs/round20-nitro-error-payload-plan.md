# Round 20 Nitro Error Payload Plan

更新时间：2026-06-05

本文记录 Nitro Player 的 Media3 错误详情对齐方案。

## 当前状态

当前 Nitro native 能在 `TrackPlayerEventListener.onPlayerError(error: PlaybackException)` 收到 Media3 `PlaybackException`。

已完成的小步：

- `patches/react-native-nitro-player+1.4.1.patch` 已让 native 在 `onPlayerError` 中记录：
  - `errorCode`
  - `errorCodeName`
  - `message`
  - `cause` class/message
- native 仍会调用 `core.emitStateChange(Reason.ERROR)`，JS 侧继续收到通用 `reason=error`。
- MusicFree `NitroPlayerAdapter` 当前派发的 `playbackError` payload 包含：
  - `code: nitro-playback-error`
  - `message: Nitro playback error`
  - `backend`
  - `reason`
  - `state`

这只解决真机诊断，不等于 JS 已经拿到 Media3 原始错误详情。

## Round 20 决策

本轮决定：暂不 fork Nitro spec/codegen 来补 JS 原始错误 payload。

原因：

- Gate 1/2 和 ALAC/WMA/ASF/DSF 当前收口缺口不再依赖 JS 原始错误码。
- 为了一个诊断增强 fork Nitro spec，会引入 generated C++/Kotlin/Swift/JSI 产物维护成本，反而削弱后续跟进 `riteshshukla04/react-native-nitro-player` 升级的便利性。
- 当前 native logcat 已记录 Media3 `errorCode`、`errorCodeName`、`message` 和 cause，足够支撑格式开发期定位。
- MusicFree 的用户态恢复策略现在不再靠 JS 自动下一曲兜底；收到通用 `nitro-playback-error` 后只记录和同步错误，不需要 raw Media3 payload 才能保持播放队列稳定。

保留路线：

- `onPlaybackStateChange(reason=error)` 继续作为 JS 状态同步入口。
- 原始 Media3 错误详情以 native logcat 为准。
- 如果以后需要把错误详情显示给用户、做插件级错误策略，或上游 Nitro 正式暴露 `onPlaybackError`，再按本文“正式实现方案”补 spec/codegen。

## 为什么不能只在 JS adapter 补

Nitro 当前公开回调是：

```ts
onPlaybackStateChange(
  callback: (state: TrackPlayerState, reason?: Reason) => void
): void
```

Android generated spec 也固定为：

```kotlin
abstract fun onPlaybackStateChange(
    callback: (state: TrackPlayerState, reason: Reason?) -> Unit
): Unit
```

因此现有桥接只能传 `TrackPlayerState` 和 `Reason`。`PlaybackException` 的 `errorCode/message/cause` 在 native 层被压缩成 `Reason.ERROR` 后，JS adapter 没有任何真实通道读取它。

2026-06-04 复核 generated 结构后补充：不要手改 `nitrogen/generated/**/*` 来绕过这个限制。`Reason` 和 `TrackPlayerState` 都是 nitrogen 生成的 enum，`onPlaybackStateChange` 绑定到固定的 `Func_void_TrackPlayerState_std__optional_Reason_`，手工塞字符串或对象 payload 会破坏 generated C++/Kotlin/JSI 类型一致性。这个缺口必须通过 fork Nitro 源 spec 后重新生成 nitrogen 产物解决。

## 正式实现方案

需要在 `CTZZG/react-native-nitro-player` fork 中新增错误 payload 类型和回调，然后重新运行 nitrogen。

建议新增类型：

```ts
export interface PlaybackErrorInfo {
  code: string
  message: string
  errorCode?: number
  errorCodeName?: string
  causeClassName?: string
  causeMessage?: string
}
```

建议新增 API：

```ts
onPlaybackError(callback: (error: PlaybackErrorInfo) => void): void
```

需要修改的源文件：

- `src/specs/TrackPlayer.nitro.ts`
- `src/types/PlayerQueue.ts` 或新增错误类型文件
- `android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerCore.kt`
- `android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerListener.kt`
- `android/src/main/java/com/margelo/nitro/nitroplayer/HybridTrackPlayer.kt`
- iOS 对应 `HybridTrackPlayer.swift` / core listener，至少要有 no-op 或平台等价错误

需要通过 `bun run specs` 或 Nitro 包的 `npm run specs` 重新生成：

- `lib/**/*`
- `nitrogen/generated/**/*`

## MusicFree 对接

fork 暴露 `TrackPlayer.onPlaybackError` 后：

1. `NitroPlayerAdapter` 注册 `onPlaybackError`。
2. 将 payload 映射为 `PlayerAdapterPlaybackError`：
   - `code`
   - `message`
   - `backend: nitro-player`
   - `nativeCode`
   - `nativeMessage`
   - `raw`
3. 保留 `onPlaybackStateChange(reason=error)` 作为状态同步，不再由它构造主要错误详情。

## 验收

至少需要用以下场景验证：

- 不存在的本地文件
- 无法访问的 HTTP URL
- FFmpeg decoder 不支持或 extractor 不识别的格式
- WMA/DSF 开发过程中的失败样本

通过标准：

- JS `playbackError` 能看到 Media3 error code/name/message。
- logcat 和 JS payload 能对应同一次失败。
- MusicFree `handlePlayFail()` 行为不退化。
