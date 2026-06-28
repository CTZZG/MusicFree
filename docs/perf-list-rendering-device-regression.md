# perf/list-rendering-optimization 真机回归记录

更新时间：2026-06-27

接续自上一会话（上下文超限中断）。本文记录 `perf/list-rendering-optimization`
分支 5 个提交的真机回归结果，方法论沿用
`docs/round20-gate1-device-regression-checklist.md`（UIAutomator bounds，不截图猜坐标）。

## 被测改动

| 提交 | 内容 |
|------|------|
| `625c7a3f` | feat(ui): 列表骨架屏占位 |
| `3ef69723` | feat(equalizer): 均衡器 UI 外壳 + 可插拔 DSP 适配器 |
| `eb9eed8e` | fix(lxSource): 异步 inited / 非 2xx 响应回调 |
| `f59e3c49` | fix(lxSource): zlib 工具 + 二进制安全 crypto |
| `1cfd1b83` | feat(lxSource): crypto.rsaEncrypt（PKCS#1 v1.5） |

## 环境

- 设备：Honor `AAK-AN00`（HarmonyOS），序列号 `A4UF6R6317000876`
- APK：`app-arm64-v8a-release.apk`（2026-06-26 21:21 构建，21:24 安装）
- `versionName=0.6.5-nitro.1`，`versionCode=400014`
- 签名证书 `D6:FF:76:…` 与设备已装应用一致，`install -r` 保留用户数据
- 后端：Nitro `NitroPlayerPlaybackService`

## 结果

### 均衡器（`3ef69723`）— 通过

- **抽屉入口**：`设置` 分组、`主题设置` 之后出现「均衡器」（`bars-3` 图标），位置与设计一致。
- **启用开关**：开关命中点 `(1163,421)`。点击后 5 个频段 SeekBar 与全部预设/重置由
  `enabled="false"` 翻为 `enabled="true"`（UIAutomator 读属性，非靠 logcat —— release 已 strip console）。
- **预设**：选「流行」→ 频段精确变为 `-1/+2/+4/+2/-1`；选「摇滚」→ `+4/+2/0/+2/+4`，
  与 `EQUALIZER_PRESETS` 定义一致，活动 chip 高亮、滑块同步。
- **重置**：点「重置」→ 5 频段全回 `0dB`。
- **持久化**：设「摇滚 + 启用」后 `am force-stop` + 重启 → 重新进入均衡器页，
  仍为启用 + `+4/+2/0/+2/+4`，确认 `Equalizer.setup()` 从 MMKV(`equalizer` store) 正确恢复。
- 收尾已把开关恢复为关闭（设备原始状态）。备注：MMKV 里 `preset` 残留为「摇滚」，
  但开关关闭时不影响音频，且当前 controller 为 no-op。

### 列表渲染优化（MusicList 重构）— 通过

- 搜索「Jay」→ 单曲结果（GD聚合音乐 60 首：晴天/七里香/青花瓷…）渲染正常，
  memo 行、插件徽标、more 图标均正确。
- 榜单「飙升榜」board 加载完成，渲染 100 首（最后的借口/遥遥/玻璃…）。
- 上一会话已验证：「我喜欢」(170 首) 列表 + keyExtractor、长按进入多选（稳定 handler）。

### 骨架屏（`625c7a3f`）— 通过

- 触发点：`ListEmpty` 在 `state === PENDING_FIRST_PAGE` 且 `skeletonOnLoading`(默认 true)
  时渲染 `ListSkeleton`（8 行 封面+两行文字）。`MusicList` / `recommendSheets` 等
  直连 `ListEmpty` 无外层 loading gate 的列表会真正显示骨架。
- 实捕：推荐歌单切到「元力KW」插件标签，封面图到达前捕获到 8 行骨架（左侧方块封面 +
  62%/40% 两条文字条 + 呼吸式透明度动画），与 `SkeletonListItem` 定义完全一致。
- 注意：`boardPanel` 与搜索非 music tab 在 `PENDING_FIRST_PAGE` 走自带 `<Loading/>`，
  骨架仅首帧闪现，属设计行为，不是缺陷。

### lxSource（`eb9eed8e` / `f59e3c49` / `1cfd1b83`）— 运行时链路通，crypto 正确性待决定性样本

- 静态：上一会话对照 lx-music-mobile 与官方自定义源协议核对，27/27 单测通过（含 5 个 rsa 用例），production bundle 编译通过。
- 真机：设备已装 4 个 LX 自定义源（全豆要[聚合音源] / [独家音源] / Huibq / ikun），均启用。
- **`eb9eed8e`（异步 inited）已运行时验证**：更新 [独家音源] 成功（`createLxSourceRuntime` 等到 `inited` 并完成解析），且重解析后该源在「音源重定向」候选中暴露出 `musicUrl` 目标（如 `LX 自定义源 / [独家音源] / kw`）——证明 sources 正确填充。
- **重定向链路已运行时验证**：把插件「元力KW」重定向到 `[独家音源] / kw`，播放「晴天」触发
  `getMediaSourceByRedirectTarget → requestLxMusicUrl → 脚本 request handler`。
  日志（开 `debug.traceLog`/`errorLog`）显示脚本被调用并执行，**我方 AES/zlib/rsa 全程未抛异常**；
  返回的 `"unknow error"` 来自脚本自身（非本仓库代码，grep 确认），即酷我未给出可播 URL。
- **未决**：「晴天/周杰伦」在酷我免费层版权锁严，且 kw 签名轻、基本不走新加的 AES/RSA；
  `1cfd1b83`（rsaEncrypt）的决定性验证需「元力WY 插件 → `[独家音源]/wy`（网易云 weapi 走 AES+RSA）+ 一首网易云可免费播的歌」。代码与编译层面无回归。

## 方法论备注（供后续真机回归复用）

- Git-Bash 调 `adb shell /sdcard/...` 会被 MSYS 改写路径，需 `MSYS_NO_PATHCONV=1`。
- 截图用 `adb exec-out screencap -p > file`（直管道）；Honor 限制写 `/sdcard` 后再 cat。
- RN 开关/抽屉对合成 `input tap` 敏感，务必用 `uiautomator dump` 的真实 bounds 中心点。
- 瞬时态（骨架屏）用「无间隔连拍 + 按 PNG 字节大小定位关键帧」抓取；
  纯灰块页面字节量明显小于带封面的已加载页。
