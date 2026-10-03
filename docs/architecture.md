# 当前架构与支持范围

> 适用于 `feat/mpv-only` 分支（`package.json` 版本 0.9.0），最后核对日期 2026-10-03。
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
| 搜索 | `src/core/search`（`SearchSession`）← `src/pages/searchPage/hooks/useSearchSession.ts` | 会话负责请求编排与各来源状态；页面只订阅快照、调用会话操作，见下文 |
| 下载 | `src/core/downloader.ts`、`src/core/downloadFinalizationRunner.ts`、`src/core/downloadFinalizationJournal.ts` | 任务调度与传输；最终化按日志阶段推进（产物就绪含解密、写标签、写歌词、加入音乐库、提交附加信息），中断后从记录的阶段继续 |
| 本地音乐 | `src/core/localMusicSheet.ts` | 扫描、元数据缓存、匹配与提交 |
| 存储 | `src/utils/keyValueStore` | 原子写入的文件键值存储（提交 `9bfccd41` 起替代 MMKV） |
| 导航 | `src/core/router`、`src/pages/home/index.tsx` | 根栈加主页的底部标签（首页、搜索、资料库、设置）；搜索标签沿用 `search-page` 路由名，从其他页面跳搜索用 `navigateToSearch`，先回到主页再切标签 |
| 外观 | `src/core/theme.ts`、`src/core/themeAppearance.ts`、`src/components/base/glassBackdrop.tsx` | 只有 iOS 风格的浅色、深色两套配色，默认跟随系统；旧主题（液态硅胶、自定义配色）在启动时迁移为跟随系统。标签栏和迷你播放器的毛玻璃在 Android 12+ 模糊各自的 `BlurTargetView`（主页标签内容、根栈），玻璃必须放在目标外面；做不到真模糊时改用接近不透明的磨砂底（`glassMaterial.ts`） |

依赖规则：

- 页面通过业务入口执行操作，不在页面里直接组合插件调用、播放器状态修改、文件写入与持久化。
- `src/core` 不依赖 `src/pages`。
- 纯规则（各模块的 `*Policy.ts` 与状态转换函数）不依赖 React、原生模块或文件系统，可以直接单元测试。
- 跨模块只调用明确的入口，不新增全局事件总线，也不直接修改其他模块内部的 atom。
- 保留 Jotai 与现有 external store；先明确状态归属，不同时迁移状态库。

## 搜索

- `SearchSession`（`src/core/search/searchSession.ts`）负责一次搜索的关键词、参与的来源，以及每个来源每种类型的页码与状态（加载中、有结果、无结果、失败）。
- 开始新的搜索时，之前的请求全部失效，迟到的结果和错误都被丢弃。搜索页是常驻的底部标签，点“取消”时会话被重置；
  其他页面带关键词跳转时（`navigateToSearch`）开始新的一次搜索。
- 每个来源独立加载、独立失败：任意一个来源返回后就展示结果，其余来源在各自的标签里继续加载。
- 单个来源单次请求最多等待 15 秒。失败按原因区分为 `timeout`、`error`、`invalid-result`、`source-unavailable`，页面据此给出不同提示。
- 重试只重新请求失败的那个来源的失败那一页，已加载的页保留；“加载更多”不会跳过失败的页。
- 取消语义：插件的 `search` 没有取消接口。超时或被取代的请求只是不再等待，插件内部的网络请求仍会继续，结果被丢弃。
- 页面通过 `hooks/useSearchSession.ts` 按来源订阅快照：一个来源的结果变化不会让其他来源的列表重新渲染。
- 歌词搜索面板（`src/components/panels/types/searchLrc`）仍使用自己的请求编排，尚未接入会话。

## 依赖安装

- Node.js 版本见 `package.json` 的 `engines`（`>=22.13.0`），CI 使用 Node 22。
- 用 `npm ci` 按锁文件安装，安装后 `postinstall` 会重放 `patches/` 下的补丁。
- `package-lock.json` 中大部分包的下载地址是 `registry.npmmirror.com`。无法访问该镜像的环境可以运行
  `npm ci --replace-registry-host=always`，改从当前配置的 registry 下载；锁文件中的 `integrity` 校验不变。

## 质量门

- `npm run verify`（`generator/verify.mjs`）：静态审计与 TypeScript（`audit:round20-static`）、只读 ESLint、Jest、构建脚本自己的 node:test 用例（`generator/lib/*.test.mjs`，新加的自动纳入）、`patch-package --error-on-fail`（补丁打不上时本地也失败）。不修改仓库文件；`node_modules` 里还没打上的补丁会被打上，与 postinstall 相同。
- `npm run lint:check` 只检查；`npm run lint` 会自动修复文件。
- CI 共用 `.github/actions/quality-gate`：`npm ci` 后运行 `npm run verify` 和 `git diff --check`。
  稳定版构建（`android-build.yml`）、Beta 构建（`build-beta.yml`）和 PR / 推送检查（`ci.yml`）都先通过它。
