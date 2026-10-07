# 当前架构与支持范围

> 适用于 `claude/sharp-planck-xtfenm` 分支的 mpv-only 实现（`package.json` 版本 0.11.0），最后核对日期 2026-10-07。
> 本文与源码不一致时以源码为准，并请在同一个改动里更新本文。

## 平台与支持范围

| 项目 | 当前状态 | 依据 |
| --- | --- | --- |
| 发布平台 | 只发布 Android APK | `.github/workflows/android-build.yml`、`build-beta.yml` |
| 播放内核 | 只有 mpv（libmpv）；Nitro 内核及随它提供的投屏、均衡器已移除 | `src/core/playerAdapter/index.ts`；提交 `793aa1ad` |
| 最低 Android 版本 | 安装包声明 API 24；播放内核 libmpv 要求 API 26，通过 `tools:overrideLibrary` 强制合并。API 24–25 设备能安装，但不在播放支持范围内，也未验证 | `android/build.gradle`（`minSdkVersion`）、`android/app/build.gradle`（libmpv 依赖注释）、`android/app/src/main/AndroidManifest.xml` |
| targetSdk | 36 | `android/build.gradle` |
| iOS | 保留 `ios/` 目录，本分支不构建、不验证，不承诺可运行 | 没有 iOS 构建流程 |
| 应用内检查更新 | 读本仓库 GitHub Releases 的最新正式版（`api.github.com`），连不上时用 jsDelivr 取最新的版本标签。“从浏览器下载”直接下与手机 CPU 架构对应的 APK（没有就下通用版），“备用链接”是发布页；对话框里显示发布说明中“下载”以外的各节。仓库里的 `release/version.json` 是上游的更新机制，应用不读 | `src/utils/checkUpdate.ts`、`src/hooks/useCheckUpdate.ts` |

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
- App 在后台也要跑的播放协调代码（通知栏、锁屏切歌，自然切歌，淡入淡出）不用 RN 的普通定时器：Activity 暂停后
  `setTimeout`、`setInterval` 不再触发，回到前台才一次性补跑。用 `@/utils/delay`（默认后台定时器）或
  `react-native-background-timer`。手动切歌的确认如果仍然醒得远晚于约定时间（JS 被挂起过），以原生实际在放的曲目为准，
  不再重载目标或回滚。

## 搜索

- `SearchSession`（`src/core/search/searchSession.ts`）负责一次搜索的关键词、参与的来源，以及每个来源每种类型的页码与状态（加载中、有结果、无结果、失败）。
- 开始新的搜索时，之前的请求全部失效，迟到的结果和错误都被丢弃。搜索页是常驻的底部标签，点“取消”时会话被重置；
  其他页面带关键词跳转时（`navigateToSearch`）开始新的一次搜索。
- 每个来源独立加载、独立失败：任意一个来源返回后就展示结果，其余来源在各自的标签里继续加载。
- 单个来源单次请求最多等待 15 秒。失败按原因区分为 `timeout`、`error`、`invalid-result`、`source-unavailable`，页面据此给出不同提示。
- 重试只重新请求失败的那个来源的失败那一页，已加载的页保留；“加载更多”不会跳过失败的页。
- 取消语义：插件的 `search` 没有取消接口。超时或被取代的请求只是不再等待，插件内部的网络请求仍会继续，结果被丢弃。
- 页面通过 `hooks/useSearchSession.ts` 按来源订阅快照：一个来源的结果变化不会让其他来源的列表重新渲染。
- 单曲的来源标签前有「全部来源」，不带指定来源的搜索默认进入它（`resultPanel/allMusicResults.tsx`），不另发请求，
  读同一个会话。按各来源原有排名交错排列；标题、歌手、专辑和取整到秒的时长都完整且一致时才合成一组、可选来源
  （`src/core/search/aggregateMusicResults.ts`），信息不全、同一来源里有多个相同信息的 ID 时分别列出。列表顶上只列出
  失败的来源（可重试），加载中、结果数看来源标签；点歌沿用 `basic.clickMusicInSearch`。合成一组的歌下面挂一行
  「⇄ 其他来源：…」，从歌名那一列开始、紧贴着那首歌（对齐用 `MUSIC_ITEM_ARTWORK_TEXT_INSET`），点开按来源选择播放；
  以前是一整行「选择来源（N 个）」，离上下两首一样远，真机上看不出是哪首歌的。
