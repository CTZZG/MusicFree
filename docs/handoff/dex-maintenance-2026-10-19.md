# DEX、依赖与取源职责整理（2026-10-19）

本轮从 v0.12.0 / `3559b1e076602605f5bcf6f76c4e623669609cbe` 开始。用户授权按打包、退役清理、R8、职责拆分的顺序执行。保持 Android 14 / API34、0.12.0 / 400033；不合并、不创建版本标签、不发布正式 Release，不恢复旧 Android 支持。

## 选择与边界

- 下载体积与代码复杂度分开处理。0.12.0 的原始 DEX 比旧版更小，APK 增大主要因为 AGP 在 minSdk>=28 时默认不压缩 DEX。恢复压缩不意味着播放逻辑提速。
- `packagingOptions.dex.useLegacyPackaging=true` 明确恢复 DEX 压缩；构建后实际读取 ZIP 条目，拒绝未压缩 DEX。正式/Beta 都保存包体报告，签名门保持原样。旧 `build_ref` 缺审计脚本时明确不宣称执行过检查。
- 不为行数拆文件、不换状态库、不删除暂停/焦点/超时保护；这类保护有真实设备回归背景。R8 先裁剪未使用 Java/Kotlin 代码，保留名称；资源裁剪与 SDK 默认优化策略不在本轮扩大。

## 独立提交

| 改动 | 已有证据 |
|---|---|
| `50af9c2a` DEX 压缩及产物检查 | 实际 Gradle Release 成功，ARM64 未签名包 43,217,517 bytes；4 个 DEX 都 DEFLATED |
| `bb86cb79` 退役依赖/不可达源码 | 实际 Release 成功，ARM64 42,335,913 bytes；只删除 libffmJNIb.so / libffmpegJNI.so，其余 37 个原生库逐字节相同 |
| `9fa7a417` Fresco 对齐 | 旧 GIF 2.5.0 / core 3.6.0 组合真实 JAR 加载报 IncompatibleClassChangeError；两者 3.6.0 的同一加载检查通过；版本来自 RN 的 expoLibs 目录 |
| 取源拆分 `63171f0b` | 相关 Jest 304 项、TS、目标 ESLint、运行时循环审计通过；AST 对照 126 个保留方法、11 个迁移方法主体一致 |

这些本地 APK 未使用正式证书。后续整合构建和设备结果另列，不能把分阶段产物冒充最终候选。

## 当前组合的本地结果

- 对齐后的 R8 / `fd764383` 构建实际成功，无 R8 告警或缺失类；ARM64 未签名 APK 34,636,125 bytes，DEX 从 36,940,068 降至 14,078,272 bytes，类数从 29,115 降至 15,306。
- 直接读取构建产物的 class_defs / class_data：105 个 ID3 标签体均保留公开构造函数；FLAC pictureType 字段、9 个 CENC native 方法、MPVLib 49 个方法和所检查 Nitro JNI 类均存在；退役 Media3 解码类不存在。这是二进制契约检查，不能替代真实调用。
- 原生库只因 Fresco 对齐改变了 libgifimage.so；mpv、FFmpeg 及其他原生库与清理阶段字节一致。
- 隔离工作区的完整 verify：189 套 / 1,394 Jest，40 generator，1,257 layout，ESLint 0 错误 / 215 警告，TS、patch-package 与循环审计通过。最终组合的 src、generator、package/lock 内容与这份已验证源码逐字节一致。原本已退役模块的测试一并删除，新增解析器测试 6 项。
- 首次完整 verify 因警告少于基线而失败，随后仅将 inline-styles 19→18 收紧；没有放宽质量门。隔离工作区未构建 ReleaseManifest，对应审计分支明确跳过，需在实际构建工作区补查。
- 250ms 转场采样上限、0.25s 连续性容差、暂停观察窗均未修改。正式签名门未修改。

## 退役范围及仍需保留的依赖

删除两个旧 Media3 / ExoPlayer FFmpeg AAR、配套旧生成器与两份 JNI wrapper；删除没有生产调用者的 mediaFormatDiagnostics、playingIndicator、sourceMeta、colorUtil，以及只服务于已删除模块的测试。净删除约 3,000 行，不将这些原本就未进入 JS bundle 的模块宣称为明显提速来源。现用队列同步方法改为 Adapter 命名，没有删除队列功能。

| 必需组件 | 实际用途 / 可删除条件 |
|---|---|
| libmpv / libav* / libc++ | 当前播放与格式支持、JNI/ELF 链接契约；更换播放内核前不能按 FFmpeg 名称删除 |
| react-native-mmkv / nitro-modules | 从旧 MMKV 搬迁用户设置与歌单；需明确迁移退出决策和真实数据夹具后才能移除 |
| Expo 液态玻璃及 Compose | 迷你播放器通过 requireNativeViewManager 动态注册使用；静态无直接 import 不代表无用 |
| Fresco animated-gif | RN Image 的 GIF 解码，必须跟随 RN 目录版本，不能单独留在 2.x |
| AndroidX media | mpv 系统媒体会话、通知、锁屏控制 |

