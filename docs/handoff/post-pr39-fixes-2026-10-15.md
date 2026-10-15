# PR #39 后续小修与验收（2026-10-15）

用户授权 Codex 接手 #39 收尾、三个小问题和发版前验收。版本号保持 0.11.4 /400030；本轮不创建正式 Release。#39 的最终 9cc926ca all/perf 已完成，最后 7d03d458 仅文档变化，已普通合并为 59b6919d。本文件记录本轮后续代码，准确运行结果随后补在独立 PR 描述里。

## 三个问题及修复

### OGG 封面写入内存

原实现先 readBytes 整首文件，拆成完整页列表，再构造完整输出 ByteArrayOutputStream、复制结果写盘，音频体积因此直接放大峰值内存。原始实现的实际 Kotlin 方法在 32 MiB JVM 堆中处理约 48 MiB 的容器输入，直接在 File.readBytes 抛 OutOfMemoryError。Android Base64/Log 在本地控制实验中由 JVM 替身提供，未在本地编译 Android。

新实现把纯容器处理放到 OggCoverRewriter，Android 门面 OggCoverWriter 保持原 API。只保留三个 Vorbis 头包，音频逐页读写（单页最多 65,307 字节），重算 CRC 和目标流的序号，保留音频包、granule、标志和其他逻辑流序号；也保留最后一个头页里已有的音频。头包累计上限 16 MiB，超过时返回失败并保留原文件。

写入仍在同目录临时文件里完成；校验/读取/替换失败会删临时文件并保留原文件，不再通过截断原文件的复制操作兜底。没有增加依赖或改变支持的容器（仍为 Vorbis，不支持的头包安全失败）。

独立对照：同一约 48 MiB 容器输入，新门面在 24 MiB 堆下写入成功。6 项 JVM 用例覆盖标签/旧封面替换、跨页头包、同页音频、逻辑流序号、截断保全和受限堆。把整文件读取放回去，受限堆回归失败。受限堆用例仅在宿主 JVM 运行；Android 共用测试源但不把宿主 java 子进程测试算作设备验证。

真实 3 秒 Vorbis fixture 写封面前后，ffmpeg 完整解码的 PCM SHA256 都为 `29664fc6b2ca5d38acb68d0a07f93fec35c6f9ce76fac753f2b1346e985617c0`，ffprobe 的 title/artist 保留，并识别到 front cover。大容器仅用于内存压力，不把其重复音频包称作真实歌曲播放验收。

设备新增两项：调用真实 OggCoverWriter 和 Android Base64，核对写入前后的 MediaExtractor 音频包及时间戳哈希一致、图片块含原图；截断文件安全失败且原始字节不变。它们不验证物理出声，也不测 Android 实际峰值堆。

### 桌面歌词颜色

原 rgba2argb 只按字符串长度 9 判断 RGBA，合法的 `lightgray` 也被重排；非法设置直接交给 Color.parseColor 抛异常。更新调用投递到主线程，外层 try 不保证能捕获异步 UI 异常。

新 LyricColors 仅转换带 # 的 CSS/RN 十六进制顺序；保留颜色名称，支持短十六进制和 transparent。首次显示的坏值回退默认色，更新中的坏值保留上一颜色。showLyricWindow 和 setColors 都使用同一路径。

4 项纯 Kotlin 用例验证 RGBA、短十六进制、名称和坏值回退。恢复旧转换和不捕获行为，3 项失败。新增两项 Android 用例在主线程用真实 LyricView.setColors、TextView 和 Color.parseColor 验证非法值不抛错、颜色保持以及 lightgray/transparent 可用。该测试注入 TextView，不要求悬浮窗权限，不代表完整悬浮窗 UI 验收。

### 罗马音缓存清理

MediaCache.clearLocalCaches 只删除原文和翻译，漏掉 $localLyric.romanization。现在复用相同的文件存在判断与 canRemove 并发保护清理第三种文件。

测试走真实 MediaCache 删除、全清和 1500 条触发的自动淘汰，并在罗马音文件检查期间更新缓存，确保旧淘汰不删新数据。8 项全部通过；恢复旧实现时 4 项失败。

