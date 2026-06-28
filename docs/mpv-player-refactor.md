# mpv 播放内核改造（实验性，仅 Android）

把 mpv（libmpv）作为**可选播放内核**接入 MusicFree，与现有的 `react-native-nitro-player`（默认）并存。
设置里可切换；默认仍是 Nitro，风险隔离。

> 背景：旧 `dev-mpv1` 分支曾尝试 mpv，但作为「并行播放器 + 原生维护队列、和 RN 状态手动对账」实现，
> 长期受状态同步问题困扰（提交史里大量「修复状态同步」「部分歌曲无法播放」）。本次改造换了思路。

## 为什么这次不一样：单一队列真相来源

round20 nitro 重构后，播放核心 `src/core/trackPlayer/index.ts` 是面向 **`PlayerAdapter` 接口**编程的
（`backend` 字段，`index.ts:166`/`lockBackend()`）。本次复用这个接缝：

- **不再并行挂一个 mpv 播放器**，而是写一个实现同一接口的 `mpvPlayerAdapter`。
- **队列 / 当前下标 / repeat / 自动切歌全部在 JS 适配器里管理**（唯一真相来源），
  原生 mpv 只当「单曲播放引擎」：加载一个 URL、播放/暂停/seek、上报进度与结束。
- 适配器在事件契约上「装成」Nitro（`trackChanged{track,index,reason}`、`progress`、
  `playbackStateChanged` 等），所以 2000 行的播放核心**几乎不用改**，nitro 路径完全不受影响。

这从根上消除了旧实现「双队列对账」的状态同步类 bug。

## 职责划分

| 关注点 | 归属 |
|---|---|
| 队列、上一首/下一首、跳转、repeat、shuffle、play-later | JS：`mpvPlayerAdapter` + `trackPlayer/index.ts`（沿用既有逻辑） |
| 音源 URL 解析（插件）、URL 未就绪时回填 | JS：适配器发 `tracksNeedUpdate`，核心解析后 `updateTrack` 回填再播 |
| 实际解码播放、进度/结束/错误上报 | 原生：`MpvPlayerModule` 包装 `libmpv` |
| 锁屏/通知栏控制、后台存活 | 原生：`MediaSessionCompat` + `MpvPlaybackService` 前台服务 |

## 文件清单

**JS / TS**
- `src/core/playerAdapter/types.ts` — `PlayerBackendName` 增加 `"mpv"`
- `src/core/playerAdapter/index.ts` — `resolvePlayerAdapter(name)`（Nitro/MPV 均懒加载，避免未选后端提前创建 MediaSession）
- `src/core/playerAdapter/nativeMpvPlayer.ts` — JS↔原生桥接契约（事件/方法定义）
- `src/core/playerAdapter/mpvPlayerAdapter.ts` — mpv 适配器（JS 队列 + 引擎桥接）
- `src/core/trackPlayer/index.ts` — `lockBackend()` 按 `basic.playerBackend` 选内核
- `src/types/core/config.d.ts` — 新增配置键 `basic.playerBackend`
- `src/pages/setting/settingTypes/basicSetting.tsx` — 设置项「播放内核」（仅 Android）
- `src/types/core/i18n/index.d.ts` + `zh-cn/zh-tw/en-us.json` — 文案

**原生 Android**
- `android/app/libs/libmpv-release.aar` — 预编译 libmpv（~42MB，取自 dev-mpv1）
- `android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlayerModule.kt`
- `android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlaybackService.kt`
- `android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlayerPackage.kt`
- `android/app/src/main/java/fun/upup/musicfree/MainApplication.kt` — 注册 package
- `android/app/src/main/AndroidManifest.xml` — `FOREGROUND_SERVICE_MEDIA_PLAYBACK` + service
- `android/app/build.gradle` — 引入 aar + `androidx.media:media:1.7.0`

## 事件 / 方法契约（原生 → JS）

事件（`DeviceEventEmitter`）：
- `onMpvStateChanged { state }` — `idle|buffering|playing|paused|ended|error`
- `onMpvProgress { position, duration, buffered }`（秒）
- `onMpvEnded { reason: "end", autoAdvanced?: boolean }` — 自然播放结束（用户 stop 不触发）；
  `autoAdvanced=true` 表示 mpv 已经自动切到 JS 指定的 prepared next。
