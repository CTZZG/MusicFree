# mpv 播放内核 — 已知问题与修复记录

创建日期：2026-06-29

## 背景

在 `feat/mpv-player` 分支上实现了基于 libmpv 的实验性播放内核。
JS 侧 `mpvPlayerAdapter.ts` + `nativeMpvPlayer.ts` 定义契约，原生侧 `MpvPlayerModule.kt`
包装 libmpv，`MpvPlaybackService.kt` 提供 MediaSession + 通知栏控制。

AI 操作时间线：
- **6月28日 9:46**：`docs/mpv-player-refactor.md` 编写完成，各项功能真机验证通过
- **6月28日 11:00 后**：AI 升级 Nitro 1.4.1→1.4.3、尝试升级 libmpv v1.0.0 → 大量增删操作 → mpv 原生代码被删除
- **6月28日 22:00+**：AI 生成 `UPGRADE_REPORT.md` 和 `FINAL_SUMMARY.md`，声称 Nitro 正常但未测试播放
- **6月28日深夜 - 6月29日凌晨**：人工 + Claude Code 尝试修复，重建原生代码，未能完全恢复功能

## 当前状态

### ✅ 已正常

| 功能 | 状态 |
|------|------|
| App 编译成功 | ✅ |
| Nitro 内核播放（默认） | ✅ libmpv aar 不干扰 Nitro 路径 |
| mpv 内核初始化 | ✅ `NativeModules.MpvPlayer` 可用 |
| mpv 基本加载+播放 | ✅ `loadfile replace` + `pause=false` 正常工作 |
| mpv 手动切歌（下一首按钮） | ✅ 能切歌且自动播放 |
| 设置页「播放内核」选项 | ✅ Android 8.0+ 可见 |
| 音频焦点 | ✅ 基本可用 |

### ❌ 三个核心问题

#### 1. 暂停后需点两次播放才能恢复

**现象**：歌曲播放中，点击通知栏暂停按钮 → 歌曲暂停。再次点击播放按钮 → 无反应。
需要再点一次才会恢复播放。

**涉及的代码路径**：
- 通知栏按钮 → `PendingIntent.getService()` → `onStartCommand(ACTION_PLAY_PAUSE)`
  → `MpvServiceBridge.onCommand("play")` → Module 发送 `onMpvRemoteCommand`
  → JS `handleRemoteCommand("play")` → `this.play()` → `hasLoaded ? resume() : playIndex()`
  → `NativeMpvPlayer.resume()` → `MPVLib.setPropertyBoolean("pause", false)`
  → mpv observer → `emitState("playing")` → Service `onPlaybackStateChanged` → 更新通知

**已尝试的修复**：
- 在 `resume()` 中检测 idle 状态并 seek 0（无效）
- 将 `PendingIntent` 从 `getBroadcast` 改为 `getService`（无效）
- 将 `MediaSessionCompat.Callback` 改为直接 `setCallback` 块体（无效）
- 使用 `Handler.post` 替代 `UiThreadUtil.runOnUiThread`（无效）

**猜测方向**：
- 可能是 JS 侧的 `play()` 方法中 `hasLoaded` 状态错误
- 可能是第一次 tap 实际生效了但通知没有更新（视觉反馈缺失导致用户以为无效）
- 可能是 `MediaSessionCompat` 的 `transportControls.play()` 与 `PendingIntent.getService()` 之间存在竞态

#### 2. 通知栏不显示歌曲时长和播放进度

**现象**：只有播放列表的第一首歌能在通知栏看到时长和进度条；
之后的歌曲切换后，通知栏不显示进度信息。

**涉及的代码路径**：
- `loadAndPlay` → `durationSecs = payload.getDouble("duration")`
  → `syncMetadataToService()` → `onMetadataChanged(durationSecs)`
  → `cachedDuration = (durationSecs * 1000).toLong()` → `updateNotification()`

- mpv observer → `eventProperty("duration", value)` → `emitProgress()`
  → `onProgressChanged(positionSecs, durationSecs)` → `cachedDuration` 更新
  → `updatePlaybackState()` → 首次 duration 时额外 `updateNotification()`

**已尝试的修复**：
- `time-pos`/`duration` 观察格式从 `MPV_FORMAT_INT64` 改为 `MPV_FORMAT_DOUBLE`
- `onProgressChanged` 中当 `cachedDuration` 从 0 变为正数时触发 `updateNotification()`
- `getPropertyDouble` 替代 `getPropertyInt`

**猜测方向**：
- 可能是 JS 侧 `toLoadPayload` 传入的 `duration` 为 0（track.duration 未初始化）
- 可能是 mpv observer 对 `duration` 属性的报告有延迟或不可靠
- 可能是 Service 在切歌过程中 `cachedDuration` 被错误重置

#### 3. 歌曲播放完毕后不会自动切到下一首播放

**现象**：歌曲播放到末尾，UI 切换到下一首歌的信息，但 mpv 不会自动开始播放。
需要手动点击播放或下一首按钮。手动点击下一首按钮则可以正常切歌+自动播放。

