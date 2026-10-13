# 模拟器自动测试（E2E）

在 Android 模拟器上装真正的 APK，像用户一样点界面、用媒体键切歌，检查界面与系统媒体会话的播放行为。
单元测试和布局测试管不到的播放链路（mpv、后台服务、通知栏/锁屏控制、插件取源）都靠这里兜底。

## 测了什么

| 检查 | 怎么判断 |
| --- | --- |
| 启动后进入首页 | 首页底部标签出现 |
| 通过链接安装插件 | `musicfree://install/<地址>` 弹出确认框，点“确认安装” |
| 搜索并依次点播三首歌 | `musicfree://search` 打开搜索页，点 A、B、C，播放条跟着换 |
| 前台播放 | 系统媒体会话里在播 C，4 秒内进度前进至少 2 秒 |
| 回到桌面后继续播放 | 同上 |
| 后台用媒体键切歌 | 连按两次“上一首”，依次切到 B、A（和通知栏、锁屏按钮走同一条路） |
| 回到应用后不跳回旧歌 | 回到应用 6 秒后仍在播 A，播放条显示 A |
| 播放失败后的提示 | 点一首取不到地址的歌，出现“播放未成功”，点开有“查找其他来源” |
| 后台播完自动接下一首 | 20 秒的短歌在后台播完后，自动播队列里的下一首 |
| 原来源失败时换到其他来源 | 测试源 A 取不到地址的歌，自动换到测试源 B 的同一首歌播放，播放页的来源标签写“改用E2E 测试源 B” |
| 不换成别的版本 | 测试源 B 只有 Live 版时不换，留下“播放未成功”提示 |
| 播放统计 | 设置 → 基本设置 → 播放统计里，测试源 A 记有换源播放、正好 2 次失败（Broken、Live Only） |
| 播放中切换音质 | 播放页点音质标签换成 320K：标签变成 HQ，媒体会话里还是 A，进度接着原来的往前走 |
| 切到取不到的音质 | 选测试源 A 没有的无损：标签保持 HQ，照常播 |
| 冷启动续播 | 暂停后 `am force-stop` 再打开：媒体会话（通知栏、锁屏）里停在暂停的地方，播放条恢复 A，播放页上音质还是 HQ；点播放从暂停的地方接着播（都是前后 3 秒内） |
| 断网时点歌 | 关掉 Wi-Fi 后点 B：一分钟内提示“播放未成功”，不能一直转圈或悄悄回到上一首 |
| 网络恢复后重试 | 打开 Wi-Fi，在失败提示里点“重试”：B 在播 |
| 迷你播放器不盖住标签栏 | 从资料库的播放历史返回、播放条刚升上去就按 Home 切到后台，5 秒后回来换到搜索标签：读屏树里迷你播放器在标签栏上方（`lib/dock.py`） |
| 插件一直不回应时的切歌 | 搜 `e2e hang <提交号>` 点 C，按“下一首”切到取地址时插件一直不回应的 Hang：C 先暂停，25 秒内回到 C 接着播（一轮取源期限 15 秒，不再等两轮）；再按“上一首”切到 B 在播 |
| 外部暂停一直作数 | 媒体键（和通知栏、锁屏、耳机走同一条路）：切到 Hang、C 停下等地址时按“暂停”，超时回滚后 20 秒里 C 一直停着；按“上一首”后 0.3 秒按“暂停”，B 装好后 8 秒里一直停着；两次之后按“播放”都照常接着放 |
| 看完视频自动接着放 | 打开“视频”替身（`focus-app/`，临时占用音频焦点 12 秒）：替身打出“放下焦点”日志之前，每次采样音乐都停着、焦点都在视频那边；之后 15 秒内接着放、进度在走。视频没结束音乐就放了算失败 |
| 看视频前后主动暂停过的不自己放 | 先暂停再看 6 秒视频、看视频时按“暂停”：视频期间停着，放下焦点后 8 秒里仍停着 |
| 切歌等地址时来了视频 | 从 C 切到 Hang、C 停下等地址时看 25 秒视频：切歌放弃回到 C 时（视频的第 13 秒左右）音乐仍停着、焦点不被抢回；视频放下焦点后 C 接着放（切歌自己的暂停不算用户暂停） |
| 锁屏照常播放 | 放着 C 灭屏：30 秒里每 5 秒采样一次都在播 C，进度一共前进至少 25 秒 |
| 锁屏界面上点下一曲 | 从头放 B，灭屏（`KEYCODE_SLEEP`）再亮屏，不解锁，停在系统锁屏界面，Maestro 确认控件后从当前读屏树解析系统“下一曲”控件中心，adb tap 点击（控件上还是 B 就重读位置再点，最多 3 次）：C 在播，锁屏界面还在。算出切到 C 那一刻 B 播到哪里，离 B 播完不到 5 秒就分不清是不是播完自动接的，记失败 |
| 锁屏时切歌等地址的期限 | 灭屏锁着，从 C 按“下一首”切到一直不回应的 Hang：C 先停下等地址，25 秒内回到 C 接着播。期限用的是后台计时器，这一项看灭屏时它是不是按时到 |
| 锁屏时按过的暂停 | 灭屏锁着再切到 Hang、C 停下等地址时按“暂停”：回滚后 20 秒里一直停着；再停 40 秒后按“播放”，从暂停的地方接着播 |
| 锁屏时切歌没被卡住 | 两次切歌都超时放弃之后，锁着屏按“上一首”切到 B 在播 |
| 锁屏时临时焦点打断 | 灭屏锁着打开 USAGE_MEDIA 的“视频”替身临时占用焦点 12 秒：替身放下焦点之前音乐一直停着、焦点在替身那边；之后 15 秒内接着放 |
| 解锁后界面和播放一致 | 解锁回到应用，从播放条打开播放页：是在放的 B、按钮是“暂停”，进度条下的已播放时间在读界面前后两次媒体会话采样之间（各放宽 2 秒） |
| Doze 中播放、切歌 | 在放 B（第 19 步没走到这里时自己从头放 B）时回到桌面、拔电（`dumpsys battery unplug`）、灭屏后强制进入深度休眠（`dumpsys deviceidle force-idle deep`，确认状态是 IDLE）：B 20 秒里照常播；按“下一首”联网取到 C 的地址放出来；切到 Hang 25 秒内回到 C；暂停 1 分钟后按“播放”从暂停处接着播 |
| 省电模式下切歌、播放 | 取消强制 Doze 并模拟运动确认已退出，再打开省电模式（`cmd power set-mode 1`，确认 `low_power` 是 1），灭着屏按“上一首”：取到 B 的地址放出来，20 秒里照常播 |
| 下载记录写不进去时的下载 | 先正常下载 C 作对照，在 B 要下载到的位置放一个用户自己的同名文件，再让下载记录写不进去（见下面“故障注入”）后下载 B：下载列表里 B 标为“未知错误”；错误日志里有 `music.DownloadTasks` 落盘失败（故障确实生效）；没写出 B 的最终文件；C 和用户的同名文件逐字节不变；下载记录文件和故障前逐字节相同；下载缓存清空。去掉故障、重启后文件和下载记录都完好；重新下载 B 写到新文件名，已有的文件仍不变 |
| 从 0.7.3 升级，迁移中、迁移后删掉的数据不回来 | 装 0.7.3 启动一次，往它的 MMKV 写入我喜欢（A、B、C）和测试源 A、B 的附加信息（带旧版标记），覆盖安装新版：我喜欢、测试源 A 的附加信息迁移过来（对照）；删掉我喜欢里的 B；卸载全部插件时测试源 B 的附加信息才第一次用到（之前新存储里没有它），清空和迁移同时进行，迁移跑完后没有旧数据；测试源 A 的（已迁移）清空后也没有。重启、再显示测试源 A 的歌之后，B 不在我喜欢里，两个平台都没有带旧版标记的键、迁移标记都在 |

