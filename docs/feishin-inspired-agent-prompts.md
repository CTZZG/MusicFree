# Feishin-Inspired Agent Prompts

更新时间：2026-06-10

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

## Prompt 14：恢复前自动备份

状态：已完成。本次在恢复流程开始前自动把当前数据备份到 App 可写目录，并把备份路径或失败原因写入恢复报告。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/backup.ts
- src/pages/setting/settingTypes/backupSetting.tsx
- src/utils/fileUtils.ts
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
增强备份恢复可验证流程，在正式恢复用户选择的备份文件前，自动保存当前应用数据，降低误恢复风险。

范围：
- 恢复前调用现有 `Backup.backup()` 生成当前数据备份。
- 文件名使用 `backup-before-restore-<timestamp>.json`。
- 存储到 App 可写目录下的 `MusicFree` 文件夹。
- 自动备份成功时在恢复报告里显示路径。
- 自动备份失败时不阻断恢复，但恢复报告显示失败原因。
- 本地文件、URL、WebDAV 三个恢复入口复用同一恢复 loading 流程。

不要做：
- 不新增云同步。
- 不改变用户选择的恢复模式。
- 不要求用户额外选择目录。
- 不阻断恢复。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 恢复报告能显示恢复前备份路径或失败原因。
- 自动备份失败时仍继续执行恢复。
```

## Prompt 15：恢复报告复制

状态：已完成。本次给恢复结果弹窗增加“复制报告”按钮，方便用户把恢复摘要和失败原因发给测试/开发排查。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/pages/setting/settingTypes/backupSetting.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
增强备份恢复报告，让用户恢复完成后可以一键复制报告文本。

范围：
- 复用现有 `formatResumeReport` 生成报告文本。
- 恢复结果弹窗增加复制按钮。
- 复制成功后沿用现有复制成功 toast。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不保存报告历史。
- 不上传报告。
- 不改变恢复流程。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 恢复报告弹窗点击复制后写入剪贴板。
```

## Prompt 16：WebDAV 备份历史基础

状态：已完成。本次让手动 WebDAV 备份同时写入 latest 文件和带时间戳的历史文件，并保留最近 10 份历史备份。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/pages/setting/settingTypes/backupSetting.tsx

任务：
为后续 WebDAV 自动备份打基础，让当前手动 WebDAV 备份不再只有一个会被覆盖的文件。

范围：
- 保留 `/MusicFree/MusicFreeBackup.json` 作为 latest 文件，兼容现有 WebDAV 恢复入口。
- 每次 WebDAV 备份额外写入 `/MusicFree/Backups/MusicFreeBackup-<timestamp>.json`。
- 自动创建 `/MusicFree` 和 `/MusicFree/Backups`。
- 备份成功后清理历史目录，只保留最近 10 份时间戳备份。
- 历史清理失败只记录日志，不让本次备份失败。

不要做：
- 不实现后台定时任务。
- 不增加 Wi-Fi 条件。
- 不新增远端备份列表 UI。
- 不改变 WebDAV 恢复默认读取 latest 文件的行为。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- WebDAV 手动备份仍更新 latest 文件。
- WebDAV 手动备份会生成时间戳历史文件。
```

## Prompt 17：WebDAV 远端备份选择恢复

状态：已完成。本次让 WebDAV 恢复入口能列出 latest 和历史备份，用户可选择要恢复的远端备份文件。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/pages/setting/settingTypes/backupSetting.tsx
- src/components/panels/types/simpleSelect.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
增强 WebDAV 恢复入口，让用户不只能恢复 latest 文件，也能选择历史备份。

范围：
- WebDAV 恢复时检查 `/MusicFree/MusicFreeBackup.json`。
- 同时读取 `/MusicFree/Backups` 中的 `MusicFreeBackup-*.json`。
- 如果只有一个可恢复文件，保持直接预览恢复。
- 如果有多个可恢复文件，弹出 SimpleSelect 让用户选择。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不新增完整远端备份管理页。
- 不删除远端备份。
- 不改变恢复预览和恢复报告流程。
- 不做后台自动备份。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- WebDAV 只有 latest 时仍可直接恢复。
- WebDAV 有历史备份时可选择恢复文件。
```

## Prompt 18：本地文件丢失修复与重新定位

状态：已完成。本次让缺失的本地音乐文件可见、可阻止误播放、可从歌曲菜单重新定位，并在恢复报告中输出缺失原因摘要。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/localMusicSheet.ts
- src/core/musicSheet/index.ts
- src/components/mediaItem/musicItem.tsx
- src/components/panels/types/musicItemOptions.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
修复本地音乐文件丢失后的体验，让用户知道文件缺失、避免误触播放，并能为同一首本地歌重新选择文件路径。

范围：
- LocalMusicSheet 暴露支持音频扩展名判断和 relocateMusic。
- 重新定位只更新 localPath，保留 id/platform/title/artist。
- MusicSheet 同步更新所有普通歌单中同一 media key 的本地歌引用。
- 本地文件不存在时点击歌曲不进入播放，改为提示。
- 缺失本地歌的更多菜单增加“重新定位文件”。
- 恢复本地音乐时记录缺少路径、文件不存在、无效记录等原因摘要。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不做 WebDAV 自动备份。
- 不重写播放器。
- 不重新生成本地音乐 ID。
- 不处理 Android SAF 持久授权迁移。
- 恢复报告不输出完整本地路径。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 删除或改名本地文件后，列表显示文件不存在。
- 点击缺失本地歌只提示，不进入播放。
- 通过更多菜单重新定位后，本地音乐页和普通歌单中的同一首歌都能播放。
- 包含丢失本地文件的备份恢复后，恢复报告显示跳过数量和简短原因。
```

## Prompt 19：本地音乐按歌手和专辑筛选

状态：已完成。本次把本地音乐从单一来源筛选扩展到歌手和专辑筛选，让下载后的音乐库更像可浏览的资料库。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/pages/localMusic/mainPage/localMusicList.tsx
- src/core/localMusicSheet.ts
- src/components/panels/types/simpleSelect.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
让本地音乐页支持按歌手和专辑进一步筛选，和现有来源筛选组合使用。

范围：
- 在本地音乐页增加歌手筛选。
- 在本地音乐页增加专辑筛选。
- 歌手/专辑候选项按当前来源过滤后的列表生成。
- 切换来源时重置歌手/专辑筛选，避免空列表困惑。
- 复用现有 SimpleSelect 面板完成候选选择。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不新建独立筛选页面。
- 不改普通歌单编辑逻辑。
- 不做复杂搜索索引。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 本地音乐页可按来源筛选。
- 本地音乐页可按歌手筛选。
- 本地音乐页可按专辑筛选。
- 三个筛选可以组合使用。
```

## Prompt 20：下载元数据写入状态展示

