# Plugin Center Plan

更新时间：2026-06-09

状态：已确认并开始实施。当前实现分支为 `codex/plugin-center-mvp`。

第一轮实现范围：插件来源识别、能力标签、插件详情入口。

## 背景

MusicFree 的核心价值是插件生态。用户遇到“不能搜索”“不能播放”“本地插件安装失败”“备份恢复后歌单存在但不能播”等问题时，当前插件管理页只能做安装、更新、排序、卸载、启用/禁用，缺少足够的状态解释和诊断入口。

借鉴 Feishin 的重点不是照搬桌面端或自建服务器客户端模式，而是借鉴它的“音乐客户端完整性”：清楚的能力展示、清楚的状态、清楚的问题定位、清楚的恢复路径。

## 一句话定义

“插件中心”不是插件商店，而是插件生命周期管理中心：

- 用户知道每个插件来自哪里。
- 用户知道每个插件支持什么能力。
- 用户知道插件为什么失败。
- 用户能备份、迁移、恢复插件相关配置。
- 开发和测试时能快速定位是插件问题、网络问题、配置问题还是播放器问题。

## 非目标

第一阶段不做这些事情：

- 不内置、托管或推荐具体插件源。
- 不改变现有插件接口规范。
- 不强制插件作者改代码。
- 不做真正意义上的商业化插件市场。
- 不在自动诊断中擅自请求用户未确认的播放资源。
- 不把用户变量、Cookie、token 等敏感信息写入明文日志。

## 当前代码入口

实现前优先阅读这些文件：

- `src/core/pluginManager/index.ts`
  插件安装、更新、卸载、排序、启用插件获取。
- `src/core/pluginManager/plugin.ts`
  插件实例、能力封装、插件方法调用、错误定位。
- `src/core/pluginManager/meta.ts`
  插件启用状态、排序、用户变量、替代插件等元信息。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`
  当前插件列表、安装入口、更新入口。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginSort.tsx`
  插件排序页。
- `src/pages/setting/settingTypes/pluginSetting/views/pluginSubscribe.tsx`
  插件订阅源设置。
- `src/core/backup.ts`
  当前备份恢复逻辑。后续插件配置备份需要扩展这里。
- `src/types/core/pluginManager.d.ts`
  插件管理类型定义。
- `src/types/plugin.d.ts`
  插件能力接口。

## 用户故事

### 普通用户

- 我想知道某个插件为什么不能播放。
- 我想知道某个插件是不是支持歌词、歌单导入、专辑详情。
- 我想知道插件是本地安装的，还是从 URL/订阅源安装的。
- 我换手机后，希望插件顺序、启用状态、用户变量、替代插件设置能恢复。
- 我安装插件失败时，希望看到可理解的原因，而不是只有“安装失败”。

### 测试用户

- 我想一眼看到哪些插件安装成功、哪些失败。
- 我想看到最近一次 `search`、`getMediaSource`、`getLyric` 的失败原因。
- 我想导出一份不含敏感信息的插件诊断报告。

### 开发者

- 我想快速判断播放失败是插件解析失败、插件未启用、插件缺少用户变量，还是播放器失败。
- 我想保留最近的插件错误，避免用户复现一次就丢失上下文。
- 我想让备份恢复结果可解释：恢复了几个插件、跳过了几个、本地插件为什么不能自动恢复。

## MVP 范围

第一版只做低风险增强，尽量不改插件协议。

### 1. 插件卡片增强

当前插件列表每个插件项至少展示：

- 插件名称。
- 版本号。
- 启用状态。
- 来源类型：
  - `network`：来自 `srcUrl`。
  - `local-file`：从本地文件安装，没有可更新 URL。
  - `unknown`：无法判断来源。
- 支持能力标签：
  - 搜索：`search`
  - 播放源：`getMediaSource`
  - 歌词：`getLyric`、`getWordByWordLyric`
  - 歌单导入：`importMusicSheet`
  - 单曲导入：`importMusicItem`
  - 专辑详情：`getAlbumInfo`
  - 歌单详情：`getMusicSheetInfo`
  - 艺人作品：`getArtistWorks`
  - 排行榜：`getTopLists`、`getTopListDetail`
  - 推荐歌单：`getRecommendSheetsByTag`
  - 歌单同步：`syncMusicSheet`
