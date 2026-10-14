# 慢文件换源：状态和通知动作诊断

基线主线为 `0fd41f78`。用户授权“继续下一轮”，本轮先验证慢换音质状态；不改版本、不发布，不自动合并新PR，不开始音乐库或性能功能改动。

## 问题假设与范围

#35 在替换前暂停旧源、捕获真实进度，FILE_LOADED 应用待执行 seek 后允许自动播放。原生 pause 属性回调仍可能把这次内部暂停发布成 paused，影响 JS 和系统媒体会话。通知的同一个播放/暂停 PendingIntent 根据服务 cachedState 决定命令，因而不能未经验证就断言只是视觉闪烁。

这一提交只增加测试与诊断，没有修改产品实现。只有在设备确实复现后，才考虑范围有限的修复；不能先宣称问题已存在或仅靠静态阅读宣布修好。

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
