# Round 20 Nitro Operation Mapping

更新时间：2026-06-05

本文逐项记录 `react-native-nitro-player@1.4.1` 的公开播放器操作与 MusicFree `PlayerAdapter` 的对应关系。它用于判断“全部操作定义是否已经与 MusicFree 对应上”，不用于宣称迁移完成。

继续开发前先读：

- `docs/round20-context-handoff.md`
- `docs/round20-current-state-baseline.md`
- 本文

## 范围说明

Nitro Player 包含多个模块：

- `TrackPlayer`
- `PlayerQueue`
- `DownloadManager`
- `Equalizer`
- `AudioDevices`
- `AudioRoutePicker`
- `AndroidAutoMediaLibrary`

Round 20 现在不再只靠文档口头解释范围。`npm run audit:nitro-adapter` 会读取 `react-native-nitro-player/src/specs` 下全部 Nitro HybridObject spec，并强制每个 operation 都进入以下状态之一：

- `mapped`：已经映射到 MusicFree `PlayerAdapter` 或播放服务消费路径。
- `partial`：已有消费路径，但语义仍不完整。
- `deferred`：Nitro 已暴露，MusicFree 当前保留既有体系或尚无产品决策，后续 Nitro-only 完成前必须重新决策。
- `platform-scoped`：平台限定能力，当前 Android Media3/FFmpeg 目标不直接消费。

这意味着“全部操作定义”已经可被机器清点，但不等于全部已实现。当前真正完成到 MusicFree 播放器路径的是 `TrackPlayer + PlayerQueue`，其余模块被明确登记为 deferred/platform-scoped，避免 Nitro 升级时漏掉。

## 总体结论

核心播放操作和 `PlayerQueue` 元信息操作已经映射到 `PlayerAdapter`。仍未完整对齐的是：

- 错误详情：当前只有通用 `nitro-playback-error`
- remote/duck：Nitro 没有 RNTP 风格 JS remote callbacks，当前走 native MediaSession

当前已新增静态审计命令：

```powershell
npm run audit:nitro-adapter
```

该命令读取 `react-native-nitro-player/src/specs` 下全部 `.nitro.ts` spec。2026-06-05 当前结果为：

- `49` mapped
- `1` partial
- `57` deferred
- `1` platform-scoped

`partial` 为 `onPlaybackStateChange` 缺 Media3 原始错误详情 JS payload。`deferred` 主要来自 Nitro `DownloadManager`、`Equalizer`、`AudioDevices` 和 `AndroidAutoMediaLibrary`，它们已有升级护栏，但还没有进入 MusicFree 播放目标的完成证据。

错误详情的正式方案见 `docs/round20-nitro-error-payload-plan.md`。当前已补 native logcat 诊断，但 JS payload 仍需要 fork Nitro 并重新生成 nitrogen 产物。

## TrackPlayer 映射

