# Feishin-Inspired Agent Prompts

更新时间：2026-06-09

状态：执行中。当前分支：`codex/plugin-center-mvp`。

本文把 `docs/plugin-center-plan.md` 和 `docs/feishin-inspired-roadmap.md` 拆成可交接、可复制给后续 agent 的实施提示词。每个提示词都应该作为一个相对独立的开发切片推进，避免一次性大改。

## 使用规则

每次开始前：

1. 确认当前分支。
2. 检查 `git status --short`。
3. 阅读对应提示词列出的文件。
4. 只做该提示词范围内的改动。
5. 跑 `npx tsc --noEmit` 和 `git diff --check`。
6. 提交并推送当前分支。

不要在一个提示词里混入其他 Milestone。

## Prompt 01：插件卡片来源和能力标签

状态：已完成，提交 `9a9e809`。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/plugin-center-plan.md
- src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx
- src/core/pluginManager/index.ts
- src/core/pluginManager/plugin.ts
- src/types/plugin.d.ts
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
在插件管理页的插件卡片上展示插件来源和能力标签，并增加一个“详情”入口。

范围：
- 来源识别：network / local-file / unknown。
- 能力标签从 plugin.supportedMethods 派生。
- 详情弹窗显示版本、作者、来源详情、hash、支持能力。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不新增插件协议。
- 不新增路由。
- 不做诊断存储。
- 不做备份恢复。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件卡片显示来源和能力。
- 点击详情能看到基础信息。
```

## Prompt 02：插件诊断记录 MVP

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/plugin-center-plan.md
- docs/feishin-inspired-agent-prompts.md
- src/core/pluginManager/plugin.ts
- src/core/pluginManager/index.ts
- src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx
- src/utils/getOrCreateMMKV.ts
- src/utils/jsonUtil.ts
- src/utils/log.ts

任务：
实现插件诊断记录 MVP，让插件方法失败时保留最近错误，并在插件卡片详情里展示。

范围：
- 新增轻量诊断模块，例如 src/core/pluginManager/diagnostics.ts。
- 每个插件最多保留最近 20 条错误，全局最多保留 200 条。
- 记录字段至少包括 pluginName、pluginHash、method、message、createdAt。
- 对错误信息做基础脱敏，避免保存 token、cookie、authorization。
- 在插件方法封装层记录失败。
- 插件详情弹窗展示最近 5 条诊断记录。

不要做：
- 不记录成功调用。
- 不上传日志。
- 不保存 headers、cookies、用户变量原文。
- 不新增复杂诊断页。
- 不改插件协议。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 诊断模块有明确容量限制。
- 插件详情弹窗能显示“最近无错误”或最近错误列表。
```

## Prompt 03：插件安装结果统一展示

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/plugin-center-plan.md
- src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
- src/core/pluginManager/index.ts
- src/types/core/pluginManager/index.d.ts
- src/core/i18n/languages/zh-cn.json

任务：
统一本地安装、URL 安装、订阅安装的结果展示，让失败原因更可读。

范围：
- 成功结果展示插件名、版本、来源。
- 失败结果展示来源、失败原因。
- 多插件安装支持部分成功、部分失败。
- 保留现有安装逻辑，不重写插件安装机制。

不要做：
- 不做插件市场。
- 不做诊断页。
- 不改变插件格式。

验收：
- 本地安装正常插件显示成功。
- 本地安装坏插件显示解析失败原因。
- 订阅源部分失败时能看到每个失败项。
- npx tsc --noEmit 通过。
```

## Prompt 04：备份恢复预览和报告

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/backup.ts
- src/pages/setting/settingTypes/backupSetting.tsx
- src/core/musicSheet/index.ts
- src/core/localMusicSheet.ts
- src/core/pluginManager/index.ts

任务：
实现备份恢复可验证流程的第一版：恢复前预览，恢复后报告。

范围：
- 解析备份文件后先展示歌单数、歌曲数、本地音乐数、收藏歌单数、插件数。
- 恢复完成后展示成功、跳过、失败摘要。
- 插件恢复失败不得阻断歌单恢复。
- 兼容旧备份字段缺失。

不要做：
- 不做 WebDAV 自动备份。
- 不做加密。
- 不做云同步。

验收：
- 选择备份文件后出现预览。
- 恢复完成后出现报告。
- 旧备份仍可恢复。
- npx tsc --noEmit 通过。
```

## Prompt 05：播放诊断页 JS 层 MVP

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/trackPlayer/index.ts
- src/pages/setting/settingTypes/aboutSetting.tsx
- src/constants/buildInfo.generated.ts
- src/utils/log.ts

任务：
实现播放诊断页 JS 层 MVP。

范围：
- 从关于页或高级设置进入。
- 展示 buildInfo、当前歌曲、队列索引、队列长度、播放状态、进度、当前插件。
- 提供刷新和复制诊断信息。
- 不读 Native MediaSession 状态。

