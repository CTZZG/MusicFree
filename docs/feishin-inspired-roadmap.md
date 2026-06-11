# Feishin-Inspired MusicFree Roadmap

更新时间：2026-06-11

状态：已确认并开始实施。当前实现分支为 `codex/plugin-center-mvp`，插件中心已推进到本地插件重新选择文件更新、能力矩阵和插件列表来源/能力筛选小切片，下载和本地音乐库资料库化已补充文件状态筛选、摘要、歌手/专辑筛选、本地音乐排序、缺失文件报告、重扫复用缺失旧记录、扫描结果可见报告和扫描结果复制能力；备份恢复报告已补充恢复方式上下文，恢复前预览已支持复制；智能歌单已补齐“最近添加”“收藏歌曲”、歌手/专辑分组、常听歌曲、临时排序和保存为普通歌单；统一搜索已支持本地音乐匹配、高频页面直达、本地歌曲直达播放和在线歌曲/歌单/专辑/歌手搜索入口。

关联文档：

- `docs/plugin-center-plan.md`：插件中心专项设计。

## 背景

Feishin 的启发点不在于“桌面端”本身，而在于它把音乐播放器做成了完整的音乐客户端：音乐库组织、智能歌单、歌词体验、播放状态、构建发布都有明确边界。

MusicFree 的基础不同：

- MusicFree 是移动端。
- MusicFree 的核心是插件聚合和本地播放。
- MusicFree 不依赖自建音乐服务器。
- MusicFree 需要优先保证 Android 播放生命周期、插件兼容、备份恢复和下载体验。

因此本路线不照搬 Feishin，而是把它的产品能力拆成适合 MusicFree 的移动端版本。

## 总体优先级

推荐顺序：

1. 插件中心：已有专项文档。
2. 备份恢复可验证流程。
3. 播放状态与问题诊断页。
4. 智能歌单。
5. 下载和本地音乐库资料库化。
6. 歌词体验升级。
7. 统一搜索/命令面板。
8. 发布体验正规化。

原因：

- 前三项直接解决最近真实反馈中的问题：插件安装、本地歌单恢复、播放退出/恢复/通知栏。
- 智能歌单和下载资料库化是用户可感知增强。
- 歌词、统一搜索、发布体验适合作为后续质量提升。

## 全局非目标

第一轮不做：

- 不做 Feishin 式自建服务器依赖。
- 不重写播放器核心。
- 不改插件协议，除非专项确认。
- 不一次性重构所有页面。
- 不做复杂云同步账号系统。
- 不引入远程服务端。

## 1. 智能歌单

### 目标

让用户不用手动维护所有歌单，也能快速进入常用集合：

- 最近播放。
- 最近添加。
- 已下载歌曲。
- 某插件来源歌曲。
- 指定歌手/专辑。
- 本地音乐。
- 收藏歌曲。
- 播放次数筛选。

### 当前代码入口

- `src/core/musicSheet/index.ts`
  本地歌单数据、收藏歌单、恢复逻辑。
- `src/core/musicHistory.ts`
  播放历史。
- `src/core/downloader.ts`
  下载队列和已下载状态。
- `src/core/localMusicSheet.ts`
  本地音乐库。
- `src/pages/history`
  历史页面。
- `src/pages/localMusic`
  本地音乐页面。
- `src/components/musicSheetPage`
  通用歌单详情页组件。
- `src/utils/mediaUtils.ts`
  媒体唯一键和本地路径。

### 概念定义

智能歌单不是普通歌单。它可以有两种形态：

- `virtual`：实时按规则计算，不落地歌曲列表。
- `materialized`：按规则生成一次，然后保存成普通歌单。

MVP 建议先做 `virtual`，避免复制大量歌曲和同步问题。

### 建议数据结构

```ts
type SmartSheetRuleType =
    | "recent-played"
    | "recent-added"
    | "downloaded"
    | "local"
    | "favorite"
    | "plugin-source"
    | "artist"
    | "album"
    | "play-count";

interface SmartSheetRule {
    type: SmartSheetRuleType;
    operator?: "eq" | "contains" | "gte" | "lte";
    value?: string | number;
}

interface SmartSheet {
    id: string;
    title: string;
    rules: SmartSheetRule[];
    matchMode: "all" | "any";
    sortBy?: "recent-played" | "recent-added" | "title" | "artist";
    limit?: number;
}
```