- 最近错误摘要：
  - 无错误：显示“最近无错误”
  - 有错误：显示方法名、时间、简短原因

### 2. 插件详情页

点击插件卡片进入详情页，第一版包含：

- 基本信息：
  - 名称、版本、作者、平台名、hash、安装路径、来源 URL。
- 能力列表：
  - 支持/不支持分组显示。
- 配置入口：
  - 用户变量。
  - 替代插件。
  - 启用/禁用。
  - 更新。
  - 卸载。
- 最近诊断：
  - 最近 10 条插件错误。
  - 每条显示方法名、错误消息、时间。
  - 如果已有插件代码行号估算能力，显示估算位置。

### 3. 插件诊断记录

新增一个轻量诊断存储，不影响正常播放。

建议结构：

```ts
interface PluginDiagnosticEvent {
    id: string;
    pluginName: string;
    pluginHash?: string;
    method: string;
    level: "warn" | "error";
    message: string;
    createdAt: number;
    sourceUrl?: string;
    estimatedLocation?: string;
}
```

存储建议：

- 使用 MMKV。
- 每个插件保留最近 20 条。
- 全局最多保留 200 条。
- 不记录完整 URL query 中疑似 token 的内容。
- 不记录用户变量原始值。
- 不记录 headers/cookies。

第一版只记录失败，不记录每次成功，避免噪音和性能风险。

### 4. 安装结果更清晰

本地安装和网络安装都统一返回可展示结果：

- 成功：
  - 插件名。
  - 版本。
  - 来源。
- 失败：
  - 来源。
  - 失败原因。
  - 是否可重试。

本地安装失败常见原因需要文案化：

- 文件读取失败。
- 插件解析失败。
- 插件语法不兼容 Android。
- 已安装更新版本。
- 插件重复。

### 5. 备份恢复增强

当前备份主要记录插件 `srcUrl/version`，对本地插件、用户变量、排序、启用状态、替代插件设置不够完整。

MVP 可以先新增插件配置备份块，不破坏旧备份：

```ts
interface PluginBackupV2 {
    version: 2;
    installed: Array<{
        name: string;
        hash?: string;
        version?: string;
        sourceType: "network" | "local-file" | "unknown";
        srcUrl?: string;
    }>;
    order?: Record<string, number>;
    disabled?: string[];
    alternativePlugins?: Record<string, string>;
    userVariables?: Record<string, Record<string, string>>;
}
```

恢复策略：

- `network` 插件：
  - 有 `srcUrl` 才尝试下载安装。
  - 下载失败不阻断歌单恢复。
- `local-file` 插件：
  - 不自动恢复插件代码。
  - 恢复报告中提示“本地插件需要重新选择文件安装”。
- 用户变量：
  - 默认恢复。
  - 如果未来担心敏感信息泄露，可加导出开关。
- 排序、启用状态、替代插件：
  - 插件存在时恢复。
  - 插件不存在时暂存或跳过，并写入恢复报告。

## 页面草图

### 插件管理首页

```text
插件管理

[已安装] [订阅源] [诊断] [备份]

酷我音乐        已启用   network
1.2.3          搜索 播放源 歌词 歌单
最近无错误

某本地插件      已启用   local-file
0.9.0          搜索 播放源
最近错误：getMediaSource 403，2小时前
```

### 插件详情页

```text
酷我音乐
版本：1.2.3
来源：network
URL：https://...
状态：已启用

能力
✓ 搜索
✓ 播放源
✓ 歌词
× 歌单同步

操作
[更新] [禁用] [用户变量] [替代插件] [卸载]

最近诊断
2026-06-09 19:20 getMediaSource 失败：403 Forbidden
2026-06-09 18:05 getLyric 失败：歌词为空
```

### 诊断页