- 歌词搜索面板（`src/components/panels/types/searchLrc`）仍使用自己的请求编排，尚未接入会话。

## 依赖安装

- Node.js 版本见 `package.json` 的 `engines`（`>=22.13.0`），CI 使用 Node 22。
- 用 `npm ci` 按锁文件安装，安装后 `postinstall` 会重放 `patches/` 下的补丁。
- `package-lock.json` 中大部分包的下载地址是 `registry.npmmirror.com`。无法访问该镜像的环境可以运行
  `npm ci --replace-registry-host=always`，改从当前配置的 registry 下载；锁文件中的 `integrity` 校验不变。

## 质量门

- `npm run verify`（`generator/verify.mjs`）：静态审计与 TypeScript（`audit:round20-static`）、ESLint（只读，见下）、Jest、构建脚本自己的 node:test 用例（`generator/lib/*.test.mjs`，新加的自动纳入）、布局测试（`tests/layout/*.test.mjs`）、`patch-package --error-on-fail`（补丁打不上时本地也失败）。不修改仓库文件；`node_modules` 里还没打上的补丁会被打上，与 postinstall 相同。
- `npm run lint:check` 只检查；`npm run lint` 会自动修复文件。
- ESLint 警告按规则设基线（`generator/eslint-warning-baseline.json`，`generator/eslint-ratchet.mjs`）：verify 中有报错就失败；
  某条规则的警告比基线多（包括基线里没有的规则）就失败，并列出这条规则的全部警告；比基线少也失败，提示运行
  `npm run lint:baseline` 把基线降下来再提交，免得空出来的名额以后被新警告悄悄用掉。`lint:baseline` 只降不升，
  也不会加入新规则；确实要提高时（例如升级 ESLint 配置）手改 JSON，并在提交里写明原因。按规则比较，
  修掉一条 A 规则的警告不能抵消新加的一条 B 规则的警告。
  `lint:baseline` 先通过错误和回归检查再写入；解析错误导致警告统计不完整时保留原基线。
