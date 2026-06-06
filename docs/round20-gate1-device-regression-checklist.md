# Round 20 Gate 1 Device Regression Checklist

更新时间：2026-06-04

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文是 Gate 1 的可执行真机清单。目标是先证明 Nitro 后端的普通播放和系统媒体控制稳定，再进入 ALAC/WMA/DSF 格式样本矩阵。

当前已有历史基线：`docs/round20-device-media-session-baseline.md`

当前执行状态：

- 2026-06-04 本轮续跑执行 `adb devices`，结果没有连接设备。
- 因此本轮不能新增真机播放证据，不能把“未测试”写成“失败”或“通过”。

## 运行前要求

- 设备已连接，`adb devices` 至少显示一个 `device`。
- 设备上安装的是当前构建的 MusicFree。
- 记录以下信息：
  - 设备序列号
  - `versionName`
  - `versionCode`
  - `lastUpdateTime`
  - 当前播放器后端是否为 Nitro

命令：

```powershell
adb devices
adb shell dumpsys package fun.upup.musicfree
adb shell pidof fun.upup.musicfree
adb shell dumpsys media_session
```

## 必须遵守

- 不使用截图猜坐标。
- UI 操作用 UIAutomator bounds。
- 媒体控制优先用 `cmd media_session dispatch`。
- 每一步都记录 `dumpsys media_session` 前后状态。
- 不并行运行多条 ADB daemon 启动命令。

## 基础启动

目标：确认 MusicFree 启动后暴露 Nitro/Media3 session。

命令：

```powershell
adb shell am start -n fun.upup.musicfree/.MainActivity
adb shell pidof fun.upup.musicfree
adb shell dumpsys media_session
adb shell uiautomator dump /sdcard/musicfree-window.xml
adb exec-out cat /sdcard/musicfree-window.xml
```

通过条件：

- MusicFree 进程存在。
- `dumpsys media_session` 中出现 `fun.upup.musicfree/androidx.media3.session.id.*`。
- session `active=true`。
- 能看到非空 metadata 或明确的空队列状态。

## 普通播放 60 秒

目标：证明 Nitro 普通播放不会几秒误跳。

步骤：

1. 用 UIAutomator bounds 找到底部播放按钮或当前播放入口。
2. 点击播放。
3. 立即记录 `dumpsys media_session`。
4. 等待 60 秒。
5. 再记录 `dumpsys media_session`。

通过条件：

- state 为 `PLAYING` 或符合预期的缓冲/暂停状态。
- active item 没有异常快速跳转。
- position 持续推进。
- queue size 不异常变为 0。

## 系统媒体键

目标：证明 Nitro/Media3 原生 session 能处理系统控制。

命令：

```powershell
adb shell cmd media_session dispatch pause
adb shell dumpsys media_session
adb shell cmd media_session dispatch play
adb shell dumpsys media_session
adb shell cmd media_session dispatch next
adb shell dumpsys media_session
adb shell cmd media_session dispatch previous
adb shell dumpsys media_session
```

通过条件：

- pause 后 state 变为 `PAUSED`。
- play 后 state 变为 `PLAYING`。
- next 后 active item 前进并保持 queue。
- previous 后 active item 回退或符合播放器“上一首/重播当前首”策略。

## 自然结束下一首

目标：证明自然播放结束由 Nitro/Media3 原生队列推进，不依赖 JS 定时兜底。

步骤：

1. 选择一首剩余时长较短的普通歌曲。
2. 记录开始时 active item、metadata、duration、position。
3. 等待自然结束。
4. 记录结束后的 active item、metadata、state。

通过条件：

- active item 自然推进到下一首。
- state 保持 `PLAYING` 或符合 repeat/队列末尾策略。
- 没有连续异常跳多首。

## 通知栏和蓝牙

目标：覆盖用户真实入口，而不只覆盖 shell dispatch。

通知栏：

- 展开通知栏。
- 用 UIAutomator bounds 点击播放/暂停/下一首/上一首。
- 每次点击后记录 `dumpsys media_session`。

蓝牙或系统媒体键：

- 若有蓝牙设备，测试 play/pause/next/previous。
- 若没有蓝牙设备，至少用系统 `cmd media_session dispatch` 作为替代证据，记录“蓝牙未覆盖”。

## 页面回归

目标：证明 MusicFree UI 层仍与 Nitro 状态同步。

必须覆盖：

- 底部播放栏：标题、歌手、封面、播放状态不空白。
- 播放详情页：可进入、进度推进、按钮可用。
- 歌词页：可进入、歌词进度随播放推进。
- 切歌后 UI 同步当前歌曲。

## 强停恢复

目标：证明 app 被系统杀掉或用户强停后的恢复路径可用。

步骤：

```powershell
adb shell am force-stop fun.upup.musicfree
adb shell am start -n fun.upup.musicfree/.MainActivity
adb shell dumpsys media_session
```

通过条件：

- 应用不崩溃。
- 播放栏恢复到可解释状态。
- 若设计要求恢复上一首，metadata 和 queue 可恢复。
- 若设计要求不自动恢复播放，状态也必须稳定且可手动继续播放。

## 记录格式

每轮测试写入 `docs/round20-device-media-session-baseline.md`，格式如下：

```markdown
## YYYY-MM-DD 设备基线

- 设备：
- APK / versionName / versionCode：
- 后端：
- 队列来源：
- 样本歌曲：
- 通过：
- 失败：
- 未覆盖：
- 关键命令：
- 关键观察：
- 结论：
```

## Gate 1 完成条件

Gate 1 只有在以下全部满足后才能标记为完成：

- 普通播放 60 秒以上稳定。
- 系统 pause/play/next/previous 稳定。
- 自然结束下一首稳定。
- 通知栏按钮稳定。
- 蓝牙或系统媒体键替代证据明确。
- 底部栏、详情页、歌词页状态同步稳定。
- 强停重开稳定。
- 未覆盖项都被显式记录，而不是默认为通过。