```text
插件诊断

[全部] [播放源] [歌词] [搜索] [安装]

酷我音乐 / getMediaSource
403 Forbidden
2小时前

某插件 / install
插件无法解析：Unexpected token
昨天
```

## 推荐实现阶段

### Phase 0：文档确认

已完成。

产出：

- 本文档。
- 用户确认范围。
- 新建实现分支。

验收：

- 不改功能代码。
- 不切分支。
- 不提交到 GitHub，除非用户明确要求。

### Phase 1：插件卡片和详情页 MVP

目标：

- 插件列表展示来源、版本、能力标签、最近错误摘要。
- 新增插件详情页。
- 不改变插件安装逻辑。

涉及文件：

- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`
- `src/pages/setting/settingTypes/pluginSetting/components/pluginItem.tsx`
- 新增插件详情页或在现有 `PluginItem` 上扩展。
- `src/core/pluginManager/index.ts`
- `src/core/pluginManager/plugin.ts`

验收：

- 已安装插件能显示能力标签。
- 本地插件和网络插件能区分来源。
- 点击插件能进入详情页。
- `npx tsc --noEmit` 通过。
- Android 真机能打开插件管理页。

### Phase 2：诊断记录

目标：

- 插件方法失败时记录最近错误。
- 插件卡片显示最近错误。
- 插件详情页展示最近 10 条。

实现建议：

- 新增 `src/core/pluginManager/diagnostics.ts`。
- 在插件方法封装层统一记录错误。
- 诊断记录只保存摘要，不保存敏感信息。

验收：

- 构造一个错误插件，错误能显示在诊断页。
- 正常播放流程不受影响。
- 诊断记录不会无限增长。

### Phase 3：安装结果和订阅源体验

目标：

- 本地安装、网络安装、订阅安装使用统一结果展示。
- 失败原因可读。
- 订阅源安装失败时能看到每个 URL 的结果。

涉及文件：

- `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`
- `src/pages/setting/settingTypes/pluginSetting/views/pluginSubscribe.tsx`
- `src/core/pluginManager/index.ts`

验收：

- 本地安装一个正常插件，显示成功详情。
- 本地安装一个坏插件，显示解析失败原因。
- 订阅源中部分 URL 失败时，不影响其他 URL。

### Phase 4：插件配置备份恢复

目标：

- 备份插件顺序、启用状态、用户变量、替代插件。
- 恢复时生成报告，不让插件失败阻断歌单恢复。

涉及文件：

- `src/core/backup.ts`
- `src/core/pluginManager/meta.ts`
- `src/pages/setting/settingTypes/backupSetting.tsx`

验收：

- 备份后恢复，插件排序保持。
- 禁用状态保持。
- 用户变量恢复。
- 本地插件不自动恢复代码，但恢复报告提示用户重新安装。

### Phase 5：可选增强

当前已在 `codex/plugin-center-mvp` 分支完成：

- 插件健康检查按钮，以及健康检查报告复制/导出。
- 插件测试搜索关键词、搜索类型选择、成功/失败报告复制/导出。
- 插件测试搜索综合报告，聚合搜索结果/失败诊断和本地健康检查。
- 插件诊断报告导出。
- 插件诊断筛选报告只包含筛选相关插件摘要。
- 插件诊断单条记录导出。
- 插件诊断单条详情弹窗，以及详情直达插件列表筛选。
- 单个插件直达诊断页并自动筛选。
- 插件详情弹窗可复制安全诊断摘要。
- 插件卡片直接显示最近错误摘要，并可点按直达该插件诊断筛选。
- 插件卡片直接显示用户变量配置摘要，缺少配置时可点按进入用户变量设置。
- 插件管理首页支持按用户变量配置状态筛选：缺少配置、已配置、无配置。
- 插件管理首页支持按启用状态筛选：已启用、已禁用。
- 本地文件插件可重新选择文件更新，且会校验插件名避免误装其他插件。
- 插件能力矩阵总览。
- 插件管理首页支持按来源和能力快速筛选插件。

后续仍暂缓：

- 插件回滚。
- 全局命令面板。

## 数据和类型建议

### 插件来源

```ts
type PluginSourceType = "network" | "local-file" | "unknown";

