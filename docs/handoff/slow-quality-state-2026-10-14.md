# 慢文件换源：状态和通知动作诊断

基线主线为 `0fd41f78`。用户授权“继续下一轮”，本轮先验证慢换音质状态；不改版本、不发布，不自动合并新PR，不开始音乐库或性能功能改动。

## 问题假设与范围

#35 在替换前暂停旧源、捕获真实进度，FILE_LOADED 应用待执行 seek 后允许自动播放。原生 pause 属性回调仍可能把这次内部暂停发布成 paused，影响 JS 和系统媒体会话。通知的同一个播放/暂停 PendingIntent 根据服务 cachedState 决定命令，因而不能未经验证就断言只是视觉闪烁。

基线提交263fdb81只增加测试与诊断。Android16 #50实际复现后，本PR追加窄范围状态修复；下面分开保留修复前证据与修复后待验收项目。

## 四个真实原生边界场景

`SlowQualityLoadingTest` 使用真实 MpvPlayerModule、libmpv、播放服务、MediaSession 和已发布通知。先播放本地WAV；随后同媒体换源到受控MockWebServer，实际收到HTTP请求后暂不返回响应，使新文件持续处于未加载状态。释放后支持Range并返回同一WAV，验证新的generation已激活、恢复位置、暂停或真实进度推进。

1. 内部暂停：在响应未放行的窗口中，预期为buffering和通知“暂停”；同时收集全部原生发往JS的状态、MediaSession回调，防止轮询遗漏短暂paused。
2. 通知暂停：发送实际通知动作的PendingIntent，确认发出的命令为pause，加载完成后仍暂停，用户明确播放后引擎能推进。
3. 临时焦点：启动现有“视频”替身，真实占用焦点，确认pause及interruptionBegan/Ended事件。此测试没有React运行时，所以焦点归还后**显式调用原生resume**模拟上层后续动作；不把它说成完整JS自动恢复测试。既有RealJsEngineProgressTest继续检查真实JS意图与焦点恢复。
4. 打断中再次暂停：通过MediaController明确暂停，焦点归还和文件加载完成后仍保持暂停，直到明确播放。

测试只观察真实发往JS的事件接收端，**没有渲染React页面或逐帧验证页面按钮**。通知对象、动作和MediaSession为真实系统对象。HTTP是仪器进程的本机夹具，未改变产品的网络策略或信任规则；不代表远端插件服务实测。也不声称物理音频输出测量。

## 证据与防误报

- `files/quality-loading-state.jsonl` 按scenario/phase记录真实engine pause/position、恢复目标、加载generation、媒体会话、通知动作、JS事件和命令。
- e2e脚本在开始时清旧文件，成功或失败清理时用现有可验证导出函数保存。正常执行还要求新证据检查通过，缺场景或前提失败不能跳过变绿。
- Python检查器要求四个场景全部出现，每个等待窗口13个样本且至少1秒；已加载/恢复检查点必须有真实进度，且通知暂停确实发出pause命令。
- 新检查器文件包含在Android16 workflow触发路径和自检步骤中；新仪器类包含在显式类清单。旧原生25条及真实JS70/冻结5条检查保留，250ms/0.25s门限未改。
- finally/After放行服务器、销毁引擎与服务、取消媒体会话回调、关闭测试服务器与焦点替身，失败也执行。

## 当前验证

- Python证据检查器18项自测通过；shell语法、workflow YAML解析、git diff --check及结构审计通过。
- 本地完整verify第一次在ESLint阶段执行连接中断，不计通过；重跑已完整成功：1365 Jest / 43 generator / 1257 layout，ESLint0错误/216警告，TypeScript、静态审计和patch重放通过。日志为slow-quality-baseline-verify-retry.log。
- 本地没有Android SDK，新增Java/Kotlin仪器代码尚未本地编译。CI必须先证明编译和前提成立，再判断原代码是否有目标问题；编译失败、HTTP/焦点夹具失败不算复现。

后续按同一PR记录原始基线与必要修复结果，不把旧运行或部分样本当新通过，不为了变绿放宽门限。完整运行ID、实际计数、错误及诊断结论写入PR描述。