历史文档、迁移接口和 MMKV 的 Nitro 命名仍有意义，不能按字符串批量删除。react-native-permissions 收益很小，本轮未扩大到移除它。

## R8 契约

- MPVLib 自带 AAR consumer rule；应用 CencNative 的 Java_* JNI 入口保留；React Native/Expo consumer rules 和 MMKV/Nitro 的 Keep/DoNotStrip 注解继续生效。
- jaudiotagger 动态用 FrameBody+文件内 ID 构造 ID3 标签体：仅保留这组类的公开构造函数；FLAC 的 pictureType 私有反射字段单独保留，不全包 keep。
- 不新增全局 dontwarn、不通过放宽告警伪造构建成功。第一次 R8 虽构建成功，但暴露了 Fresco 父类/接口冲突，因此该诊断包不作为候选。已用真实 JAR 前后对照定位，对齐后须重新构建和运行。

## 职责归属

`PlaybackSourceResolver` 拥有来源元数据、远程地址/加密准备、插件期限、直接/刷新取源和备用来源查找。依赖仅为运行时配置 getter、插件管理器 getter、备用来源展示回调。每次请求的取消检查/TimedOutSources 由调用者传入，不积存在共享解析器中。

TrackPlayer 继续拥有点歌事务、队列提交、native load/seek、暂停意图、焦点与过期请求防护。15s BackgroundTimer、备用搜索 8s、质量尝试顺序及原始/记住来源优先级不变。既有集成测试仅把 spy 指向新所有者，未降低断言。新增 6 项直接覆盖来源顺序、刷新驱逐、依赖注入和迟到结果取消。

`audit:runtime-cycles` 已接入 `npm run verify`。TrackPlayer 仍很大，startPlayback 等事务编排尚未进一步拆分；本轮只抽取一个责任，不宣称架构债全部清零。

## 验证限制与待补结果

本地 SDK36 已实际编译两阶段 Release。软件 API34 虚拟机无 KVM，不能代表手机或硬件加速模拟器的速度。并行编译时的安装没有完成，不算应用测试通过；后续串行测量需保留失败和 A/B/A 完整数据。两份压缩实验 APK 的 1228 个运行内容条目哈希相同，仅 DEX 压缩不同，均为公开调试签名，不作为交付 APK。

## 最终产品 `6a26eff3` 的实际验收