interface PluginSourceInfo {
    type: PluginSourceType;
    srcUrl?: string;
    path?: string;
}
```

来源推断：

- `plugin.instance.srcUrl` 存在：`network`
- `plugin.path` 存在但 `srcUrl` 不存在：`local-file`
- 两者都缺失：`unknown`

### 插件能力

能力从 `plugin.supportedMethods` 派生，不需要新协议。

```ts
interface PluginCapabilityView {
    key: keyof IPlugin.IPluginInstanceMethods;
    label: string;
    supported: boolean;
}
```

### 插件诊断摘要

```ts
interface PluginHealthSummary {
    lastError?: PluginDiagnosticEvent;
    errorCount: number;
}
```

## 备份兼容策略

- 旧备份没有 `pluginBackupV2` 时，继续走旧逻辑。
- 新备份有 `pluginBackupV2` 时，优先使用新逻辑。
- `plugins` 老字段暂时保留，避免破坏旧版本。
- 恢复时所有插件任务都应该使用 `Promise.allSettled`，不能因为插件失败导致歌单、本地音乐、收藏歌单恢复失败。

## 隐私和安全

必须避免：

- 把用户变量原文写进诊断日志。
- 把 Cookie、Authorization、token 写进诊断日志。
- 把完整播放 URL 直接展示给用户或写入日志。
- 自动上传诊断数据。

可以做：

- 本地展示错误摘要。
- 用户手动复制诊断报告。
- 报告默认脱敏。

## 真机测试清单

实现后至少测：

- 打开插件管理页。
- 打开插件详情页。
- 本地安装正常插件。
- 本地安装坏插件。
- URL 安装正常插件。
- URL 安装失败插件。
- 禁用/启用插件。
- 插件排序。
- 触发一次插件播放源失败，确认诊断记录出现。
- 备份后恢复，确认歌单不受插件失败影响。
- 恢复后确认插件排序和用户变量。

可用命令：

```powershell
npx tsc --noEmit
git diff --check
android\gradlew.bat :app:assembleRelease --no-daemon --console=plain
adb devices
adb logcat
```

## 风险

- 插件懒加载：如果插件未挂载，能力和实例信息可能来自缓存，详情页要能显示“缓存信息”或触发挂载。
- 诊断噪音：插件失败可能很多，必须限制数量。
- 敏感信息：错误对象里可能带 URL/header，需要脱敏。
- 本地插件恢复：没有原文件时不能自动恢复，只能提示用户重新选择文件。
- 文案和 i18n：新增 UI 文案需要同步类型定义。
- 性能：插件列表不应该因为读取大量诊断记录变慢。

## 开放问题

确认前需要决定：

- 是否第一版就做“插件详情页”，还是先只增强卡片。
- 是否备份用户变量原文。
- 诊断记录保留 20 条还是 50 条。
- 是否在插件详情页提供“复制诊断信息”按钮。
- 是否需要为本地插件增加“重新选择文件更新”入口。已完成，入口仅对本地文件插件显示，并校验插件名。
- 是否需要显示插件安装路径给普通用户，还是只在高级模式显示。

## 推荐第一轮任务拆分

当前分支第一轮建议只做：

1. 插件来源识别。
2. 插件能力标签。
3. 插件详情页。
4. 最近错误诊断存储。
5. 插件详情页展示最近错误。

这一轮完成后，再决定是否进入备份恢复增强。

## 接手提示

如果上下文丢失，新 agent 应先读：

1. `docs/plugin-center-plan.md`
2. `src/core/pluginManager/index.ts`
3. `src/core/pluginManager/plugin.ts`
4. `src/core/pluginManager/meta.ts`
5. `src/pages/setting/settingTypes/pluginSetting/views/pluginList.tsx`

不要直接开始大改。先确认当前分支、工作区状态和用户是否已经批准本文档。
