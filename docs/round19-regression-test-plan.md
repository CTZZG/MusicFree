# Round 19 真机回归测试计划

更新时间：2026-06-03

## 目标

验证 RN 0.85 / Expo 56 / React 19 升级分支在 Android 真机上没有明显影响体验的回归问题，并重点覆盖这轮已经暴露过的问题：底部播放栏、首页发现、榜单/推荐歌单、最近播放封面、播放详情页和播放器恢复。

## 测试环境

- 分支：`codex/round19-rn-expo-upgrade`
- 包类型：release APK
- 设备：用户连接的 Android 真机
- 插件：至少包含 GD 聚合音乐，并保留当前插件排序

## 必测清单

| 编号 | 场景 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| R19-01 | 冷启动首页 | 强制停止应用后重新打开 | 首页正常渲染，底部播放栏不空白，发现板块加载排序第一插件源的排行榜预览或显示加载态 |
| R19-02 | 发现板块 | 等待首页发现加载完成 | 不停留在单个“榜单”兜底卡片；预览卡片数量有限，不无限横滑加载全部榜单 |
| R19-03 | 榜单入口 | 点击首页发现右侧“查看” | 进入榜单页，不闪退、不进入错误页，Tab 可切换 |
| R19-04 | 榜单详情 | 点击一个榜单 | 进入榜单详情并加载歌曲列表，不闪退 |
| R19-05 | 推荐歌单入口 | 返回首页后点击快捷入口“推荐歌单” | 进入推荐歌单页，不闪退，Tab 可切换 |
| R19-06 | 继续听 | 点击首页“继续听”卡片或播放按钮 | 可以播放/暂停或进入播放详情，不闪退，按钮位置不偏移 |
| R19-07 | 底部播放栏 | 点击底部播放按钮和播放列表按钮 | 播放按钮居中，点击命中正确；播放列表面板可打开 |
| R19-08 | 最近播放封面 | 查看首页最近播放横滑列表 | 可正常显示已有歌曲封面；无封面或加载失败时显示默认图，不出现异常崩溃 |
| R19-09 | 搜索 | 搜索一首歌并切换源 Tab | 搜索结果列表正常，封面/音质标签显示稳定，Tab 不触发错误 |
| R19-10 | 播放详情 | 从底部播放栏进入播放页，切换封面/歌词 | 详情页不闪退，歌词加载、迷你歌词和返回手势稳定 |
| R19-11 | 应用恢复 | 播放到非零进度后杀进程重开，点击播放 | 播放栏恢复当前歌曲，点击播放不闪退，进度恢复行为可接受 |
| R19-12 | 构建 | 执行 release 构建 | `:app:assembleRelease` 成功产出 APK |

## 日志检查

每个真机动作后抓取 `adb logcat`，重点搜索：

- `AndroidRuntime`
- `FATAL EXCEPTION`
- `JavascriptException`
- `ReactNativeJS`
- `TypeError`
- `ReferenceError`
- `PROCESS_DIED`

## ADB 坐标规范

真机点击坐标必须来自 `adb shell uiautomator dump` 的控件 `bounds`，再计算中心点。不要直接用截图预览里的目测坐标，因为截图在桌面端显示时会被缩放，容易导致点击整体偏上或偏左，出现“本来想点播放栏却点到我的歌单”“本来想点查看却点到搜索栏”这类误测。

## 当前记录

- 2026-06-03 真机回归：通过。
- 构建：`android\gradlew.bat :app:assembleRelease --no-daemon --console=plain` 通过，产物为 `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`。
- 安装：`adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` 通过。
- R19-01 / R19-02：强停重开后 3 秒首页发现显示加载态，约 13 秒加载出排序第一插件源 `GD聚合音乐` 的有限榜单预览，不再先落到泛化“榜单”兜底卡片。截图：`%TEMP%\musicfree-home-r19-3s.png`、`%TEMP%\musicfree-home-r19-13s.png`。
- R19-03：用 UI bounds 点击首页发现右侧“查看”（`[1113,321][1231,402]`，中心 `1172,362`）进入榜单页，未闪退。截图：`%TEMP%\musicfree-r19-toplist-view.png`。
- R19-04：点击榜单页第一项进入榜单详情，歌曲列表正常加载，未闪退。截图：`%TEMP%\musicfree-r19-toplist-detail.png`。
- R19-05：点击快捷入口“推荐歌单”（`[804,1894][1035,2084]`，中心 `919,1989`）进入推荐歌单页，切换源 Tab 未闪退。默认 GD 聚合音乐推荐歌单为空时显示空态，这是插件数据状态，不是页面崩溃。
- R19-06：点击首页“继续听”卡片（`[41,1189][1231,1464]`，中心 `636,1326`）进入播放详情，未闪退。截图：`%TEMP%\musicfree-r19-continue-card.png`。
- R19-07：底部播放按钮 bounds 为 `[954,2627][1076,2749]`，中心 `1015,2688`；点击播放按钮和播放列表入口均命中正确，播放列表面板可打开。截图：`%TEMP%\musicfree-r19-playlist-panel.png`。
- R19-08：首页最近播放横滑列表显示歌曲封面；部分歌曲使用默认封面时无异常崩溃。截图：`%TEMP%\musicfree-r19-reopen-play.png`。
- R19-09：搜索 `love` 后结果页正常显示，多源 Tab、封面、音质标签和底部播放栏正常。日志中仅出现无关 `com.tencent.mm` 的 `PROCESS_DIED`，未出现 MusicFree 侧 RN/JS/FATAL。截图：`%TEMP%\musicfree-r19-search-love.png`。
- R19-10：从底部播放栏进入播放详情，封面、迷你歌词、播放控件正常显示，未闪退。截图：`%TEMP%\musicfree-r19-music-detail.png`。
- R19-11：强停重开后底部播放栏可恢复当前歌曲，点击播放按钮不闪退、不空白。截图：`%TEMP%\musicfree-r19-reopen-play.png`。
- R19-12：release 构建通过。

## 仍需关注

- 真机日志中仍有 `Could not find generated setter for class com.reactnativepagerview.PagerViewViewManager` 这类 RN generated setter warning，当前不影响使用，也没有触发崩溃。后续如果继续推进 RN 0.85 分支，可以在依赖稳定后再评估是否需要处理。
- 推荐歌单在 GD 聚合音乐源下可能为空，这是插件返回数据问题或当前标签为空，不属于本轮升级导致的闪退回归；后续可以单独优化空态提示和默认标签选择。