状态：已完成。本次在下载完成后记录元数据和独立歌词文件写入结果，并在歌曲列表项中展示轻量状态徽标。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/downloader.ts
- src/core/musicMetadataManager.ts
- src/utils/mediaExtra.ts
- src/components/mediaItem/musicItem.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
让用户在下载完成后能看到元数据写入是否成功。

范围：
- 下载完成后异步记录元数据写入状态：success / failed / skipped。
- 下载完成后异步记录独立歌词文件写入状态：success / failed / skipped。
- 状态写入 mediaExtra，随歌曲项订阅更新。
- 歌曲项展示元数据状态徽标。
- 独立歌词文件只在成功或失败时展示徽标，避免默认未启用时过度占位。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不阻塞下载完成态和后续队列。
- 不新增下载历史页。
- 不做格式级别的详细标签字段校验。
- 不改 Native 元数据写入接口。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 下载完成后本地歌曲项可显示元数据已写入/失败/未写入。
- 启用独立歌词文件下载时，可显示歌词文件写入成功或失败。
```

## Prompt 21：下载中心来源筛选与完成时间

状态：已完成。本次让下载中心可按插件来源筛选，并在下载完成任务上显示完成时间。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/downloader.ts
- src/pages/downloading/downloadingList.tsx
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
增强下载中心的资料库浏览能力，让用户能按插件来源筛选下载任务，并看见任务完成时间。

范围：
- 下载任务完成时记录 `completedAt` 时间戳。
- 下载中心保留现有状态筛选。
- 下载中心增加插件来源筛选入口。
- 来源候选从当前下载队列中的 `platform` 自动生成。
- 已完成任务显示完成时间。
- 补齐中/英/繁体文案和 i18n 类型。

不要做：
- 不新增持久化下载历史表。
- 不删除已完成任务。
- 不改变下载文件命名规则。
- 不改变下载队列调度逻辑。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 下载中心状态筛选和来源筛选可以组合使用。
- 下载完成任务显示完成时间；没有时间戳的旧任务仍显示“下载完成”。
```

## Prompt 22：WebDAV 自动备份启动触发

状态：已完成。本次抽出 WebDAV 备份核心能力，并增加启动后的每日/每周静默自动备份。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/pages/setting/settingTypes/backupSetting.tsx
- src/entry/bootstrap/bootstrap.ts
- src/core/backup.ts
- src/core/appConfig.ts
- src/utils/persistStatus.ts
- src/types/core/config.d.ts
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
在已有 WebDAV 手动备份历史基础上，增加可关闭的自动备份入口。

范围：
- 抽出可复用 WebDAV 备份模块。
- 手动 WebDAV 备份继续写 latest 和历史备份，并继续清理旧历史。
- 设置页增加 WebDAV 自动备份频率：关闭 / 每天 / 每周。
- App 启动后按频率静默触发一次 WebDAV 备份。
- 自动备份默认关闭。
- 自动备份失败只写日志，不弹 toast、不阻断启动。
- 补齐中/英/繁体文案、i18n 类型、配置类型和持久化状态类型。

不要做：
- 不实现后台常驻定时任务。
- 不新增 Wi-Fi 条件。
- 不新增远端备份管理页。
- 不改变手动备份和恢复入口的交互。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- WebDAV 手动备份/恢复入口仍可使用。
- 自动备份关闭时启动不触发。
- 自动备份设置为每天/每周时，到期后启动会写入 latest 和历史备份。
```

## Prompt 23：WebDAV 自动备份结果展示

状态：已完成。本次在 WebDAV 自动备份设置下展示最近自动备份结果，并记录脱敏失败原因。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

先阅读：
- docs/feishin-inspired-roadmap.md
- src/core/webdavBackup.ts
- src/pages/setting/settingTypes/backupSetting.tsx
- src/utils/persistStatus.ts
- src/core/i18n/languages/zh-cn.json
- src/core/i18n/languages/en-us.json
- src/core/i18n/languages/zh-tw.json
- src/types/core/i18n/index.d.ts

任务：
让用户能在设置页看到 WebDAV 自动备份最近一次是否成功，失败时看到简短原因。

范围：
- 自动备份成功时记录最近成功时间。
- 自动备份失败时记录最近失败时间和脱敏原因摘要。
- 成功后清除旧失败状态。
- WebDAV 设置页展示自动备份状态：尚未备份 / 上次成功 / 上次失败。
- 失败原因不保存完整 URL，截断过长文本。
- 补齐中/英/繁体文案、i18n 类型和持久化状态类型。

不要做：
- 不弹出自动备份失败 toast。
- 不上传诊断信息。
- 不新增远端备份管理页。
- 不新增 Wi-Fi 条件。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 自动备份成功后设置页显示成功时间。
- 自动备份失败后设置页显示失败时间和简短原因。
```

## Prompt 24：WebDAV 自动备份 Wi-Fi 条件

状态：已完成。本次给 WebDAV 自动备份增加默认开启的“仅 Wi-Fi 时自动备份”开关，移动网络下静默跳过自动备份，且不影响手动备份/恢复。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- WebDAV 自动备份默认只在 Wi-Fi 下运行，保护用户移动流量。
- 设置页允许用户关闭“仅 Wi-Fi”限制。
- 手动 WebDAV 备份/恢复不受这个限制影响。

实现要求：
- 新增配置 webdav.autoBackupWifiOnly: boolean。
- 没有历史配置时默认视为 true。
- maybeRunAutoWebdavBackup 只在自动备份场景检查 Wi-Fi 条件。
- 非 Wi-Fi 且开关开启时静默跳过，不写入 lastAttempt，避免回到 Wi-Fi 后被误判为刚尝试过。
- WebDAV 设置页在自动备份频率下方展示“仅 Wi-Fi 时自动备份”开关。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 自动备份关闭时不触发。
- 自动备份开启且仅 Wi-Fi 开启时，移动网络下不触发、不更新时间戳。
- 自动备份开启且仅 Wi-Fi 关闭时，仍按每日/每周间隔触发。
- 手动 WebDAV 备份/恢复入口仍可使用。
```

## Prompt 25：WebDAV 自动备份跳过状态

状态：已完成。本次在 WebDAV 自动备份状态中展示“因非 Wi-Fi 被跳过”的最近记录，同时保持跳过不计入自动备份尝试时间。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户在移动网络下启动 App 时，如果 WebDAV 自动备份因“仅 Wi-Fi”规则被跳过，设置页能看见最近跳过时间和原因。
- 跳过状态不能影响下一次真正自动备份的到期判断。
- 手动 WebDAV 备份/恢复不受影响。

实现要求：
- WebDAV 自动备份检查返回 run / idle / skip 三种结果。
- 只有自动备份已到期、WebDAV 已配置、且仅 Wi-Fi 开启但当前不是 Wi-Fi 时，记录跳过状态。
- 记录 backup.webdavAutoBackupLastSkippedAt 和 backup.webdavAutoBackupLastSkipReason。
- 跳过时不写 backup.webdavAutoBackupLastAttemptAt。
- 设置页“自动备份状态”按最近事件展示成功 / 失败 / 跳过。
- 新增三语 i18n 和 i18n 类型。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 到期且移动网络下被跳过时，状态显示“上次跳过”和非 Wi-Fi 原因。
- 未到期时不刷新跳过时间。
- 回到 Wi-Fi 后仍可立即按原到期时间触发自动备份。
- 手动 WebDAV 备份/恢复入口仍可使用。
```