## 本地验证

- 完整 npm run verify：1397 Jest /48 generator /1257 layout，ESLint 0 错误 /216 警告，类型检查、静态审计和补丁回放通过。
- 独立 JVM 编译本轮纯容器/颜色逻辑和测试：10 项通过；两个回退 mutant 合计 4 项失败（内存 1、颜色 3）。没有本地完整 Android SDK 编译。
- 实际 Android 编译、原生单测和四项新增设备用例等待本 PR 的 CI/Android 16 结果；不按投影数量报通过。

### Android 16 #69 编译失败与修正

当前 d040e7ec 的 CI #139 已实际执行 Debug Gradle 单元测试；下载 XML 后是 24 套件、133 项，失败、错误、跳过均为 0。Beta #156 固定产品源码 a0b98a21 的 Release XML 也是 24 套件、133 项全零。它们没有编译或运行 Android 仪器用例，不能代替设备结果。

Android 16 #69 在 `:app:compileDebugAndroidTestKotlin` 失败：新增 LyricColorsInstrumentedTest 直接实例化了 React Native 0.85 已为抽象类的 ReactApplicationContext，尚未进入模拟器检查。这是新增测试夹具的编译错误，保留该失败记录。修正后复用已有、实现完整抽象方法的 NativePlaybackTestContext，并公开该测试类和构造器供歌词测试使用；颜色设置、真实 TextView/Android Color、清理与所有断言都不变。仅修改仪器夹具和文档，不改变产品代码，也不重复 Beta 大打包。实际设备验收仍待修正后的 Android 16 运行。

## 发版前验收范围

另补真实 React 页面按钮的 Android 16 验收：原有真实 JS 流程结束后，在同一个 ReactHost/引擎上注入 paused-for-cache 原生事件，分别截图并点击播放页与迷你播放器的缓冲暂停按钮。每次确认实际引擎暂停、后到的 cache-ready 事件不覆盖暂停、观察至少 4 秒，再从真实按钮主动恢复。独立导出 20 条 JNI/媒体会话/原生意图读数和两张截图，原有 70 条正常/5 条冻结证据保持不变。注入的是缓冲状态事件，不是真实断网或慢文件，也不宣称暂停期间新文件已经到达；后者仍由已有慢文件仪器用例和真实控件 Jest 覆盖。

这次仅新增测试，产品代码与先前 a0b98a21 相同。Beta #156 固定构建 a0b98a21，不重复打包；新增真实 UI 仪器逻辑由更新后的 PR Android 16 工作流重新编译执行，不能把旧设备运行当作新测试通过。

#39 的 CI/Android 16 已在已复核 head 上完成；最终 Beta #154 all 和 #155 perf 要按各自实际来源与结果记录，不能用早先 APK 或实验替代。#155 已下载原始结果：29 个唯一项全部 PASS，源码 9cc926ca；此台模拟器的新主页帧提交中位数约 3194 ms /P95 4203 ms。不同运行机器的绝对数不能直接与 #153 的同机对照 2206 ms 比较来推断产品回退或额外收益。

本轮小修需要自己的 Debug/Release XML、Android 16 新增原生用例和全量 Beta 回归。原有引擎观测保留 250 ms /0.25 s 门限和冻结 RAW_STALLED 控制。

当前环境没有连接的实体 Android 设备。实体机验收尚未完成，不写成模拟器已代替真机。准备本轮 Beta 安装包后，实体机仍需检查：

1. 连续冷启动、启动中回桌面再进入、切换系统主题/重建：开屏正常移除、页面正常可交互，无明显空白。
2. 页面和迷你播放器缓冲图标实际点击暂停，文件到达后仍暂停，主动播放后恢复。
3. 真实视频应用临时打断后自动恢复；打断前/期间主动暂停后继续保持暂停。

这三项的实体设备结果是 0.11.5 发版前剩余条件。本轮不改版本或创建 Release，也不把引擎位置、提取器音频包或 PCM 解码结果写成扬声器出声证据。
