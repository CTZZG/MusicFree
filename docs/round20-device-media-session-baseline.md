# Round 20 Device Media Session Baseline

更新时间：2026-06-05

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文记录设备上的 Nitro / MediaSession 基线。早期段落保留并存期安装包证据；当前 RNTP v4 删除决策以 `docs/round20-restart-anchor.md` 为准。

## 设备和安装包

- 设备：`A4UF6R6317000876`
- 包名：`fun.upup.musicfree`
- versionName：`0.6.4-beta.1`
- versionCode：`400012`
- lastUpdateTime：`2026-06-04 10:02:56`
- 当时 package 里同时存在：
  - Nitro Media3 service：`com.margelo.nitro.nitroplayer.media.NitroPlayerPlaybackService`
  - 旧 RNTP service：`com.doublesymmetry.trackplayer.service.MusicService`

## 初始状态

命令：

```powershell
adb devices
adb shell pm list packages fun.upup.musicfree
adb shell pidof fun.upup.musicfree
adb shell dumpsys media_session
```

观察：

- 设备在线。
- MusicFree 已安装。
- 启动前 `pidof fun.upup.musicfree` 没有进程。
- 启动前 `dumpsys media_session` 没有 MusicFree session。

## 启动后 session

命令：

```powershell
adb shell am start -n fun.upup.musicfree/.MainActivity
adb shell dumpsys media_session
adb shell uiautomator dump /sdcard/musicfree-window.xml
adb exec-out cat /sdcard/musicfree-window.xml
```

观察：

- MusicFree 进程存在。
- 出现 Media3 session：`fun.upup.musicfree/androidx.media3.session.id./438`
- `active=true`
- `state=PAUSED`
- `active item id=0`
- metadata：`山听雨, 羽肿, 山听雨`
- queue size：`58`
- 底部播放按钮 UIAutomator bounds：`[954,2627][1076,2749]`

注意：启动后直接执行 `adb shell cmd media_session dispatch play` 没有把 MusicFree 拉到 `PLAYING`，当时系统还唤出了另一个播放器 session。结论是：在 MusicFree 尚未成为 `Media button session` 前，`dispatch play` 不适合作为首个启动播放动作。本轮改用 UIAutomator 真实 bounds 点击底部播放按钮中心点 `1015,2688`。

## 播放和系统下一首

命令：

```powershell
adb shell input tap 1015 2688
adb shell dumpsys media_session
adb shell cmd media_session dispatch next
adb shell dumpsys media_session
```

观察：

- 点击播放后 MusicFree 进入 `PLAYING`。
- `Media button session` 指向 MusicFree。
- 播放开始时：
  - `active item id=0`
  - metadata：`山听雨, 羽肿, 山听雨`
  - queue size：`58`
- 系统下一首后：
  - `active item id=1`
  - metadata：`巅峰, David Frank@Unisonar, 第五人格, Identity V E-Sports-SRE战队`
  - `state=PLAYING`
  - queue size 仍为 `58`

结论：本轮观察到系统 `cmd media_session dispatch next` 可以让 Nitro/Media3 原生队列从 item `0` 推进到 item `1`，且保持播放。

## 自然结束和误跳观察

继续观察：

- item `1` 播放后自然推进到 item `2`。
- item `2` metadata：`朋友还是恋人, 杜宣达, 朋友还是恋人`
- item `2` 保持 `PLAYING`，没有几秒内误跳。
- 继续观察后 item `2` position 正常推进到约 `198943 ms`，仍是 item `2`。
- 发送 pause 前，item `2` 又自然推进到 item `3`。
- 最终暂停确认：
  - `state=PAUSED`
  - `active item id=3`
  - metadata：`希望你，真的很快乐, 饭角, ZIMA芝麻酱, 广播剧《希望你，真的很快乐》歌曲`
  - queue size：`58`

结论：

- 本轮观察到一次系统下一首：`0 -> 1`。
- 本轮观察到至少两次 Nitro/Media3 原生自然推进：`1 -> 2`、`2 -> 3`。
- 本轮没有复现“播放几秒就误跳下一首”。