## 基线设备结果：263fdb81

[Android16 #50](https://github.com/CTZZG/MusicFree/actions/runs/38515791943) 缓存未命中，实际编译app与test APK。仪器清单期望66项、完成66项，65通过、1失败：

- `internalPauseWhileWaitingForTheFileKeepsBufferingAndThePauseAction` 捕获真实JS事件 `[buffering, paused, buffering]`，媒体会话回调也包含状态2后回到6。因此是内部暂停被短暂发布为paused，不能说只是通知外观变化。
- 该场景13个稳定窗口样本都为buffering/通知“暂停”。第二场景点击前也为6/“暂停”，实际PendingIntent产生pause，加载后保持暂停，明确播放后进度恢复。**没有复现稳定后按钮发出play或暂停被覆盖**；也没有在短暂paused时刻点击通知，不推断那个竞争窗口的实际点击结果。
- 两个临时焦点场景通过。焦点归还后的原生resume是夹具明确发出的，不是本场景内真实React自动恢复。
- 总运行按设计失败，没有继续运行后面的真实JS70条/冻结5条、订阅转场；不能将此运行说成完整回归通过。

[CI118](https://github.com/CTZZG/MusicFree/actions/runs/38515791901) 的质量门通过；Gradle Debug单元测试实际执行，下载XML为21套件120项，失败、错误、跳过均0。这不替代新增仪器代码的编译和运行。

## 窄范围修复与设计边界

`MpvPlayerModule` 的pause=true回调仅在以下条件同时满足时报告buffering：仍是当前loading generation、该代有待恢复seek、仍允许该代自动播放、没有用户暂停或系统焦点hold。显式pause会取消自动播放标记，系统打断也有hold；这两种仍报告paused。不全局隐藏paused，不改播放意图或load/seek顺序。

选择buffering是因为新文件确实尚未装好，状态应区别于主动暂停。服务现有实现只在PLAYING启动Live Update定时推进，且只在PLAYING推算当前通知位置；buffering不会继续推算。没有测量物理音频输出。

页面现有缓冲状态显示不可点击的转圈；本轮没有把它改成可点的暂停按钮。若希望用户在此阶段也能在页面主动暂停，属于后续单独的交互改动，不能伪称已经覆盖。通知/媒体控制的暂停仍可用。

## Claude建议与JS层补充

`interruptionDuringLoad.test.ts` 增加三个用例，用真实TrackPlayer、真实MpvPlayerAdapter、真实useMusicState和页面PlayControl；只替换原生、外围服务、图标/动画/方向：

1. 重放设备观察到的paused回调，确认页面显示播放，点击确实调用resume而不是pause；回调本身不写入用户暂停意图。此用例用于说明实际影响，并不把错误状态下的“播放”按钮强行要求为暂停。
2. buffering显示原有转圈，没有播放/暂停点击入口；装好后暂停与播放分别改变用户意图。
3. 原生在装载期间报告playing时，点击真实页面暂停按钮，FILE_LOADED及补播之后仍保持暂停。

这些JS用例验证事件消费者行为；真正修复前失败的回归是上述原生仪器测试，不能说JS中手工模拟的原生实现证明了Kotlin修复。本地删除实际TrackPlayer状态订阅后，三个新增页面用例全部失败；原文件已经恢复，再跑完整验证。

测试服务器等待响应上限从15秒扩至45秒，并只在本仪器实例把mpv network-timeout设为60秒，给焦点观察留余量。产品网络超时15秒、观察窗口、250ms/0.25s门限均未改。基线没有超时失败，这项仅预留慢模拟器余量，不能称为已发生的问题修复。

修复后设备/完整Beta结果以PR最新提交表为准；尚未回来前保持待验收。不会自动合并或发布。

## 修复后本地检查

完整 `npm run verify` 通过：185套件1368 Jest /43 generator /1257 layout，ESLint0错误/216警告，TypeScript、静态审计、patch重放通过。相关29套件301项通过，新增页面用例所在文件20项通过。Python慢加载18项与真实JS证据100项自检通过。日志为slow-quality-fix-verify.log；不把本地检查当成新增Kotlin的编译或设备验证。
