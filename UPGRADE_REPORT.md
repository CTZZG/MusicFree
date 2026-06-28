# MusicFree 升级报告：Nitro 1.4.3 + libmpv v1.0.0

**日期**：2026-06-28  
**目标**：升级 react-native-nitro-player 和 libmpv-android 到最新版本  
**状态**：✅ **编译构建成功，待真机验证**

---

## 📊 升级概览

### 阶段一：react-native-nitro-player 1.4.1 → 1.4.3 ✅

| 项目 | 旧版本 | 新版本 | 状态 |
|---|---|---|---|
| npm 包版本 | 1.4.1 | **1.4.3** | ✅ 已升级 |
| 项目 patch 行数 | ~1100 | ~1100 | ✅ 完全兼容 |
| 编译结果 | - | BUILD SUCCESSFUL | ✅ 通过 |

**新增功能**：
- 支持自定义 Android 通知小图标（`notificationSmallIconResName`）
- Bug 修复和性能优化

**Patch 内容保留**：
- ✅ DSF/DFF extractor（自定义 DSD 音频支持）
- ✅ WMA extractor（ASF 容器 + WMA 编解码）
- ✅ 音源请求头注入（`MusicFreePlayerExtensions`）
- ✅ ExoPlayer ffmpeg 扩展集成
- ✅ MediaSession 增强（shutdown action, session activity）

**修复问题**：
- 添加缺失的常量定义：`ACTION_SHUTDOWN`, `SESSION_ACTIVITY_REQUEST_CODE`

---

### 阶段二：libmpv 实例化重构 ✅

**背景**：v1.0.0 API 从静态方法改为实例方法，需要重构代码以适配新 API。

**代码改动统计**：
- 文件：`android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlayerModule.kt`
- 改动行数：**35+ 处静态调用 → 实例调用**
- 新增字段：`private var mpv: MPVLib? = null`

**改动清单**：

| 方法区域 | 改动描述 | 改动数 |
|---|---|---|
| 类字段 | 新增 `mpv` 实例字段 | 1 |
| `initialize()` | `mpv = MPVLib.create()` + 配置/观察属性 | 14 |
| `destroy()` | `removeObserver` + `destroy` + `mpv = null` | 4 |
| `loadAndPlay()` | 设置选项 + 加载文件 + 播放 | 3 |
| `pause()`/`resume()`/`stop()` | 控制命令 | 3 |
| `seekTo()`/`setVolume()`/`setRate()` | 属性设置 | 3 |
| `handleAudioFocusChange()` | 音频焦点处理（闪避/恢复） | 5 |
| `registerNoisyReceiver()` | 拔耳机暂停 | 1 |
| `event()` | 获取错误信息 | 1 |

**常量路径更新**：
```kotlin
// 旧 API（静态）
MPVLib.MPV_FORMAT_FLAG
MPVLib.MPV_EVENT_SHUTDOWN

// 新 API（v1.0.0 嵌套类）
MPVLib.MpvFormat.MPV_FORMAT_FLAG
MPVLib.MpvEvent.MPV_EVENT_SHUTDOWN
```

---

### 阶段三：libmpv-android 升级到 v1.0.0 ✅

| 项目 | 旧版本 | 新版本 | 变化 |
|---|---|---|---|
| aar 文件 | `libmpv-release-old-20260628.aar` | `libmpv-release.aar` | - |
| aar 大小 | 43 MB | **46 MB** | +3 MB |
| ffmpeg 版本 | 6.x/7.x（推测） | **8.1** | 大版本升级 |
| mpv 版本 | 0.3x（推测） | **0.41.0** | 大版本升级 |
| 发布日期 | 2026-06-27（自编译） | 2026-04-08（官方） | upstream |

**核心库版本**（v1.0.0）：
- **ffmpeg 8.1**（2024-09 release）
- **mpv 0.41.0**（2024-11 release）
- dav1d 1.5.3（AV1 视频解码）
- libplacebo 7.360.1（GPU 渲染 + HDR tone mapping）

**libmpv.so 文件大小**（per ABI）：
- arm64-v8a: **6,477,048 bytes (~6.2 MB)**
- armeabi-v7a: ~5.8 MB（预估）

**API 破坏性变更**：
1. **静态方法 → 实例方法**：所有 `MPVLib.xxx()` 需要通过实例 `mpv.xxx()` 调用
2. **常量命名空间**：`MPV_FORMAT_*` / `MPV_EVENT_*` 移入嵌套类

---

## 🔧 构建产物

### APK 文件清单

```
android/app/build/outputs/apk/release/
├── app-arm64-v8a-release.apk      40 MB   ⭐ 推荐真机测试
├── app-armeabi-v7a-release.apk    38 MB
├── app-x86_64-release.apk         41 MB
├── app-x86-release.apk            41 MB
└── app-universal-release.apk     100 MB   (含所有 ABI)
```

### 编译日志摘要