- 稳定版构建另外运行 `npm run audit:production-deps`（`generator/audit-production-deps.mjs`），有高危漏洞时不发布。
  阻断标准与 `npm audit --omit=dev --audit-level=high` 相同，只放行脚本中登记的例外。例外只能是上游暂无修复版本的公告，并写明原因；
  一旦依赖方接受的版本范围内出现了不受影响的新版本，审计就会失败，提醒升级并删除例外。已不再匹配任何公告的例外只给出警告。
- 2026-10-02 已把有修复版本的高危依赖全部升级（axios、nanoid、brace-expansion、@xmldom/xmldom、browserslist、joi、js-yaml、undici），
  生产依赖的中危条目也已清零（qs 升到 6.16.0；@react-navigation/core 升到 7.23.0，不再依赖 query-string 和 decode-uri-component）。
  开发依赖中 fast-uri、svgo 的公告也已修复（fast-uri 3.1.8、svgo 3.3.5）。发布审计只检查生产依赖；
  目前完整的 `npm audit`（含开发依赖）也只剩下面登记的例外。
  当前登记的例外：
  - node-forge（GHSA-86w9-cpqp-85rv）：最新 1.4.0 仍受影响，经 `expo` → `@expo/cli` 引入，只用于 Expo 更新包签名，本项目构建不使用，也不打进 APK。
  - image-size（GHSA-5p2g-fcmc-qvqq、GHSA-w3rx-r6r6-pgpr）：只在 2.x 修复，而 metro 各版本都依赖 `^1.0.2`；metro 只在打包时读取仓库自带的图片，不打进 APK。
  - braces（GHSA-vfj7-8cjw-p6xm，2026-10-03 登记）：最新 3.0.3 仍受影响，经 `expo` → `@expo/cli` → `@expo/metro-file-map` → `micromatch` 引入，只在打包时匹配仓库自己的路径规则，不处理外部输入，也不打进 APK。
    `npm audit` 建议的“降级 expo 到 44”只是绕开这条依赖链，不能采用。
- `brace-expansion` 通过 `overrides` 固定为 5.0.12，`patches/brace-expansion+5.0.12.patch` 让旧版 minimatch 仍能把它当函数调用；升级版本时需要同时重新生成补丁。
- `patches/react-native+0.85.3.patch` 让所有 ScrollView（含 FlatList、SectionList、FlashList 和手势库的 ScrollView）在 Android 上默认 `overScrollMode="never"`。越界拉伸、回弹还没结束时，原生 ScrollView 会把下一次按下当成「停住回弹」拦掉，滚到底后第一下点不动。个别页面需要回弹时显式传 `overScrollMode`。`TabView` 不经过 ScrollView，在各处单独设置。升级 React Native 时需要重新生成补丁，`npm run verify` 会在补丁打不上时失败。
- 原生代码由两套构建中的 `assembleRelease` 编译；`npm run audit:round20-native` 需要本地 Android 环境，不在 CI 质量门中。
- Android 单元测试（`android/app/src/test`，纯 JVM，不依赖 Android API）：
  - Beta 和稳定版构建在 `assembleRelease` 之前运行 `testReleaseUnitTest`，失败时不打包、不上传、不发布；
  - PR 和推送检查（`ci.yml` 的 Android unit tests）在改到原生代码、原生依赖或这项检查本身时运行 `testDebugUnitTest`，判断规则见 `generator/lib/nativeChanges.mjs`，拿不准时照样运行；没改到时任务直接以成功结束；
  - 三处都上传测试报告，测试失败时也上传。

## 核心行为清单

测试通过只说明对应的规则成立，不代表设备行为已验证。没有设备记录的场景一律记为“未验证”。

| # | 场景 | 自动化覆盖 | 设备验证 |
| --- | --- | --- | --- |
| 1 | 搜索：两个来源一快一超时，先看到成功结果，只重试失败来源 | `src/core/search/__tests__/searchSession.test.ts`、`src/pages/searchPage/hooks/__tests__/useSearchSession.test.tsx` | 未验证 |
| 2 | 搜索：连续搜索 A、B 且 A 最后完成，B 不混入 A 的结果或错误；分页失败后重试同一页 | `src/core/search/__tests__/searchSession.test.ts` | 未验证 |
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