“在播”和“进度在走”都看系统媒体会话（`dumpsys media_session`）。Beta E2E 固定用 Android 14，
不运行 Android 16 Live Update 的秒级通知刷新；这套检查验证的是会话进度，不直接验证音频输出。
原生 `currentNotificationPosition()` 在更新会话时仍可估算进度。Android 16 启用 Live Update 后，
服务每秒刷新会话，估算更容易被误认为 mpv 持续前进；不能直接推广本套结论。
Android 16 的独立引擎检查见下面，尚未直接验证音频输出。
“一直停着”大约每秒采样一次媒体会话，采到在播、或者最后进度往前走了都算失败；
实际采样间隔还包含 adb 耗时，不能保证捕捉所有一秒或更短的误播。谁拿着音频焦点看 `dumpsys audio` 的
焦点栈（`lib/audio_focus.py`）。这些判断在 `lib/pause_checks.sh`，`lib/pause_checks_test.sh` 用假的
adb 和时钟自检：视频没结束就接着放、视频结束后一直不放都要判失败，CI 跑模拟器之前先跑这个自检。断网用的是关掉模拟器的 Wi-Fi（移动数据在开头就关了），等系统的默认网络
变成 none 再点歌。

## Android 16：Live Update 与真实引擎进度

`proxy-subscription-check.yml` 的 API 36 模拟器运行 `LiveUpdateEngineProgressTest`。
它通过真实 `MpvPlayerModule.initialize/loadAndPlay/pause/resume` 加载现场生成的 90 秒 WAV，
使用正常的 AudioTrack/OpenSL ES 配置。只替换 JS 事件接收器，不启动 Metro 或歌曲插件。
JNI 句柄通过测试侧反射读取，没有给产品增加调试端口或缓存回退。