- 本地最终组合 Release 为 ARM64 34,637,161 bytes（未签名），Release XML 28 套 / 149 项，失败、错误、跳过均 0；实际 ReleaseManifest 审计通过。
- 软件 API34 上将该真实 R8 Release 用公共调试证书重签，未开启 debuggable。独立测试 APK 从目标包加载真实类：ID3 五类反射构造、FLAC 私有字段、CENC 空句柄 JNI 错误路径、mpv 初始化/读版本/释放、GIF 红蓝两帧 JNI 像素解码，5 项均过。`ao=null` 不证明物理音频，也没有验证真实 CENC 解密或完整 RN GIF 控件。
- PR CI `39185518929` 实际 Debug Gradle 测试与下载 XML 28 套 / 149 项全过。Android16 `39185518919` 新编 app/test APK，89 项清单全部 code0（含辅助类测试）；native25、慢加载73、正常 JS70、按钮 UI20/两截图、冻结5完整。冻结确为 RAW_STALLED，7 暂停窗不动；最大转场间隔78ms，原门限未改。
- [Beta182](https://github.com/CTZZG/MusicFree/actions/runs/39197303335) 真实执行 Release 单测及 R8、打包和 APK 压缩审计。五包全部通过压缩检查，ARM64 为 **34,653,230 bytes**；签名 configured/validation passed。大包标准 gh API 下载返回 exit1/0bytes/Forbidden，未独立核对 Beta APK 哈希和证书，配置检查不是 apksigner。
- Beta182 的 Android14 `all`：**109 个唯一项 109PASS/0FAIL**，包含锁屏、Doze、省电、存储迁移与备用来源下载。四份初装/升级插件前提记录的 SHA256 与本提交源码一致；下载 PCM 完整解码为5,760,000 bytes，SHA256 `f7534ef5a05f837b2e40050b6688b3012a32f088fab462951241390c5c11cbde`，与来源B夹具相同，原歌曲标签正确。任务身份/来源是运行时 KV 检查，未另存原始任务快照；128k 是插件标签，音频约16kbps。`all` 不包括 library/perf。
- 另观察到 RNDeviceInfo 的可选 InstallReferrer.newBuilder 被 R8 移除并被 SDK 内部捕获；src 无此 API 调用。没有为未使用的可选 SDK API 添加整包 keep，不声称所有外部库 API 均保留可调用性。

## 启动对照失败与逐次留证

[Beta183](https://github.com/CTZZG/MusicFree/actions/runs/39204390411) 复用182与旧 Beta177（源码332c12ca），没有打包。旧包已是API34下限，与3559的生产差异只有版本、无用import和空行。该对照不等于同payload的压缩隔离实验。

对照实际 **51PASS/2FAIL**：旧包前组第9次缺 home-drawn，只有9个有效主页首帧；旧包后组第0次预热缺 first-screen/splash-hidden，只有10行、没有预热行。新包完整预热1+有效10次，中位数2712.5ms、P95 3336ms。外层完整性检查正确拒绝两组旧包，不能用新包一组或旧包残缺数据宣称提速/回退。旧包缺标记的真实原因尚未确认，不能直接归为基础设施故障或产品故障。

旧脚本在下一次启动前清日志，没有逐次保留失败启动命令和现场。本次后续提交只改测试留证及本文档，产品仍是6a26eff3：每次保留启动输出/退出码、清日志输出和**同一份用于解析的标记快照**；缺标记/解析失败时，在下次 force-stop 前有界保存全日志、PID、活动/窗口和截图。诊断不替代任何指标，不补采、不重试失败样本、不增加等待、不修改统计规则；原60s/10s等待和预热1+10协议保留。

本地12项比较/留证自测通过，包含实际出现的缺home字段、缺预热行，以及诊断命令自身失败；旧脚本和禁用失败留证的反证均被拒绝。带逐次留证的复验只复用现有APK，不重新大打包；即使复验通过，也不将其写成已修复旧包启动问题。最新运行结果以PR48描述为准，保留183原失败。

未连接真机，不声称物理音频、真机耗电或性能提升。Debug 仪器通过不能单独证明 R8 Release 的全部运行契约。

## 183 / 184 / 91 后续根因与修复

Beta184（`39206636537`，脚本31ff、仍复用182/177 APK）实际35PASS/2FAIL。旧包前组和新包分别都有预热1+有效10次，但旧包后组在初次进入首页时失败，尚未进入采样。前两组中位数2041.5 / 1813ms不能替代完整A/B/A结果。初次启动的 am start 返回成功，之后截图已回到桌面；没有足够证据将其称为系统故障。

同头 Android16 #91（`39206620868`）的89项原生清单、正常JS70、UI20均通过，随后冻结控制却在启动ReactHost时发生原生SIGSEGV，冻结样本为0。它不是预期的RAW_STALLED，也不是完整回归通过。匹配本项目 libreactnative.so 的 BuildID `008588050d46ef8090fe6c9ab6a8b2808b97bdfe` 后，反汇编确认 MountingCoordinator 正在经失效委托的虚表调用，跳到了不可执行的堆内存。

### screens 4.25.2 竞争

`ScreensModule.initialize` 注册生命周期观察者与安装Fabric观察者之间，可以有UI线程的 onHostResume 同时进入 nativeAddMutationsListener。原C++对共享指针的懒初始化没有锁；两个线程可能同时构造/写入委托，回调还捕获了可能已失效的NativeProxy。这个路径与上游同版本、同RN0.85.3的崩溃报告及[已合并的修复4413](https://github.com/software-mansion/react-native-screens/pull/4413)吻合（上游合并提交 `b3badd012f83679b12f4e29f2e28eceaa4830efd`）。不能据此倒推184一定发生了同一次崩溃。

本轮通过 patch-package 回移该修复的四个C++文件，适配4.25.2的cpp目录布局，不升级整套依赖：

- 使用线程安全初始化的进程级委托，适应RN只能追加委托、没有注销API的接口。
- 在锁内替换回调并按值保留JNI全局引用；回调在锁外执行，避免JNI重入死锁。
- 用所有权token避免旧ReactHost失效时清掉新Host的回调；失效后已排队的安装在访问Fabric前退出。
- 不改R8保留、播放/焦点/暂停规则、音频后端、版本或系统下限。将来升级screens至包含4413的兼容版本时，删除这份回移补丁并重新验证。

`generator/check-rnscreens-listener.py` 直接编译安装包内的真实NativeProxy/Listener源码；只在JNI和Fabric边界使用host夹具，不冒充设备JNI测试。六项行为检查通过，覆盖并发安装、失效后排队安装、旧Host拆卸、重入和委托寿命。ThreadSanitizer在旧源码的100轮双线程安装中捕获共享指针读写竞争；相同夹具修复后100轮通过。竞争有时序性，另一次旧源码重复运行未触发，原记录保留。夹具在取得UIManager引用后模拟3ms绑定工作，不改变任何生产计时。删除排队保护或token保护的两个独立反证均被拒绝。

SDK36已真实编译隔离后的x86_64 screens C++源码，编译命令明确指向修复文件，完整Release组装仍待结束核对。此前构建虽然成功，产物复查却发现自动链接缓存仍指向共享目录中的旧screens；该包不算修复验证，已保留记录、清除本工作区生成缓存并重新构建，不修改共享依赖。本地完整verify189套1394Jest/40generator/1257layout、ESLint0错误/215警告及7份补丁回放通过。本轮新建的软件API34虚拟机未完成系统启动：APEX映射超时、缺失conscrypt启动文件，之后系统服务反复退出；已经停止，仅作为环境失败记录，没有任何本轮应用设备通过结论。

### 保住初次启动日志及新的对照方法

已核对Maestro2.8.0的AndroidDriver：开始设备日志采集时会执行logcat清空。新增host持续采集在安装/第一次am start之前启动，进入首页后停止；EXIT也清理。它跨越Maestro清空操作保留已有日志，不重试、不延长等待、不补样本。比较/留证自测现13项通过。

接下来候选必须重新打包并通过真实设备回归，因为screens原生产品输入已变化。性能控制包从清理前的3559b1e0构建，**也应用相同screens补丁**，保持0.12.0/400033及相同原生修复；其余仍为未优化输入。这样不让新旧两边的崩溃修复差异混入性能收益。两包生成后再做一次同机旧→新→旧、每组预热1+有效10次。它仍是整个优化组合的比较，不是DEX压缩单变量实验。新运行的实际证据以PR描述为准，不将旧182或残缺183/184结果写作新候选验收。

## 外部复核后的标签反射修正

`aa7e7099` 已完成CI174、API16 #92、Beta186全量和同机性能187；结果保留在PR描述。187三组各预热1+有效10，中位数2980/2976.5/2823.5ms，**没有稳定提速证据**。这些是该提交的历史验证，不覆盖下述新增R8修正；PR已重新转draft等待新候选验证，不合并、不发布、不改版本/API34。

复核指出FrameBody保留不等于完整标签反射契约。已经用实际aa7的R8 Release DEX确认：`NumberHashMap(NumberHashMap)` 被删，多个ASF/WMA reader也缺无参构造器。再用本项目AGP8.12.0实际嵌入的R8 **8.12.14** 缩减原始jaudiotagger2.2.5和只调用AudioFileIO的driver：旧规则下v2.3 MP3/WMA失败、v2.4对照成功。新两条定向规则后，三文件的标题/歌手/专辑/歌词/封面完整写入回读均成功。不是根据另一个R8版本的结果直接推断。

- 保留datatype家族的公开构造函数，满足旧版ID3转换时`ID3Tags.copyObject()`按真实字段类型找拷贝构造函数的调用。
- 保留实现ChunkReader的无参构造函数，包括非公开构造函数，满足ASF容器在同包中使用Class.newInstance的调用。不整包keep，不降低缺类/签名/性能门限。
- 新`generator/check-tagging-release.py`在Beta及正式构建中检查**实际五APK的DEX定义和方法原型**，以原始依赖JAR的javap构造函数清单为准，并核对host smoke使用的R8版本与实际Release mapping一致。host smoke不是Android执行，与真实APK检查和设备下载检查分开记录。缺文件、版本变了或案例未完成均失败。
- 新检查能拒绝旧真实APK；本地新真实x86_64 R8 Release检查通过，核对66个datatype公开构造函数、10个ASF无参构造函数，三个host格式均过。实际DEX为15,314个class_defs；同类本地未签名包36,256,782→36,261,514 bytes。Release单测任务本地合法UP-TO-DATE，不冒充本次重新执行；新CI/Beta另核对实际XML。
- 备用下载的tone-b改为ID3v2.3，原始音频逐字节解码相同（5,760,000 bytes，PCM SHA256仍f7534ef5…c11cbde）。旧R8读取这个实际新夹具会报NumberHashMap缺构造函数；不是仅把文件命名成v2.3。guard也检查夹具头，防止将来悄悄换回v2.4。
- 新WMA下载用例仅用专用查询出现，不改变原搜索队列/旧流程点击位置。源文件标签故意是Before Title/Artist/Album；实际Release必须写成E2E Tagged WMA/E2E Artist/E2E Album，并完整解码比较音频。即使下载状态成功，写标签被吞也会失败。10项shell故障自测覆盖旧标签未改、缺标签、解码/复制/前提失败。
- 另删除logTransport中退役nitro-player环境变量分支，trace仍由显式persist控制。没有增加产品测试入口。

后续需真实新Beta全量及同一R8包的library套件。187不重跑以声称新规则带来性能收益；其提交范围与本轮新候选分开标注。新运行的实际结果继续记录在PR描述，保留此前所有失败和APK独立下载/真机限制。