## 仍不能宣称完成的范围

这次只覆盖了当前设备当前队列上的 MediaSession 基线。仍未覆盖：

- 强停重开恢复。
- 通知栏按钮完整矩阵。
- 蓝牙按键。
- 播放详情页和歌词页回归。
- M4A/AAC、M4A/ALAC、WMA/ASF、DSF、MP3/FLAC/OGG 格式矩阵。
- 本地文件和 HTTP URL 的格式样本。
- WMA/ASF extractor/sample 输出。

下一步不要继续写 JS 下一秒策略。如果后续再出现下一曲异常，按 `docs/round20-restart-anchor.md` 中的 queue / URL / `tracksNeedUpdate` / `onChangeTrack(reason=end)` 顺序定位。

## DSF 设备样本记录

用户设备上存在 DSF 样本：

- `/sdcard/music/神様になった日.dsf`
- 文件大小：`172933312`
- header 观察：`DSD ` offset `0`，`fmt ` offset `28`，`data` chunk 在约 `80` 附近
- channel count：`2`
- DSD sample rate：`2822400`
- bits per sample：`1`
- block size per channel：`4096`

旧构建测试观察：

- 通过 `ACTION_VIEW file:///sdcard/music/...dsf` 能进入 MusicFree 本地播放路径。
- Nitro/Media3 MediaSession 显示 `PLAYING`。
- duration/buffered 约 `245082ms`。
- position 会推进，pause/play/fast-forward 可操作。
- logcat 未看到明显 `Invalid DSF`、`ExoPlaybackException`、`Source error`。
- 用户确认实际没有声音。

当前构建测试观察：

- 参考 `CTZZG/jellyfin-androidx-media` 后，当前构建改为 legacy FFmpeg4 native base + Media3 JNI wrapper。
- wrapper 对 DSD decoder 设置 raw sample rate/channel layout，并把高采样率输出重采样到 48k。
- 2026-06-04 用户真机确认：当前安装包播放 DSF 已经能听到声音。
- `dumpsys media_session` 仍观察到 DSF 播放时 position 字段可能不连续刷新，例如停在 `17`，但播放本身已有用户听感确认。

结论：

- 不能再把 DSF 判为“pipeline 进入但无声”；本地 DSF 基础可听播放已通过。
- MediaSession position 上报异常需要作为后续观察点处理，不应推翻真实有声结论。
- DSF 还没有完成 Gate 3：仍需验证 duration UI、seek、后台播放、强停恢复和更多 DSF 样本。DFF/DSDIFF 当前已退出本地扫描支持口径，只保留诊断。

## 搜索结果点击播放回归

2026-06-05 在设备 `A4UF6R6317000876` 上安装最新 release 包后补测搜索结果点击播放：