每个窗口五次采样、间隔 1.1 秒，分别读 JNI `time-pos/pause/idle-active/paused-for-cache/path`
和 `MediaControllerCompat.playbackState`，并确认通知确实采用 `ProgressStyle`。
播放和恢复要求每段原始进度前进、曲目正确、不在暂停/空闲/缓冲，估算进度与原始进度差不超过 1.5 秒；
暂停要求两个时钟都保持不变。纯 JVM 的 `EngineProgressProbeTest` 覆盖缺失读数、单段停滞、错误曲目、
窗口不足、间隔过短/逆序、间隔过长、跳跃、状态不符和投影漂移。

负面对照先真正暂停引擎、卸下模块观察器，再仅在测试中给服务注入过期的“playing”状态。
确认 Live Update 估算进度仍前进至少 2.5 秒，但同一个播放检查必须以 `RAW_STALLED` 拒绝；
随后重新挂回观察器、恢复真实播放，也要通过检查。这个对照验证投影不能冒充引擎前进，
没有模拟 CPU 真正挂起、网络阻塞或物理音频输出。

工作流除了检查每个仪器测试的完成状态，还要求五个阶段各五条原始样本。
`proxy-subscription-<run_id>` 附件包含 `instrumentation-summary.json` 和
`engine-progress-samples.jsonl`；后者的原始读数不从媒体会话推算。
导出前用 `adb shell` 确认文件存在，临时副本通过 JSONL 校验后才替换已保存的证据；
缺文件、断连或 `exec-out` 返回错误文本时，清理不会覆盖之前的有效副本。
`e2e/lib/engine_progress_artifact_test.sh` 在该工作流运行，覆盖导出的失败路径；
每次设备运行另记录缺文件时 `exec-out` 的实际返回码和输出，附件为 `missing-sample-exec-out.txt`。
这是 API 36 原生层的独立补充，没有把 Android 14 的锁屏、省电、切歌网络测试搬到 API 36。

### Android 16：真实 JS 切歌、音质和临时打断

