# 当前架构与支持范围

> 适用于 `feat/mpv-only` 分支（`package.json` 版本 0.7.3），最后核对日期 2026-10-02。
> 本文与源码不一致时以源码为准，并请在同一个改动里更新本文。

## 平台与支持范围

| 项目 | 当前状态 | 依据 |
| --- | --- | --- |
| 发布平台 | 只发布 Android APK | `.github/workflows/android-build.yml`、`build-beta.yml` |
| 播放内核 | 只有 mpv（libmpv）；Nitro 内核及随它提供的投屏、均衡器已移除 | `src/core/playerAdapter/index.ts`；提交 `793aa1ad` |
| 最低 Android 版本 | 安装包声明 API 24；播放内核 libmpv 要求 API 26，通过 `tools:overrideLibrary` 强制合并。API 24–25 设备能安装，但不在播放支持范围内，也未验证 | `android/build.gradle`（`minSdkVersion`）、`android/app/build.gradle`（libmpv 依赖注释）、`android/app/src/main/AndroidManifest.xml` |
| targetSdk | 36 | `android/build.gradle` |
| iOS | 保留 `ios/` 目录，本分支不构建、不验证，不承诺可运行 | 没有 iOS 构建流程 |

## 模块与依赖方向

| 模块 | 入口 | 职责边界 |
| --- | --- | --- |
| 播放 | `src/core/trackPlayer/index.ts`（`TrackPlayer` 门面）→ `src/core/playerAdapter/mpvPlayerAdapter.ts` → `android/app/src/main/java/fun/upup/musicfree/mpvplayer/` | JS 负责用户意图、队列与播放规则；native 负责实际加载与播放、进度、通知、锁屏和媒体键 |
| 插件与音源 | `src/core/pluginManager` | 插件按可信代码对待（提交 `c46675b0`）；插件方法经 `PluginMethodsWrapper` 包装，取源走统一的音质兼容层 |
| 下载 | `src/core/downloader.ts`、`src/core/downloadFinalizationRunner.ts`、`src/core/downloadFinalizationJournal.ts` | 任务调度与传输；最终化按日志阶段推进（产物就绪含解密、写标签、写歌词、加入音乐库、提交附加信息），中断后从记录的阶段继续 |
| 本地音乐 | `src/core/localMusicSheet.ts` | 扫描、元数据缓存、匹配与提交 |
| 存储 | `src/utils/keyValueStore` | 原子写入的文件键值存储（提交 `9bfccd41` 起替代 MMKV） |

依赖规则：

- 页面通过业务入口执行操作，不在页面里直接组合插件调用、播放器状态修改、文件写入与持久化。
- `src/core` 不依赖 `src/pages`。
- 纯规则（各模块的 `*Policy.ts` 与状态转换函数）不依赖 React、原生模块或文件系统，可以直接单元测试。
- 跨模块只调用明确的入口，不新增全局事件总线，也不直接修改其他模块内部的 atom。
- 保留 Jotai 与现有 external store；先明确状态归属，不同时迁移状态库。

## 依赖安装

- Node.js 版本见 `package.json` 的 `engines`（`>=22.13.0`），CI 使用 Node 22。
- 用 `npm ci` 按锁文件安装，安装后 `postinstall` 会重放 `patches/` 下的补丁。
- `package-lock.json` 中大部分包的下载地址是 `registry.npmmirror.com`。无法访问该镜像的环境可以运行
  `npm ci --replace-registry-host=always`，改从当前配置的 registry 下载；锁文件中的 `integrity` 校验不变。

## 质量门

- `npm run verify`（`generator/verify.mjs`）：静态审计与 TypeScript（`audit:round20-static`）、只读 ESLint、Jest、`patch-package --check`。检查只读，不修改工作区。
- `npm run lint:check` 只检查；`npm run lint` 会自动修复文件。
- CI 共用 `.github/actions/quality-gate`：`npm ci` 后运行 `npm run verify` 和 `git diff --check`。
  稳定版构建（`android-build.yml`）、Beta 构建（`build-beta.yml`）和 PR / 推送检查（`ci.yml`）都先通过它。