- 布局测试（`tests/layout`，`npm run test:layout`）：渲染真实组件，用与 React Native 同一代的 Yoga（`yoga-layout`）按 RN 的配置排版
  （errata 兼容模式、按像素密度取整），再检查「谁不能压住谁、什么不能被裁掉」这类语义，而不是比对像素。
  - 覆盖播放页（竖屏方形、圆形、大图三种封面，横屏两种封面）、推荐歌单网格、插件用户变量表单（含 WebDAV、Last.fm），
    在 320～412 dp 宽的竖屏、320～363 dp 高的横屏、系统字体 1～2 倍下各跑一遍，表单另外分中英文；
  - 推荐歌单整页（标题栏、音源标签、分类标签条、网格、加载失败／到底提示、出错和没有插件时的空页面）和歌单类别面板、
    榜单整页（标题栏、音源标签、各分组的方卡和预览横卡、加载中、出错、没有插件）和榜单面板（含窄于窗口的面板）、
    歌单、榜单、专辑详情和自己的歌单详情（标题栏、封面和简介、播放按钮区、歌曲行及「更多」的点击区域、长按进入的
    多选模式、加载中、出错）、搜索页（搜索框、搜索历史、类别和来源两层标签、四种结果、搜索中、没有插件、来源超时、
    全部失败、多选）、歌手详情（头部、单曲和专辑两个标签和列表）：
    320、363 dp 竖屏和横屏，中英文，系统字体 1、1.3、1.5、2 倍；
  - 资料库的网格／列表、悬浮底栏也用真实组件检查：中英文、窄屏、横屏安全区，栏内触摸区域至少 44 dp；
    资料库另查滚到底时最后一个歌单露在底栏上方，底部预留按生产的规则计算；歌单的 ⋮ 不带底色、不压文字和封面、
    点击范围至少 44 见方且不伸进旁边一格，「我喜欢」入口，没有自己的歌单时的新建和导入。各套件的组合维度不同，见各测试文件；
  - 渲染时包上与 App 相同的字体缩放范围（`inAppFontScaleScope`），没登记的页面里 `ThemeText` 不放大，2 倍用例也只放大 `Text`；
  - 文字宽度按 Roboto 的字宽估算、按 Android 的规则断行，比真机略宽，几个 dp 以内的差别不拿来断言；
  - 「被裁掉」看的是能不能看到：overflow 不是 visible 的视图两个方向都裁，滚动容器在不能滚动的方向上照常裁
    （`scrollEnabled={false}` 的滚动容器两个方向都按普通的裁剪算）；
    在能滚动的方向上，滚动视口和外层裁剪祖先共同留下一个可见窗口，内容只能在 0～最大滚动量之间移动，窗口扫过
    的范围盖住整个元素才算看得到（列表里排在屏幕下面的格子、横向滚出屏幕的标签可以滚进来；视口被外层裁掉一截、
    整个在外层可见区之外、滚到底也露不出来的都算被裁）；
  - 工具只认识明确支持的样式、宿主组件和依赖，其余一律报错；页面用到的原生模块和运行时服务由测试显式给桩（`tests/layout/stubs.mjs`，
    含 FlashList 网格、react-native-tab-view 的标签栏（能滚动、不能滚动，点标签切页），以及有返回键的普通页面共用的
    一组 `createPageStubs`）；
    `SafeAreaView` 的桩和 react-native-safe-area-context 5 一样：每一层都按根上的 Provider 取安全区、叠加在自己的内边距上，
    嵌套两层同一条边就让开两次（`harness.test.mjs` 固定了这一点）；
  - `renderLayout` 返回的 `interact` 在 act 里做一次交互（例如长按歌曲）后重新排版，用来检查交互之后才出现的界面；
    onLayout 和 RN 一样按宿主实例回调：新挂载的视图（换 key、隐藏后重现）收到第一次回调，已挂着的只在排版变了时回调；
  - 排版结果里的节点打印时只显示类型、标签、文字和位置，宿主实例、Yoga 节点、父子节点不可枚举：assert 生成差异时
    会展开到 1000 层，顺着宿主实例走遍整棵 React 树会让失败的测试卡住几十秒、吃掉十几 GB 内存；
  - 工具自身的行为由 `tests/layout/harness.test.mjs` 固定。排查时可以用 `dumpTree` 打印排版结果。