- versionName：`0.6.4-beta.1`
- versionCode：`400012`
- lastUpdateTime：`2026-06-05 05:44:28`
- APK：`android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
- APK size：`31747773` bytes
- 搜索词：`love`
- 点击结果：`Love will live forever` / `A-Lin` / `天生歌姬`

trace 关键链路：

- `TrackPlayer.playWithReplacePlayList before play`
- `TrackPlayer.play start`
- `TrackPlayer.play getMediaSource end`，`hasSource=true`
- `获取音源成功`
- `NitroPlayer.loadQueue`，`count=50`，`startIndex=0`
- `NitroPlayer.play`
- `TrackPlayer.playWithReplacePlayList end`

MediaSession 观察：

- `state=PLAYING`
- position 继续推进，例如 `10865ms`
- buffered position 约 `107624ms`
- metadata：`Love will live forever, A-Lin, 天生歌姬`
- queue size：`50`

结论：

- 搜索结果 `playWithReplacePlayList()` 路径已在该安装包修复并通过一次真机验证。
- 当时阻塞点是搜索结果对象被冻结后，旧 `playWithReplacePlayList()` 直接写 Symbol 字段导致 async reject；现在改为克隆队列项并记录错误 trace。
- 2026-06-05 同日又复现搜索结果点击无反应，本机 adb 未识别设备，无法抓当前 trace。离线定位到 `playMusic` 分支仍会通过 `TrackPlayer.play()` -> `addAll()` 写冻结搜索结果对象，`setCurrentMusic()` 也可能补 artwork 时写原对象；当前已在 `src/core/trackPlayer/index.ts` 追加不可变克隆修复，并通过 `npx tsc --noEmit --pretty false`、`npm run audit:round20-static`、`:app:assembleRelease -PmusicfreeEnableNitroFfmpeg=true`。这个追加修复尚未装机验证。
- 如果后续再复现搜索结果点击无反应，先查点击设置是 `playMusic` 还是 `playMusicAndReplace`，并看 `trace-log.log` 是否有 `SearchResult.musicItem press`、`TrackPlayer.playWithReplacePlayList error`、`TrackPlayer.play error`、`TrackPlayer.play getMediaSource end`、`NitroPlayer.loadQueue`，再看插件源或 Media3 错误。

## WMA/ASF 设备样本记录

2026-06-05 在设备 `A4UF6R6317000876` 上安装 WMA 实验 release 包：

- versionName：`0.6.4-beta.1`
- versionCode：`400012`
- lastUpdateTime：`2026-06-05 16:33:56`
- APK：`android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
- 当时构建参数：`-PmusicfreeEnableNitroFfmpeg=true -PmusicfreeEnableExperimentalWmaExtractor=true`；当前 WMA v2/ASF 已默认启用，显式实验开启参数不再需要。

样本：

- `/sdcard/music/Bangles 01 - Walk Like An Egyptian.wma`
- `/sdcard/music/Alice Deejay - Back In My Life.asf`

修复前关键失败：

- `Bangles 01 - Walk Like An Egyptian.wma` 曾进入 MediaSession `ERROR`。
- logcat：`FfmpegAudioRenderer error`、`musicfree_ffmpeg_legacy_jni: Error in avcodec_open2: Invalid argument`、`FfmpegDecoderException: Initialization failed.`
- 后续定位为 WMA FFmpeg4 decoder 需要完整 WAVEFORMATEX 参数；再下一轮暴露 direct input buffer 问题。

当前构建观察：

- Bangles：MediaSession `PLAYING`，duration/buffered 约 `205031ms`，position 推进，无 `avcodec_open2`、direct-buffer、`ExoPlaybackException` 或 `Source error`。
- Alice：MediaSession `PLAYING`，duration 约 `208498ms`，position 推进；pause 后 `PAUSED`，play + fast-forward 后仍 `PLAYING`，position 约 `110585ms`。
- logcat：AudioFlinger `createTrack_l` / `start output session`，44.1k 输入到 48k 输出。
- 用户确认：WMA/ASF 实际可听。

结论：

- WMA v2 / ASF 本地基础可听播放可标记为通过。
- 仍未完成 Gate 3 的 WMA 变体覆盖：WMA Pro/Lossless/Voice 样本未验收；WMA v2/ASF 的 HTTP 机器链路已在 2026-06-05 后续复测通过。
- 当前决策：WMA v2/ASF 默认启用；`-PmusicfreeEnableWmaExtractor=false` 是回滚开关，`musicfreeEnableExperimentalWmaExtractor=false` 仅作为旧脚本兼容禁用别名。

## M4A/ALAC 设备样本记录

2026-06-05 用户提供 FFmpeg ALAC 样本：

- URL：`https://samples.ffmpeg.org/A-codecs/lossless/ALAC/snoop_try.m4a`
- 本机路径：`D:\Downloads\snoop_try.m4a`
- 文件大小：`16415231` bytes
- 手机路径：`/sdcard/music/snoop_try.m4a`

样本审计：

- `npm run audit:round20-format-samples` 在 `MUSICFREE_FORMAT_SAMPLE_DIRS=D:\Downloads` 下输出 `MP4/M4A audio streams: snoop_try.m4a: codecs=alac scanned=16415231/16415231`。
- 审计脚本已改为读取 MP4 `stsd` sample entry，避免把 ALAC `.m4a` 误算为 AAC `.m4a`。

