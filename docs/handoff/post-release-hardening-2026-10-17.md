# v0.11.5 后续：OGG 尾标签、歌词 UI 任务及插件安装前提

基于 `feat/mpv-only` 的 `967a6cc17be9df3996f679d23b2d3cc15d2d9297`。
本轮不修改版本、minSdk、音频内核、播放意图或既有设备验收门限，不合并或发布新版本。

## 复核结论及实现

### 完整 OGG 后面的 ID3v1 / APE 尾标签

v0.11.5 的流式写入在尾部遇到非 Ogg 数据会失败，临时文件删除、原文件保持。
更早的实现遇到坏尾部会停止解析，写封面时丢弃该尾部；不能说旧版保留了尾标签。

本轮只在 Vorbis 音频已 EOS、最后一页的包已完整结束时，识别占满剩余文件的
ID3v1 或 APEv1/v2 标签序列。APE 支持可选头部、按 footer 声明长度倒查；
长度、版本、保留字节及头尾不一致时仍拒绝，不重新编码 APE 条目。
使用固定大小随机读取和流式复制，不把整个标签或音频放进内存。
已识别尾部逐字节保留；未知垃圾、物理截断及不完整标签仍失败，保留原文件。
标签不能代替前一个音频包的结束，包括空 EOS 页之前仍未结束的包。
没有修改既有页粒度内存界限，也没有把它扩成完整的 Ogg 语义校验器。

### 在歌词 UI 任务内部捕获异常

旧 setter 的 try/catch 包住投递动作，抓不到以后在主线程执行时抛出的异常；
部分 Promise 还会在 UI 操作之前就 resolve。

新增 `LyricUiTaskRunner`，把普通 Exception 的捕获放进 Runnable，同时处理投递失败。
实际操作完成后才 resolve；异常走 Promise.reject，保留 Throwable。展示选项的
类型读取也在该边界内。已有 View 内部自行处理的失败仍遵循其原有行为，
没有增加桌面歌词入口、权限或数值修正规则，也不把 OOM 等 Error 吞掉。

设备用例调用真实 `LyricUtilModule` / `LyricView`：主线程先排队，确认 Promise
未提前完成；真实 WindowManager 对未附着 TextView 的更新抛出异常，检查 reject
后主线程仍可使用；错误的展示选项类型也应 reject。View 不真正挂载，不依赖
悬浮窗权限。测试清理只释放自己创建的对象。

### 插件安装前提与诊断

Beta 159 只确认安装对话框关闭，却在搜索页发现无搜索插件。日志确有 DNS 异常，
但原始插件安装异常没有保存，不能确认“已安装后的注册竞态”。159 / 160 / 161
的实际范围已补入 `audiotrack-startup-clock-2026-10-16.md`，旧失败不抹掉。

确认框关闭现在只记“确认外部插件安装请求”。随后在 30 秒内读取 `plugin.cache`
和 `plugin-meta` 的应用快照，校验挂载项身份、path、固定 REF 下原始插件文件的
SHA256、单曲搜索能力和未禁用，才记另一项“验证插件安装”通过。
这是持久化挂载证据，后续真实搜索步骤仍验证页面与结果，不以缓存代替页面检查。
首次 A/B 安装和旧版升级后重装复用同一入口，前提失败即阻止依赖步骤执行。

该检查需要可 adb root 的测试模拟器；这成为所有选择该安装流程的套件的明确前提，
包括以前仅尽力记录插件状态的 perf。CI 的 google_apis 模拟器具备此前提。
它不修改产品插件注册、网络重试或搜索逻辑。

原始缓存仅写上传目录以外的临时目录，附件只保存测试插件验证结果。
失败时导出安装诊断的选定字段，远程 URL 被隐藏；诊断读不出时输出
`available: false`，而不是把“没有诊断”当作“没有安装错误”。不保存插件代码、
无关插件配置或任意完整 KV 文件。测试模拟器异常断连时前提照样失败。

## 本地验证