- `onMpvError { message, code? }`
- `onMpvRemoteCommand { command, position? }` — 来自 MediaSession 锁屏控制

方法：`initialize / loadAndPlay / prepareNext / updateMetadata / pause / resume / stop / seekTo /
setVolume(0-1) / setRate / getIsPlaying / getPosition / getDuration / destroy`。

## 启用方式

设置 → 基础设置 → **播放内核** → 选 `mpv（实验性）` → **重启 App** 生效。
（仅在 Android 且已构建含 mpv 原生模块的包时出现该选项。未构建时选了 mpv，`setup()` 会抛清晰错误。）

## 构建

```bash
# 依赖（已配 flatDir libs，aar 已就位）
cd android && ./gradlew assembleRelease
```

注意：libmpv 的 `.so` 单 ABI 约 **5.7MB**（`libmpv.so`）。项目已开启 ABI 拆分，
所以**每个单 ABI 的 APK 只增大约 6MB**；`universal`（含所有 ABI）的包才会显著变大。
如需进一步瘦身可自行裁剪构建 libmpv。当前回归以 `assembleRelease` 为准，签名配置来自
`android/keystore.properties`；已验证 release APK 正确打包 `libmpv.so`/`libplayer.so`，
无 `libc++_shared.so` 冲突，并可覆盖安装到真机。

**minSdk**：libmpv aar 要求 `minSdk≥26`，而项目全局 minSdk=24。为不牺牲 Android 7.x 用户，
manifest 用 `tools:overrideLibrary="dev.jdtech.mpv"` 放行，保持全局 24；同时设置里的「播放内核」
选项**仅在 Android 8.0+（`Platform.Version>=26`）出现**，确保老设备不会加载 libmpv 的 .so。

## 已对齐能力

**批次一（队列与基础播放）**
- 队列/切歌/repeat/shuffle 通过 `syncQueueOrder` 与 UI 列表对齐。
- 当前分支已完成代码级修复、release 构建和真机覆盖安装验证。MPV 通知播放/暂停、进度推进、
  seek、上一首/下一首、重启恢复暂停、曲尾 seek 后进入下一首，以及列表循环自然曲尾自动下一首
  均已在设备 `A4UF6R6317000876` 验证。

**批次二（系统交互对齐 Nitro）**
- **音频焦点**：来电/其他 App 抢占 → 暂停（临时丢失，焦点恢复后续播）；通知音 → 闪避降到 30%。
- **拔耳机/断蓝牙**：`ACTION_AUDIO_BECOMING_NOISY` → 自动暂停。
- **通知栏控制按钮**：上一首/播放暂停/下一首 显式 Action + 紧凑视图；状态栏图标改用应用图标。
- **锁屏/耳机键 上一首/下一首**：经 `onMpvRemoteCommand` → `playbackServiceObserver` → `TrackPlayer.skipTo*`，
  代码路径会走完整 App 逻辑（稍后播放队列、自动跳过不喜欢）。通知按钮已真机确认；全局媒体键会被系统路由到
  当前媒体会话，测试时需先让 `MusicFreeMpv` 成为媒体键会话，避免被其他播放器抢走。
- **后端隔离**：Nitro 与 MPV adapter 都延迟加载；切到 MPV 重启后 MusicFree 只保留 `MusicFreeMpv`
  session，切到 Nitro 重启后只保留 `androidx.media3.session.id` session。

## 2026-06-29 当前代码状态补充

本文件最初记录的是已丢失实现的目标形态。当前 `feat/mpv-player` 分支已重新按同一
`PlayerAdapter` 架构补回 MPV 后端，并完成 release 构建、覆盖安装和基础真机验证；以下条目区分
「已补齐/已验证」与「仍需专项产品化验证」。

本轮补齐后，MPV 后端已覆盖 MusicFree 当前使用到的 Nitro 播放表面：播放/暂停/seek/倍速/音量、
队列同步、JIT 音源回填、repeat/shuffle、prepared-next/gapless 预备、通知/锁屏控制、音频焦点、
闪避配置、缓冲进度、停止/关闭通知，以及重启恢复队列但不自动播放的 `autoPlay=false` 语义。
需要注意：基础链路和本轮 ASF/M4A/WMA 样本已经真机通过，但焦点抢占和复杂队列策略仍必须继续专项回归。