同一工作流另外运行 `RealJsEngineProgressTest`。它启动真正的 MainActivity 和 ReactHost，
通过产品深链安装测试插件、搜索歌曲，通过界面替换队列和选择音质，通过 MediaSession 按钮切歌、暂停和播放。
读取的是这个 ReactHost 已经持有的 MpvPlayerModule 的 JNI 句柄，不创建另一台引擎，也不直接调用原生加载或恢复。
测试在首次启动前写入已有配置格式，让真实 JS 启用 Live Update；这不是对设置开关界面的验收。

`e2e/plugins/e2e-source-js-flow.js` 用发布到 GitHub 的完整测试提交号固定插件和音频。
B 立即返回，C 每次取源延迟十二秒，Hang 不返回；每次请求在 logcat 留下开始、结束和音质标记。
初始队列只有 B，再通过搜索结果替换为 B/C/Hang，检查 C 的预取刚开始才按下一首，防止提前取源让慢速场景形同虚设。
192K 和 320K 地址带不同查询参数，JNI `path` 必须真的换成对应地址。

十四个阶段各五次采样，共七十条真实读数：正常播放、慢速切歌等待和成功、Hang 等待和回滚、
慢速换音质时临时失去焦点（旧源和新源均暂停）、焦点返回后自动播放，以及打断期间主动暂停后
旧源、新源、焦点返回后都保持暂停，最后主动播放恢复；另外不中断播放换音质，旧源在十二秒取源期间继续播放。
回滚检查非零进度锚点。换音质比较旧源实际停止位置与新源首次就绪采样，不能回退超过 0.25 秒。
不中断的场景在仪器测试线程直接读取 JNI，每轮之后等待 50 毫秒再轮询旧源直到地址改变，
记录最后有效读数；不等待新源追上锚点，以免掩盖回退。实际采样间隔包含 JNI 查询的耗时。
切换循环只读地址（前后各一次）、原始位置、idle 和 buffering；模块与引擎身份、媒体会话
在循环前后核对，后续完整窗口仍核对暂停、通知样式与媒体会话。循环不等待主线程队列。
`transitionReadsDoNotWaitForMainLooper` 另外持住主线程，用同一个实际 libmpv 引擎确认
工作线程读取能在主线程释放之前完成；无效或缺失读数不使用估算值替代。
同一轮询也记录新地址首次有效恢复位置（固定跳过小于三秒的装载初始值、idle/buffering、缺失读数），
再等待正常播放就绪；后续窗口不能覆盖该首次位置。它与旧源停止位置的比较同样使用 0.25 秒容差。
五条新源窗口附带一致的 `sourceTransition`，保留旧/新读数时间、新源位置、前次轮询间隔
和从最后有效旧源读数起的最大轮询间隔 `maxPollGapMs`；时间戳紧接 JNI 位置读取之后获取。
这段过渡中的任何采样间隔超过 250 毫秒，Kotlin 和 Python 都拒绝这次测量；
装载初始值、idle/buffering 和路径不一致的轮询也计入间隔。后续有效旧源读数会刷新锚点和间隔历史。
总装载时间可以超过 250 毫秒，只要期间一直连续采样。
仍受轮询与多属性查询时延影响，
因此 0.25 秒不能解释为真实 seek 回退的硬上限。

焦点由 `focus-app/` 取得并持有二十五秒，再把 MusicFree 界面置于前台；每个受打断的样本必须同时确认
焦点仍在辅助应用、MusicFree 仍在前台。插件延迟使用普通 JS 定时器，避免把退后台后该定时器停住
误当成播放器的问题。这验证界面操作中的临时打断，不代表后台、锁屏或永久焦点丢失。

正常流程之后，独立重启并运行故障对照：真实 JS 点播 B 后，测试侧卸下同一模块的观察器、暂停同一引擎，
向服务注入过期的 playing 状态。这个仪器测试必须以 `RAW_STALLED` 失败，同时五条原始样本必须证明
引擎停住而会话估算至少前进 2.5 秒；其他失败、跳过或缺样本一律拒绝，不能把随便一次红色当作有效对照。