- 独立 Kotlin/JUnit：OGG 8 项、UI runner 6 项全部通过。OGG 的有效标签组合
  覆盖独立音频页、末个头页共用音频及单独空 EOS 页三种布局；截断、未结束包、其他逻辑流
  的 EOS 和伪造标签长度仍拒绝。原 48 MiB 音频 / 24 MiB 子进程堆检查保留。
- 将实际 `967a6cc1` 的 OGG 源码放回 scratch，新 8 项有 1 项失败；旧式 UI
  外层捕获模式的 scratch 对照在 6 项中失败 3 项。后者是旧代码模式对照，
  不是旧 APK 的设备测试。实验不留在提交中。
- 四种真实 Vorbis 尾部（ID3v1、无头 APE、有头 APE、APE + ID3v1）写封面后，
  尾字节保持；ffmpeg `-xerror` 完整解码各为 96000 字节 PCM，均等于原音频的
  SHA256 `87c7e098ae499af0f9732823fd1493886f203caa27343d0e56d110fbcf6e7b52`。
  Android 新用例另外核对尾字节、封面及移除尾标签后的实际 Vorbis 包/时间戳；
  不把该包检查说成 Android 完整文件 PCM 解码。
- 插件检查器 12 项、shell 调用链 16 场景通过：延迟挂载、确认但未挂载、错误
  源码、无搜索能力、禁用、快照损坏/读失败、无 root、确认失败、诊断缺失/损坏、
  升级后重装、请求发起失败及证据目录创建失败均覆盖；失败不得记安装验证 PASS，
  父脚本失败计数必须增加。
- 初次完整 `npm run verify`：1397 Jest / 48 generator / 1257 layout；
  ESLint 0 错误 / 216 警告，TypeScript、静态审计及补丁重放通过。

### 实际 Android 构建及本地软件虚拟机

官方完整 JDK 17、SDK 36、NDK 27.1 下，实际生成 x86_64 app / androidTest APK，
包括 Kotlin、Java、C++ 和 DEX。最终源码的 Debug Gradle XML 为 26 套 / 146 项，
failure/error/skipped 均 0。独立主机的 14 项不另加到这 146 项上。
额外 `audit:round20-native` 入口因仓库 gradlew 没有执行位而报 EACCES，未进入
其 Release Kotlin 分支、不算通过；上述本地 Android 任务实际使用 `bash gradlew`。

API 28 软件虚拟机中，3 项真实歌词模块与 3 项 OGG 仪器全部 code 0。
相同测试 APK 换上使用实际 `967a6cc1` 歌词模块源码的诊断应用后，真实 setter
时序用例 code -2，明确为 `Promise settled before the UI operation ran`，不是
初始化失败。恢复同一修复 APK 后，6 项再次全部 code 0。
诊断应用还包含本轮其他代码，不冒充 v0.11.5 原始发布 APK。

已独立拉回安装文件核对：

- 固定测试 APK：`831f72d9caa648e8e41c081ca87260558bb2b817baa3b69ee2e431b84e2f95a7`。
- 修复应用：`b6415b8e96c2c4976574d2bbe6e25ea6223cdbeb3011af75da999af6cdcbe03f`。
- 旧歌词模块诊断应用：`b0ba0d873f09706bf73dd301b3fe68eaf2b76d8dc4575a15dae0b39688547651`。

本地原始日志及哈希在 `/workspace/scratch/followup-device/`。
早期快照恢复后窗口服务超时、首轮安装超时均保留，没有作为产品通过或失败。
冷启动后，系统堆栈确认 `BackgroundDexOptService_PostBootUpdate` 正在为
Google Play 服务执行 dexopt 并持有安装锁。仅取消该开机任务与对应 GMS 子进程后，
安装完成；没有放松本应用的安装验证或 UI / 引擎测试窗口。安装客户端此前的
300 秒超时仍保留，完成状态以设备包记录及独立拉回的同字节 APK 核对。

提交后的 CI / Android 16 / Beta 证据待追加。API 28 软件模拟器不替代 API 36 或真机。
物理音频、厂商省电和新 AudioTrack 库在 ARM 真机上的定量表现仍未系统验收。
