# 性能基线：冷启动、点歌到引擎开始推进、搜索（2026-10-14）

## 目的与做法

按计划的第 4 项，在固定配置的模拟器上记下几项关键耗时的中位数和 P95，只记录、不设门限，给以后的改动做对照。
工作分支 `claude/sharp-planck-xtfenm`，PR #38（草稿），基线 `feat/mpv-only` 的 `1c3553b8`（PR #37 合并后）。
不合并、不发 Release。

测了三件事：
- 冷启动到主页（“资料库”标签所在的标签栏）出现在屏幕上；
- 点歌到引擎开始推进：mpv 的 time-pos 第一次自然往前走，不等于扬声器出声；
- 搜索到第一个结果、到所有来源都返回。

测的过程中发现：每次冷启动都有约 1 秒花在系统等主窗口同步的超时上，用户实际看到主页比应用画出主页晚 1.6 秒左右。
见“冷启动”一节。

## 怎么测

- 应用把时间点写到 logcat（标签 `MusicFreePerf`，每行“名字 at=<墙钟毫秒> …”）。
  - 原生：`PerfMarks`。
  - JS：`NativeUtils.perfMark`。发布版会去掉 console，所以不用 console。
  - 这些时间点只写日志，不改变任何行为。
- 端到端第 23 步（`e2e/perf.sh`）：手动运行 Beta 构建时 `e2e_suite` 选 `perf`，不在 `all` 里。
  - 每项先跑 1 次预热（不计），再跑 10 次。
  - `e2e/lib/perf_stats.py` 解析，算中位数、P95（最近秩）、最小、最大。
  - 10 次时，最近秩的 P95 就是最大值。
- 检查项“失败”只表示没测出来（样本少于 8 个），不表示慢。
- 指标定义见 `e2e/README.md` 的“性能基线”一节。

应用写的时间点：

| 时间点 | 位置 | 含义 |
| --- | --- | --- |
| `process-start` | `MainApplication.onCreate` 开头 | 应用进程起来 |
| `first-screen` | 主页标签栏 `onLayout`（JS） | 标签栏排好版，这时开屏页还盖着 |
| `splash-hidden` | `SplashScreen.hideAsync()` 之后（JS） | 启动初始化做完，叫开屏页收起 |
| `first-draw` | `MainActivity` 内容视图第一次 `onDraw`（原生，记一次后移除） | 应用界面第一次画出来，开屏页还盖着 |
| `play-request` | `TrackPlayer.play` 开头（`skip=false` 是用户点的） | 点歌 |
| `track-load` | `setTrackSource` | 取到地址，交给播放器 |
| `engine-load` | 原生发出 `loadfile` 之前（带装载代次 `gen`） | 开始装载 |
| `engine-file-loaded` | mpv `FILE_LOADED` | 文件装好 |
| `engine-progress` | `EngineProgressMarker` | 这次装载后 time-pos 第一次以 0–1 秒的小步往前走（续播的大跳不算） |
| `search-start` / `search-first-result` / `search-done` | `SearchSession` | 搜索开始、第一个有结果的来源返回、所有来源第一页都返回 |

冷启动还用了系统的日志（`logcat -v epoch`）：
- 起点：ActivityTaskManager 的 “START u0 … cmp=fun.upup.musicfree/” 行；
- 系统认为窗口画好：“Displayed fun.upup.musicfree/…” 行；
- 主页出现在屏幕上：`SplashScreenView: remove starting view`（开屏页移除）。这是系统的调试日志，模拟器的 userdebug
  系统里有，user 版系统可能没有。

## 结果：Beta #145

