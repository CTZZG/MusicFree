# mpv 播放内核 — 已知问题与修复记录

创建日期：2026-06-29

## 2026-06-29 Codex 修复摘要

本轮在当前 `feat/mpv-player` 分支上保留「MPV 作为 `PlayerAdapter` 可选后端」的架构，未恢复旧
`dev-mpv1` 的 RNTP 静音轨道双播放器方案。代码层已完成以下修复，并已在 Honor 设备
`A4UF6R6317000876` 上覆盖 MPV/Nitro 切换、通知控制和末尾播放边界：

- 原生 `MpvPlayerModule` 改为加载代际状态机：抑制替换旧文件产生的 stale `END_FILE`，并在
  `START_FILE` / `FILE_LOADED` / `PLAYBACK_RESTART` 及延迟重试点强制补 `pause=false`，用于修复自然
  播放结束后下一首 UI 已切换但 mpv 不出声的问题。
- `pause/resume/idle/buffering/ended` 状态重新收敛：暂停/恢复会立即同步状态给 JS 和 Service，避免通知栏
  播放按钮第一次点击只有视觉/状态竞态、需要点两次的现象。
- 通知栏和 MediaSession 进度改为持续同步：切歌时重置 position，`FILE_LOADED` 和 `duration` 属性回调会补
  duration，通知每秒刷新 progress/subText，并透传 buffered 进度。
- `MpvPlaybackService` 补齐锁屏封面 bitmap、单色通知小图标、拔耳机暂停、瞬时音频焦点暂停/恢复。
- JS `mpvPlayerAdapter` 补齐 Nitro 风格队列能力：`getTracksNeedingUrls`、`getTracksById`、queueInfo、
  add/remove/reorder、临时队列、queue/temporary 事件等；同时在 `syncQueueOrder` 中保留已解析 URL、headers
  和 userAgent。
- 初始化路径调整为同一份 `PlayerAdapterConfig` 同时传给 `setup` 和 `configure`，MPV 初始化期现在能拿到
  userAgent、maxCacheSize、progress interval、闪避策略和通知 stop 能力。
- MPV 通知栏现在会按 `basic.showExitOnNotification` 对应的 capabilities 显示「关闭」按钮；`stop()` 会标记
  原生文件已卸载，后续播放会重新加载当前曲目，避免对空 mpv 实例 resume。
- 原生进度事件按 `progressUpdateEventInterval` 节流，切歌、seek、时长变化、stop/end 等关键点强制上报；
  MPV 进入 idle/error 时会取消前台通知，避免 reset/stop 后残留陈旧通知。
- 新增 prepared-next/gapless 代码路径：`TrackPlayer` 根据 repeat、play-later、拉黑歌曲等应用层规则计算
  单个确认的下一首，`mpvPlayerAdapter.prepareNextTrack()` 传给原生 `prepareNext()`；原生仅追加这一首到 mpv
  playlist，自动前进后通过 `autoAdvanced` 事件让 JS 同步当前曲。原生记录 prepared next 的 playlist index，
  并在自动前进后压缩历史 playlist 项，避免 repeat/play-later 快速变更时误删当前曲。
- `loadQueue` 增加可选 `autoPlay` 语义，`TrackPlayer.setTrackSource(..., autoPlay=false)` 会传给 MPV；
  原生加载时保持 `pause=true` 且不执行 unpause retry，避免重启恢复队列时绕过“不自动播放”设置。
- JS `mpvPlayerAdapter.play()` / `seekTo()` 增加“接近曲尾”保护：用户把通知进度条拖到 duration 后再点
  播放时，不再把 MediaSession 卡成 `PLAYING` 但 position 不动，而是走同一套结束/下一首逻辑。
- Nitro 与 MPV adapter 都改为懒加载：`TrackPlayer` 不再在模块顶层持有 Nitro 默认实例，避免选择 MPV
  时 `react-native-nitro-player` 提前创建空的 Media3 session。MPV 模式重启后系统媒体键会直接路由到
  `MusicFreeMpv`。
- 2026-06-29 追加：MPV 原生初始化不再设置 `keep-open=always`，改为允许 mpv 在曲尾自然 EOF 和推进
  prepared-next playlist；JS 侧在处理 `onMpvEnded` 的短窗口内忽略原生随后补发的 `ended` 状态，避免列表循环
  自动切到下一首时被结束态覆盖。

