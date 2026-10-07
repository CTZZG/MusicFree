# 模拟器自动测试（E2E）

在 Android 模拟器上装真正的 APK，像用户一样点界面、用媒体键切歌，检查歌是不是真的在播。
单元测试和布局测试管不到的播放链路（mpv、后台服务、通知栏/锁屏控制、插件取源）都靠这里兜底。

## 测了什么

| 检查 | 怎么判断 |
| --- | --- |
| 启动后进入首页 | 首页底部标签出现 |
| 通过链接安装插件 | `musicfree://install/<地址>` 弹出确认框，点“确认安装” |
| 搜索并依次点播三首歌 | `musicfree://search` 打开搜索页，点 A、B、C，播放条跟着换 |
| 前台播放 | 系统媒体会话里在播 C，4 秒内进度前进至少 2 秒 |
| 回到桌面后继续播放 | 同上 |
| 后台用媒体键切歌 | 连按两次“上一首”，依次切到 B、A（和通知栏、锁屏按钮走同一条路） |
| 回到应用后不跳回旧歌 | 回到应用 6 秒后仍在播 A，播放条显示 A |
| 播放失败后的提示 | 点一首取不到地址的歌，出现“播放未成功”，点开有“查找其他来源” |
| 后台播完自动接下一首 | 6 秒的短歌播完后，在后台自动播队列里的下一首 |
| 原来源失败时换到其他来源 | 测试源 A 取不到地址的歌，自动换到测试源 B 的同一首歌播放，播放页的来源标签写“改用E2E 测试源 B” |
| 不换成别的版本 | 测试源 B 只有 Live 版时不换，留下“播放未成功”提示 |

“在播”和“进度在走”都看系统媒体会话（`dumpsys media_session`），那里的进度是 mpv 直接上报的，
不是界面上的数字。

## 怎么跑

Beta 构建（`build-beta.yml`）打包成功后默认接着跑，结果在这次运行的 Summary 里，
截图、Maestro 日志和 logcat 在附件 `e2e-results-<运行 ID>` 里。

- 只改了测试、不想重新打包：手动运行 Beta 构建，`e2e_apk_run_id` 填之前某次 Beta 构建的运行 ID，
  会直接测那次打出的 APK（30 天内的都在）。
- 不想跑测试：取消勾选 `e2e`。

每次的截图和结果还会推到 `refs/e2e/latest`（不在分支列表里，每次覆盖）：

```bash
git fetch origin refs/e2e/latest && git show FETCH_HEAD:summary.md
```

本地开着模拟器（x86_64，Android 8 以上）也能直接跑，需要 adb、[Maestro](https://maestro.mobile.dev) 和 python3：

```bash
e2e/run.sh path/to/MusicFree-…-x86_64-release.apk "$(git rev-parse HEAD)" e2e-results
```

## 测试用的音源和音频

- `plugins/e2e-source-a.js`：测试音源。搜索关键字写成 `e2e <40 位提交号>` 才有结果，
  歌曲文件从这个提交的 `fixtures/` 读取，所以**提交号必须已经推到 GitHub**。
  应用只允许从公网 https 地址装插件和取音频，模拟器上不能用本机地址。
- `plugins/e2e-source-b.js`：第二个测试音源，正常搜索时不返回歌（只记下提交号），应用替测试源 A
  找其他来源时才返回同一首 Fallback 和一首 Live 版。
- `fixtures/*.mp3`：几段纯音，由 `fixtures/generate.sh` 用 ffmpeg 生成。
- 插件在 Jest 里也会用应用自己的加载代码跑一遍（`src/core/pluginManager/__tests__/e2eTestPlugin.test.ts`），
  写错了在 `npm run verify` 就能发现，不用等模拟器。

## 加一项检查

- 点界面、等文字出现、截图：在 `flows/` 里写一个 Maestro 流程，在 `run.sh` 里用 `flow "<检查名>" <文件>` 调用。
  按读屏标签找元素最稳，比如播放条是“歌曲: <歌名> 歌手: <歌手>”。
- 判断播放状态：用 `run.sh` 里的 `expect_playing "<检查名>" "<歌名>"` 或 `wait_for_song`。
- 流程没通过时，日志里会打出当时界面上的所有文字，并截一张 `failed-<流程>.png`。