不要做：
- 不新增 NativeModule。
- 不控制播放。
- 不上传诊断信息。

验收：
- 播放中诊断信息可见。
- 暂停/切歌后刷新能更新。
- 复制内容脱敏。
- npx tsc --noEmit 通过。
```

## Prompt 06：智能歌单模板 MVP

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/musicSheet/index.ts
- src/core/musicHistory.ts
- src/core/downloader.ts
- src/core/localMusicSheet.ts
- src/components/musicSheetPage
- src/pages/home

任务：
实现智能歌单模板 MVP。

范围：
- 最近播放。
- 本地音乐。
- 已下载歌曲。
- 某插件来源歌曲。
- 只做 virtual 智能歌单，不保存为普通歌单。

不要做：
- 不做自由规则编辑器。
- 不做播放次数筛选。
- 不做复杂缓存。

验收：
- 首页或侧栏能进入智能歌单。
- 各模板有合理空状态。
- 不影响普通歌单。
- npx tsc --noEmit 通过。
```

## Prompt 07：下载和本地库资料库化 MVP

状态：已完成。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/downloader.ts
- src/core/localMusicSheet.ts
- src/pages/downloading
- src/pages/localMusic
- android/app/src/main/java/fun/upup/musicfree/mp3Util

任务：
增强下载中心和本地音乐库的资料库能力。

范围：
- 下载中心按状态筛选。
- 已下载歌曲按插件来源筛选。
- 本地文件不存在时显示文件丢失状态。

不要做：
- 不做全文件 hash。
- 不做复杂重新定位流程。
- 不改 Native 下载核心。

验收：
- 下载中心筛选可用。
- 本地文件丢失能被提示。
- npx tsc --noEmit 通过。
```

## Prompt 08：歌词候选和偏移保存 MVP

状态：已完成。本次实现歌词来源标记、手动关联沿用、偏移沿用和无歌词原因展示。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/lyricManager.ts
- src/components/panels/types/musicItemLyricOptions.tsx
- src/components/panels/types/searchLrc
- src/pages/musicDetail/components/content/lyric
- src/utils/mediaExtra.ts
- src/utils/lrcParser.ts

任务：
增强歌词体验第一版，让用户能更清楚地处理歌词来源和偏移。

范围：
- 展示当前歌词来源：插件 / 手动关联 / 本地内嵌 / 无歌词。
- 歌词偏移保存到 mediaExtra，并在下次播放同一首歌时沿用。
- 搜索歌词结果选择后保存关联关系。
- 无歌词时给出可读原因，例如插件不支持、返回空、解析失败。

不要做：
- 不做复杂自动置信度算法。
- 不做新 NativeModule。
- 不重写歌词渲染。
- 不做逐字歌词新格式解析。

验收：
- 手动选择歌词后下次播放仍使用该歌词。
- 偏移调整后下次播放仍生效。
- 无歌词时能看到原因。
- npx tsc --noEmit 通过。
```

## Prompt 09：统一搜索/全局跳转 MVP

状态：已完成。本次实现全局搜索页、歌曲搜索跳转、本地歌单/插件/设置入口匹配，以及首页、侧栏、设置页入口。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/router
- src/core/pluginManager/index.ts
- src/core/musicSheet/index.ts
- src/pages/searchPage
- src/pages/home
- src/pages/setting

任务：
实现统一搜索/全局跳转 MVP，让重度用户可以快速跳到常用对象。

范围：
- 搜插件：跳转插件管理并能看到插件。
- 搜本地歌单：跳转歌单详情。
- 搜设置项：跳转对应设置页。
- 搜歌曲仍复用现有搜索页，不重写搜索引擎。

不要做：
- 不做命令动作，如直接删除、启用、下载。
- 不做复杂分页。
- 不阻塞播放。
- 不新增远程服务。

验收：
- 输入插件名能找到插件入口。
- 输入歌单名能跳转歌单。
- 输入设置项能跳转设置。
- 没结果时有清晰空状态。
- npx tsc --noEmit 通过。
```

## Prompt 10：发布体验正规化 MVP

状态：已完成。本次实现 release asset 清理容错、构建信息补充、构建/签名/产物错误注解，以及关于页构建引用展示。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- .github/workflows/android-build.yml
- generator/generate-build-info.mjs
- src/constants/buildInfo.generated.ts
- src/pages/setting/settingTypes/aboutSetting.tsx
- package.json
- android/app/build.gradle

任务：
增强发布体验第一版，让 GitHub Release 和构建信息更可靠。

范围：
- Release asset 清理遇到 GitHub 5xx 时重试或跳过失败项，不让整条构建直接失败。
- android-build-info.txt 补充版本号、commit、构建时间、构建分支。
- APK 文件名保留版本号和 shortSha。
- 构建失败时日志能区分构建失败、签名失败、上传失败。

不要做：
- 不重写整个 CI。
- 不引入新发布服务。
- 不改变 beta/stable 版本规则。
- 不要求 CI 真机测试。

验收：
- release asset 清理有容错。
- 构建信息文件包含关键字段。
- npx tsc --noEmit 通过。
- workflow YAML 语法保持有效。
```

