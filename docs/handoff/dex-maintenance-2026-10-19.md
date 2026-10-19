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

最终 R8 Release、启动/安装对照、整合质量门、设备回归待真实完成后填写。Debug 仪器通过不能单独证明 R8 Release 的反射、JNI、MMKV 迁移或 GIF 正常。未连接真机，不声称物理音频、真机耗电或性能提升。
