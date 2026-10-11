# 锁屏与省电验证交接（2026-10-11）

## 目的与基线

用户把后续推进交给 Codex，完成后由 Claude 复核。目标是补齐锁屏、省电的设备证据，同时先修正测试自身的误报。
这次不合并、不发 Release。工作分支为 `codex/power-validation-20261011`，目标分支 `feat/mpv-only`。
之后按用户安排由 Claude 接到 `claude/sharp-planck-xtfenm` 上开 PR 接替 #25，见文末“Claude 复核”。

基线：PR #24 合并提交 `9e300936`；接续 Claude 的最新提交 `a3253ae9`。
Claude 的待合入工作原样保留：

- `ae4030ea`：Beta 构建旧提交时，给旧生成器传正确的 `GITHUB_SHA`，避免完整 gitSha 与 APK 源码不一致；补两个生成器测试。
- `703a23a6`：锁屏和省电第 19、20 步。
- `828fb854` / `a4c2912f`：将取源超时换成普通 RN 定时器的负对照，以及紧随其后的撤销。最终产品代码没有这项改动。
- `91bb7f16`：锁屏按钮点击不再等待动画稳定；用歌曲长度和两次采样区分手动下一首与自然播完。
- `a3253ae9`：控件仍显示 B 时最多重试三次；按钮检查先做，再测 C 灭屏播放；失败的锁屏按钮不再让后面所有检查作废，省电步骤可独立重设 B。

Codex 不改产品的播放、焦点、通知进度估算，也不改变版本号。新增代码均用于 E2E 判断及 CI。

## 修了什么，为什么

旧省电步骤只在开始等一次 IDLE。用假设备跑完整步骤，让设备第 5 秒退出 Doze，歌曲仍正常播放：
旧脚本七项全部通过，只在日志提示已经退出。省电模式阶段仅发 `unforce`，也可能仍在 IDLE，混合了两种环境。
锁屏 UI 操作后，再次灭屏失败被 `|| true` 忽略，后续项目仍可能以锁屏名义通过。

1. **环境必须和播放行为一起成立。** `e2e/lib/power_environment.sh` 的 `power_check` 装饰一个现有检查：
   开始、结束以及每次媒体会话采样前后核对设备状态。锁屏要求 Asleep/Dozing 且 keyguard showing；
   Doze 要求灭屏且 IDLE；Doze/独立省电要求灭屏及相应电源状态，独立省电还要求 low_power=1。省电检查不要求 keyguard 已显示，避免额外限制场景。状态读不出来也失败。
   第一次不满足写入临时记录，防止 Bash 命令替换中的失败在子 shell 退出后丢失；之后恢复也不能抹掉失败。
   检查只向正式结果表记一次，未记录、重复记录、名称错配、报告通过却返回失败都会被拒绝。
   子 shell 内替换采样和记录函数，原 run.sh 的计数与其他步骤保持原有语义。
2. **等待过程也采样。** 取地址、超时回滚、暂停、恢复、焦点打断都在环境检查内执行，不能只检查最终播放结果。
   重新灭屏失败会把依赖这项前提的后续检查记失败，并恢复设备；不会把没有执行的检查漏掉。
3. **Doze 与省电分开。** `unforce` 后确认 force=false，再发送 `deviceidle motion` 模拟运动并核对已经退出深度休眠；保持灭屏时的 INACTIVE 等准备状态尚未进入深度 Doze，允许通过；IDLE、维护窗口与未知状态拒绝。后续采样也核对休眠状态和 low_power。
4. **恢复后还要继续播。** 原 expect_resumed 只核对状态和暂停位置，新增 expect_power_resumed 再观察四秒进度，防止
   “会话写着在播，记录的进度却没有前进”被算作成功；这不等于独立验证音频输出。
5. **描述不超出证据。** 暂停一分钟没有直接查询唤醒锁，删除“已放下唤醒锁”的结论。焦点替身用 USAGE_MEDIA，
   改称临时焦点打断，不声称模拟了 Telecom 来电。README 说明 Android 16 Live Update 有原生进度估算。

环境是定期采样，不是连续观测；两次采样之间的短暂变化不能保证发现。此实现不为了保持绿色而重新强制设备进入
IDLE：环境中途丢失属于没有完成要求的验证，必须在结果里可见。

## 新增回归检查

- `power_environment_test.sh`：27 项，真实解析器与环境装饰器，只替换设备 I/O、时钟。覆盖中途退出/恢复、亮屏、
  解锁、省电关闭、状态不可解析、暂停命令替换内的失效、结果报告错误、恢复后进度停住。