- 系统字体放大：目标是全部跟随系统字体。直接用 `Text` 的地方本来就跟随；`ThemeText` 以前一律关掉了缩放，
  现在按页面、面板逐个放开：核对过的登记在 `src/constants/fontScaleMigration.ts`，路由入口（`src/entry`）和面板入口
  给它们包一层跟随系统的 `FontScaleScope`，没登记的保持原样（不放大）。主页（`home` 路由）的四个标签各自再包一层
  （`src/pages/home`），按 `fontScaleMigratedHomeTabs` 决定，盖过 `home` 路由那一层；标签栏本身跟着 `home` 路由，还没迁移。
  - 迁移一个页面：布局测试按 1、1.3、1.5、2 倍检查（渲染时包上与 App 相同的范围）→ 先处理固定高度的容器 →
    放不下时先省次要的行 → 只有尺寸固定、又没法省掉的紧凑控件才用 `maxFontScaleConst.compact`（1.5 倍）封顶，
    正文、标题、说明不封顶 → 登记 → 真机用大字体看一遍。全部迁移完以后 `ThemeText` 改为默认跟随，删掉名单。
  - 已迁移：播放页（`music-detail`）、插件用户变量表单（`SetUserVariables` 面板，WebDAV、Last.fm 设置也用它）、
    推荐歌单页（`recommend-sheets`）和它的歌单类别面板（`SheetTags`）、榜单页（`top-list`）、
    歌单详情（`plugin-sheet-detail`）、榜单详情（`top-list-detail`）、专辑详情（`album-detail`）和自己的歌单详情
    （`local-sheet-detail`）、歌手详情（`artist-detail`），从歌曲行点出来的选项面板（`MusicItemOptions`）和加入歌单
    面板（`AddToMusicSheet`），主页的搜索标签（`search-page`），以及播放页点出来的音质（`MusicQuality`）、播放
    失败处理（`PlaybackRecovery`）、播放队列（`PlayList`）和歌词字号（`SetFontSize`）面板。
  - `ListItem` 在跟随系统字体的页面、面板里用最小行高（字体放大时跟着变高），没迁移的地方保持固定行高。
  - 推荐歌单：分类标签条按标签定高（最小 `rpx(100)`），也不再被下面的长列表压矮（以前横屏时 1.3 倍字体就裁掉标签）。
    共用的列表底部提示（`ListFooter`）改为最小高度，没有插件的提示（`NoPlugin`）占满宽度、留页边距（以前横屏时偏在左边）。
    面板标题和其他面板一样单行，放不下时截断。
  - 推荐歌单、榜单的音源标签和歌手详情的单曲、专辑标签共用 `TabLabel`：名字宽 80 dp 乘系统字体倍数，放下 5 个粗体
    汉字、更长的截断——选中（粗体）和未选中两份文字叠在一起，必须同宽，所以不按文字长短自适应。搜索歌词面板的标签名
    还是固定宽度、字号却跟着系统放大，迁移时改用它。
  - 搜索页：输入框（`TextInput`）的字一直跟着系统放大，搜索框改为最小 36 高、输入框撑满框高（点框里任何地方都能输入）。
    类别、来源两层标签共用 `ResultTabLabel`：名字下面一行结果数／加载中／失败，按文字排宽，上下限（50～76 dp）乘系统
    字体倍数——下限放得下「加载中...」，结果回来时不变窄；上限放得下 5 个粗体汉字和「Failed to load」。名字先按粗体排
    一份看不见的占位，看得见的那份盖在上面，选中前后同宽。历史关键词胶囊改为最小高度，太长时截断、两头留内边距。
  - 列表行标题后面的来源角标（`TitleAndTag`）不再和标题一起缩：以前标题一长，角标被挤成一两个字；现在放不下时只截断
    标题，特别长的来源名由 `maxWidth` 截断。歌曲行、专辑、作者结果都用它。
  - 歌手详情：头部高度跟着内容走，列表往下滚时在 0 和量到的内容高度之间收起、展开（以前固定 350rpx 高，字体一大简介就
    压到标签上）；名字一行放不下时截断，来源角标完整显示；单曲、专辑标签栏可以横向滑动（窄屏 2 倍字体时第二个标签露不全）。
  - 榜单：方卡的大小由网格决定，标题条压在封面上，2 倍字体时两行标题几乎盖住整张卡，所以方卡标题封顶 1.5 倍；
    带歌曲预览的横卡不封顶，按内容变高，每行放不下时截断。
  - 歌单、榜单详情（共用 `MusicSheetPage`，专辑详情也用它）：歌曲行（`MusicItem`）由固定 64 改为最小 64，字体放大时跟着
    变高；时长一栏最小 36 dp 乘 `ThemeText` 实际的放大倍数（`useThemeTextFontScale`，没迁移的页面里是 1），超过一小时的
    跟着变宽，不再折成两行；音质、写入状态角标改为最小高度并封顶 1.5 倍。播放、随机播放两个按钮并排、高度固定，标签
    封顶 1.5 倍；收藏、加入歌单、批量编辑一行放不下时折行（英文在 320、363 dp 的手机上 1 倍字体就放不下）。多选模式的
    顶栏折行，底部操作栏高度固定、标签封顶 1.5 倍。
  - `ListItem` 里占满行高的部分（图标、文字、内容区）用 `alignSelf: "stretch"`，不用 `height: "100%"`：行只有最小高度时，
    Yoga 按百分比算出的高度不对，列表里的行会被撑得很高（布局测试里复现过）。有点击事件的图标外面那层可点视图也要
    撑满行高，否则点击区域缩成图标那么大，点图标上下会点到整行（歌曲行的「更多」就会变成播放）。