本地播放观察：

- MediaSession `PLAYING`
- metadata：`snoop_try.m4a, 未知歌手, 未知专辑`
- duration/buffered 约 `123158ms`
- position 从约 `11816ms` 推进到 `90000ms`
- pause 后 `PAUSED position=33919ms`
- play + fast-forward 后 `PLAYING position=51176ms`
- logcat：加载 `FfmpegAudioRenderer` 和 `libffmpegJNI.so`，AudioFlinger `createTrack_l` / `start output session`
- 未见 `DecoderInitializationException`、`ExoPlaybackException`、`Source error`、`UnrecognizedInputFormatException`
- 用户确认：该 ALAC 样本实际可听。

2026-06-05 安装 `lastUpdateTime=2026-06-05 17:24:23`、APK size `31751369` bytes 的追加修复包后，复测外部打开本地 ALAC：

- 旧问题：第一次打开 `/sdcard/music/snoop_try.m4a` 时实际能听到 ALAC，但界面仍显示上一首 `皇后大道东.dsf`。
- 定位：Nitro `loadQueue` 后旧 DSF 队列滞后的 `trackChanged` 事件会覆盖 JS 当前曲；同时外部打开同曲时旧 fast path 可能不强制刷新 native queue。
- 修复：Nitro backend 下 `forcePlay=true` 绕过当前曲 fast path；外部媒体打开用 `TrackPlayer.play(musicItem, true)`；`setCurrentMusic()` 持久化当前曲；Nitro `loadQueue` 后 5 秒内按目标曲 key 过滤旧队列滞后事件。
- 复测 trace：出现多条 `Nitro 队列切歌忽略`，旧 DSF event 被过滤；目标 `snoop_try.m4a` event 被接收。
- 复测 MediaSession：`state=PLAYING`，metadata `snoop_try.m4a, 未知歌手, 未知专辑`，position 推进，AudioFlinger output track 正常创建。

HTTP URL 入口观察：

- 旧构建直接 `ACTION_VIEW https://samples.ffmpeg.org/A-codecs/lossless/ALAC/snoop_try.m4a` 会被 App 当作本地文件处理，trace 报 `message="本地音乐不存在"`。
- 追加修复包中，HTTP/HTTPS 媒体 URL 已由本地插件识别为远程媒体，不再走 RNFS `stat()` / `exists()`；trace 显示 `网络音频播放`、`NitroPlayer.loadQueue` 和 `NitroPlayer.play`。
- logcat 看到 `FfmpegAudioRenderer`、`libffmpegJNI.so`、AudioFlinger `createTrack_l` / `start output`。
- 设备上在线播放该 FFmpeg samples URL 会间歇 `PLAYING` 后反复回到 `BUFFERING`，例如 position 到约 `19040ms`、buffered 约 `19969ms`，未见 decoder/source error。
- 结论：HTTP URL 入口和 ALAC decoder 链路已在后续复测通过；即使服务器返回 `Content-Type: audio/mpeg`，MediaSession 仍达到 `PLAYING`，系统 fast-forward 后恢复 `PLAYING`。

结论：

- M4A/ALAC 本地基础可听播放通过。
- 仍未完成 Gate 3 的普通 M4A/AAC 回归 smoke；ALAC 本地与 HTTP 基础链路已通过，ALAC 同曲后台/强停恢复可作为专项补充而非当前硬阻塞。

## 2026-06-05 Gate 1 / HTTP 复测记录

测试设备：`A4UF6R6317000876`

安装包：