- 稳定版构建另外运行 `npm audit --omit=dev --audit-level=high`，有高危漏洞时不发布。
  2026-10-02 核对时该审计未通过（axios、@xmldom/xmldom、brace-expansion 等有新公告），需要单独升级依赖。
- 原生代码由两套构建中的 `assembleRelease` 编译；`npm run audit:round20-native` 需要本地 Android 环境，不在 CI 质量门中。

## 核心行为清单

测试通过只说明对应的规则成立，不代表设备行为已验证。没有设备记录的场景一律记为“未验证”。

| # | 场景 | 自动化覆盖 | 设备验证 |
| --- | --- | --- | --- |
| 1 | 搜索：两个来源一快一超时，先看到成功结果，只重试失败来源 | 待补（首个切片） | 未验证 |
| 2 | 搜索：连续搜索 A、B 且 A 最后完成，B 不混入 A 的结果或错误；分页失败后重试同一页 | 待补（首个切片） | 未验证 |
| 3 | 播放：连续下一首、指定播放、切音质与暂停，旧 START/END/error 事件不覆盖最终意图 | 相关单元测试：`src/core/trackPlayer/__tests__/manualSkipCoordinator.test.ts`、`qualityChangeCoordinator.test.ts`、`src/core/playerAdapter/__tests__/mpvPlayerAdapter.test.ts`（未逐条核对是否覆盖本场景） | 未验证 |
| 4 | 播放：冷启动恢复某曲后立即修改同一曲的音质或进度，旧恢复不覆盖新意图 | 相关单元测试：`src/core/trackPlayer/__tests__/sourceRecoveryPolicy.test.ts`（未逐条核对） | 未验证 |
| 5 | 播放：JS 暂时不活跃时 native 连续切到已准备的曲目，恢复后界面、通知与队列一致 | 相关单元测试：`src/core/playerAdapter/__tests__/mpvQueue.test.ts`（只覆盖 JS 侧） | 未验证 |
| 6 | 下载：最终化各阶段中断或重启后，文件、任务、音乐库一致，重复恢复幂等 | 相关单元测试：`src/core/__tests__/downloadFinalizationRunner.test.ts`、`downloadFinalizationJournal.test.ts` | 未验证 |
| 7 | 本地音乐：重扫、文件移动、重复导入、权限撤销与重新授权 | 相关单元测试：`src/core/__tests__/localMusicScanPolicy.test.ts`、`localMusicSheetPolicy.test.ts` | 未验证 |
| 8 | 播放器初始化失败、切后台再回前台，恢复入口不重复 | 相关单元测试：`src/core/trackPlayer/__tests__/playerStartupPolicy.test.ts` | 未验证 |
| 9 | 代表性 Android 版本与厂商、耳机/蓝牙、锁屏下的核心流程 | 无 | 未验证 |

## 历史材料

- `docs/release-notes-v0.7.3.md`：v0.7.3 发布记录（tag `v0.7.3`，提交 `fe9c5fd0`）。其中关于 Nitro 播放内核、Google Cast、Nitro 均衡器与 WorkManager 的内容只适用于该版本。
- 更早版本的说明以对应 tag 下的文件为准。
- `generator/audit-round20-*.mjs` 的名称沿用 Nitro 迁移期的 Round 20 编号；其中 `audit:round20-static` 仍在质量门中运行。

## 待定事项

- **minSdk**：安装下限（API 24）与播放内核要求（API 26）不一致。把 `minSdkVersion` 提到 26 会让 API 24–25 设备无法安装新版本，需要单独决定。
- **Nitro 遗留的原生依赖**：`android/app/build.gradle` 默认仍打包 Nitro 时期的 `musicfree-media3-ffmpeg-decoder` AAR（`musicfreeEnableNitroFfmpeg` 开关），而 `android/app/src/main/java` 中已没有 Media3 或 FFmpeg 的引用。是否移除需要构建与设备验证后再定。
- **iOS**：是否继续支持需要单独定义。
