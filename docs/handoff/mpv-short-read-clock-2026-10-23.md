# mpv 短读计时修正（2026-10-23）

## 范围和保持的产品选择

本修复基于 PR52 的 d95f3db9，单独处理已抓到的 mpv pull-buffer 计时错误。版本仍为0.13.0/400035、最低Android14/API34；不合并或发布，不修改JS恢复目标、JNI读数、音频后端、暂停意图、焦点或所有250ms/.25s/暂停窗门限。临时实验workflow、AO计数日志和LogObserver不进入产品。

mpv仍锁定0.41.0的41f6a645068483470267271e1d09966ca3b9f413，NDK27.1.12297006/API26是该依赖的构建参数，不是恢复旧系统支持。保留已有startup-delay两秒边界、时间戳/透传/回绕策略。

## 实际机制和最小修正

AudioTrack先按请求帧数计算out_time_ns；ao_read_data_locked即使只返回部分帧且没有补静音，也把完整请求的结束时间保存为队列结束时间。ao_get_delay减去这份过大的延迟，可能使time-pos低于准确的seek目标。

只在pos>0且pad_silence=false时，扣除(samples-pos)/samplerate。完整读、空读、带静音尾部的读和原有underrun唤醒/paused行为不变。补丁直接修改锁定源码函数，不钳制JNI/time-pos，也不靠丢弃早期读数通过测试。

## 真实证据及边界

- 原#99/run39887296631的-.253337213s首读数失败保留。原生实际捕获/seek正确，不能回到“陈旧JS目标”的错误解释；读数斜率接近1也不能证明物理音频起点。
- 仅计数#104/run39975480363观察到少65.6875/92.8125ms的两次实际短读与早65.523355/91.257307ms的首读数对应。原生89方法通过，但完整JS前漏传fixtureSHA而退出，不是完整回归通过。
- #106/run39980948129在apt索引更新停滞后触发90分钟上限；没有编译/APK/设备数据。已去掉全仓库apt刷新，使用固定工具/校验gperf源码和单独准备超时。
- 修正+计数#107/run40010354162，实验head ab7ad64c，独立ZIP digest、来源/库SHA、仅一个APK payload变化及debug签名一致性均核对。89方法code0；六轮288样本，最差-.016231770s，最大27ms；所有第一读数都贴近恢复目标，其中实际少77.125ms的一轮也没有对应首读数下跌。
- #107完整原回归：native25/slow73/正常JS70且仪器code0/UI20+两PNG实际查看/冻结5齐全。冻结RAW_STALLED、raw0而session+4403ms，七暂停窗0变化；focus/foreground/source12begin7resolved通过。真正oldStop=新阶段resumeAnchor80.25129821396926，firstNew相同，maxgap66ms。未放宽门限。
- 这些数据支持修正已捕获的短读机制，不完整解释旧253ms失败的全部触发条件，不代表真机/ARM实机、物理出声或听觉重复已经验证。

## 来源、测试和后续维护

合并现有driver patch与buffer修正，rebuild严格核对两个文件的原始/修正SHA，拒绝部分应用或额外修改；四ABI必须来自同一组当前输入。FFmpeg/JNI/Java/runtime等其他AAR条目必须逐字节保留。

check-short-read.py提取并编译真实源码函数，仅队列/唤醒边界替身。九项覆盖短读/完整/空/静音尾部/第二采样率/paused和underrun。原源码及删除两个关键条件的变体必须失败。tests/mpv-0.41-buffer.c是带原许可证的完整上游测试快照，整文件SHA与重建checkout的原始源码相同；让CI离线检验同一补丁，而不是另一套手写逻辑。它不参与App编译。

升级mpv时，须同时核对上游是否已修复该问题、更新pin/源码测试快照/补丁/四ABI来源并重跑原门限。不要只改manifest散列来绕过重建，不把实验workflow合入产品。

## 产品候选验收状态

本地真实函数9项及原源码/两个负对照、startup helper和21项证据检查器自测通过。另三个源码/快照污染控制被拒绝。完整npm verify实际191套1410 Jest/40 generator/1257 layout、ESLint0/215、TS/static/patch通过；复用已有依赖目录，两个Node工具的精确新锁依赖由云端npm ci另验。本轮未再次执行本地JVM或构建本地App Release，不能冒称本轮176项本地JVM已重跑。

四ABI均已真实重编译，bundle输入及输出一致；除四libmpv外，所有AAR条目逐字节不变。每ABI54个mpv导出与原库相同，SONAME/DT_NEEDED相同、没有新增undefined imports、PT_LOAD最小16KiB；实际buffer对象编译命令使用锁定NDK27.1/API26。库中不含实验AO计数日志。摘要SHA如下：

| ABI | 新libmpv SHA256 |
| --- | --- |
| arm64-v8a | `4ad6a1c158c263d6688bff3fcc4056536f527c15078deba3e21ff709fd23cd09` |
| armeabi-v7a | `455b5dac99dcc38c0449f7d7abb843800963d41be7dd92fb63fa5de53642c7a0` |
| x86 | `c5f067888d1e5f3539e180fea181727275a4c416504991dc99525fe651270a68` |
| x86_64 | `fe095b7144951d043d1f1c48b321e4f655fb62b721a133bf5170489db8b506b0` |

现有APK包体审计新增mpv实际payload SHA；ZIP_STORED/DEFLATED同内容检查通过，删除该报告字段的变体失败。新Beta须逐包对照bundle来源，避免把旧缓存嵌入包也误判通过。原DEX/16KiB门限不变。

正常新CI/API36和新产品Release Beta/all仍待实际云端验证。实验包和Beta206复用的旧APK不能代替新产品库验收。Beta签名配置校验不等独立生产证书验签。all不包含library/perf，未运行的范围不得宣传覆盖。