- `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
- 当时构建参数：`-PmusicfreeEnableNitroFfmpeg=true -PmusicfreeEnableExperimentalWmaExtractor=true`；当前 WMA v2/ASF 默认启用。
- 安装时间：`lastUpdateTime=2026-06-05 21:50:01`

用户长测补充：

- 2026-06-05 用户反馈已连续使用数小时，通知栏、蓝牙、播放详情页、歌词页、长时间播放均未发现问题。

ADB Gate 1 复测：

- 系统媒体 pause/play：在 HTTP WMA `Bangles 01 - Walk Like An Egyptian.wma` 播放中执行 `adb shell cmd media_session dispatch pause` 后，MediaSession 从 `PLAYING` 进入 `PAUSED position=112193 error=null`；再执行 `dispatch play` 后回到 `PLAYING position=115325 error=null`。
- 系统媒体 fast-forward：在 HTTP ALAC `snoop_try.m4a` 播放中执行 `adb shell cmd media_session dispatch fast-forward`，MediaSession 短暂 `BUFFERING position=163974 error=null` 后恢复 `PLAYING position=164025`，后续继续推进到 `position=169826 error=null`。
- 强停重开：播放中执行 `adb shell am force-stop fun.upup.musicfree` 后 MediaSession 清空；随后 `adb shell monkey -p fun.upup.musicfree 1` 重开 App，无 `FATAL EXCEPTION` / `AndroidRuntime` / ReactNativeJS 崩溃。重开后 MediaSession 恢复为已保存队列的 `PAUSED position=0 error=null`，metadata 为 `后来的我们, 五月天, 自传`，queue size `103`。

HTTP 格式复测：

- WMA URL：`https://samples.ffmpeg.org/A-codecs/WMA/Bangles%2001%20-%20Walk%20Like%20An%20Egyptian.wma`
  - 启动方式：显式 MainActivity `ACTION_VIEW`。
  - 结果：MediaSession `PLAYING position=33231 buffered=205031 error=null`，metadata `Bangles 01 - Walk Like An Egyptian.wma`，AudioFlinger `createTrack_l` / `start output session`，未见 `ExoPlaybackException`、`Source error`、`avcodec_open2`、direct-buffer 错误。
- ASF URL：`https://samples.ffmpeg.org/asf-wmv/Alice%20Deejay%20-%20Back%20In%20My%20Life.asf`
  - 启动方式：force-stop 后显式 MainActivity `ACTION_VIEW`。
  - 结果：MediaSession `PLAYING position=43963 buffered=131942 error=null`，metadata `Alice Deejay - Back In My Life.asf`，position 连续推进，AudioFlinger 持续输出，未见 decoder/source/direct-buffer 错误。
- ALAC URL：`https://samples.ffmpeg.org/A-codecs/lossless/ALAC/snoop_try.m4a`
  - 启动方式：force-stop 后显式 MainActivity `ACTION_VIEW`。
  - 结果：MediaSession `PLAYING position=51985 buffered=123158 error=null`，metadata `snoop_try.m4a`，系统 fast-forward 后恢复 `PLAYING`，未见 decoder/source/direct-buffer 错误。

注意：

- Manifest 当前没有 `https` VIEW intent-filter；ADB 测试需要显式指定 `fun.upup.musicfree/.MainActivity`。如果希望浏览器/文件管理器直接把 HTTP 音频链接分发给 MusicFree，需要另行增加 `http/https` intent-filter 或提供 App 内测试入口。
- 本轮 ADB 只能证明 MediaSession、decoder、DataSource 和 AudioFlinger 链路正常；实际听感仍以用户设备侧确认为准。

## DSF 专项 seek / 强停记录

测试设备：`A4UF6R6317000876`

样本：

- `/sdcard/music/神様になった日.dsf`
- 启动 URL：`file:///sdcard/music/%E7%A5%9E%E6%A7%98%E3%81%AB%E3%81%AA%E3%81%A3%E3%81%9F%E6%97%A5.dsf`

测试方式：

```powershell
adb shell am force-stop fun.upup.musicfree
adb shell am start -n fun.upup.musicfree/.MainActivity -a android.intent.action.VIEW -d "file:///sdcard/music/%E7%A5%9E%E6%A7%98%E3%81%AB%E3%81%AA%E3%81%A3%E3%81%9F%E6%97%A5.dsf"
adb shell cmd media_session dispatch fast-forward
adb shell cmd media_session dispatch pause
adb shell cmd media_session dispatch play
adb shell am force-stop fun.upup.musicfree
adb shell monkey -p fun.upup.musicfree 1
```