- 安全区：每条边只由一层 `SafeAreaView` 负责。`VerticalSafeAreaView` 名字叫 Vertical，实际四边都让开（含
  `ShortcutPageSurface`），里面不能再套 `HorizontalSafeAreaView`；react-native-safe-area-context 5 的每个 `SafeAreaView`
  都按根上的 Provider 取安全区叠加，嵌套就让开两次。榜单、歌单／榜单／专辑详情（`MusicSheetPage`）、本地音乐、
  歌单浏览、批量编辑、本地歌单详情原来都套了两层，横屏时左右各多让一次，已去掉里层。设置页、搜索页外层只让上下，
  里层让左右，不重复；搜索页的搜索框和大标题以前在让左右的那层外面，横屏时没让开刘海，已挪进去。
  - 播放页的导航栏、进度时间、角标、上滑提示封顶 1.5 倍；歌名区不封顶，横屏放不下时先省专辑、歌手行。
    迷你歌词是固定高度的窗口，不跟随系统放大（点开歌词页可以看完整歌词，那里有单独的字号设置）。
  - 歌词页的歌词（原文、翻译、音译、逐字）只按歌词自己的字号设置显示，不再叠加系统字体（`allowFontScaling={false}`），
    字号面板的说明和按钮仍跟随系统。档位 0～3 照旧（`rpx(24/30/36/42)`，默认 1），新增 `rpx(54/66/84)` 三档，覆盖以前
    最大档叠加 2 倍系统字体的范围（`src/utils/detailLyricFontSize.ts`）。以前靠系统大字体看大歌词的用户，升级后要在
    字号面板里自己选大一档。
- CI 共用 `.github/actions/quality-gate`：`npm ci` 后运行 `npm run verify` 和 `git diff --check`。
  稳定版构建（`android-build.yml`）、Beta 构建（`build-beta.yml`）和 PR / 推送检查（`ci.yml`）都先通过它。
- 稳定版构建另外运行 `npm run audit:production-deps`（`generator/audit-production-deps.mjs`），有高危漏洞时不发布。
- 稳定版的 Release 正文就是 `docs/release-notes-v<版本>.md`，只写给用户看的内容：下载哪个文件、升级前要注意的行为变化、
  新功能、改进与修复；不写测试数、Beta 编号、验证过程这类过程性内容。提交、构建时间、签名在附件 `android-build-info.txt`
  和构建日志里，不追加到正文。发版后要改说明：改这个文件并合入 `feat/mpv-only`，再手动运行 Android Release Build、
  勾选 `notes_only`，只更新正文，不重新构建、不动安装包；同一分支上正在跑的构建会让它排队。
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
    变更路径用 NUL 分隔读取，重命名按删除＋新增检查，移出原生目录的旧路径也会触发；
  - 三处都上传测试报告，测试失败时也上传。