| Nitro `TrackPlayer` 操作 | MusicFree 当前对应 | 状态 | 备注 |
| --- | --- | --- | --- |
| `configure(config)` | `PlayerAdapter.configure(config)` | 已对应 | Nitro adapter 固定 `lookaheadCount: 2`，只映射 notification/Auto 开关的一部分 |
| `play()` | `PlayerAdapter.play()` | 已对应 | 直接调用 Nitro |
| `pause()` | `PlayerAdapter.pause()` | 已对应 | 直接调用 Nitro |
| `playSong(songId, fromPlaylist)` | `PlayerAdapter.playTrack(track, queueId)` / `loadQueue()` 内部使用 | 已对应 | `playTrack` 通过 MusicFree track ref 映射到 Nitro track id |
| `skipToNext()` | `PlayerAdapter.skipToNext()` | 已对应 | 已改为 Nitro 原生下一首 |
| `skipToPrevious()` | `PlayerAdapter.skipToPrevious()` | 已对应 | 已改为 Nitro 原生上一首 |
| `skipToIndex(index)` | `PlayerAdapter.skipToIndex(index)` | 已对应 | 直接调用 Nitro |
| `seek(position)` | `PlayerAdapter.seekTo(position)` | 已对应 | 命令侧已对应 |
| `addToUpNext(trackId)` | `PlayerAdapter.addToUpNext(track)` | 已对应 | 通过 `toNativeTrackId()` 映射 |
| `playNext(trackId)` | `PlayerAdapter.playNext(track)` | 已对应 | 通过 `toNativeTrackId()` 映射 |
| `getActualQueue()` | `PlayerAdapter.getQueue()` | 已对应 | 返回 MusicFree track 兼容结构 |
| `getState()` | `getState()` / `getProgress()` / `getActiveTrack()` | 已对应 | active index 单独走 Nitro `getCurrentTrackIndex()` |
| `setRepeatMode(mode)` | `setRepeatMode(mode)` | 已对应 | `queue` 映射到 Nitro `Playlist` |
| `getRepeatMode()` | `getRepeatMode()` | 已对应 | Nitro `Playlist` 映射回 `queue` |
| `onChangeTrack(cb)` | `trackChanged` / `playEnd` | 已对应 | `reason=end` 只派发 `playEnd`，不再 JS 自动下一首 |
| `onPlaybackStateChange(cb)` | `playbackStateChanged` / `playbackError` | 部分对应 | 错误只保留通用 code/message，缺 Media3 原始错误详情 |
| `onSeek(cb)` | `playbackSeeked` | 已对应 | 这是 seek 后通知，不是 remote seek 命令；不能接到 `remoteSeek` |
| `onPlaybackProgressChange(cb)` | `progress` | 已对应 | 进度同步和持久化使用 |
| `onAndroidAutoConnectionChange(cb)` | `androidAutoConnectionChanged` | 已对应 | 当前 Android Auto 仍未完整产品化 |
| `isAndroidAutoConnected()` | `isAndroidAutoConnected()` | 已对应 | 直接调用 Nitro |
| `setVolume(volume)` | `setVolume(volume)` | 已对应 | adapter 兼容 0-1 与 0-100 |
| `updateTracks(tracks)` | `updateTracks(tracks)` / `updateTrack(track)` | 已对应 | 用于 lookahead 补源 |
| `getTracksById(trackIds)` | `getTracksById(trackIds)` | 已对应 | 用于按 ID 回查 |
| `getTracksNeedingUrls()` | `getTracksNeedingUrls()` | 已对应 | 用于懒补 URL |
| `getNextTracks(count)` | `getNextTracks(count)` | 已对应 | 用于预解析 |
| `getCurrentTrackIndex()` | `getActiveTrackIndex()` | 已对应 | 直接调用 Nitro 原生 `getCurrentTrackIndex()` |
| `setPlaybackSpeed(speed)` | `setRate(rate)` | 已对应 | MusicFree 命名沿用 rate |
| `getPlaybackSpeed()` | `getRate()` | 已对应 | MusicFree 命名沿用 rate |
| `removeFromPlayNext(trackId)` | `removeFromPlayNext(track)` | 已对应 | 通过 `toNativeTrackId()` 映射 |
| `removeFromUpNext(trackId)` | `removeFromUpNext(track)` | 已对应 | 通过 `toNativeTrackId()` 映射 |
| `clearPlayNext()` | `clearPlayNext()` | 已对应 | 直接调用 Nitro |
| `clearUpNext()` | `clearUpNext()` | 已对应 | 直接调用 Nitro |
| `reorderTemporaryTrack(trackId, newIndex)` | `reorderTemporaryTrack(track, newIndex)` | 已对应 | 通过 `toNativeTrackId()` 映射 |
| `getPlayNextQueue()` | `getPlayNextQueue()` | 已对应 | 返回 MusicFree track 兼容结构 |
| `getUpNextQueue()` | `getUpNextQueue()` | 已对应 | 返回 MusicFree track 兼容结构 |
| `onTemporaryQueueChange(cb)` | `temporaryQueueChanged` | 已对应 | adapter 做 JS 多监听者分发 |

## PlayerQueue 映射