结果在 `proxy-subscription-<run_id>/real-js/`：正常与对照的 instrumentation 日志、logcat 和 samples.jsonl。
`js_flow_evidence.py` 独立核对完成状态、阶段、逐段 JNI 进度、暂停、焦点、曲目和真实请求延迟；
其自检故意删阶段、冻结进度、偷换焦点和伪造完成状态，工作流先跑自检再跑设备。
仪器测试结束时销毁真实 ReactHost 并等待服务释放；脚本无论成功失败都会强制停止应用和辅助应用。
原生独立测试的二十五条样本在真实 JS 场景清理应用数据前已经保存，导出失败不会覆盖旧的有效副本。

本地有 API 36 模拟器、已安装应用和测试 APK、Metro 时，可运行：

```bash
E2E_TEST_SOURCE_SHA=<已推送的完整提交号> E2E_FOCUS_APK=/path/to/focus.apk \
    bash e2e/android16-js-flow-check.sh proxy-subscription-results/real-js
```

这仍不直接验证扬声器输出、蓝牙、厂商省电或真机。没有声称覆盖 FILE_LOADED 回调那一瞬间的打断。

## 故障注入（第 17、18 步，`storage.sh`）

应用里没有任何测试开关，故障都在设备上用 `adb root`（google_apis 模拟器镜像可以）直接做，结果也直接看
应用的私有文件（`/data/data/<包名>/files/kvstore/*.json`，格式见 `lib/kvstore.py`）和下载目录：

- **下载记录写不进去**：键值存储每次落盘都先写 `<store>.json.tmp` 再改名。在 `music.DownloadTasks.json.tmp`
  的位置放一个 root 的目录（里面有文件，应用删不掉），下载记录就一次也写不进去，下载收尾第一次提交日志
  （“准备收尾”）就失败。这是存储满了、文件系统出错时的样子。
- **迁移进行期间清空**：旧版数据要是 0.7.3 自己的格式。CI 下载 0.7.3 的 x86_64 APK（核对 SHA-256）装上
  启动一次，让它建出自己的 MMKV 目录和文件；再用 `mmkv-seed`（`mmkv-seed/`，用 0.7.3 和现在的应用都在用的
  MMKV 2.4.0 核心编出来）往里写测试数据，按 0.7.3 自己文件的属主、权限、SELinux 标签放回去
  （`lib/device_place.sh`），然后覆盖安装要测的 APK。测试源 B 的歌不出现在任何列表里，它的附加信息一直
  用不到，卸载插件时才第一次用到：清空和从旧版迁移在同一时刻开始。

判断文件和存储的函数由 `lib/storage_checks_test.sh` 用假的 adb 在本机自检（CI 跑模拟器之前先跑）。
第 18 步会先卸载应用，所以放在最后（在第 19、20 步之后）。手动运行 Beta 构建时 `e2e_suite` 选 `storage`，只装应用和测试源、
跑这两步；配合 `e2e_apk_run_id` 可以拿旧的 APK 跑，确认这些检查在修复前确实会失败。本地跑要先编出
`mmkv-seed`、下载 0.7.3 的 APK，再设 `E2E_MMKV_SEED`、`E2E_LEGACY_APK`：

```bash
e2e/mmkv-seed/build.sh /tmp/mmkv-seed
E2E_SUITE=storage E2E_MMKV_SEED=/tmp/mmkv-seed E2E_LEGACY_APK=path/to/MusicFree-0.7.3-…-x86_64-release.apk \
    e2e/run.sh path/to/MusicFree-…-x86_64-release.apk "$(git rev-parse HEAD)" e2e-results
```

测的 APK 比 GitHub 上最新发布的版本旧时，启动后会弹“发现新版本”，测试会勾上“跳过此版本”再关掉
（`flows/dismiss-update.yaml`）。

## 锁屏和省电（第 19、20 步，`power.sh`）

