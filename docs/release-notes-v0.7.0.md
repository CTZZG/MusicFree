# 🎵 MusicFree 0.7.0

0.7.0 收录 `feat/mpv-player` 从远端基线提交 `18c71611` 到本版本的改动，重点完善沉浸式播放详情、无封面歌曲补图和跨界面封面一致性。

## 📱 下载选项

发布后可在 [MusicFree 0.7.0 Release 页面](https://github.com/CTZZG/MusicFree/releases/tag/v0.7.0) 下载 APK。

推荐下载（适用于大多数设备）：

- **Universal APK**：[MusicFree-0.7.0-<短 SHA>-app-universal-release.apk](https://github.com/CTZZG/MusicFree/releases/download/v0.7.0/MusicFree-0.7.0-<短 SHA>-app-universal-release.apk)

按设备架构下载（体积更小）：

- **ARM64（推荐）**：[MusicFree-0.7.0-<短 SHA>-app-arm64-v8a-release.apk](https://github.com/CTZZG/MusicFree/releases/download/v0.7.0/MusicFree-0.7.0-<短 SHA>-app-arm64-v8a-release.apk)，适用于大部分现代 Android 设备
- **ARM32**：[MusicFree-0.7.0-<短 SHA>-app-armeabi-v7a-release.apk](https://github.com/CTZZG/MusicFree/releases/download/v0.7.0/MusicFree-0.7.0-<短 SHA>-app-armeabi-v7a-release.apk)，适用于较老的 Android 设备
- **x86_64**：[MusicFree-0.7.0-<短 SHA>-app-x86_64-release.apk](https://github.com/CTZZG/MusicFree/releases/download/v0.7.0/MusicFree-0.7.0-<短 SHA>-app-x86_64-release.apk)，适用于 x86_64 模拟器
- **x86**：[MusicFree-0.7.0-<短 SHA>-app-x86-release.apk](https://github.com/CTZZG/MusicFree/releases/download/v0.7.0/MusicFree-0.7.0-<短 SHA>-app-x86-release.apk)，适用于 x86 模拟器

Release 同时提供 `SHA256SUMS.txt`、`android-build-info.txt` 和混淆映射压缩包，便于校验安装包和定位 Release 问题。

## 🔄 更新内容

1. 【播放界面】重做竖屏方形封面的沉浸式主视觉，使用同一封面画布完成全屏模糊背景、中央清晰区域和底部渐隐，不再把页面切成顶部、中部、底部三个独立色块
2. 【播放界面】顶部状态栏区域改为同源放大模糊与暗化过渡，中央清晰封面使用柔性遮罩融入上下背景，减少纯色封面最容易出现的横向分层和左右长条
3. 【播放界面】根据封面主色动态生成环境底色和多段渐变，使亮色、深色及大面积纯色封面都能自然延伸到整个播放页
4. 【歌曲信息】调整 Hero 模式下歌名、歌手、平台和收藏入口的位置与字号，限制标题单行展示并隐藏重复专辑行，让信息区更接近参考视频的视觉层级
5. 【歌词】重新调整 Mini 歌词区域的位置、间距和切换动画，当前歌词更突出，前后行以淡入、淡出和轻位移动画完成过渡
6. 【Android】启用 React Native Edge-to-Edge，并让播放详情状态栏透明覆盖在主视觉之上，避免系统状态栏重新填充独立背景色
7. 【封面】无封面歌曲在音源补图失败后使用 iTunes 音乐搜索获取真实专辑封面，并自动请求 1200×1200 高清图片
8. 【封面】补图采用严格歌名/歌手匹配，同时兼容部分本地文件把标题和歌手标签写反的情况，降低同名歌曲、Remix 或无关图片误匹配风险
9. 【封面】iTunes 封面结果在播放详情、底部播放条和首页“继续听”之间共享；切歌时按歌曲身份隔离缓存和异步结果，避免上一首封面短暂串到下一首
10. 【封面】彻底移除 TMDB 请求、凭证、缓存和构建配置；若 iTunes 与音源均无匹配结果，则继续使用应用内生成的歌曲占位视觉
11. 【测试】新增封面缓存共享、标题/歌手互换、iTunes 高清封面、快速切歌防旧结果覆盖及沉浸背景配色测试
12. 【发布】应用版本升级为 0.7.0，Android/iOS 构建号同步递增；Release Action 自动校验版本并读取本文件生成 GitHub Release 更新说明

## 🔧 构建信息

GitHub Action 发布时会自动在本说明末尾附加实际构建时间、提交 SHA、分支、签名状态和 Action 运行链接。具体版本、证书和依赖信息也会写入 Release 附带的 `android-build-info.txt`。

## ℹ️ 说明

- iTunes 补图仅用于界面展示，不会改写本地音频文件、播放队列或播放历史中的原始元数据
- 远程封面结果使用内存缓存；应用冷启动后可能重新查询
- 圆形唱片模式和横屏双栏模式保留原有布局与交互
- 本说明仅覆盖 `feat/mpv-player` 从 `18c71611` 到 `v0.7.0` 的改动，不包含 `main` 或其他仓库的差异

Full Changelog: [18c71611...v0.7.0](https://github.com/CTZZG/MusicFree/compare/18c71611...v0.7.0)