- 模拟器端到端测试（`e2e/`，怎么跑、怎么加检查见 `e2e/README.md`）：Beta 构建打包后默认在 Android 14 模拟器（x86_64，
  GitHub Actions）上装刚打出的 APK，用 Maestro 点界面，用 `dumpsys media_session` 看实际播放（进度由 mpv 上报，不是界面
  数字）。覆盖：外部链接装插件、搜索点播、后台用媒体键切歌后回到应用不跳回旧歌、播放失败提示和处理方式、后台播完接下一首、
  换到其他来源和不换成别的版本、播放统计。测试音源和音频按提交号从 raw.githubusercontent.com 读取，提交必须已推送。
  只改测试时可以填 `e2e_apk_run_id`，直接测以前某次 Beta 的 APK，不重新打包。结果写进运行的 Summary，截图、Maestro 日志、
  logcat 在附件里，截图和结果另外推到 `refs/e2e/latest`（不在分支列表里，每次覆盖）。

## 标签页、资料库与榜单布局

- 悬浮播放条 60 dp，标签栏 60 dp，间距 8 dp，底部悬浮距离 8 dp；合计预留 136 dp，系统安全区单独叠加。
  尺寸来自 `src/components/musicBar/layout.ts`，页面底部预留与实际栏共用同一套计算。
  播放条封面 44 dp，按钮触摸区域 48 dp；标签图标 24 dp、文字 11 dp，栏内边距 6 dp。
- 标签页与搜索页的大标题为 28 dp，行高 34 dp。
- 资料库右上角在歌单网格与列表之间切换，偏好保存到 `AppConfig` 的 `library.playlistView`，未设置时使用网格。
  两种视图共用歌单打开和管理菜单：长按或点 ⋮ 打开同一个菜单（置顶、分组、删除，删除仍要确认）；网格按扣除横向安全区后的宽度计算。
  ⋮ 和歌曲行一样不带底色、用次要文字色：列表里整行高、和「编辑」右边对齐，行里不再放进入箭头；网格里在封面下面、
  名字右边，点击范围 44 见方，不伸进旁边一格。⋮ 放在歌单那一项的外面而不是里面：那一项是一个无障碍节点，里面的按钮读屏软件点不到。
- “我喜欢”是 `MusicSheet.defaultSheet`（id `favorite`）：播放页 ♥ 收歌和取消都改它，智能歌单的「收藏歌曲」、推荐的加分也读它；
  不能删除、改名、置顶、分组。它不列在「我的歌单」里（「编辑」页本来也不列），而是上面入口卡片里的一行（智能歌单和收藏歌单之间），
  有歌时右边写数量。它的歌单页标题跟着界面语言（存的名字是中文），空的时候说明在播放页点 ♥ 收歌。
  没有自己的歌单时，「我的歌单」下面直接给新建和导入，不显示搜索框和「编辑」。
- 资料库的歌单可以按名称搜索、置顶、分组，整理信息存在 `AppConfig` 的
  `library.playlistOrganization`，不改歌单内容（`src/core/libraryPlaylistOrganization.ts`）。
- 榜单普通手机采用三列圆角方卡，标题位于卡内；宽屏按实际面板宽度增加列数，竖屏最多四列、横屏最多五列。
  面板用 `onLayout` 测量可用宽度，格宽向下取整，避免像素取整把第三张卡片挤到下一行。页边距 16 dp、格间距 12 dp、组间距 24 dp。
  榜单接口附带有效 `musicList` 时展示横向预览卡，最多三首，封面在右侧；预览直接使用接口已有数据。插件返回顺序和点击详情参数保持一致。