锁屏是真的灭屏、锁屏：模拟器的锁屏方式是“滑动”，灭屏再亮屏就停在系统锁屏界面（开头用
`locksettings set-disabled false` 确保没被关掉）。屏幕状态看 `dumpsys power` 的 `mWakefulness`，锁屏界面
看 `dumpsys window policy`，深度休眠看 `dumpsys deviceidle` 的 `mState`（`lib/device_state.py`），每项检查的
说明里写末尾状态。`lib/power_environment.sh` 在每次媒体会话采样前后及检查边界核对环境：
锁屏要求灭屏且 keyguard showing；Doze/省电只要求灭屏及自己的电源状态，Doze 要求 IDLE，独立省电还要求 low_power=1。
第一次采到不满足后就锁定失败，即使之后恢复也不能通过；无法解析状态同样失败。
这不是连续监控，采样间隔内的短暂变化不能保证发现。锁屏界面上的“下一曲”按当前读屏标签解析位置后 adb tap（Maestro tap 等动态进度条静止会耗时过久），其余的按钮用媒体键：通知栏、锁屏、
耳机按键都经过系统媒体会话。做完这两步会退出休眠和省电、接回电源、解锁回到应用，后面的步骤照常跑。

从 Doze 切到省电模式时，`unforce` 后确认 force=false，再 `dumpsys deviceidle motion` 模拟运动，并确认不在深度休眠。
Android 14 在灭屏、未充电时 unforce 只清标志，未必改变 IDLE；不能用发送亮屏按键代替状态检查。
暂停一分钟后的恢复会另外观察四秒进度；没有查询唤醒锁，因此不能据此声称锁已经释放。
独立省电阶段允许 ACTIVE/INACTIVE 等尚未进入深度 Doze 的准备状态，拒绝 IDLE、IDLE_MAINTENANCE 与未知状态。
锁屏临时焦点打断使用的是视频替身，不是 Telecom 来电，真实通话留待设备验收。

判断“锁屏期间一直在播”“期限按时到”“界面和媒体会话一致”的函数由 `lib/power_checks_test.sh` 用假的 adb
和时钟自检：会话写着在播但进度不动、回滚晚了、回来后不接着播、界面上的进度停在旧值，都要判失败。
`lib/power_environment_test.sh` 补充测试 Doze 退出后恢复、亮屏、解锁、省电关闭、状态无法解析、
命令替换中的环境失效及恢复后进度停住。环境检查只装饰第 19、20 步，不改变其他步骤的记录和采样。
`lib/power_scenario_test.sh` 跑完整的锁屏、省电流程，防止调用点漏接环境断言：正常时全过，而且要核对环境的十三项
都必须经 power_check 按对应环境记录；退出 Doze、未退出 IDLE、点过锁屏按钮后没有锁屏界面时必须产生对应失败。`lib/power_controls_test.sh` 自检按当前控件定位、最多重试三次及成功后停止。PR CI 与 Beta E2E 都执行这些自检。

模拟器测不到的：进 Doze 后 CPU 并不会真的停（真机熟睡时计时器停走）；厂商自己的省电、杀后台、
“后台受限”；指纹或密码锁屏；蓝牙耳机按键。这些要在真机上另外看。手动运行 Beta 构建时 `e2e_suite`
选 `power`，只装应用和测试源、跑这两步。

## 怎么跑

Beta 构建（`build-beta.yml`）打包成功后默认接着跑，结果在这次运行的 Summary 里，
截图、Maestro 日志和 logcat 在附件 `e2e-results-<运行 ID>` 里。

- 只改了测试、不想重新打包：手动运行 Beta 构建，`e2e_apk_run_id` 填之前某次 Beta 构建的运行 ID，
  会直接测那次打出的 APK（30 天内的都在）。
- 只跑下载、旧版数据迁移的故障注入：`e2e_suite` 选 `storage`；只跑锁屏和省电：选 `power`。
- 拿修复前的代码对照：`build_ref` 填那个提交的完整提交号，打包那份代码，测试脚本和测试音源仍用触发的分支。
  APK 文件名、构建信息（`android-build-info.txt`、应用里的构建信息）记的是打包的源码提交和它的版本号，
  触发工作流的提交另记为 `Workflow commit`。测试结果里分开写测试脚本的提交和 APK 打包的源码提交。
