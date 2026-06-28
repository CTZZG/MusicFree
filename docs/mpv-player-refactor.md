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
- `src/core/playerAdapter/index.ts` — `resolvePlayerAdapter(name)`（mpv 懒加载）
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
- `onMpvProgress { position, duration }`（秒）
- `onMpvEnded { reason: "end" }` — 自然播放结束（用户 stop 不触发）
- `onMpvError { message, code? }`
- `onMpvRemoteCommand { command, position? }` — 来自 MediaSession 锁屏控制

方法：`initialize / loadAndPlay / updateMetadata / pause / resume / stop / seekTo /
setVolume(0-1) / setRate / getIsPlaying / getPosition / getDuration / destroy`。

## 启用方式

设置 → 基础设置 → **播放内核** → 选 `mpv（实验性）` → **重启 App** 生效。
（仅在 Android 且已构建含 mpv 原生模块的包时出现该选项。未构建时选了 mpv，`setup()` 会抛清晰错误。）

## 构建

```bash
# 依赖（已配 flatDir libs，aar 已就位）
cd android && ./gradlew assembleRelease
# 或调试包
./gradlew assembleDebug
```

注意：libmpv 的 `.so` 单 ABI 约 **5.7MB**（`libmpv.so`）。项目已开启 ABI 拆分，
所以**每个单 ABI 的 APK 只增大约 6MB**；`universal`（含所有 ABI）的包才会显著变大。
如需进一步瘦身可自行裁剪构建 libmpv。已验证：`assembleDebug` 成功，`libmpv.so`/`libplayer.so`
正确打包，无 `libc++_shared.so` 冲突。

**minSdk**：libmpv aar 要求 `minSdk≥26`，而项目全局 minSdk=24。为不牺牲 Android 7.x 用户，
manifest 用 `tools:overrideLibrary="dev.jdtech.mpv"` 放行，保持全局 24；同时设置里的「播放内核」
选项**仅在 Android 8.0+（`Platform.Version>=26`）出现**，确保老设备不会加载 libmpv 的 .so。

## 已对齐能力

**批次一（队列与基础播放）**
- 队列/切歌/repeat/shuffle 通过 `syncQueueOrder` 与 UI 列表对齐。
- 真机已验证：mpv 实际解码播放、进度推进、随机/顺序切歌正确。

**批次二（系统交互对齐 Nitro）**
- **音频焦点**：来电/其他 App 抢占 → 暂停（临时丢失，焦点恢复后续播）；通知音 → 闪避降到 30%。
- **拔耳机/断蓝牙**：`ACTION_AUDIO_BECOMING_NOISY` → 自动暂停。
- **通知栏控制按钮**：上一首/播放暂停/下一首 显式 Action + 紧凑视图；状态栏图标改用应用图标。
- **锁屏/耳机键 上一首/下一首**：经 `onMpvRemoteCommand` → `playbackServiceObserver` → `TrackPlayer.skipTo*`，
  **已走完整 App 逻辑**（稍后播放队列、自动跳过不喜欢）。

## 仍与 Nitro 有差距（第二批待办）

- [ ] **无缝接续（gapless）**：当前曲尾才 `loadfile` 下一首，切歌有空隙；可用 mpv playlist 预载下一首。
- [ ] **锁屏封面 bitmap**：现只传 artwork URI，未解码 bitmap，部分系统不显示封面
      （`MpvPlayerModule.updateMetadataFromPayload` 的 TODO）。
- [ ] **通知小图标**：用的是应用图标，非单色状态栏专用图标（`MpvPlaybackService` 的 TODO）。
- [ ] **Android Auto / 车机**：未接入。
- [ ] **多歌单原生管理**（queueInfo 系列）：未实现（当前 App 未调用，暂无影响）。
- [ ] **均衡器**：两后端当前都是 no-op 外壳；将来 Nitro DSP 接好后，mpv 需走 `af=...` 滤镜单独接。
- [ ] **闪避细粒度配置**：`basic.tempRemoteDuck`/`tempRemoteDuckVolume` 暂用固定 30%，未读用户配置。
- [ ] **缓冲进度**：mpv 上报 `buffered=position`，进度条无缓冲预览。

## 真机回归清单

- [ ] 基础：加载→播放→进度→结束自动下一首；暂停/续播/seek/倍速/音量。
- [ ] 音源 JIT：下一首 URL 未预解析时 `tracksNeedUpdate`→`updateTrack` 回填续播。
- [ ] repeat/shuffle：单曲循环、列表末尾回绕、随机顺序与 UI 一致。
- [ ] 本地音乐/特殊格式：DSF/DFF、flac、wma、wav（旧实现踩坑处）。
- [ ] 音频焦点：来电、其他 App 放音、通知音（闪避）；拔耳机暂停。
- [ ] 通知/锁屏：按钮可见可用；上一首/下一首走 play-later/拉黑跳过。
- [ ] 后台/息屏存活；切换内核 mpv↔nitro + 重启后状态恢复。

真机回归参照 memory 里的 device-regression workflow（adb + UIAutomator）。

## 不在本次范围

- **iOS**：libmpv 需单独为 iOS 构建并接 AVAudioSession，工作量翻倍，本次仅 Android。
- libmpv 自构建/裁剪：先复用 dev-mpv1 的预编译 aar。