**涉及的代码路径**：
- mpv `MPV_EVENT_END_FILE` → Module `event(END_FILE)` → 时间窗口检查
  → `sendEvent(ON_MPV_ENDED)` + `emitState("ended")`
  → JS `addEndedListener` → `handleNativeEnded()`
  → `computeNextIndex()` → `playIndex(nextIndex, "end")`
  → `loadAndPlay(toLoadPayload(nextTrack))` → `loadfile replace` + `pause=false`

**与「手动下一首」的区别**：
- 手动：MediaSession callback `onSkipToNext()` → JS `handleRemoteCommand("next")`
  → observer → `TrackPlayer.skipToNext()` → `playIndex("manual")`
- 自动：`onMpvEnded` → `handleNativeEnded()` → `playIndex("end")`
- 两者最终都调用 `NativeMpvPlayer.loadAndPlay(...)`，但自动切歌在新文件加载后不播放

**已尝试的修复**：
- 等待 `MPV_EVENT_FILE_LOADED` 后再 `pause=false`（无效，FILE_LOADED 可能时序不可靠）
- 用 `AtomicBoolean` 设置 `isReplacingFile`/`pendingUnpause` 标志（无效）
- 用时间窗口 800ms 抑制 END_FILE（无效）
- 使用 `playlist-remove all` + `loadfile append-play`（引入新问题：无法切歌，已回滚）
- 去掉 `replace` flag（默认就是 replace，无效）
- Service 端 `ended`/`buffering` 不更新 MediaSession（部分修复：消除了状态抖动）

**猜测方向**：
- 自然结束后的 mpv 状态（`keep-open=always`，idle-active=true）与手动切歌时的
  状态（playing）不同，`loadfile replace` + `pause=false` 在 idle 状态下行为不同
- 可能需要先 `seek 0` 或使用 `playlist-next` 而不是 `loadfile replace`
- 或者 mpv 对 `pause=false` 在 idle 状态下忽略，需要改用其他方式触发播放
- 可能是 JS 侧 `handleNativeEnded` 中的 `playIndex` 调用了 `loadAndPlay`
  但 `pause=false` 后 mpv 的 observer 没有正确发射 `pause:false` 事件

## 文件结构

```
android/app/src/main/java/fun/upup/musicfree/mpvplayer/
├── MpvPlayerModule.kt      # libmpv 包装器，实现 EventObserver
├── MpvPlaybackService.kt   # 前台服务 + MediaSession + 通知栏
├── MpvPlayerPackage.kt     # RN NativeModule 注册
└── MpvServiceBridge.kt     # Module ↔ Service 单例桥接

src/core/playerAdapter/
├── mpvPlayerAdapter.ts     # JS 侧 mpv 适配器（队列管理）
├── nativeMpvPlayer.ts      # JS ↔ 原生桥接契约（事件/方法定义）
├── nitroPlayerAdapter.ts   # Nitro 适配器（未修改）
├── index.ts                # resolvePlayerAdapter()
└── types.ts                # PlayerBackendName, PlayerAdapter 接口

src/core/trackPlayer/
├── index.ts                # lockBackend() 根据配置选内核
└── playbackServiceObserver.ts  # remoteNext/remotePrevious 监听
```

## 技术要点

### libmpv API（通过反编译 classes.jar 获取）

**可用事件**：MPV_EVENT_NONE(0), SHUTDOWN(1), LOG_MESSAGE(2),
GET_PROPERTY_REPLY(3), SET_PROPERTY_REPLY(4), COMMAND_REPLY(5),
**START_FILE(6), END_FILE(7), FILE_LOADED(8)**, CLIENT_MESSAGE(9),
VIDEO_RECONFIG(10), AUDIO_RECONFIG(11), SEEK(12),
PLAYBACK_RESTART(13), PROPERTY_CHANGE(14), QUEUE_OVERFLOW(15), HOOK(16)

**可用属性格式**：NONE, STRING, OSD_STRING, FLAG, INT64, DOUBLE,
NODE, NODE_ARRAY, NODE_MAP, BYTE_ARRAY

**关键方法**：create/init/destroy, command(String[]), observeProperty(name, format),
getPropertyInt/Double/Boolean/String, setPropertyInt/Double/Boolean/String,
addObserver/removeObserver(EventObserver)

### keep-open=always 行为

- 文件播放到末尾后 mpv 保持打开
- `idle-active` 属性变为 `true`
- `pause` 属性：在 idle 状态下设置为 pause 无意义
- 此时 `loadfile replace` + `pause=false` 可能无效
- `seek 0 absolute` + `pause=false` 可能可以恢复播放

### 与 Nitro 的差异

- Nitro 使用 ExoPlayer + Media3，内部处理所有状态转换
- mpv 是更底层的播放器，需要手动管理属性观察和状态同步
- Nitro 的 PlaybackService 处理 MediaSession，mpv 需要自己实现

## 后续建议

1. **用 Debug 构建**测试，添加详细 log 观察 mpv 属性变化和事件时序
2. **对比 dev-mpv1 分支**的完整 MpvPlayerModule.kt（该分支可能有更完整的实现）
3. **简化架构**：考虑是否可以让 Service 直接持有 mpv 实例，模块只做 JS 桥接
4. **考虑使用 mpv 的 playlist 机制**预载下一首来实现 gapless + 可靠的自动切歌