[Beta #145](https://github.com/CTZZG/MusicFree/actions/runs/38582122132)：
- 模拟器 API 34、pixel_6、3 核、4 GB；
- APK 是 Beta #143 按 `aee24abd` 打的；测试脚本 `ef4bb950`，只改了测量，没改应用；
- 只跑 `perf`，26 项全部通过。

单位毫秒，各 10 次。

| 指标 | 中位数 | P95（=最大） | 最小 |
| --- | --- | --- | --- |
| **冷启动：到主页出现在屏幕上（开屏页移除）** | **2786** | 4050 | 2582 |
| 冷启动：系统报告的启动完成（TotalTime） | 2161 | 2679 | 2031 |
| 冷启动：应用画出主页（开屏页还盖着） | 1146 | 1655 | 1021 |
| 冷启动：主页标签栏在开屏页下排好版 | 1045 | 1628 | 947 |
| 冷启动：JS 叫开屏页收起 | 1139 | 1645 | 1016 |
| 冷启动：启动请求到应用进程起来 | 316 | 539 | 262 |
| 冷启动：画出主页到系统认为画好（Displayed） | 1006 | 1014 | 1004 |
| 冷启动：系统认为画好到开屏页移除 | 632 | 1387 | 543 |
| **搜索：到第一个有结果的来源返回** | **18** | 35 | 14 |
| 搜索：到所有来源第一页都返回 | 18 | 35 | 14 |
| **在线点歌：点歌到引擎开始推进** | **974** | 1414 | 391 |
| 在线点歌：点歌到取到地址交给播放器 | 47 | 144 | 17 |
| 在线点歌：loadfile 到文件装好（含下载） | 580 | 890 | 226 |
| 在线点歌：文件装好到开始推进 | 246 | 250 | 49 |
| **本地点歌：点歌到引擎开始推进** | **468** | 741 | 327 |
| 本地点歌：点歌到交给播放器 | 71 | 225 | 39 |
| 本地点歌：loadfile 到文件装好 | 96 | 154 | 60 |
| 本地点歌：文件装好到开始推进 | 185 | 489 | 132 |

同一个 APK 在 [Beta #143](https://github.com/CTZZG/MusicFree/actions/runs/38571684078)（另一台 GitHub 托管机器）上的中位数：

| 指标 | 中位数 |
| --- | --- |
| 应用画出主页 | 1050 |
| TotalTime | 2062 |
| 搜索到第一个结果 | 16 |
| 在线点歌到引擎开始推进 | 930 |
| 本地点歌到引擎开始推进 | 400 |

整体比 #145 快 5–15%。机器之间的差别就是这个量级，看趋势要看多次运行。

## 冷启动：用户看到主页比应用画出主页晚约 1.6 秒

Beta #143 的 10 次冷启动里，应用界面第一次画出来（`first-draw`）到系统报告启动完成（TotalTime）每次都差
1006–1033 ms。差得这么稳，像是一个定时器，不像是工作量。

于是加了冷启动追踪：冷启动统计之后再冷启动一次，不进统计。启动过程中在设备上连续截屏，同时留下窗口管理的日志。
截屏有开销，这一次比统计里慢，只看先后。
[Beta #144](https://github.com/CTZZG/MusicFree/actions/runs/38578327645) 的时间线（相对启动请求的毫秒数）：

| 时刻 | 事件 |
| --- | --- |
| +0 | 系统收到启动请求，开屏页（系统画的启动窗口）出现 |
| +323 | 应用进程起来（`process-start`） |
| +1346 / +1475 | 主页标签栏排好版、JS 叫开屏页收起 |
| +1491 | 应用画出主页（`first-draw`），开屏页还盖在上面 |
| +2492 | `SurfaceSyncGroup: Failed to receive transaction ready in 1000ms. Marking SurfaceSyncGroup(wmsSync-VRI[MainActivity]#0) as ready`，正好在 first-draw 之后 1000 ms |
| +2498 | 系统报 `Displayed …MainActivity: +2s507ms`（即 TotalTime），应用窗口拿到输入焦点 |
| +3606 | 开屏页交给应用（`SplashScreenView: Building from parcel`） |
| +3786 | 开屏页移除（`SplashScreenView: remove starting view`） |

截屏：
- 1–9（+18 到 +3988 ms）完全相同，都是开屏页（猫头标志）；
- 10–13（+4025 ms 起）完全相同，都是主页。

Beta #145 的追踪也是同样的顺序：first-draw +1432，同步超时 +2435，Displayed +2441，开屏页移除 +3435。截屏 1–10
（到 +3465 ms）是开屏页，11 起是主页。

结论：
- 用户看到主页是在开屏页移除之后，不是 first-draw。之前把 first-draw（#143 中位数约 1.05 秒）当作“主页可见”，
  量早了。从 `ef4bb950` 起，“主页出现在屏幕上”以开屏页移除为准，中位数 2786 ms。
- 应用画出主页之后还有两段：
  - 画出主页到系统认为画好：10 次都在 1004–1014 ms，就是同步等满 1000 ms 超时；
  - 系统认为画好到开屏页移除：中位数 632 ms。
  
  合起来约 1.6 秒，占冷启动的一半以上。
- 这是实际的启动延迟，不是测量误差。
- Beta 模拟器关了动画。真机上开屏页还要淡出（expo-splash-screen 默认 400 ms），主页完全显示还会更晚。

原因没有查实。已知：
- expo-splash-screen 56.0.14（`SplashScreenManager`）用自己的 `OnPreDrawListener` 撑住开屏页：JS 叫收起前，
  每一帧都取消绘制。`hide()` 只改一个标志，不主动请求重绘。
- 应用和原生依赖里都没有 SurfaceView、TextureView，可以排除“子 Surface 不出帧拖住同步”。
- 搜索没有找到这个现象的已知报告。

可能的原因：系统（Android 14）请求主窗口同步时，这一帧正被取消，之后画出的帧没有算进这次同步，于是等到超时。
系统认为画好之后到开屏页移除的约 0.6 秒也没有拆开看。

要验证，需要打几个对照 APK，在同一配置上量“画出主页到 Displayed”和“Displayed 到开屏页移除”。可以对照的做法：
- 不撑开屏页；
- `hide()` 后主动 `invalidate`；
- 改用 androidx 的 `setKeepOnScreenCondition`。

这是产品改动，留给用户决定。

## 其他观察

- 搜索 14–35 ms：测试源是本地数据，不走网络，测的是应用和插件运行时本身的开销；真实插件还要加上网络。
- 在线点歌约 1 秒，大头是 loadfile 到文件装好（中位数 580 ms，含从 raw.githubusercontent.com 下载）。
- 本地点歌约 0.5 秒：取地址、装载、开始推进三段的中位数分别是 71、96、185 ms。
- 取地址（点歌到交给播放器）中位数 47–71 ms，P95 到 144–225 ms。JS 侧的开销不大，但波动明显。

## 本地验证

在 `ef4bb950` 上跑：
- `npm run verify` 通过：
  - 188 个测试文件、1389 项 Jest；
  - TypeScript；
  - ESLint 警告不超过各规则的基线；
  - 生成器单元测试、布局（Yoga）测试、patch-package 重放。
- 本 PR 新增的 Jest：`searchSessionPerfMarks`（4 项）、`perfMark`（3 项）。
- 原生单元测试 `EngineProgressMarkerTest`（3 项）在 PR CI 的 Android 单元测试里跑。
- `python3 -I e2e/lib/perf_stats.py --self-test` 通过（PR CI 和 Beta 都跑）：
  - 冷启动、点歌、搜索的解析；
  - 缺时间点、顺序不对、读到上一次启动、开屏页移除早于 JS 叫收起都判测不出；
  - 追踪的时间线和截屏转换。
- `shellcheck -x e2e/perf.sh` 无警告。

PR 上 Android 16 的 `emulator` 检查（仪器测试，不跑性能基线）出过两次失败，见 PR #38 的评论：
- `aee24abd` 上一次 `SOURCE_REWIND` 超出 6 ms，重跑通过；
- `ef4bb950` 上一次 `SlowQualityLoadingTest` 初始播放 12 秒超时。

被测的产品代码与通过的 `c7ef2e61` 完全相同。基线分支上的对照运行和后续推送的结果见 PR。

## 没做 / 留给以后

- 没有测物理音频输出（扬声器出声）。
- 模拟器数字只能和同一配置比，不能当真机耗时；GitHub 托管机器之间也有差异，看趋势要看多次运行。
- 冷启动是进程被杀后的启动，系统文件缓存是热的。
- 不设门限：要设的话，先在同一配置上多跑几次，看清波动再定。
- 开屏页那 1.6 秒怎么省：见上面，等用户决定。
- 测试过程中的旁证：Beta #140 一次搜索没找到插件，#141、#142 没有复现。插件状态诊断（`perf_plugin_state`）
  保留在第 23 步里，原因不明。