观察：

- 打开后 MediaSession 为 `PLAYING position=0 buffered=2925 error=null`，metadata 为 `神様になった日.dsf, 未知歌手, 未知专辑`，queue size `1`。
- fast-forward 后仍为 `PLAYING position=26573 buffered=47132 error=null`。
- pause 后为 `PAUSED position=32541 buffered=62874 error=null`。
- resume 后回到 `PLAYING position=32547 buffered=62874 error=null`。
- 强停后 MusicFree Media button session 清空。

## Nitro-only release 安装 smoke

测试时间：2026-06-06

测试设备：`A4UF6R6317000876`

安装包：

- `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
- 文件大小：`29678118` bytes
- `versionName=0.6.4-beta.1`
- `versionCode=400012`
- `lastUpdateTime=2026-06-06 06:36:55`

包服务检查：

- package dump 中存在 `com.margelo.nitro.nitroplayer.media.NitroPlayerPlaybackService`
- package dump 中未出现旧 `MusicService` / `trackplayer` service

冷启动检查：

```powershell
adb install -r android\app\build\outputs\apk\release\app-arm64-v8a-release.apk
adb shell am force-stop fun.upup.musicfree
adb shell monkey -p fun.upup.musicfree 1
adb shell pidof fun.upup.musicfree
adb shell dumpsys media_session
```

观察：

- App 进程存在：`pid=28095`
- Media button session 指向 `fun.upup.musicfree/androidx.media3.session.id./532`
- MediaSession 为 Nitro/Media3 session，`active=true`
- 冷启动恢复状态为 `PAUSED position=0 buffered=5967 error=null`
- metadata：`10 - 東方之珠.dsf, 未知歌手, 未知专辑`
- queue size：`2`
- 近期 logcat 未见 `FATAL EXCEPTION`、`AndroidRuntime`、`ReactNativeJS` 崩溃

系统媒体 play 检查：

- `adb shell cmd media_session dispatch play`
- 结果：当前 DSF 队列进入 `PLAYING position=0 buffered=31425 error=null`
- metadata：`10 - 東方之珠.dsf, 未知歌手, 未知专辑`
- queue size：`2`

默认 WMA HTTP 检查：

```powershell
adb shell am force-stop fun.upup.musicfree
adb shell am start -n fun.upup.musicfree/.MainActivity -a android.intent.action.VIEW -d "https://samples.ffmpeg.org/A-codecs/WMA/Bangles%2001%20-%20Walk%20Like%20An%20Egyptian.wma"
```

观察：

- MediaSession：`PLAYING position=144287 buffered=205031 error=null`
- metadata：`Bangles 01 - Walk Like An Egyptian.wma, 未知歌手, 未知专辑`
- queue size：`1`
- 这次 APK 是默认 release 构建，没有传 `-PmusicfreeEnableExperimentalWmaExtractor=true`；该结果验证 WMA v2/ASF 默认启用路径生效。
- 近期 logcat 未匹配 `FATAL EXCEPTION`、`AndroidRuntime`、`ReactNativeJS`、`ExoPlaybackException`、`Source error`、`FfmpegDecoderException`、`UnrecognizedInputFormatException`、`direct byte buffers`、`avcodec_open2` 或 `No dsd`。
- launcher 重开后出现新的 MusicFree session，恢复为同一 DSF 的 `PAUSED position=0 buffered=14952 error=null`，queue size `1`。
- logcat 错误扫描未见 `FATAL EXCEPTION`、`AndroidRuntime`、`ReactNativeJS`、`ExoPlaybackException`、`Source error`、`DecoderInitializationException`、`FfmpegDecoderException`、`UnrecognizedInputFormatException`、`Invalid DSF`、`No dsd`、`avcodec_open2` 或 direct-buffer 错误。

结论：

- DSF 专项 seek/fast-forward、pause/play 和强停重开机器链路通过。
- DSF 的实际听感仍沿用用户前序确认：当前 legacy FFmpeg4 base + Media3 JNI wrapper 构建可听。