## Prompt 11：播放诊断 Native 状态补充

状态：已完成。本次在现有播放诊断里补充 Android Native 侧快照，包括通知权限、电池优化、App importance、Nitro 播放服务声明/运行状态，以及 MediaSession 查询可访问性。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/trackPlayer/index.ts
- src/types/core/trackPlayer/index.d.ts
- src/native/utils/index.ts
- src/pages/setting/settingTypes/aboutSetting.tsx
- android/app/src/main/java/fun/upup/musicfree/utils/UtilsModule.kt

任务：
增强播放诊断页，让真机排查通知栏残留、退出恢复、MediaSession 状态时能看到 Native 侧关键状态。

范围：
- NativeUtils 增加只读播放诊断方法。
- 诊断字段包含包名、进程、通知权限、电池优化、App importance。
- 诊断字段包含 Nitro 播放服务是否声明、是否运行、shutdown action。
- 尝试读取当前应用 MediaSession；无权限时返回 denied 和原因，不抛错阻断页面。
- TrackPlayer 诊断快照挂载 native 字段。
- 关于页“播放诊断”复制内容增加 Native / 系统区块。

不要做：
- 不控制播放。
- 不强停服务。
- 不新增通知监听权限。
- 不 fork Nitro Player。
- 不上传诊断信息。

验收：
- npx tsc --noEmit 通过。
- android :app:compileReleaseKotlin 通过。
- 播放诊断弹窗在 Native 读取失败时仍能打开。
- 复制诊断信息不包含播放 URL、headers、cookie、token。
```

## Prompt 12：插件配置备份恢复 V2

状态：已完成。本次新增 `pluginBackupV2` 备份块，备份插件来源、顺序、启用状态、用户变量和替代插件，并在恢复报告里增加插件配置结果。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/plugin-center-plan.md
- docs/feishin-inspired-roadmap.md
- src/core/backup.ts
- src/core/pluginManager/index.ts
- src/core/pluginManager/meta.ts
- src/pages/setting/settingTypes/backupSetting.tsx

任务：
实现插件配置备份恢复 V2，让换机恢复时插件顺序、禁用状态、用户变量、替代插件能随备份迁移。

范围：
- 备份文件新增 `pluginBackupV2`，保留旧 `plugins` 字段兼容旧版本。
- `pluginBackupV2.installed` 记录 name/hash/version/sourceType/srcUrl。
- `pluginBackupV2` 记录 order、disabled、alternativePlugins、userVariables。
- 恢复时优先使用 V2；没有 V2 时继续走旧 `plugins` 恢复逻辑。
- network 插件有 srcUrl 时尝试安装，失败不阻断歌单恢复。
- local-file 插件不自动恢复代码，报告提示需要重新选择文件安装。
- 已安装插件恢复顺序、启用状态、用户变量和替代插件。
- 预览和恢复报告增加“插件配置”计数。

不要做：
- 不新增加密。
- 不新增用户变量导出开关。
- 不自动恢复本地插件代码。
- 不做 WebDAV 定时备份。
- 不改变现有恢复模式语义。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 旧备份没有 `pluginBackupV2` 时仍能恢复。
- 新备份包含 `pluginBackupV2` 和旧 `plugins` 字段。
- 本地插件缺失时恢复报告有提示且歌单恢复不被阻断。
```

## Prompt 13：插件诊断报告导出

状态：已完成。本次新增插件诊断报告生成器，并在插件管理页菜单增加“复制诊断报告”入口。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/plugin-center-plan.md
- src/core/pluginManager/diagnostics.ts
- src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx
- src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
为插件管理页增加手动复制插件诊断报告能力，方便用户反馈“某插件不能搜/不能播/安装失败”等问题。

范围：
- 在插件诊断模块里新增报告生成函数。
- 报告包含生成时间、插件数量、诊断事件数量。
- 报告列出插件名称、版本、作者、来源类型、hash 前缀、能力列表、最近错误数。
- 报告列出最近诊断事件。
- 插件管理页菜单增加“复制诊断报告”。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不上传诊断报告。
- 不展示或复制用户变量。
- 不复制完整插件 URL。
- 不复制 headers/cookies/token。
- 不触发插件方法探测。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 点击菜单能复制诊断报告。
- 诊断报告只包含脱敏后的诊断事件和插件摘要。
```

## 当前推进建议

当前已经完成 Prompt 01 到 Prompt 13。下一步可以从 `docs/feishin-inspired-roadmap.md` 里选择下一个独立切片继续推进，建议优先做恢复前自动备份或备份恢复历史报告。