```
BUILD SUCCESSFUL in 1m 14s
1384 actionable tasks: 123 executed, 1261 up-to-date

⚠️  警告：仅 deprecation warnings（无错误）
✅  Kotlin 编译通过
✅  libmpv.so 正确打包到 APK
✅  签名完成
```

---

## ✅ 已验证项目（编译时）

- [x] npm 包升级成功（`react-native-nitro-player@1.4.3`）
- [x] patch 重新应用无冲突
- [x] libmpv v1.0.0 aar 替换成功
- [x] Kotlin 代码编译通过（mpv 实例化重构）
- [x] 常量路径更新正确（`MpvFormat` / `MpvEvent`）
- [x] APK 打包成功，libmpv.so 正确包含
- [x] 文件大小合理（arm64 APK: 40 MB）

---

## 🧪 待真机验证项目

### 1. mpv 内核基础功能

- [ ] **初始化**：切换到 mpv 内核 + 重启 App，无崩溃
- [ ] **基础播放**：加载 → 播放 → 暂停 → 续播
- [ ] **进度控制**：seek、获取当前位置、总时长
- [ ] **倍速/音量**：setRate / setVolume 生效

### 2. 格式兼容性测试（对标 Nitro）

**无损格式**：
- [ ] **DSF/DFF（重点）**：DSD 音频，旧版有专门 patch，v1.0.0 ffmpeg 8.1 可能原生支持更好
- [ ] **FLAC**：常见无损格式
- [ ] **APE**：猴子音频
- [ ] **WAV**：未压缩 PCM

**有损格式**：
- [ ] MP3（基准格式）
- [ ] AAC/M4A
- [ ] OGG Vorbis
- [ ] **WMA**（重点）：Nitro 有自定义 extractor，mpv 是否同样支持

**在线流**：
- [ ] HTTP/HTTPS 直链
- [ ] m3u8/HLS 流
- [ ] 带自定义请求头的音源（`userAgent`, `headers`）

### 3. 系统交互功能

**音频焦点**：
- [ ] **来电**：播放中接到来电 → 自动暂停 → 挂断后不自动续播（永久丢失）
- [ ] **通知音**：播放中收到通知 → 闪避降到 30% → 通知结束恢复原音量（LOSS_TRANSIENT_CAN_DUCK）
- [ ] **其他播放器**：打开其他音乐 App → 自动暂停（永久丢失焦点）

**拔耳机/断蓝牙**：
- [ ] 播放中拔出耳机 → 自动暂停（`ACTION_AUDIO_BECOMING_NOISY`）
- [ ] 播放中断开蓝牙 → 自动暂停

**锁屏/通知栏控制**：
- [ ] 通知栏显示：封面、标题、艺术家、进度
- [ ] 通知栏按钮：上一首/播放暂停/下一首可用
- [ ] **上一首/下一首走完整 App 逻辑**（通过 `onMpvRemoteCommand` → `playbackServiceObserver` → `TrackPlayer.skipTo*`）
  - [ ] 跳过稍后播放队列的歌曲
  - [ ] 跳过不喜欢的歌曲
- [ ] 锁屏控制：与通知栏一致
- [ ] 封面显示：Bitmap 已正确加载（之前修复的异步加载逻辑）

**后台播放**：
- [ ] 息屏后继续播放
- [ ] 切换到其他 App 后台播放
- [ ] 前台服务保持存活

### 4. 队列与切歌逻辑

- [ ] 手动切歌：上一首/下一首
- [ ] 自动切歌：播放结束自动下一首（`onMpvEnded` → JS 队列逻辑）
- [ ] Repeat 模式：单曲循环、列表循环、顺序播放
- [ ] Shuffle：随机播放顺序与 UI 一致
- [ ] 音源 JIT：下一首 URL 未预解析时 `tracksNeedUpdate` → `updateTrack` 回填续播

### 5. 错误处理

- [ ] 无效 URL：上报错误事件 `onMpvError`
- [ ] 网络超时：正确处理并上报
- [ ] 不支持的格式：上报错误而非崩溃
- [ ] 解码失败：播放错误时 `playback-error` 属性正确获取

### 6. 内核切换

- [ ] mpv → Nitro：切换后 Nitro 正常播放
- [ ] Nitro → mpv：切换后 mpv 正常播放
- [ ] 重启后状态恢复：记住上次选择的内核

---

## 🔍 重点关注项

### DSF/DFF 格式验证（最高优先级）

**原因**：
- 旧 `dev-mpv1` 分支有专门的 DSF 修复 patch
- 新 v1.0.0 是 upstream 干净构建，可能缺少该 patch
- **但** ffmpeg 8.1 + mpv 0.41 可能原生支持已足够好

**验证方法**：
1. 准备测试文件：DSF（DSD64/DSD128）、DFF 各 1-2 个
2. mpv 播放，观察：
   - 是否正常加载（无崩溃）
   - 音质是否正常（无爆音/杂音）
   - 进度是否准确
3. 对比 Nitro 播放同样文件，音质/行为是否一致