## 已知保留项 / 未来项

- [x] **无缝接续（gapless）代码路径**：新增 `prepareNextTrack` adapter hook；TrackPlayer 只把应用层已确认的
      下一首交给 MPV，原生用 mpv playlist 追加单个 prepared next，并在 `autoAdvanced` 后同步 JS 当前曲。
      原生会记录 prepared next 的 playlist index，并在自动前进后清理历史项，避免 repeat/play-later 撤销预载时删错。
      真机已验证曲尾 seek 后不会卡死并可进入下一首；WMA 自然曲尾在列表循环中可自动进入下一首；
      仍需专项量化实际曲间空隙、不同 header/userAgent 音源、
      单曲循环和 play-later 场景。
- [x] **锁屏封面 bitmap**：`MpvPlaybackService` 会下载/解码 artwork，并写入 MediaSession metadata / notification large icon。
- [x] **通知小图标**：新增 `ic_stat_musicfree` 单色状态栏图标，MPV 通知不再使用 launcher 图标。
- [x] **通知关闭按钮**：`basic.showExitOnNotification` 会透传为 MPV 通知 stop action；stop/reset 后会取消陈旧通知。
- [x] **Android Auto / 车机**：当前 Nitro 配置也是 `androidAutoEnabled: false`，MPV 返回未连接，不构成当前使用面差距；真正车机支持另开产品化任务。
- [x] **多歌单原生管理**（queueInfo 系列）：MPV 侧已补单队列 queueInfo / queue changed 事件 / add-remove-reorder 的 Adapter 表面；
      当前仍不产品化多歌单 UI，与 Nitro 当前 MusicFree 使用面保持一致。
- [x] **均衡器**：两后端当前都是 no-op 外壳，不构成当前差距；将来 Nitro DSP 接好后，mpv 需走 `af=...` 滤镜单独接。
- [x] **闪避细粒度配置**：MPV 初始化读取 `basic.tempRemoteDuck` / `basic.tempRemoteDuckVolume`；
      `AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK` 可按设置暂停或降低音量，并在焦点恢复时恢复。
- [x] **缓冲进度 / 进度节流**：MPV 观察 `demuxer-cache-duration` 并向 JS / MediaSession 上报 `buffered`；
      `progressUpdateEventInterval` 会节流普通进度回调，关键状态强制上报。

## 真机回归清单

- [x] 基础：MPV 加载→播放→进度推进→暂停/续播/seek；通知上一首/下一首；曲尾 seek 后进入下一首。
- [x] 切换：设置页 Nitro ↔ MPV，重启后 MediaSession/通知后端正确，状态恢复为 paused；全局媒体键在两个后端均可播放/暂停。
- [x] 格式样本：ASF (`Alice Deejay - Back In My Life.asf`)、M4A (`snoop_try.m4a`)、
      WMA (`Bangles 01 - Walk Like An Egyptian.wma`) 在 MPV 后端可本地播放，position 推进且无播放错误。
- [x] repeat：列表循环真实队列中自然曲尾可自动切到下一首并保持 `PLAYING`。
- [ ] 基础扩展：倍速/音量、长时间自然曲尾的 gapless 空隙量化。
- [ ] 音源 JIT：下一首 URL 未预解析时 `tracksNeedUpdate`→`updateTrack` 回填续播。
- [ ] repeat/shuffle：单曲循环、列表末尾回绕、随机顺序与 UI 一致。
- [ ] 本地音乐/特殊格式扩展：DFF、flac、wav、WMA Pro/Lossless/Voice 等旧实现踩坑处。
- [ ] 音频焦点：来电、其他 App 放音、通知音（闪避）；拔耳机暂停。
- [ ] 通知/锁屏：按钮可见可用；上一首/下一首走 play-later/拉黑跳过；关闭按钮能停止并清掉通知。
- [ ] 后台/息屏存活；切换内核 mpv↔nitro + 重启后状态恢复。

真机回归参照 memory 里的 device-regression workflow（adb + UIAutomator）。

## 不在本次范围

- **iOS**：libmpv 需单独为 iOS 构建并接 AVAudioSession，工作量翻倍，本次仅 Android。
- libmpv 自构建/裁剪：先复用 dev-mpv1 的预编译 aar。