- 不想跑测试：取消勾选 `e2e`。

每次的截图和结果还会推到 `refs/e2e/latest`（不在分支列表里，每次覆盖）：

```bash
git fetch origin refs/e2e/latest && git show FETCH_HEAD:summary.md
```

本地开着模拟器（x86_64，Android 8 以上）也能直接跑，需要 adb、[Maestro](https://maestro.mobile.dev) 和 python3：

```bash
e2e/run.sh path/to/MusicFree-…-x86_64-release.apk "$(git rev-parse HEAD)" e2e-results
```

## 测试用的音源和音频

- `plugins/e2e-source-a.js`：测试音源。搜索关键字写成 `e2e <40 位提交号>` 才有结果，
  歌曲文件从这个提交的 `fixtures/` 读取，所以**提交号必须已经推到 GitHub**。
  只有 128K、192K、320K，没有无损，用来检查切换音质失败时的处理。
  搜 `e2e hang <提交号>` 只返回 B、C 和一首 Hang，Hang 取播放地址时插件一直不回应。
  应用只允许从公网 https 地址装插件和取音频，模拟器上不能用本机地址。
- `plugins/e2e-source-b.js`：第二个测试音源，正常搜索时不返回歌（只记下提交号），应用替测试源 A
  找其他来源时才返回同一首 Fallback 和一首 Live 版。
- `fixtures/*.mp3`：几段纯音，由 `fixtures/generate.sh` 用 ffmpeg 生成。
- `mmkv-seed/`：往 0.7.3 的 MMKV 存储里写测试数据的小工具（`mmkv-seed set|get|keys <目录> <store id> …`），
  `mmkv-seed/build.sh` 取 Tencent/MMKV 的 v2.4.0（按提交号核对）用 cmake 编。
- `focus-app/`：“视频”替身。`am start -n fun.upup.musicfree.e2e.focus/.HoldFocusActivity --es mode transient --ei seconds 10 --es tag video-a`
  打开后像短视频一样临时占用音频焦点（`mode full` 是长期占用）、放一段很轻的声音，到时间放下焦点、自己关掉。
  放下之前先打一行日志 `E2EFocus: releasing focus tag=<tag>`，测试以它为视频结束的界线。
  CI 用 `focus-app/build.sh` 直接调 Android SDK 的命令行工具打包（不用 Gradle），路径通过 `E2E_FOCUS_APK`
  传给 `run.sh`；本地跑时同样先打好再设这个变量。
- 插件在 Jest 里也会用应用自己的加载代码跑一遍（`src/core/pluginManager/__tests__/e2eTestPlugin.test.ts`），
  写错了在 `npm run verify` 就能发现，不用等模拟器。

## 加一项检查

- 点界面、等文字出现、截图：在 `flows/` 里写一个 Maestro 流程，在 `run.sh` 里用 `flow "<检查名>" <文件>` 调用。
  按读屏标签找元素最稳，比如播放条是“歌曲: <歌名> 歌手: <歌手>”。播放中的界面一直在动，
  Maestro 点完默认要等十几秒界面才算静止；点完要马上看播放状态的，给 `tapOn` 加 `waitToSettleTimeoutMs`。
- 判断播放状态：用 `run.sh` 里的 `expect_playing "<检查名>" "<歌名>"`、`wait_for_song`、`wait_for_state`；
  接着之前的进度播用 `expect_continued`，暂停后接着播用 `expect_resumed`。断网、联网用 `set_network off|on`。
- 流程要参数时写成 `${名字}`，调用时 `flow "<检查名>" <文件> -e 名字=值`。同一个流程跑第二次，日志另起
  一个名字（`<流程>-2.log`）。
- 流程没通过时，日志里会打出当时界面上的所有文字，并截一张 `failed-<流程>.png`。