## Prompt 26：WebDAV 自动备份失败重试

状态：已完成。本次给 WebDAV 自动备份增加失败后的短间隔重试：上次自动备份失败后，App 后续启动时若距离失败已超过 30 分钟，会再次尝试，而不是等待每日/每周周期。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- WebDAV 自动备份失败后可以更快恢复，不必等到下一个每日/每周周期。
- 重试不能在每次启动时无限打 WebDAV。
- 手动 WebDAV 备份/恢复不受影响。

实现要求：
- 自动备份失败后保留现有失败时间和脱敏失败原因。
- 自动备份检查在普通每日/每周到期之外，额外判断失败重试是否到期。
- 固定失败重试间隔为 30 分钟。
- 只有最近失败晚于最近成功时才进入失败重试判断。
- 失败重试仍然遵守“仅 Wi-Fi 时自动备份”规则。
- 重试成功后沿用现有成功状态清理失败状态。

不要做：
- 不新增后台常驻定时任务。
- 不新增新的设置项。
- 不改变手动 WebDAV 备份/恢复交互。
- 不弹自动备份失败 toast。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 自动备份失败后 30 分钟内再次启动不会重试。
- 自动备份失败超过 30 分钟后再次启动会重试。
- 重试遇到非 Wi-Fi 且仅 Wi-Fi 开启时，仍只记录跳过，不写 lastAttempt。
- 重试成功后状态显示最近成功并清除旧失败原因。
```

## Prompt 27：下载历史持久化与完成记录管理

状态：已完成。本次让下载中心记录跨 App 重启保留，并把完成任务作为可浏览历史留在下载中心，用户可手动清理已完成记录。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心不再只依赖内存状态，App 重启后仍能看到最近下载任务。
- 下载完成后保留完成记录和完成时间，方便按状态/来源筛选回看。
- 用户可以一键清理已完成记录，但不删除本地已下载音乐文件。

实现要求：
- 下载任务队列和任务快照持久化到 MMKV。
- 下载任务新增、状态变更、删除、清理时同步写回持久化状态。
- App 启动时恢复下载队列和任务快照。
- App 退出/重启前处于 Pending/Preparing/Downloading/Paused 的任务，恢复后标记为失败并显示“应用退出或重启，下载已中断”，避免误以为仍在下载。
- 下载完成后不再立刻从下载中心移除任务。
- 下载中心增加“清理已完成”入口，只移除下载中心记录，不删除本地音乐文件。
- 下载目录不可写时正式标记任务失败并持久化失败原因。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不实现后台断点续传恢复。
- 不改变下载文件命名规则。
- 不删除已下载的本地文件。
- 不新增单独下载历史页面。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 下载完成后任务仍在下载中心，显示完成时间。
- 重启 App 后下载中心仍能看到最近任务。
- 重启前未完成的任务显示中断原因，并可通过现有重试入口重新下载。
- “清理已完成”只清除完成记录，不影响本地音乐库中的文件。
- 状态筛选和来源筛选仍可组合使用。
```

## Prompt 28：插件安装失败分类与可重试提示

状态：已完成。本次给插件安装结果增加结构化失败类型和可重试提示，让本地安装、网络安装、订阅安装、批量更新失败时更容易判断下一步操作。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件安装失败时不只显示一段原始错误文本，还能看到失败分类和是否建议重试。
- 失败分类覆盖本地文件读取失败、网络失败、404 不存在、插件解析失败、已安装更新版本、无法识别内容和未知错误。
- 本地安装、URL 安装、订阅源安装、更新全部插件复用同一结果展示格式。

实现要求：
- IInstallPluginResult 新增 failureReason 和 retryable 字段。
- PluginManager.installPluginFromLocalFile 返回结构化失败原因。
- PluginManager.installPluginFromUrl 返回结构化失败原因，并正确识别 axios response.status 404。
- URL 安装只有插件成功 Mounted 时才算安装成功，避免解析失败或版本不兼容被误报成功。
- 插件安装结果弹窗展示失败类型和是否建议重试。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不重写插件安装机制。
- 不新增插件市场。
- 不上传诊断数据。
- 不改变插件协议。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 本地文件读取失败显示“本地文件读取失败”，且建议重试。
- 网络请求失败显示“网络请求失败”，且建议重试。
- 404 显示“插件地址不存在”，且不建议重试。
- 插件解析失败、无法识别内容、已安装更新版本均显示对应失败类型。
```

## Prompt 29：插件订阅源可视化管理 MVP

状态：已完成。本次让订阅源设置页显示订阅类型，并支持只更新某一个订阅源；同时把 URL 安装解析和安装结果展示抽成共享工具，避免插件列表和订阅页各维护一套逻辑。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 订阅源设置页不只是一串 URL 列表，用户能看出每个订阅是单插件 `.js` 还是订阅集合 `.json`。
- 用户可以在订阅源设置页只更新某一个订阅源，不必回插件列表更新全部订阅。
- 插件列表和订阅页复用同一套 URL 安装解析、失败分类和结果弹窗。

实现要求：
- 新增插件设置内的共享安装工具，至少包含：
  - URL 类型判断：single-plugin / collection / invalid。
  - installPluginFromUrlText：支持 `.js` 和 `.json`，兼容 query/hash 后缀。
  - format/show install result：复用 Prompt 28 的失败类型与可重试提示。
- PluginList 改为使用共享安装工具，删除重复的本地 URL 安装 helper。
- PluginSubscribe 每个订阅条目显示 URL 类型摘要。
- PluginSubscribe 对有效订阅显示“更新此订阅”图标按钮，只安装该订阅源。
- 无效订阅显示无效状态，不触发安装。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不新增远程插件市场。
- 不改变订阅 JSON 协议。
- 不新增订阅源推荐列表。
- 不上传诊断数据。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- `.js` 订阅显示为单插件。
- `.json` 订阅显示为订阅集合。
- 带 query/hash 的 `.js/.json` URL 仍能识别类型。
- 点击单个订阅的更新按钮后，只更新该订阅并展示统一安装结果。
- 插件列表的从网络安装、更新订阅、更新全部插件仍复用统一安装结果。
```

## Prompt 30：插件诊断页集中筛选视图