| Nitro `PlayerQueue` 操作 | MusicFree 当前对应 | 状态 | 备注 |
| --- | --- | --- | --- |
| `createPlaylist(name, description, artwork)` | `createQueueInfo(metadata)` / `loadQueue()` 内部创建播放队列 | 已对应 | 使用 MusicFree queue metadata 命名 |
| `deletePlaylist(playlistId)` | `deleteQueueInfo(queueId)` / `reset()` / `loadQueue()` 内部清理 | 已对应 | 删除当前 queue 时同步清空 adapter 当前 queue id |
| `updatePlaylist(playlistId, ...)` | `updateQueueInfo(queueId, metadata)` | 已对应 | 使用 MusicFree queue metadata 命名，不直接泄漏 Nitro playlist API |
| `getPlaylist(playlistId)` | `getQueueInfo(queueId)` | 已对应 | 未传 queueId 时读取当前 queue |
| `getAllPlaylists()` | `getAllQueueInfos()` | 已对应 | 返回 MusicFree `QueueInfo[]` |
| `addTrackToPlaylist(playlistId, track, index)` | `addQueueTrack(queueId, track, index)` | 已对应 | 用于显式 queue id 的单曲插入 |
| `addTracksToPlaylist(playlistId, tracks, index)` | `addQueueTracks(tracks, index)` / `loadQueue()` | 已对应 | 用于真实 Nitro playlist |
| `removeTrackFromPlaylist(playlistId, trackId)` | `removeQueueTrack(track)` | 已对应 | 只作用于当前 playlist |
| `reorderTrackInPlaylist(playlistId, trackId, newIndex)` | `reorderQueueTrack(track, newIndex)` | 已对应 | 只作用于当前 playlist |
| `loadPlaylist(playlistId, index)` | `loadQueueInfo(queueId, index)` / `loadQueue()` 内部兜底 | 已对应 | 显式加载已有 queue 时同步 adapter 当前 queue id |
| `getCurrentPlaylistId()` | `getCurrentQueueId()` | 已对应 | 命名按 MusicFree queue |
| `onPlaylistsChanged(cb)` | `queuesChanged` | 已对应 | adapter 派发 `queues` 与 `operation` |
| `onPlaylistChanged(cb)` | `queueChanged` | 已对应 | adapter 派发 `queueId`、`queue` 与 `operation` |

## 非播放器核心模块

| Nitro 模块 | 当前状态 | 建议 |
| --- | --- | --- |
| `DownloadManager` | `35` 个 operation 已登记为 deferred | MusicFree 已有下载体系；不要在 Round 20 播放器迁移里混入，除非后续决定替换下载系统 |
| `Equalizer` | `18` 个 operation 已登记为 deferred | 可作为未来体验项，不是 ALAC/WMA/DSF 播放目标的前置 |
| `AudioDevices` | `2` 个 operation 已登记为 deferred | 可用于未来输出设备管理，不是当前阻塞项 |
| `AudioRoutePicker` | `1` 个 operation 已登记为 platform-scoped | iOS/路由体验项，当前 Android 格式扩展不是它阻塞 |
| `AndroidAutoMediaLibrary` | `2` 个 operation 已登记为 deferred | Nitro 有能力，但 MusicFree 还没定义 Android Auto 媒体库结构 |

## 下一步代码对齐建议

优先级从高到低：

1. 在 Nitro fork 中按 `docs/round20-nitro-error-payload-plan.md` 新增 `onPlaybackError`，让 JS payload 包含 Media3 error code/name/message。
2. 保持 remote 控制当前策略：Nitro 走 `native-session`，除非 fork Nitro 增加真正 JS remote callbacks。
3. 完成真机 media session 回归后，再判断是否进入 Nitro-only 清理。

## 当前不能宣称的事

- 不能说 Nitro API 已经 100% 对齐，因为 `57` 个非核心 operation 仍是 deferred，错误详情和 RNTP 风格 remote/duck 仍未等价。
- 不能说 remote 行为等价 RNTP v4。
- 不能说自然结束下一曲已经最终修好，除非有真机回归记录。
- 不能说 ALAC/WMA/DSF 已支持，除非样本矩阵通过。