- 本轮工程改进与后续字体迁移的交接状态见 [2026-10-04 交接说明](handoff/engineering-ui-2026-10-04.md)；播放失败处理、
  搜索总览、队列编辑、资料库整理、歌词字号（PR #9）的理由与验收计划见 [产品改进记录](handoff/product-improvements-2026-10-04.md)。

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
| 10 | 播放：App 在后台时从通知栏、锁屏点下一首，之后原生又自动连播几首；回到 App 不回退到之前的歌 | `src/core/trackPlayer/__tests__/backgroundManualSkip.test.ts`（真实 TrackPlayer + 假 mpv 后端） | 未验证 |
| 11 | 播放失败后留下可关闭的提示，打开后可重试、换音质再试、找其他来源、检查插件设置；明确的授权／密钥拒绝不再试同一插件的其他音质，单独的 403 仍降级；迟到的旧失败不覆盖新的播放 | `src/core/trackPlayer/__tests__/playbackRecoveryIntegration.test.ts`、`playbackRecovery.test.ts`、`src/components/panels/types/__tests__/playbackRecovery.test.tsx` | 未验证 |
| 12 | 播放队列上移、下移、设为下一首不重新加载、不跳进度；删除、清空可撤销一步，之后再编辑、播放、切歌就不能撤销；删除正在放的歌时，查播放状态期间又有编辑或播放就按最新状态重删，不丢掉，也不抢在没完成的切歌前面换歌 | `src/core/trackPlayer/__tests__/queueEditingIntegration.test.ts`、`queueEditing.test.ts` | 未验证 |
| 13 | 播放：原来源取不到地址时，到其他已启用的来源找同一个录音换过去播：歌名（连同括号里的 Live、伴奏等版本说明）和歌手都一致、两边都有时长且相差不超过 2 秒才算，专辑只用来排序（`src/utils/sameRecording.ts`）；各来源同时搜，最多等 8 秒。记住能播的来源（最多 300 首），下次这首歌原来源再失败时先试它；切歌、预先准备后面几首、播放地址过期重取、换音质也用它，但不在这些地方重新搜。原来源每次都先试，恢复了就照常用。播放页来源标签写“改用 XX”。基本设置里的“播放失败时尝试更换音源”默认改为开启（以前是用歌名搜两条、取最接近的一条，可能放错歌，默认关） | `src/utils/__tests__/sameRecording.test.ts`、`src/core/trackPlayer/__tests__/alternateSource.test.ts`、`playbackRecoveryIntegration.test.ts`、`tests/layout/player.layout.test.mjs`；模拟器：`e2e/` 的 E2E Fallback、E2E Live Only | 未验证 |
| 14 | 播放统计：每一遍从头放出来 2 秒记一次（暂停后继续、往后拖进度还是同一遍，重播、单曲循环算新的一遍；换源播放的单独记），用户看到“播放未成功”时记一次失败和原因；只记来源、结果、原因和音质，不记歌名，只存在本机最近 500 次（`src/core/trackPlayer/playAttemptLog.ts`）。设置 → 基本设置 → 开发选项 → 播放统计显示最近 7 天各来源的次数、换源去向、失败原因和最近 10 次失败，可复制；“复制播放诊断”里也带上全部记录的汇总 | `src/core/trackPlayer/__tests__/playAttemptLog.test.ts`、`playAttemptReport.test.ts`、`playbackRecoveryIntegration.test.ts`；模拟器：`e2e/` 的播放统计 | 未验证 |

## 历史材料

- `docs/release-notes-v0.7.3.md`：v0.7.3 发布记录（tag `v0.7.3`，提交 `fe9c5fd0`）。其中关于 Nitro 播放内核、Google Cast、Nitro 均衡器与 WorkManager 的内容只适用于该版本。
- 更早版本的说明以对应 tag 下的文件为准。
- `generator/audit-round20-*.mjs` 的名称沿用 Nitro 迁移期的 Round 20 编号；其中 `audit:round20-static` 仍在质量门中运行。

## 待定事项

- **minSdk**：安装下限（API 24）与播放内核要求（API 26）不一致。把 `minSdkVersion` 提到 26 会让 API 24–25 设备无法安装新版本，需要单独决定。
- **Nitro 遗留的原生依赖**：`android/app/build.gradle` 默认仍打包 Nitro 时期的 `musicfree-media3-ffmpeg-decoder` AAR（`musicfreeEnableNitroFfmpeg` 开关），而 `android/app/src/main/java` 中已没有 Media3 或 FFmpeg 的引用。是否移除需要构建与设备验证后再定。
- **iOS**：是否继续支持需要单独定义。