状态：已完成。本次新增插件诊断页，集中展示最近插件错误，并支持按搜索、播放源、歌词、安装、其他分类筛选；页面只读已有诊断记录，不主动触发插件方法。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断不只散落在单个插件详情和复制报告里，用户可以从插件管理页进入集中诊断视图。
- 最近插件错误可以按常见问题类型筛选：搜索、播放源、歌词、安装、其他。
- 诊断页可以刷新当前记录，也可以复制完整插件诊断报告。

实现要求：
- 新增插件诊断页路由，例如 `/pluginsetting/diagnostics`。
- 插件管理页菜单增加“插件诊断”入口。
- 诊断页读取 `getAllPluginDiagnosticEvents()`，不触发插件探测或网络请求。
- 列表项显示插件名、方法名、时间、错误摘要和估算位置。
- 筛选项至少包含全部、搜索、播放源、歌词、安装、其他。
- 安装筛选第一版映射 `mount` 诊断事件。
- 提供刷新按钮，重新读取本地诊断记录。
- 提供复制报告按钮，复用 `buildPluginDiagnosticReport`。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不自动调用插件方法做健康检查。
- 不上传诊断数据。
- 不保存新的报告历史。
- 不新增复杂图表。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件管理页能进入插件诊断页。
- 无诊断事件时显示清晰空状态。
- 有诊断事件时能按筛选项过滤。
- 点击刷新能重新读取本地诊断记录。
- 点击复制能复制脱敏后的插件诊断报告。
```

## Prompt 31：插件安装失败事件进入诊断页

状态：已完成。本次把本地安装、网络安装和订阅源解析阶段的安装失败写入插件诊断记录，并让诊断页“安装”筛选包含 `install` 事件。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件安装失败不只出现在即时弹窗里，也会进入插件诊断页和复制诊断报告。
- 安装失败记录应覆盖本地文件读取失败、网络失败、订阅 JSON 为空、无效订阅地址、解析失败、版本倒退和未知错误。
- 诊断记录不得暴露完整本地路径、content URI、file URI、cookie、token 等敏感信息。

实现要求：
- 在插件诊断模块新增通用消息记录入口。
- 复用诊断模块的容量限制和脱敏逻辑。
- 扩展脱敏规则，遮盖 token/cookie/authorization 以及常见本地路径、`file://`、`content://`。
- `PluginManager.installPluginFromLocalFile` 的失败返回写入 `method=install` 诊断事件。
- `PluginManager.installPluginFromUrl` 的失败返回写入 `method=install` 诊断事件。
- `installPluginFromUrlText` 中未进入 PluginManager 的失败也写入 `method=install` 诊断事件。
- 插件诊断页“安装”筛选包含 `mount` 和 `install`。

不要做：
- 不记录成功安装。
- 不上传诊断数据。
- 不改变插件安装协议。
- 不把完整插件 URL 或本地路径写入诊断报告。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 本地坏插件安装失败后，插件诊断页“安装”筛选能看到 `install` 事件。
- 网络插件地址失败后，插件诊断报告包含安装失败摘要和失败分类。
- 复制诊断报告不包含完整本地路径、`file://` 或 `content://` 原文。
```

## Prompt 32：下载中心失败任务批量管理

状态：已完成。本次为下载中心增加失败任务批量重试和批量清理，并让批量操作遵守当前插件来源筛选。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心已有失败任务时，用户可以一键重试失败任务。
- 用户可以一键清理失败记录，避免下载中心长期堆积不可恢复的失败项。
- 批量操作和现有来源筛选组合使用，选中某个插件来源时只处理该来源下的失败任务。

实现要求：
- Downloader 增加批量重试失败任务能力，复用现有单条 retry 行为。
- Downloader 增加批量清理失败任务能力，只删除下载中心记录和通知，不删除本地音乐文件。
- 单条和批量重试前都检查离线/移动网络限制；限制不满足时保留失败记录。
- 下载中心顶部操作区在存在失败任务时显示“重试失败”和“清理失败”。
- 操作完成后 toast 展示处理数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不实现断点续传。
- 不删除已下载的本地文件。
- 不改变下载文件命名规则。
- 不新增下载历史独立页面。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 有失败任务时下载中心显示批量重试/清理入口。
- 选择某个插件来源后，批量重试/清理只影响该来源失败任务。
- 离线或移动网络限制下点击重试，不会丢失原失败记录。
```

## Prompt 33：插件诊断单条事件复制

状态：已完成。本次让插件诊断页的每条诊断事件都能单独复制，方便用户反馈某一次安装、搜索、播放源或歌词失败。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页不只能复制完整报告，也能复制某一条诊断事件。
- 单条报告应包含插件名、方法名、时间、hash 前缀、错误摘要和估算位置。
- 单条报告继续复用诊断模块的脱敏规则，避免泄露 token、cookie、本地路径、file/content URI。

实现要求：
- 在插件诊断模块新增单条事件报告生成函数。
- 插件诊断页每条事件右侧增加复制入口。
- 复制成功后复用现有剪贴板 toast。
- 不主动触发插件方法，不新增诊断网络请求。

不要做：
- 不保存报告历史。
- 不上传诊断数据。
- 不新增复杂详情页或图表。
- 不展示完整插件 URL、headers、cookies、用户变量。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件诊断页每条事件都能复制单条报告。
- 单条报告只包含脱敏后的事件摘要和定位信息。
- 完整诊断报告复制入口仍可使用。
```

## Prompt 34：下载中心暂停和恢复批量操作

状态：已完成。本次让下载中心在原生下载控制可用时支持批量暂停进行中任务、批量恢复已暂停任务，并继续遵守当前插件来源筛选。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心不只支持单条暂停/恢复，也能批量暂停正在进行的任务。
- 已暂停任务可以一键批量恢复。
- 批量操作和现有来源筛选组合使用，选中某个插件来源时只处理该来源下的任务。

实现要求：
- Downloader 增加批量暂停任务能力，复用现有单条 pause 行为。
- Downloader 增加批量恢复任务能力，复用现有单条 resume 行为。
- 下载中心仅在原生下载控制可用时显示批量暂停/恢复入口。
- “暂停进行中”处理 Preparing/Downloading 任务。
- “恢复暂停”处理 Paused 任务。
- 操作完成后 toast 展示处理数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不实现断点续传。
- 不改变原生下载器协议。
- 不改变下载队列调度策略。
- 不影响失败任务重试/清理和已完成记录清理。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 原生下载控制可用且存在进行中任务时，显示批量暂停入口。
- 存在已暂停任务时，显示批量恢复入口。
- 选择某个插件来源后，批量暂停/恢复只影响该来源任务。
```

## Prompt 35：插件诊断事件按插件筛选

状态：已完成。本次让插件诊断页支持按插件名筛选诊断事件，方便用户只查看某个插件的搜索、播放源、歌词或安装失败记录。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页除了按问题类型筛选，还能按插件名筛选。
- 插件候选来自已有诊断事件，不主动触发插件探测。
- 插件筛选和已有类型筛选可以组合使用。