- `power_controls_test.sh`：11 项，真实解析和点击循环，替换设备 I/O。覆盖吞掉点击、每次重新定位、最多三次、成功后不再点、读屏失败、歧义、禁用及定位后解锁。
- `power_scenario_test.sh`：三种完整省电流程，防止只写了装饰器却漏接调用点。正常应七项通过；第 5 秒退出 Doze
  应四项失败；模拟运动后仍不能退出 IDLE 应独立省电两项失败。检查失败后的屏幕、省电恢复。
- 保留 Claude 的 17 项 power_checks_test、pause_checks_test 与设备解析自检。
- PR CI 和 Beta E2E 都执行这些自检；CI 绿色不能只证明装饰器文件可加载。

## 已核对的旧运行

| 运行 | 脚本 / APK 源码 | 实际证据 |
| --- | --- | --- |
| [Beta #115](https://github.com/CTZZG/MusicFree/actions/runs/38115319608) | 703a23a6 / 0e0d19df（复用 Beta #112） | Android 14，23 PASS / 0 FAIL；这是旧环境断言和旧锁屏按钮脚本，不能代替本次结果 |
| [Beta #116](https://github.com/CTZZG/MusicFree/actions/runs/38115542559) | a4c2912f / 828fb854（普通 RN 定时器） | Android 14，9 PASS / 13 FAIL；锁屏切 Hang 后 45 秒内未回到 C，解锁后恢复。后续大量项目因前置条件失败未执行 |

负对照证明锁屏超时检查能抓住本次普通定时器退化；不能把那 13 项都解释成独立复现，也不能说 Doze 超时负对照
已完成，因为 Doze 前置的 B 没有播放。它不证明模拟器 CPU 曾真正挂起。

## 首次设备运行发现的脚本问题

[Beta #121](https://github.com/CTZZG/MusicFree/actions/runs/38118672788) 用 d6a5f97e 的脚本测相同 APK，
Android 14 上 15 PASS / 8 FAIL。两次 Maestro tap 的 commands.json 分别记录约 105 秒：动态锁屏进度条
导致寻找稳定布局和点击后等待过久，B 自然播完才切到 C。tapped_next 如实拒绝通过。

修正为：Maestro 只确认控件并截图；从当前读屏树的系统“下一曲”标签解析控件中心，再 adb input tap。
每次重读控件位置，仍在 B 才重试，最多三次，切到 C 就停止。没有固定坐标，也不把媒体键替代成锁屏点击。

同一次运行中 Doze 已进入 IDLE，屏幕 Dozing，但 keyguard 还 hidden；初版把所有模式都要求 keyguard showing，
使七项省电检查没有执行。这是额外的测试前提，修正为只在 locked 模式要求 keyguard；Doze 和省电仍严格要求灭屏
和相应电源状态。27 项自检补上“Doze/省电不要求锁屏界面显示”的对照，锁屏解除仍会失败。

## 独立省电准备的第二次设备反馈

[Beta #125](https://github.com/CTZZG/MusicFree/actions/runs/38120298975) 使用 4d121c79：21 PASS / 2 FAIL。
锁屏按钮在 B 约 65 秒时切到 C，排除了自然播完；锁屏和 Doze 的超时均为 16 秒；两个一分钟暂停后的恢复都有四秒进度。
剩下两项因退出 Doze 的准备失败没有执行：unforce 加亮屏按键后仍 Dozing/IDLE。

核对 Android 14 [DeviceIdleController 源码](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-14.0.0_r1/apex/jobscheduler/service/java/com/android/server/DeviceIdleController.java)：
exitForceIdleLocked 只在 mScreenOn 或 mCharging 时调用 becomeActiveLocked。灭屏、未充电时 unforce 只清 mForceIdle。
修正为 unforce 后确认 get force=false，再发送 motion 显式走退出路径，仍要求离开 IDLE/维护窗口并持续采样。
完整流程的假设备也改为 unforce 不改变 IDLE：漏掉 motion 会使正常对照失败，motion 后仍 IDLE 仍会使两项省电失败。
没有关闭 Doze 或降低判断标准；先完成 Doze 组，再模拟运动进入独立省电组。

## 最新脚本的负对照与运行隔离

[Beta #127](https://github.com/CTZZG/MusicFree/actions/runs/38120412659) 用 4d121c79 脚本测普通 RN 定时器 APK 828fb854。
锁屏和 Doze 的 Hang 超时各自执行，均在 45 秒内没有回到 C，媒体会话仍是 PAUSED；解锁后出现恢复。
省电组独立重置 B，所以锁屏失败没有阻止 Doze 的第二次复现。其余多项因超时事务未完成连带失败，不能当成独立产品缺陷；独立省电仍被当时的退出步骤阻止。

Beta #122、#126 是被最新脚本取代的全量运行，已取消，不计入通过证据。最终产品树与 0e0d19df 相同；
负对照 828fb854 与该产品树只差取源超时换成普通 RN 定时器及对应单元测试期望。负对照失败是期望结果，不能写成现行产品失败。

## Codex 提交与验证结果

- `d6a5f97e`：环境采样和首次失败锁定、恢复进度检查、完整流程负对照、自检接入 CI。
- `4d121c79`：按当前控件标签定位锁屏按钮，避免 Maestro 等动态界面稳定；Doze/省电不额外要求 keyguard 显示，补 11 项控件回归。
- `97825a05`：依据 Android 14 实际运行和源码，显式退出强制 Doze 后独立验证省电；整流程替身模拟 unforce 不改变 IDLE。
- 最终文档提交：原生 XML 和三组设备证据、采样/会话估算限制、下一轮实现建议。

## 当前验证与复核重点

本地 `npm run verify` 通过：1318 个 Jest、43 个生成器、1257 个布局用例，ESLint 0 错误/216 警告。
环境自检 27 项、控件自检 11 项、完整省电自检 3 项通过；同样的整流程用例放到 `91bb7f16` 的旧脚本上，两种故障场景都失败，正常对照通过。
[CI #74](https://github.com/CTZZG/MusicFree/actions/runs/38121699413) 在 97825a05 上通过，质量门和全部脚本自检执行成功；原生 XML 报告为 17 个 suite / 89 个测试，错误、失败、跳过均为零，Gradle 为实际 testDebugUnitTest（2 分 55 秒），没有按路径跳过。
[Beta #128](https://github.com/CTZZG/MusicFree/actions/runs/38121708179) 用 97825a05 脚本测 0e0d19df APK，在 Android 14 上 23 PASS / 0 FAIL。
系统锁屏按钮在 B 约 58 秒时切到 C（总长 180 秒），锁屏 Hang 超时 15 秒、Doze Hang 超时 16 秒；
锁屏和 Doze 的一分钟暂停后恢复均有四秒会话进度。独立省电按上一首及随后 20 秒播放均通过，
灭屏、low_power=1、深度休眠为 QUICK_DOZE_DELAY（未进入 IDLE）；持续采样符合 saver 要求。
同脚本的 [Beta #130](https://github.com/CTZZG/MusicFree/actions/runs/38121711743) 测普通定时器 APK 828fb854：13 PASS / 10 FAIL（预期负对照红色）。
锁屏与 Doze 的 Hang 超时各自在 45 秒内未回到 C，状态仍 PAUSED，而正常 APK 分别是 15、16 秒。
独立省电环境准备已经完成，但原超时事务仍挂着，上一首没能播放；不能把这些连带结果算成十个独立缺陷。
负对照里“暂停保持 20 秒”通过只说明会话保持暂停；由于超时回滚已经失败，不能用这一项证明回滚完成或暂停意图已被回滚尊重。
[Beta #129](https://github.com/CTZZG/MusicFree/actions/runs/38121709775) 全量完成：Android 14，96 PASS / 0 FAIL，
脚本同为 97825a05，APK 同为 0e0d19df。包括锁屏、省电、切歌超时、外部暂停、临时焦点打断、
下载首次写盘失败与既有文件保护、从 0.7.3 升级迁移删除/清空和重启后的结果。96 是报告中的检查行数，包含 UI 操作及前提准备，不能理解为 96 个独立功能或 96 个原生仪器测试。
全量中的锁屏与 Doze 超时均 16 秒，锁屏按钮在 B 约 36 秒时切到 C，独立省电两项再次通过。

专项、全量、负对照分别下载 artifact 并核对 summary.md 的脚本/APK SHA 和逐项结果。
最终交接提交只修改验证记录、README、解析器说明与脚本注释，没有更改 97825a05 的测试行为，因此不为纯说明改动重新跑设备。源码构建与测试脚本提交必须分开记，复用 APK 不等于
在新提交重新编译。只改测试时复用 Beta #112 是因为最终产品代码树与该 APK 源码一致。

请 Claude 重点复核：

- Bash 子 shell 的记录隔离和失败锁定，是否有记录失效但仍报告 PASS 的路径。
- 锁屏、Doze、省电的全部等待与恢复路径是否接入 power_check；前提失败是否完整记录依赖项。
- 环境解析失败、界面亮屏/解锁、IDLE 退出后恢复能否误报；省电阶段是否确实独立于 Doze。
- 真实设备结果的脚本 SHA、APK SHA、API 和逐项说明，不能只看 job 颜色。
- 旧生成器 full gitSha 修复及 Claude 的锁屏按钮判断，本 PR 一并带入，不要只看 Codex 的最后几项改动。

## Claude 复核（ac10234b）

用户安排：由 Claude 接到 #25 上，在 `claude/sharp-planck-xtfenm` 开一个 PR 接替 #25，交 Codex 复核。
接手时 Codex 已经解决了我原本要补的两处（锁屏按钮点不中、进 Doze 时要求锁屏界面显示），所以这个 PR 的
代码就是 `ac10234b`，只加了这一节复核记录。我在 `a3253ae9` 之后的 `3ea5f154`（锁屏界面只看控件、切歌改用
媒体键）没有带进来：按当前读屏树定位后 adb tap 真正经过了系统锁屏按钮这条路，比改用媒体键更好。

复核范围：`a3253ae9..ac10234b` 的全部改动（power.sh、power_environment.sh、device_state.py、三个新自检、
ci.yml、build-beta.yml、README、media_session.py 说明）和引用的设备运行。

本地：device_state、power_checks、power_environment（27）、power_controls（11）、power_scenario（3，补上锁屏后 5）、
pause_checks、storage_checks 自检全部通过；shellcheck 只有样式提示（`screen=?` 这类赋值的 SC2125，
赋值里不展开通配符，行为不变）。

设备运行，我自己从 job 日志核对了：

- [Beta #129](https://github.com/CTZZG/MusicFree/actions/runs/38121709775)：脚本 `97825a05`，APK 源码 `0e0d19df`，
  Android 14，96 项通过、0 项失败；锁屏按钮在 B 约 36 秒时切到 C，锁屏、Doze 的期限都是 16 秒；省电两项通过，
  深度休眠状态 QUICK_DOZE_DELAY。核对环境的 13 项，说明都以“环境采样符合 locked / doze / saver”结尾，调用点在设备上没有漏接。
- [Beta #130](https://github.com/CTZZG/MusicFree/actions/runs/38121711743)：脚本 `97825a05`，APK 源码 `828fb854`
  （普通 RN 定时器的对照包），Emulator E2E 失败，符合对照预期。
- `ac10234b` 相对 `97825a05` 只改了注释和说明（power.sh 一行注释、media_session.py 文档字符串、README、本文档），
  上面的结果对本 PR 的脚本成立。后面补的 `e1242db4` 只改自检和 README，不改设备上跑的脚本。

结论：没有发现阻塞问题；找到一处自检缺口，已在本 PR 补上（见“补上的自检缺口”）。

- `power_check`：子 shell 里换掉 session、pass、fail，环境失效写进文件，命令替换里的失败不会丢；结果的行数、
  检查名、退出码都核对。锁屏、Doze、省电里的等待、暂停、恢复、焦点打断都经过 session 采样，都在环境核对之内。
  没找到“环境记录失效仍报 PASS”的路径。
- 锁屏按钮：每次重读控件位置、要求亮屏且锁屏界面在、仍在 B 才点，切到 C 就停；`tapped_next` 仍防住“B 播完
  自动接 C”。
- Doze 退出：Android 14 灭屏、未充电时 unforce 只清标志（DeviceIdleController 源码），先确认 force=false
  再 motion，再要求离开 IDLE，做法对。
- 会话进度：核对了 MpvPlaybackService。updatePlaybackState 用 currentNotificationPosition()；mpv 每次进度事件
  先把缓存进度设成 mpv 的值再更新，所以 Android 14 上会话进度基本就是 mpv 的进度，但别的事件触发更新时会按
  时间推算。我原来写的“会话进度就是 mpv 报的、歌停了就不动”说过头了，Codex 的改法是对的。

### 补上的自检缺口

用变异检验自检：在 power.sh 里每次只去掉一个调用点的 `power_check <环境> "$名字"`，原检查照样跑，看 PR CI 跑的
四个 power 自检能不能发现。13 个调用点（锁屏 7、Doze 4、省电 2）：

- `ac10234b` 原有的自检只发现 2 个（Doze 中照常播放、Doze 中按下一首），其余 11 个去掉也照样全过。锁屏 7 个
  全部发现不了：power_scenario_test 只跑第 20 步，锁屏没有完整流程的自检。Doze 后两项、省电两项也发现不了：
  省电流程只数失败个数，环境一失效，前提失败会连带后面几项一起失败，某一项漏接时失败数不变。
- 设备上没有漏接（上面 #129 的 13 项都有“环境采样符合 …”），所以这是以后改 power.sh 时缺回归保护，不影响本次结果。

补法（`e1242db4`，只改 power_scenario_test.sh 和 README）：

- 加锁屏第 19 步完整流程的替身：亮屏、锁屏界面在、仍在 B 时 adb tap 系统“下一曲”才切到 C；视频替身占焦点、
  `dumpsys audio` 焦点栈、`logcat` 放下焦点；解锁。
- 正常场景要求核对环境的 13 项都通过，而且说明以“环境采样符合 <对应环境>”结尾（只有 power_check 写这句话），
  漏接或接错环境都会失败。
- 新场景：点过锁屏按钮后再灭屏没有锁屏界面，七项锁屏检查必须全部失败，之后恢复亮屏、解锁。
- 替身修了一处：切歌等地址时按暂停，进度会倒退；现在从实际开始播放的时刻算。

用新自检重做同样的变异：13 个调用点去掉哪一个，自检都会失败，失败信息直接指出哪一项没经 power_check 记录。

不阻塞、留给后续的观察：

1. 省电组的 quick doze：开省电模式、灭屏后系统进入 QUICK_DOZE_DELAY，默认约 60 秒后进入 IDLE，而 saver 环境
   拒绝 IDLE。#129 里从退出 Doze 到省电两项做完约 26 秒（07:53:41–07:54:07），余量约 34 秒；取 B 的地址变慢时
   可能把环境判失效。这只会误报失败，不会误报通过。需要时可在省电组前用 device_config 把 quick_doze_delay_to
   调长、做完还原，或在失败说明里点明是 quick doze。
2. Doze 中期限不到的对照，除了 #127、#130，`a3253ae9` 脚本的 [Beta #120](https://github.com/CTZZG/MusicFree/actions/runs/38118412908)
   也复现过：对照包在 Doze 里切到 Hang 后 C 停在 3.5 秒，直到这一步结束都没回滚；同一脚本测现行 APK 的
   [Beta #119](https://github.com/CTZZG/MusicFree/actions/runs/38118411786) 是 16 秒回来。
3. 环境是采样核对，两次采样之间的短暂变化抓不到（上文已写明）。

## 后续方向

先把后台核心路径的证据做可信，再加新功能。产品层面的自动恢复、用户暂停和内部切歌暂停已经有统一意图机制；
这一轮不再次改动那套状态机。

下一步建议：Android 16 Live Update 用 mpv 原始进度或音频输出作独立观测，再扩展锁屏省电设备矩阵。Android 14
当前检查不运行 Live Update 秒级刷新，但 currentNotificationPosition 在更新会话时仍可估算。
Android 16 启用 Live Update 后服务每秒刷新会话，估算更容易被误认为 mpv 持续前进；会话进度不能独自证明 mpv 还在播放。不要为了测试删除产品正常使用的通知进度平滑。
`media_session.py` 的解析逻辑没有增加估算，但原先文件说明称“进度由 mpv 直接上报、能证明真的在播”，本次一并修正这段说明。

后续这项可从 `MpvPlayerModule.kt` 已有的 `MPVLib.getPropertyDouble("time-pos")` 读取路径入手，
在测试侧分别记录原始 time-pos、暂停属性和媒体会话进度。Android 16 要真实加载测试音频并打开 Live Update；
加一个“引擎停住、会话仍被估算推进”的负对照，确认新判断能失败。现有 `LiveUpdateNotificationStyleTest`
直接驱动服务的 metadata/state 回调，证明通知样式切换，不能代替真实引擎播放验证。

仍需真机证据：CPU 实际挂起、厂商省电/后台杀进程、后台受限、密码/指纹锁屏、真实蓝牙耳机、真实视频和来电。
慢速换音质期间被临时打断、音频焦点永久丢失也应单独做端到端场景。下载和迁移故障注入已在 PR #24 处理，
本次不重复扩展其范围。