### MVP 范围

第一版建议只做模板，不做自由规则编辑器：

- 最近播放：复用历史。
- 最近添加：使用本地歌单歌曲的 `$timestamp`。
- 已下载歌曲：根据下载记录或本地路径判断。
- 本地音乐：复用 `LocalMusicSheet`。
- 某插件来源：按 `musicItem.platform` 过滤。

入口建议：

- 首页或侧栏增加“智能歌单”分组。
- 先内置模板，不允许用户编辑规则。
- 每个智能歌单复用 `MusicSheetPage` 展示。

当前已完成的智能歌单小切片：

- 首页智能歌单入口、内置模板列表和智能歌单详情页。
- 最近播放、本地音乐、已下载歌曲、插件来源歌曲模板。
- 最近添加模板，按普通歌单歌曲 `$timestamp` 从新到旧聚合并去重。
- 收藏歌曲模板，复用默认“我喜欢”歌单内容。
- 歌手/专辑动态分组，从已知歌曲聚合并进入对应虚拟歌单。
- 常听歌曲模板，基于本地播放次数统计按次数和最近播放时间排序。
- 智能歌单详情页可将当前结果快照保存为普通歌单。
- 智能歌单详情页支持临时按歌曲名、歌手名或专辑名排序。

### 第二阶段

增加用户自定义规则：

- 规则编辑页。
- 条件组合：全部满足/任一满足。
- 排序方式。
- 数量上限。
- 保存为普通歌单。

### 验收标准

- 最近播放能显示历史歌曲。
- 已下载歌曲能显示下载过的歌曲。
- 本地音乐能显示扫描到的本地歌曲。
- 某插件来源能按 `platform` 过滤。
- 空结果有清晰空状态。
- 不影响普通歌单增删改。
- `npx tsc --noEmit` 通过。

### 风险

- 播放次数目前可能没有完整统计，需要先补计数字段。
- 下载状态来源要统一，避免“文件存在但下载记录丢失”。
- 虚拟歌单不应该参与普通歌单排序/删除。
- 大歌单实时过滤可能有性能问题，需要缓存或分页。

## 2. 播放状态与问题诊断页

### 目标

给用户和开发者一个“播放器黑盒观察窗”，减少真机问题排查成本。

最近真实问题包括：

- 退出后状态恢复异常。
- 通知栏残留。
- 点击通知打不开应用。
- 重新打开后 UI 当前歌曲和实际播放源不一致。
- 插件播放源解析失败但表现为播放失败。

### 当前代码入口

- `src/core/trackPlayer/index.ts`
  当前播放状态、播放队列、播放源解析、恢复逻辑。
- `src/core/trackPlayer/playbackServiceObserver.ts`
  播放状态回调给插件。
- `android/app/src/main/java`
  Android 原生播放、通知、MediaSession 相关实现。
- `src/constants/buildInfo.generated.ts`
  构建信息。
- `src/pages/setting/settingTypes/aboutSetting.tsx`
  关于页，可作为诊断入口参考。
- `src/utils/log.ts`
  日志入口。

### 页面入口

建议第一版隐藏在：

- 设置 -> 关于 -> 连续点击构建号 5 次。
- 或设置 -> 高级 -> 播放诊断。

不建议放在首页，避免普通用户误操作。

### MVP 展示内容

```text
播放诊断

构建
版本：0.6.5-nitro.1 / 400014
分支：...
提交：...

当前播放
歌曲：...
歌手：...
平台：...
队列索引：5 / 32
进度：02:00 / 04:12
播放状态：playing / paused / buffering

播放源
插件：...
URL 类型：http / file / content
质量：...
是否来自缓存：是/否

恢复状态
最近一次保存进度：...
最近一次恢复进度：...

通知/MediaSession
JS 状态：...
Native 状态：后续补

最近错误
...

[刷新] [复制诊断信息]
```

### 第一阶段实现

只展示 JS 层可直接获取的信息：