实现要求：
- 插件诊断页从 `getAllPluginDiagnosticEvents()` 返回的事件中生成插件名候选。
- 增加“全部插件 / 指定插件”的筛选入口。
- 刷新诊断事件后，如果当前插件筛选不再存在，自动回到全部插件。
- 筛选结果计数继续显示当前组合筛选后的数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不自动调用插件方法做健康检查。
- 不上传诊断数据。
- 不新增复杂搜索框。
- 不改变诊断记录存储结构。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件诊断页能选择全部插件或某个插件。
- 插件筛选能和搜索/播放源/歌词/安装/其他筛选组合使用。
- 刷新后不存在的插件筛选会自动重置。
```

## Prompt 36：下载中心批量清理确认

状态：已完成。本次为下载中心批量清理已完成记录、失败记录增加确认弹窗，并让已完成记录清理遵守当前插件来源筛选。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心批量清理记录前需要用户确认，避免误触。
- 确认文案明确只清理下载中心记录，不删除本地音乐文件。
- 已完成记录清理和失败记录清理一样，遵守当前插件来源筛选。

实现要求：
- `Downloader.clearCompletedTasks` 支持传入候选歌曲列表。
- 下载中心按当前来源筛选计算可清理的已完成记录数量。
- 点击“清理已完成”先展示确认弹窗，确认后再清理。
- 点击“清理失败”先展示确认弹窗，确认后再清理。
- 清理成功后继续 toast 展示处理数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不删除本地音乐文件。
- 不改变失败任务重试逻辑。
- 不改变下载队列调度策略。
- 不新增单独下载历史页面。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 点击“清理已完成”会先弹确认，取消时不清理。
- 点击“清理失败”会先弹确认，取消时不清理。
- 选择某个插件来源后，清理已完成只影响该来源记录。
```

## Prompt 37：插件诊断事件关键字过滤

状态：已完成。本次为插件诊断页增加轻量关键字过滤，可在已有类型筛选和插件筛选基础上进一步缩小诊断事件范围。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页支持按关键字过滤已有诊断事件。
- 关键字过滤和问题类型筛选、插件名筛选可以组合使用。
- 关键字过滤只读本地诊断事件，不触发插件探测或网络请求。

实现要求：
- 增加关键字筛选入口，复用现有 SimpleInput 面板。
- 关键字匹配插件名、方法名、错误摘要和估算位置。
- 提交空内容可清除关键字筛选。
- 筛选结果计数继续显示当前组合筛选后的数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不新增复杂搜索页。
- 不改变诊断记录存储结构。
- 不上传诊断数据。
- 不主动调用插件方法。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 输入关键字后诊断页只显示匹配事件。
- 关键字筛选能和类型筛选、插件筛选组合使用。
- 提交空关键字后恢复为不过滤关键字。
```

## Prompt 38：插件诊断事件清理

状态：已完成。本次为插件诊断页增加清理当前筛选结果能力，方便用户清掉已经处理过的本机诊断噪音。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页可以清理当前筛选出的诊断事件。
- 清理前需要确认，避免误删诊断上下文。
- 清理只影响本机诊断记录，不影响插件、配置、歌单或播放数据。

实现要求：
- 诊断模块新增按事件 id 清理诊断记录的能力。
- 插件诊断页在当前筛选结果非空时显示清理入口。
- 清理入口清理当前类型筛选、插件筛选、关键字筛选组合后的事件。
- 清理完成后刷新诊断列表并 toast 展示清理数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不上传诊断数据。
- 不清理插件安装文件或插件配置。
- 不改变诊断记录容量限制。
- 不新增报告历史。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 当前筛选结果为空时不显示清理入口。
- 点击清理当前诊断会先弹确认，取消时不清理。
- 确认后只清理当前筛选出的诊断事件。
```

## Prompt 39：插件诊断筛选状态摘要

状态：已完成。本次让插件诊断页在组合筛选时展示当前筛选摘要，并提供一键清空筛选入口。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页使用类型、插件名、关键字组合筛选时，用户能看见当前筛选摘要。
- 用户可以一键清空所有筛选，回到全部诊断事件。
- 不改变诊断记录存储和清理逻辑。

实现要求：
- 当存在任一活动筛选时，在诊断记录数量下方显示当前筛选摘要。
- 摘要包含活动的问题类型、插件名和关键字。
- 筛选条中增加“清空”入口，只在存在活动筛选时显示。
- 点击清空后重置类型筛选、插件筛选和关键字筛选。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不新增复杂搜索页。
- 不改变诊断记录存储结构。
- 不上传诊断数据。
- 不自动调用插件方法。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 设置类型/插件/关键字任一筛选后，页面显示筛选摘要。
- 点击清空后恢复为全部诊断事件。
- 没有活动筛选时不显示摘要和清空入口。
```

## Prompt 40：下载中心批量操作空结果提示

状态：已完成。本次为下载中心批量重试、暂停、恢复、清理补上空结果兜底提示。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 当下载中心批量操作实际处理数量为 0 时，用户能收到明确反馈。
- 兜底场景包括队列状态在点击前后发生变化、筛选结果过期、原生下载控制返回失败等。
- 不改变下载队列、任务状态、清理文件行为。

实现要求：
- DownloadingList 在批量重试失败、暂停进行中、恢复暂停、清理已完成、清理失败返回 count=0 时显示 toast。
- 复用一个通用文案“当前筛选下没有可处理任务”。
- 同步 zh-cn/en-us/zh-tw 和 i18n 类型。

非目标：
- 不让空批量按钮常驻显示。
- 不改变 downloader 批量方法的返回语义。
- 不新增任务状态。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 批量按钮可见但实际处理数量为 0 时，出现空结果提示。
- 原本成功处理 count>0 的成功提示保持不变。
```

## Prompt 41：插件诊断时间范围筛选

状态：已完成。本次为插件诊断页增加时间范围筛选，方便用户只看最近发生的问题。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页可以按诊断事件时间过滤记录。
- 时间范围筛选可以和类型、插件名、关键字筛选组合使用。
- 筛选摘要和一键清空筛选需要覆盖时间范围。
- 不改变诊断记录存储结构，不主动触发插件方法。