**如果失败**：
- 选项 1：回退到旧 aar（43MB 那个）
- 选项 2：从 `dev-mpv1` 提取 DSF patch，在 v1.0.0 上重新应用
- 选项 3：继续用 v1.0.0，DSF 格式走 Nitro 内核

### WMA 格式验证

**原因**：
- Nitro 有你的 1100 行 patch，包含完整的 WMA extractor（ASF 容器解析 + WMA 编解码）
- mpv 0.41 + ffmpeg 8.1 理论上也支持 WMA，但行为可能不同

**验证**：
- WMA v1/v2（常见）
- WMA Pro/Lossless（高级编码）
- 对比 Nitro，音质/稳定性

---

## 📱 真机测试步骤

### 1. 安装 APK

```bash
adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

### 2. 切换到 mpv 内核

1. 打开 MusicFree App
2. 进入「设置」→「基础设置」
3. 找到「播放内核」选项（仅 Android 8.0+ 显示）
4. 选择「mpv（实验性）」
5. **重启 App**（必须）

### 3. 播放测试

**快速验证**：
- 播放任意在线歌曲（MP3）→ 确认 mpv 初始化成功
- 检查进度条、暂停/播放、seek 是否正常
- 锁屏查看通知栏显示

**格式测试**：
- 本地音乐 → DSF/DFF 文件（如果有）
- 在线 WMA 音源（如果有）
- FLAC、APE 等无损格式

**系统交互**：
- 播放中拨打电话（测试音频焦点）
- 播放中拔耳机（测试自动暂停）
- 锁屏按「上一首」（测试远程控制走 App 逻辑）

### 4. 查看日志（如有问题）

```bash
# 清空日志
adb logcat -c

# 实时查看 mpv 相关日志
adb logcat | grep -E "MpvPlayer|mpv|MPV"

# 或保存到文件
adb logcat > mpv-test.log
```

---

## 🐛 已知问题与待办

### 与 Nitro 仍有差距的功能

来自 `docs/mpv-player-refactor.md` 第 100 行「仍与 Nitro 有差距」：

- [ ] **无缝接续（gapless）**：当前曲尾才 loadfile 下一首，切歌有空隙；可用 mpv playlist 预载
- [ ] **锁屏封面 bitmap 解码**：现已修复（本次升级前已完成）
- [ ] **通知小图标**：用的是应用图标，非单色状态栏专用图标
- [ ] **Android Auto / 车机**：未接入
- [ ] **多歌单原生管理**（queueInfo 系列）：未实现（当前 App 未调用）
- [ ] **均衡器**：两后端都是 no-op 外壳；mpv 需走 `af=...` 滤镜接入
- [ ] **闪避细粒度配置**：`basic.tempRemoteDuck` / `tempRemoteDuckVolume` 暂用固定 30%
- [ ] **缓冲进度**：mpv 上报 `buffered=position`，进度条无缓冲预览

### 可能的风险点

1. **DSF/DFF 原生支持**：v1.0.0 可能缺 dev-mpv1 的 patch，需实测
2. **内存占用**：ffmpeg 8.1 更大，观察内存是否有压力
3. **兼容性**：mpv 0.41 行为与旧版可能有细微差异

---

## 📄 相关文件

**代码改动**：
- `android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlayerModule.kt`（35+ 处实例化改动）
- `node_modules/react-native-nitro-player/` + `patches/react-native-nitro-player+1.4.3.patch`（1100+ 行）

**二进制文件**：
- `android/app/libs/libmpv-release.aar`（46 MB，v1.0.0）
- `android/app/libs/libmpv-release-old-20260628.aar`（43 MB，旧版备份）

**构建产物**：
- `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`（40 MB）

---

## 🎯 下一步行动

1. ✅ **编译构建**（已完成）
2. 🔄 **安装到真机**（已执行 `adb install`）
3. ⏳ **真机验证**（待手动测试）：
   - 切换到 mpv 内核 + 重启
   - 播放基础测试（MP3）
   - **DSF/DFF 格式测试**（最高优先级）
   - 系统交互测试（音频焦点、拔耳机、锁屏）
4. 📝 **问题记录**（如有）：
   - 如 DSF 有问题 → 考虑回退或应用 patch
   - 如其他格式有问题 → 分析日志，对比 Nitro 行为
5. ✅ **正式发布**（验证通过后）

---

## 📞 支持与参考

**Upstream 项目**：
- react-native-nitro-player: https://github.com/riteshshukla04/react-native-nitro-player
- libmpv-android: https://github.com/jarnedemeulemeester/libmpv-android

**本地文档**：
- `docs/mpv-player-refactor.md`（mpv 接入架构文档）
- `src/core/playerAdapter/mpvPlayerAdapter.ts`（JS 适配器）
- `src/core/playerAdapter/nativeMpvPlayer.ts`（桥接契约）

---

**报告生成时间**：2026-06-28 21:54  
**编译状态**：✅ BUILD SUCCESSFUL  
**待验证**：真机测试（DSF/WMA 格式、系统交互）