- 当前歌曲。
- 队列长度和当前索引。
- 播放状态。
- 当前进度。
- 当前插件。
- buildInfo。
- 最近播放错误。

不强求第一版拿到完整 Native MediaSession 状态。

### 第二阶段实现

增加 Android Native 状态查询：

- 当前通知是否存在。
- MediaSession 是否 active。
- 前台服务是否运行。
- 最近一次通知点击 intent。
- 最近一次 stop/exit 原因。

可以新增一个轻量 NativeModule，只读状态，不控制播放。

### 验收标准

- 播放中打开诊断页，当前歌曲、队列索引、进度正确。
- 暂停后状态更新。
- 切歌后状态更新。
- 退出应用前复制诊断信息可读。
- 诊断页不导致播放中断。

### 风险

- 诊断页读状态不能触发副作用。
- 复制诊断信息需要脱敏播放 URL。
- Native 状态查询要避免 Android 版本兼容问题。

## 3. 歌词体验升级

### 目标

把歌词从“能显示”提升到“可选择、可校准、可恢复、可解释”。

### 当前代码入口

- `src/core/lyricManager.ts`
  歌词获取、解析、关联逻辑。
- `src/components/panels/types/musicItemLyricOptions.tsx`
  歌词相关操作面板。
- `android/app/src/main/java/fun/upup/musicfree/lyricUtil`
  Android 歌词工具和悬浮/状态栏歌词。
- `src/native/lyricUtil`
  JS 到 Native 的歌词工具桥接。
- `src/utils/mediaExtra.ts`
  媒体附加信息，可保存歌词关联、偏移等。
- `src/pages/musicDetail`
  播放详情页歌词展示。

### MVP 范围

第一版建议做：

- 歌词来源候选列表。
- 手动选择歌词后保存关联。
- 歌词偏移保存到 mediaExtra。
- 内嵌歌词优先级提升。
- 无歌词时显示具体原因：
  - 插件不支持歌词。
  - 插件返回空。
  - 歌词解析失败。
  - 本地文件无内嵌歌词。

### 歌词候选

建议结构：

```ts
interface LyricCandidate {
    id: string;
    source: "plugin" | "local-file" | "embedded" | "manual";
    pluginName?: string;
    title?: string;
    artist?: string;
    type: "lrc" | "qrc" | "word-by-word" | "plain";
    confidence?: number;
    preview?: string;
}
```

### 自动匹配置信度

第一版不需要复杂算法，可以简单按这些因素加权：

- 标题完全匹配。
- 歌手完全匹配。
- 时长接近。
- 歌词行数正常。
- 歌词时间轴覆盖歌曲大部分时长。

### 第二阶段

- 逐字歌词候选。
- 翻译歌词候选。
- 多语言显示开关。
- 歌词偏移快捷调整。
- 歌词缓存管理。

### 已完成补强

- 歌词详情页可显示来源、关联来源和无歌词原因。
- 手动选择歌词后可保存关联，并可解除关联。
- 歌词偏移可保存到 `mediaExtra`。
- 本地歌词支持上传原文、翻译和音译歌词，删除本地歌词时同步清理三类文件。
- 歌词候选列表显示匹配提示，并支持先预览歌词片段再使用该候选。

### 验收标准

- 同一首歌可看到多个歌词候选。
- 手动选择后下次播放仍使用该歌词。
- 偏移调整后下次播放仍生效。
- 本地嵌入歌词可优先使用。
- 无歌词时能看到原因。

### 风险

- 不同插件歌词格式差异大。
- QRC/KRC/逐字歌词解析可能需要 Native 或专门 parser。
- 自动置信度不能过度自信，必须允许手动选择。

## 4. 下载和本地音乐库资料库化

### 目标

让下载和本地音乐不只是文件列表，而是可管理的音乐资料库。

### 当前代码入口

- `src/core/downloader.ts`
  下载任务、队列、状态、元数据写入入口。
- `android/app/src/main/java/fun/upup/musicfree/download`
  Native 下载管理。
- `android/app/src/main/java/fun/upup/musicfree/mp3Util`
  音频元数据读写。
- `src/core/localMusicSheet.ts`
  本地音乐扫描和恢复。