实现要求：
- 增加时间范围筛选：全部时间、今天、最近 24 小时、最近 7 天、最近 30 天。
- 使用诊断事件已有 createdAt 字段做本地过滤。
- 筛选条增加时间范围 chip，点击后用 SimpleSelect 选择范围。
- 当时间范围不是全部时间时，筛选摘要显示当前时间范围。
- 点击清空筛选时同时重置时间范围。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增自定义日期选择器。
- 不改变诊断报告导出内容。
- 不上传诊断数据。
- 不改变诊断记录容量限制。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 选择今天/最近 24 小时/最近 7 天/最近 30 天后，只显示对应时间范围内的诊断事件。
- 时间范围能和类型、插件、关键字筛选组合。
- 清空筛选后恢复为全部诊断事件。
```

## Prompt 42：下载中心显示标签写入结果

状态：已完成。本次让下载中心的已完成任务显示下载后标签/歌词文件写入结果。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载完成后，用户能在下载中心看到元数据写入是否成功、失败或未启用。
- 如果独立歌词文件写入成功或失败，也能在下载中心看到。
- 复用已有 mediaExtra 写入结果，不改变下载核心流程。

实现要求：
- DownloadingListItem 读取 musicItem 的 downloadMetadataStatus 和 downloadLyricStatus。
- 已完成任务描述从“完成时间”扩展为“完成时间 / 元数据状态 / 歌词文件状态”。
- 元数据状态复用 localMusic.metadataStatus.* 文案。
- 歌词文件状态复用 localMusic.lyricFileStatus.* 文案。
- 独立歌词文件 skipped 不展示，避免用户误以为失败。

非目标：
- 不改变 downloader 的任务状态结构。
- 不改变音乐标签写入逻辑。
- 不新增下载任务详情页。
- 不新增 i18n 文案。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 下载完成且标签写入成功时，下载中心完成项能看到元数据已写入。
- 下载完成但标签写入失败时，下载中心完成项能看到元数据失败。
- 未开启标签写入时，下载中心完成项能看到元数据未写入。
- 独立歌词文件成功/失败时，下载中心完成项能看到对应提示。
```

## Prompt 43：下载中心按写入结果筛选

状态：已完成。本次让下载中心可以按下载后的元数据/歌词文件写入结果筛选已完成任务。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心可以筛选出标签写入成功、失败、未写入的已完成任务。
- 下载中心可以筛选出独立歌词文件写入成功或失败的已完成任务。
- 写入结果筛选可以和状态筛选、插件来源筛选组合使用。
- mediaExtra 写入结果变化后，筛选结果能刷新。

实现要求：
- DownloadingList 增加“写入结果”筛选 chip。
- 筛选候选包含：全部写入结果、元数据已写入、元数据失败、元数据未写入、歌词已写入、歌词失败。
- 使用已有 mediaExtra 字段 downloadMetadataStatus / downloadLyricStatus 做过滤。
- 写入结果筛选不是全部时，只匹配已完成任务。
- 清理已完成记录按当前插件来源和写入结果筛选计算数量。
- 给 mediaExtra 增加轻量全局版本 hook，让下载中心在写入结果异步更新后重算筛选。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不改变 downloader 的任务状态结构。
- 不改变音乐标签或歌词文件写入逻辑。
- 不新增下载任务详情页。
- 不新增复杂统计图。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 选择元数据失败后，只显示元数据写入失败的已完成任务。
- 选择元数据未写入后，只显示未启用或跳过标签写入的已完成任务。
- 选择歌词已写入/歌词失败后，只显示对应独立歌词文件结果的已完成任务。
- 切换插件来源后，写入结果筛选仍组合生效。
```

## Prompt 44：下载中心写入结果统计摘要

状态：已完成。本次在下载中心顶部增加当前来源下的完成任务和写入失败统计摘要。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户进入下载中心后，不用逐个筛选也能看到已完成下载的标签/歌词写入健康情况。
- 摘要按当前插件来源筛选联动。
- 摘要在 mediaExtra 写入结果异步更新后刷新。

实现要求：
- DownloadingList 统计当前来源下已完成任务数量。
- 统计当前来源下元数据写入失败数量。
- 统计当前来源下独立歌词文件写入失败数量。
- 当当前来源没有已完成任务时不显示摘要。
- 摘要显示在筛选条上方，文案保持简短。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增复杂统计图。
- 不新增任务详情页。
- 不改变下载任务或 mediaExtra 存储结构。
- 不让摘要跟状态筛选/写入结果筛选联动；它只作为当前来源总览。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 有已完成任务时，下载中心顶部显示已完成数量、元数据失败数量、歌词失败数量。
- 切换插件来源后，摘要按来源变化。
- 标签/歌词写入状态更新后，摘要能刷新。
- 无已完成任务时不显示摘要。
```

## Prompt 45：下载中心列表排序

状态：已完成。本次为下载中心增加列表排序入口，方便按完成时间、歌曲名、歌手浏览下载记录。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 下载中心可以按完成时间从新到旧、从旧到新排序。
- 下载中心可以按歌曲名和歌手名排序。
- 排序只影响当前列表展示，不改变下载队列存储顺序。
- 排序可以和状态筛选、插件来源筛选、写入结果筛选组合使用。

实现要求：
- DownloadingList 增加排序 chip。
- 排序候选包含：默认顺序、完成时间从新到旧、完成时间从旧到新、按歌曲名、按歌手名。
- 默认顺序保持原有 downloadQueue 顺序。
- 完成时间排序使用下载任务的 completedAt 字段，缺失完成时间的项目排在后面。
- 歌手排序在歌手相同时按歌曲名兜底。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不持久化排序偏好。
- 不改变下载队列或任务存储结构。
- 不新增拖拽排序。
- 不新增独立下载详情页。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 选择完成时间从新到旧后，已完成任务按 completedAt 倒序展示。
- 选择完成时间从旧到新后，已完成任务按 completedAt 正序展示。
- 选择歌曲名/歌手名后，列表按对应字段排序。
- 切换筛选条件后，排序仍作用于当前筛选结果。
```

## Prompt 46：下载中心完成记录详情

状态：已完成。本次为下载中心已完成任务增加只读详情入口。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户点击下载中心的已完成任务，可以查看这条完成记录的关键信息。
- 详情展示下载完成时间、插件来源、文件名、元数据写入状态和歌词文件写入状态。
- 详情只读，不改变下载任务、文件或 mediaExtra。

实现要求：
- DownloadingListItem 对已完成任务增加整行点击。
- 点击后打开 SimpleDialog 展示下载记录详情。
- 详情包含歌曲、歌手、插件来源、完成时间、文件名、元数据状态、歌词文件状态。
- 元数据状态复用现有写入状态文案。
- 歌词文件 skipped 在详情里显示“未写入”，列表中仍保持不展示 skipped。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增下载任务详情页路由。
- 不新增文件打开/分享操作。
- 不展示完整本地路径。
- 不改变下载队列或任务存储结构。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 点击已完成下载记录能打开详情弹窗。
- 详情能看到完成时间、文件名和写入状态。
- 点击未完成/失败任务不会打开完成详情。
```

## Prompt 47：下载中心完成记录详情复制

状态：已完成。本次让下载中心完成记录详情支持一键复制。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户在完成记录详情弹窗中可以复制当前记录详情。
- 复制内容复用弹窗展示文本，避免两份内容不一致。
- 不展示完整本地路径，不新增分享/打开文件操作。