验证：

- `npx tsc --noEmit` ✅
- `cd android && .\gradlew.bat assembleRelease` ✅
- `apksigner verify --verbose android\app\build\outputs\apk\release\app-arm64-v8a-release.apk` ✅
- `git diff --check` ✅
- `adb install -r android\app\build\outputs\apk\release\app-arm64-v8a-release.apk` ✅
- MPV 真机：重启恢复为 `PAUSED` 且不自启；通知播放/暂停进度推进；通知上一首/下一首切换元数据并继续播放；精确 seek 到曲尾后点播放可进入下一首；无 `AndroidRuntime`/`FATAL EXCEPTION`。
- MPV 真机：列表循环真实队列中，`Bangles 01 - Walk Like An Egyptian.wma` 自然播放到末尾后自动切到
  `01 - 皇后大道東.dsf`，MediaSession 仍为 `PLAYING`，metadata 与 position 均推进；确认不再停在曲尾。
- MPV 真机特殊格式：`Alice Deejay - Back In My Life.asf`、`snoop_try.m4a`、
  `Bangles 01 - Walk Like An Egyptian.wma` 均可通过本地 `file://` 播放，MediaSession 为 `MusicFreeMpv`
  且 position 推进、`error=null`；未捕获 `AndroidRuntime`/`FATAL EXCEPTION`/`ReactNativeJS`/
  `mpv-playback-error`/`Source error`/`ExoPlaybackException`。
- Nitro 真机：设置页切到 `Nitro（默认）` 后重启，MediaSession 切到 `androidx.media3.session.id`；全局媒体键播放/暂停可推进并回到 `PAUSED`。
- 双向切换：设置页 `mpv（实验性）` ↔ `Nitro（默认）` 均需重启生效，重启后对应 MediaSession/通知后端正确。MPV 模式只留下 `MusicFreeMpv`，无 Nitro 空 session 残留。

限制：

- debug APK 因签名不同仍会被系统拒绝；本轮已确认本地 `release.jks` 与设备既有包签名一致，release
  覆盖安装成功并保留数据。
- 已用通知拖动验证“曲尾播放不再卡死”和“队列末尾自然结束会停住”；由于系统媒体 carousel 偶尔返回旧通知
  XML，prepared-next 的真实 gapless 空隙和复杂 play-later/单曲循环仍建议继续用专项用例覆盖。

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

### 当前状态

| 功能 | 状态 |
|------|------|
| App 编译成功 | ✅ |
| Nitro 内核默认路径 | ✅ 配置缺省仍选 `nitro-player`，mpv 懒加载，不影响默认后端 |
| mpv 内核初始化 | ✅ release 真机启动后 `MusicFreeMpv` MediaSession 可见 |
| mpv 基本加载+播放 | ✅ 通知播放后 `PLAYING`，position/buffered 推进，暂停后 position 稳定 |
| mpv 手动切歌/曲尾边界 | ✅ 通知上一首/下一首可切歌；拖到曲尾后点播放不再卡死；真实列表循环中自然曲尾会自动进入下一首 |
| 重启恢复但不自动播放 | ✅ MPV 重启恢复为 `PAUSED`，无自动播放 |
| 设置页「播放内核」选项 | ✅ Android 8.0+ 可见 |
| 音频焦点/通知/锁屏 | ✅ 通知和 MediaSession 基础控制已真机验证；焦点抢占/拔耳机仍需专项场景 |

### 历史三个核心问题（当前代码已有对应修复并完成 release 真机回归）

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

1. **继续使用 Release 构建回归**，签名读取 `android/keystore.properties`，避免 debug 签名无法覆盖安装或行为证据不一致
2. **对比 dev-mpv1 分支**的完整 MpvPlayerModule.kt（该分支可能有更完整的实现）
3. **简化架构**：考虑是否可以让 Service 直接持有 mpv 实例，模块只做 JS 桥接
4. **已采用 mpv playlist 的窄 prepared-next 机制**预载单个确认下一首；下一步是设备侧验证 gapless、
   headers/userAgent 差异、play-later 撤销预载和单曲循环。