- `src/pages/downloading`
  下载中心。
- `src/pages/localMusic`
  本地音乐页。

### MVP 范围

第一版建议做：

- 下载中心筛选：
  - 全部。
  - 下载中。
  - 已完成。
  - 失败。
  - 按插件来源。
- 已下载歌曲列表支持按：
  - 歌手。
  - 专辑。
  - 插件来源。
  - 下载时间。
- 下载完成后记录元数据写入结果：
  - 标题。
  - 歌手。
  - 专辑。
  - 封面。
  - 歌词。
  - 写入失败原因。
- 本地音乐文件丢失时显示“文件不存在”状态。

当前已完成的下载中心资料库化小切片：

- 下载中心按状态、插件来源、歌手、专辑、写入结果筛选。
- 下载完成记录详情、复制和导出。
- 下载完成记录详情可主动复制文件夹路径和完整文件位置；批量报告仍只输出文件名，避免泄露完整本地路径。
- 下载完成记录可提示本地文件是否仍存在，文件缺失时列表和详情给出明确状态。
- 下载中心可按已完成记录的文件状态筛选，快速聚焦文件存在、文件不存在或状态未知记录。
- 下载中心顶部摘要可显示已完成记录的文件存在、文件不存在和状态未知数量。
- 本地音乐页可按文件状态筛选，并显示当前范围下文件存在、文件不存在和状态未知数量。
- 本地音乐页可按歌曲名、歌手名、专辑名或来源临时排序。
- 本地音乐页可复制当前范围下的缺失文件报告，报告不包含完整本地路径。
- 本地音乐重新扫描时，可在旧记录文件缺失且匹配唯一的情况下复用旧 `id/platform` 并更新 localPath，减少普通歌单引用失联。
- 本地音乐扫描完成后可显示扫描结果计数报告，包括新增、原始 ID 修复和歌曲信息修复数量。
- 本地音乐扫描结果报告可复制，复制文本只包含计数和生成时间，不包含本地路径或歌曲明细。

### 本地重新扫描保留歌单归属

问题：

本地音乐重新扫描后，路径或 id 变化可能导致用户原来加入歌单的本地歌曲无法匹配。

建议：

- 为本地文件保存弱指纹：
  - 文件路径。
  - 文件名。
  - 文件大小。
  - 修改时间。
  - 标题/歌手/专辑。
- 不建议第一版做全文件 hash，成本太高。
- 重扫时先用路径匹配，再用弱指纹匹配。
- 匹配成功后更新 localPath，但保持歌单里的媒体 id 关系。

已完成第一版：

- 若扫描结果与旧记录 `platform + id` 相同，且旧路径文件已缺失，则复用旧记录并更新 localPath。
- 若普通“本地”歌曲的旧路径文件已缺失，则使用标题、歌手、专辑/时长进行唯一弱匹配。
- 匹配成功后同步更新普通歌单里的同一首歌引用；不确定或多候选时不自动匹配。
- 扫描完成后显示计数报告，便于真机验证重扫修复是否生效。
- 扫描结果计数报告支持复制，方便用户反馈重扫修复结果。

### 文件丢失重新定位

当本地歌曲文件不存在：

- 歌曲列表显示“文件丢失”。
- 提供“重新定位文件”。
- 用户选择新文件后更新 localPath。
- 如果新文件标题/歌手接近，提示匹配成功。

### 验收标准

- 下载中心能按状态筛选。
- 已下载歌曲能按插件来源筛选。
- 下载完成后能看到元数据写入是否成功。
- 删除本地文件后，本地音乐页显示文件丢失而不是静默消失。
- 重新定位文件后可以播放。

### 风险

- Android 文件权限和 SAF 路径复杂。
- 元数据写入不同格式支持不同。
- 本地文件弱匹配可能误匹配，需要用户确认。

## 5. 备份恢复可验证流程

### 目标

从“恢复成功/失败 toast”升级为“恢复前可预览，恢复后有报告”。

### 当前代码入口

- `src/core/backup.ts`
  备份和恢复主逻辑。
- `src/pages/setting/settingTypes/backupSetting.tsx`
  本地/WebDAV 备份恢复入口。