实现要求：
- DownloadingListItem 抽出完成记录详情文本生成函数。
- SimpleDialog 增加“复制详情”和“关闭”按钮。
- 点击复制写入剪贴板并 toast 提示。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 点击已完成记录打开详情后，点击复制能复制同一份详情文本。
- 未完成/失败任务仍不会打开完成详情。
```

## Prompt 48：下载中心完成记录报告复制

状态：已完成。本次让下载中心支持复制当前筛选下的已完成下载记录报告。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户可以把当前筛选结果里的已完成下载记录复制成文本报告。
- 报告用于反馈下载、标签写入、歌词文件写入问题。
- 报告不包含完整本地路径，只包含歌曲、歌手、插件来源、完成时间、文件名和写入状态。

实现要求：
- 复用单条下载记录详情文本生成逻辑，避免详情弹窗和批量报告字段不一致。
- 下载中心顶部在当前筛选结果包含已完成记录时显示“复制记录”入口。
- 报告记录当前状态筛选、来源筛选、写入筛选和排序方式。
- 点击复制写入剪贴板，并提示已复制记录数量。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增文件导出或分享。
- 不新增打开文件位置。
- 不改变下载队列、下载任务或 mediaExtra 存储。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 当前筛选下有已完成记录时显示“复制记录”入口。
- 点击后剪贴板文本包含筛选摘要和每条已完成记录详情。
- 当前筛选下没有已完成记录时不显示入口，且不影响清理/重试/暂停等已有批量操作。
```

## Prompt 49：插件诊断页复制当前筛选报告

状态：已完成。本次让插件诊断页的复制报告操作尊重当前筛选。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 插件诊断页存在类型、插件、时间或关键字筛选时，复制报告只包含当前筛选出的诊断事件。
- 报告包含当前筛选摘要，方便用户反馈时说明上下文。
- 没有筛选时，复制行为保持原来的全量插件诊断报告。

实现要求：
- buildPluginDiagnosticReport 支持传入可选诊断事件列表和筛选摘要。
- 插件诊断页复制按钮在有活动筛选时传入 filteredEvents。
- 筛选报告里的插件最近错误数按当前报告事件计算。
- 筛选摘要写入报告前做基础脱敏和单行化。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不改变诊断记录存储结构。
- 不新增文件导出、上传或分享。
- 不改变插件管理页菜单里的全量复制报告入口。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 无筛选时复制报告仍包含全量诊断事件。
- 有筛选时复制报告只包含当前筛选事件，并包含 Filters 行。
- 筛选结果为空时也能复制一份事件数为 0 的报告。
```

## Prompt 50：插件诊断报告补充构建信息

状态：已完成。本次让插件诊断报告包含应用构建和关键依赖信息。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户复制插件诊断报告时，报告里能看到应用版本、构建版本、Git 引用、构建时间和播放器依赖基线。
- 反馈插件不能搜、不能播、安装失败时，不需要再额外截图关于页的构建信息。
- 全量报告和当前筛选报告都包含同一份构建信息。

实现要求：
- 在 buildPluginDiagnosticReport 中加入 Build 小节。
- 复用 src/constants/buildInfo.generated.ts 的基线字段。
- 构建运行 URL 为空时不输出空行。
- 输出字段做 sanitizeReportValue 处理，保持单行且避免敏感信息泄露。
- 不新增 i18n，因为报告主体目前是固定英文诊断文本。

非目标：
- 不改诊断事件存储结构。
- 不改关于页构建信息展示。
- 不新增文件导出、上传或分享。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 复制插件诊断报告时包含 Build 小节。
- Build 小节包含 app version、versionCode、Git、build date、signing、RN/Expo/React、nitro player。
- 当前筛选报告也包含 Build 小节。
```

## Prompt 51：下载记录报告写入结果统计

状态：已完成。本次让下载中心复制的完成记录报告包含写入结果统计。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户复制当前筛选下的下载完成记录报告时，报告头部能看到元数据和歌词文件写入结果统计。
- 统计覆盖已写入、失败、未写入和等待结果，方便反馈下载后的标签/歌词问题。
- 统计只基于当前报告里的已完成记录，不改变页面顶部原有来源摘要。

实现要求：
- buildCompletedDownloadRecordsReport 统计当前 items 的 downloadMetadataStatus 和 downloadLyricStatus。
- 在报告头部记录元数据统计和歌词文件统计。
- pending 表示 mediaExtra 尚无写入结果。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不改变下载任务、队列或 mediaExtra 存储结构。
- 不新增文件导出、上传或分享。
- 不改变下载中心顶部写入摘要逻辑。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 复制下载记录报告时，报告头部包含元数据统计和歌词文件统计。
- 切换筛选条件后，统计按当前复制报告内记录重新计算。
- 单条记录详情弹窗文本保持不变。
```

## Prompt 52：下载记录报告导出为文件

状态：已完成。本次让下载中心当前筛选下的完成记录报告可以导出为 txt 文件。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户除了复制下载完成记录报告，也可以选择本地文件夹导出一份 txt 报告。
- 导出的内容复用复制报告文本，避免复制和导出内容不一致。
- 导出只作用于当前筛选下的已完成记录。

实现要求：
- 下载中心顶部在当前筛选结果包含已完成记录时显示“导出记录”入口。
- 点击后打开现有 FILE_SELECTOR 文件夹选择器。
- 用户选择文件夹后写入 `MusicFree-download-records-YYYY-MM-DD-HH-mm-ss.txt`。
- 导出成功显示文件名，导出失败显示原因并留在文件选择器中。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增系统分享。
- 不新增打开文件位置。
- 不改变下载任务、队列或 mediaExtra 存储结构。
- 不把完整本地下载路径写入报告。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 当前筛选下有已完成记录时显示复制和导出入口。
- 导出的 txt 内容与复制报告内容一致。
- 当前筛选下没有已完成记录时不显示导出入口。
- 文件夹无写入权限时提示失败原因。
```

## Prompt 53：插件诊断报告导出为文件

状态：已完成。本次让插件诊断页的诊断报告可以导出为 txt 文件。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户除了复制插件诊断报告，也可以选择本地文件夹导出一份 txt 报告。
- 导出的内容复用复制报告文本，避免复制和导出内容不一致。
- 插件诊断页存在筛选时，导出报告和复制报告一样只包含当前筛选结果。