- `src/core/musicSheet/index.ts`
  普通歌单和收藏歌单恢复。
- `src/core/localMusicSheet.ts`
  本地音乐恢复。
- `src/core/pluginManager/index.ts`
  插件恢复。

### MVP 范围

第一版建议做：

- 备份文件预览。
- 恢复结果报告。
- 恢复前自动备份当前数据。
- 插件恢复失败不阻断歌单恢复。

当前已完成的备份恢复可验证小切片：

- 恢复前预览和恢复后报告。
- 恢复前自动备份当前数据，并在恢复报告中显示备份路径或失败原因。
- 恢复报告可复制。
- WebDAV 手动备份历史和恢复时选择历史备份。
- 恢复前预览和恢复后报告显示当前恢复方式。
- 恢复前预览可复制，复制后仍可继续开始恢复。

### 备份预览

用户选择备份文件后，先解析并显示：

```text
备份预览

普通歌单：12 个
普通歌曲：420 首
本地音乐：80 首
收藏歌单：6 个
插件：8 个
备份版本：v2
创建时间：...

[开始恢复]
```

### 恢复结果报告

```ts
interface ResumeReport {
    startedAt: number;
    finishedAt?: number;
    musicSheets: {
        total: number;
        restored: number;
        skipped: number;
        failed: number;
    };
    localMusic: {
        total: number;
        restored: number;
        missingFiles: number;
    };
    plugins: {
        total: number;
        restored: number;
        skippedLocalFile: number;
        failed: number;
    };
    messages: Array<{
        level: "info" | "warn" | "error";
        text: string;
    }>;
}
```

### 恢复前自动备份

恢复前自动生成一份当前数据备份：

- 文件名：`backup-before-restore-<timestamp>.json`
- 存储位置优先用 app 可写目录。
- 如果写入失败，不阻断恢复，但要提示用户。

### WebDAV 自动备份

后续阶段再做：

- 每天/每周自动备份。
- 仅 Wi-Fi 时备份。
- 保留最近 N 份。
- 恢复前列出远端备份。

### 验收标准

- 选择备份文件后先出现预览。
- 恢复完成后出现报告。
- 本地文件缺失时报告缺失数量。
- 插件失败时歌单仍恢复。
- 恢复前能生成当前数据备份。

### 风险

- 备份文件可能很大，解析要考虑 Loading 状态。
- 旧备份字段缺失，需要兼容。
- WebDAV 错误信息要可读。

## 6. 统一搜索/命令面板

### 目标

给重度用户一个全局入口，减少在多个页面之间跳转。

### 当前代码入口

- `src/core/router`
  页面路由。
- `src/core/pluginManager/index.ts`
  插件搜索能力。
- `src/core/musicSheet/index.ts`
  本地歌单。
- `src/core/localMusicSheet.ts`
  本地音乐。
- `src/pages/search`
  现有搜索页面。
- `src/components/base/appBar.tsx`
  顶部栏入口。

### MVP 范围

第一版建议做“全局搜索”，不叫命令面板：

- 搜歌曲：跳转现有搜索页。
- 搜本地歌单。
- 搜插件。
- 搜设置项。

当前已完成的统一搜索小切片：

- 首页和设置页可进入全局搜索。
- 可跳转在线搜歌。
- 可搜索本地歌单、插件和设置项。
- 可搜索本地音乐库，命中后进入匹配歌曲列表。
- 可搜索并直达本地音乐、下载中心、播放历史和智能歌单等高频页面。
- 本地音乐命中时展示前几条歌曲，点击可直接按当前匹配结果作为队列播放。
- 在线搜索区可直接选择搜索单曲、歌单、专辑或歌手。

入口：

- 首页右上角搜索。
- 设置页顶部搜索。
- 侧栏搜索。

### 第二阶段

增加命令能力：

- 播放某首歌。
- 添加到歌单。
- 下载。
- 启用/禁用插件。
- 跳转到某个设置项。

### 建议数据结构

```ts
type CommandTargetType =
    | "music"
    | "music-sheet"
    | "plugin"
    | "setting"
    | "action";

interface CommandItem {
    id: string;
    type: CommandTargetType;
    title: string;
    subtitle?: string;
    keywords?: string[];
    action: () => void | Promise<void>;
}
```