实现要求：
- 插件诊断页顶部增加导出报告入口。
- 点击后打开现有 FILE_SELECTOR 文件夹选择器。
- 用户选择文件夹后写入 `MusicFree-plugin-diagnostics-YYYY-MM-DD-HH-mm-ss.txt`。
- 导出成功显示文件名，导出失败显示原因并留在文件选择器中。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增系统分享。
- 不新增上传诊断报告。
- 不改变插件诊断记录存储结构。
- 不改变插件管理页菜单里的全量复制报告入口。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 无筛选时导出全量插件诊断报告。
- 有筛选时导出报告包含 Filters 行，且事件数量按当前筛选结果统计。
- 导出的 txt 内容与复制报告内容一致。
- 文件夹无写入权限时提示失败原因。
```

## Prompt 54：插件管理页导出全量诊断报告

状态：已完成。本次让插件管理页菜单也能直接导出全量插件诊断报告。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户在插件管理页不进入诊断页，也能导出一份全量插件诊断报告。
- 插件管理页的导出内容和“复制诊断报告”同源，避免两个入口内容不一致。
- 诊断页的当前筛选导出继续保持原行为。

实现要求：
- 插件管理页菜单在“复制诊断报告”旁增加“导出诊断报告”入口。
- 点击后打开现有 FILE_SELECTOR 文件夹选择器。
- 用户选择文件夹后写入 `MusicFree-plugin-diagnostics-YYYY-MM-DD-HH-mm-ss.txt`。
- 抽出插件诊断报告文件名、路径拼接和写入工具，供插件管理页和诊断页共用。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不新增系统分享。
- 不新增上传诊断报告。
- 不改变诊断事件存储结构。
- 不改变诊断页筛选、清理和复制行为。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件管理页菜单出现“导出诊断报告”。
- 插件管理页导出的报告为全量插件诊断报告。
- 插件诊断页导出仍尊重当前筛选。
- 文件夹无写入权限时提示失败原因。
```

## Prompt 55：插件能力矩阵总览

状态：已完成。本次新增插件能力矩阵页，集中展示已安装插件支持的能力。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户能在插件管理里一眼看到每个插件支持搜索、音源、歌词、榜单、推荐、专辑、歌手、导入、评论、同步等能力。
- 能力矩阵复用插件卡片已有能力识别逻辑，避免两处展示不一致。
- 这是只读总览页，不主动调用插件方法，不做健康检查。

实现要求：
- 抽出插件能力配置和能力判断工具，供插件卡片和矩阵页共用。
- 新增插件能力矩阵页，按插件行、能力列展示支持情况。
- 矩阵页展示插件启用状态、来源和支持能力数量。
- 插件管理页菜单增加“能力矩阵”入口。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不调用插件搜索、播放源、歌词或导入方法。
- 不改变插件排序、启用状态或用户变量。
- 不新增自动健康检查。
- 不改变插件诊断记录存储。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 插件管理页菜单能进入能力矩阵页。
- 插件卡片能力标签和矩阵页能力列使用同一份配置。
- 禁用插件仍显示在矩阵中，并标记状态。
- 无插件时显示空状态。
```

## Prompt 56：插件手动测试搜索

状态：已完成。本次给支持搜索能力的插件增加手动测试搜索入口。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户能在单个插件卡片上输入关键词，手动测试该插件的搜索能力。
- 测试成功后展示返回数量、搜索类型、是否末页和前几条结果。
- 测试失败时复用现有插件方法包装层的诊断记录，方便在插件诊断页继续排查。

实现要求：
- 仅对 `supportedMethods` 包含 `search` 的插件显示“测试搜索”。
- 点击后打开关键词输入面板。
- 搜索类型优先使用插件 `defaultSearchType`，否则使用 `supportedSearchType` 第一项，再兜底 `music`。
- 只调用当前插件第一页搜索，不调用其他插件。
- 搜索期间显示加载弹窗，成功后显示摘要弹窗，失败后 toast 提示原因。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不自动健康检查。
- 不批量测试所有插件。
- 不把测试结果写入歌单或播放队列。
- 不改变插件启用状态、排序、用户变量或诊断存储结构。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 支持搜索的插件卡片显示“测试搜索”。
- 不支持搜索的插件卡片不显示该入口。
- 输入空关键词时只提示，不触发搜索。
- 搜索失败时插件诊断页能看到对应 `search` 失败记录。
```

## Prompt 57：插件测试搜索结果复制

状态：已完成。本次让插件手动测试搜索的成功结果可以一键复制。

```text
你在 MusicFree 仓库的 codex/plugin-center-mvp 分支上工作。

目标：
- 用户手动测试某个插件搜索后，可以把成功结果复制为文本。
- 复制内容和弹窗展示同源，避免反馈文本与屏幕内容不一致。
- 复制文本包含插件名、关键词、搜索类型、结果数量、是否末页和前几条结果。

实现要求：
- 测试搜索成功弹窗增加“复制结果”按钮。
- 复制结果写入剪贴板并 toast 提示。
- 弹窗显示内容和复制文本使用同一份结果文本。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

非目标：
- 不保存测试搜索历史。
- 不上传测试搜索结果。
- 不自动触发测试搜索。
- 不改变插件诊断记录存储结构。

验收：
- npx tsc --noEmit 通过。
- git diff --check 通过。
- 测试搜索成功弹窗可复制结果文本。
- 复制文本包含插件名、关键词、搜索类型、结果数量、是否末页和前几条结果。
- 测试搜索失败流程保持 toast 和诊断记录行为不变。
```

## Prompt 58：插件测试搜索选择搜索类型

状态：已完成。本次让插件手动测试搜索在插件支持多个搜索类型时可以先选择类型。

```text
请继续在 codex/plugin-center-mvp 分支上推进插件中心 MVP 的小切片：插件测试搜索选择搜索类型。

背景：
- Prompt 56 已经给支持搜索能力的插件增加手动测试搜索入口。
- Prompt 57 已经让成功结果可以复制。
- 当前测试搜索类型优先使用插件 defaultSearchType，否则 supportedSearchType 第一项，再兜底 music。
- 多类型插件需要能手动选择 music/album/artist/sheet/lyric 等搜索类型，方便验证插件各搜索分支。

范围：
- 点击“测试搜索”时，读取插件 supportedSearchType。
- 如果插件只支持一个搜索类型，保持原来的直接输入关键词流程。
- 如果插件支持多个搜索类型，先弹出 SimpleSelect 选择搜索类型，再输入关键词。
- 选择项显示本地化名称和对应图标。
- 搜索仍只调用当前插件第一页，不做批量健康检查。
- 结果弹窗和复制文本继续包含实际搜索类型。
- 同步 zh-cn/en-us/zh-tw i18n 和 i18n 类型。

不要做：
- 不自动遍历所有搜索类型。
- 不保存测试历史。
- 不改变插件诊断事件存储结构。
- 不改插件搜索接口。

验收：
- 只声明单个搜索类型的插件，点击“测试搜索”后直接输入关键词。
- 声明多个搜索类型的插件，点击后先出现类型选择。
- 选择类型后输入关键词，调用的是所选类型的第一页搜索。
- 成功结果展示和复制文本里的 Type 与所选类型一致。
- 空关键词、搜索失败和诊断记录行为保持原样。
```

## 当前推进建议

当前已经完成 Prompt 01 到 Prompt 58。下一步可以继续完善下载中心资料库体验，例如打开文件位置（需确认 Android 能力边界），或继续补插件健康检查/测试搜索报告能力。