### 验收标准

- 输入插件名能找到插件详情。
- 输入歌单名能跳转歌单。
- 输入设置项能跳转设置。
- 搜索框不阻塞播放。
- 没有结果时给出可理解空状态。

### 风险

- 移动端输入法和弹窗布局容易遮挡。
- 命令动作太多会复杂，第一版只做跳转更稳。
- 搜索本地大量歌曲需要节流和分页。

## 7. 发布体验正规化

### 目标

降低发布和验证成本，让用户拿到更清晰的版本信息。

### 当前代码入口

- `.github/workflows/android-build.yml`
  Android 构建和发布。
- `generator/generate-build-info.mjs`
  构建信息生成。
- `src/constants/buildInfo.generated.ts`
  构建信息常量。
- `src/pages/setting/settingTypes/aboutSetting.tsx`
  关于页构建信息展示。
- `package.json`
  版本号和构建脚本。
- `android/app/build.gradle`
  Android versionCode。

### MVP 范围

第一版建议做：

- Release changelog 自动生成草稿。
- CI 输出更完整的 `android-build-info.txt`。
- Release asset 清理继续容错。
- 构建失败时报告更清楚。

### Beta/Stable 两条线

建议规则：

- `0.6.5-nitro.1`：测试版本。
- `0.6.5`：稳定版本。
- tag：
  - `v0.6.5-nitro.1`
  - `v0.6.5`
- Release：
  - Nitro/beta 标记 prerelease。
  - Stable 标记正式 release。

### Smoke Test

CI 里可加轻量检查：

- `npx tsc --noEmit`
- `git diff --check`
- Gradle assemble。
- APK 元数据检查：
  - packageName。
  - versionName。
  - versionCode。
  - minSdk/targetSdk。

真机 smoke 暂时不强制放 CI，可以保留本地 checklist。

### 验收标准

- 每次 release 都有版本号、commit、构建时间。
- Release asset 不因 GitHub 502 直接失败。
- APK 文件名包含版本号和 shortSha。
- 失败日志能快速看出是构建失败、签名失败还是上传失败。

### 风险

- GitHub Release API 偶发 5xx，需要重试和容错。
- Beta/stable 命名要和用户理解一致。
- 自动 changelog 需要规范 commit message。

## 推荐里程碑

### Milestone A：可靠性优先

包含：

- 插件中心 Phase 1。
- 备份恢复预览和报告。
- 播放诊断页 JS 层 MVP。

价值：

- 优先解决最近真实反馈。
- 后续出问题更容易定位。

### Milestone B：用户体验增强

包含：

- 智能歌单模板。
- 下载中心筛选。
- 本地文件丢失提示。
- 歌词候选和偏移保存。

价值：

- 用户直接感知更强。
- 适合发一个较大的 beta。

### Milestone C：重度用户效率

包含：

- 统一搜索。
- 设置项搜索。
- 插件详情快速跳转。
- 命令面板雏形。

价值：

- 适合长期用户。
- 不影响新用户主流程。

### Milestone D：发布工程

包含：

- Changelog 自动草稿。
- beta/stable 规则固化。
- release artifact 检查。
- 本地真机 smoke 文档固化。

价值：

- 降低每次发布的人肉成本。

## 开放问题

确认前建议逐条决定：

- 智能歌单第一版是否只做内置模板。
- 播放诊断入口放“关于页隐藏入口”还是“高级设置”。
- 歌词候选是否第一版就做多来源，还是先做偏移保存。
- 下载资料库是否需要独立“已下载”页面。
- 备份恢复报告是否需要保存历史记录。
- 统一搜索是否放首页，还是先放设置页。
- beta/stable 版本命名是否固定采用 `nitro.x`。

## 接手提示

如果上下文丢失，新 agent 应先读：

1. `docs/feishin-inspired-roadmap.md`
2. `docs/plugin-center-plan.md`
3. 最近一次用户确认的优先级
4. 当前 git 分支和工作区状态

不要同时开工所有模块。建议一次只开一个分支、一个 Milestone，避免开发断档后难以收口。
