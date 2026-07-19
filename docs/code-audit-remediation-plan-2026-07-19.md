# MusicFree 代码审计整改计划

日期：2026-07-19
基线分支：`feat/mpv-player`
执行原则：以本文件为唯一整改清单；先保证数据与播放稳定性，再收紧安全边界；每项必须有自动化验证或明确的真机门禁。

## 1. 完成定义

本轮完成必须同时满足：

- P0/P1 中可在当前代码库安全落地的项目全部完成，并有针对性测试。
- `npx tsc --noEmit --pretty false` 通过。
- 全量 Jest 通过。
- `:app:compileReleaseKotlin` 通过。
- 相关静态审计通过；环境无法执行的检查必须记录原因。
- 不修改或覆盖用户现有的 `.env`、截图、签名文件和其他无关工作区内容。
- 需要真机、破坏兼容性或单独产品决策的项目不得伪装成已完成，必须进入“门禁/遗留项”。

## 2. 整改任务

### Phase A：并发与数据一致性

- [x] **R01 / P0：下载目标路径原子预留**
  - 位置：`src/core/downloader.ts`
  - 修复：串行化“检查文件 + 预留路径”，避免两个同名并发任务得到同一路径。
  - 验收：并发调用在 `exists()` 延迟交错时仍返回两个不同路径；释放后可复用。

- [x] **R02 / P0：MediaCache 淘汰不得删除新值**
  - 位置：`src/core/mediaCache.ts`
  - 修复：淘汰候选携带值/版本，删除前后校验；新写入必须保留。
  - 验收：淘汰与同 key 更新交错时，新缓存和新路径不被删除。

- [x] **R03 / P1：歌单删除提交顺序**
  - 位置：`src/core/musicSheet/index.ts`
  - 修复：先持久化权威索引，再清理歌曲数据和内存映射。
  - 验收：索引写入失败时，原歌曲数据仍存在。

- [x] **R04 / P1：本地插件升级原子替换**
  - 位置：`src/core/pluginManager/index.ts`
  - 修复：先写新插件并提交插件列表，最后 best-effort 删除旧文件。
  - 验收：新文件写入失败时旧插件仍可用；成功后不残留旧文件。

- [x] **R05 / P2：恢复报告按实际变更计数**
  - 位置：`src/core/localMusicSheet.ts`、`src/core/backup.ts`
  - 修复：成功数按实际新增/提交数量计算，不按输入数组长度推断。
  - 验收：重复条目恢复时报告与实际新增数量一致。

### Phase B：模块连接与生命周期

- [x] **R06 / P0：启动阶段不得提前实例化错误播放器后端**
  - 位置：`src/core/trackPlayer/index.ts`、启动页/播放器 hooks
  - 修复：后端锁定前禁止 hooks 触发 Adapter getter；选定 MPV 时不得先调用 Nitro。
  - 验收：MPV 冷启动策略测试中 Nitro resolver/getState 调用次数为 0。

- [x] **R07 / P1：MPV Service 重建与销毁收敛**
  - 位置：`MpvPlaybackService.kt`、`MpvPlayerModule.kt`、`MpvServiceBridge.kt`
  - 修复：空 Intent 不重建空 Service；销毁清理回调；Bridge 跨线程字段具备可见性；排队命令在 destroy 后安全拒绝。
  - 验收：Kotlin 编译通过；静态/单测覆盖 null-intent 策略与 destroy guard；真机进程重建列入门禁。

- [x] **R08 / P1：查询 Effect 消除陈旧闭包与迟到结果**
  - 位置：Artist、TopList、SearchLrc、Markdown 异步解析相关组件。
  - 修复：补齐依赖、重置分页、加入 generation/cancel guard。
  - 验收：切换 artist/tab/musicItem 后只提交最新请求结果。

- [x] **R09 / P1：LyricManager 初始化幂等、订阅可释放**
  - 位置：`src/core/lyricManager.ts`
  - 修复：保存订阅句柄，重复 setup 不重复注册，提供 dispose；原生歌词仅更新当前活动后端。
  - 验收：连续 setup 两次仍只有一组监听；dispose 后不再响应事件。

### Phase C：安全、隐私与交付门禁

- [x] **R10 / P0：WebDAV 强制安全传输**
  - 位置：`src/core/webdavBackup.ts`、设置页及测试。
  - 修复：统一 URL 校验，默认只允许 HTTPS，保存与建连两处均拒绝不安全地址。
  - 验收：HTTP、内嵌凭据、无效 URL 被拒；HTTPS 可用。

- [x] **R11 / P1：插件下载入口统一安全策略**
  - 位置：`PluginManager.installPluginFromUrl`、自动更新、Deep Link。
  - 修复：校验放入底层安装入口，所有调用者不可绕过；外部本地 `.js` 安装需确认。
  - 验收：自动更新中的 HTTP/本机/私网 URL 被拒；合法 HTTPS 正常；外部 Intent 不会静默执行插件。

- [x] **R12 / P1：遥测透明度与默认行为一致**
  - 位置：`src/core/telemetry.ts`、配置/设置、README。
  - 修复：遥测改为明确选择后启用，README 描述与代码一致，异常属性保持最小化。
  - 验收：默认配置不发送；显式开启后才允许发送；关闭开关立即生效。

- [x] **R13 / P1：CI 与依赖安全门禁**
  - 位置：`.github/workflows/android-build.yml`、`package-lock.json`、`android/app/build.gradle`。
  - 修复：CI 增加 TypeScript 检查；依赖审计门槛提升到 High；升级可安全升级的传递依赖并复核可达性。
  - 完成：经用户授权连接 npm 官方 registry，使用 lockfile-only、非 `--force` 修复生产及开发传递依赖；完整依赖树 High/Critical 均清零。修复同时消除了 Gradle 对 `@expo/cli` 根目录 hoist 的隐式依赖，使嵌套依赖布局也可稳定构建。
  - 验收：`npm ci` 可复现安装；`npm audit --audit-level=high` 返回 0（18 Moderate、0 High、0 Critical）；TypeScript、全量 Jest、静态审计及原生三段编译全部通过。
  - 边界：剩余 18 项 Moderate 位于 Expo/xcode/uuid 与 react-native-image-colors/Jimp/file-type 链；npm 仅提供会降级或跨主版本的 `--force` 方案，本轮按安全边界不执行。

- [x] **R14 / P2：日志与敏感文件卫生**
  - 位置：日志调用、`.gitignore`、环境变量模板。
  - 修复：删除明显的媒体对象直出日志；增加安全示例和忽略规则，但不覆盖当前用户 `.env`。
  - 验收：源码不直接打印完整媒体/URL/凭据对象；`.env.example` 只含占位符。

## 3. 独立门禁 / 遗留项

以下项目属于架构迁移，不能在无真机或无兼容性决策时冒充完成：

- [ ] **G01：插件真正沙箱化**：独立进程/独立 JS Runtime、能力声明、网络与存储最小权限、签名或可信源模型。
- [ ] **G02：全局禁用明文流量**：需先确认第三方插件和媒体源的 HTTP 兼容策略，再将 `usesCleartextTraffic` 收敛为 false 或域级例外。
- [ ] **G03：targetSdk 30 → 当前目标版本及 SAF/MediaStore 迁移**：需 Android 版本矩阵和大量本地文件回归。
- [ ] **G04：真机生命周期与内存门禁**：MPV/Nitro 冷启动、进程重建、音频焦点、并发下载、LeakCanary/Perfetto。
- [ ] **G05：用户当前 `.env` 的历史与秘密扫描**：文件当前已有用户修改，本轮不读取、不覆盖、不删除；需仓库所有者确认后再做 untrack/轮换。

## 4. 验证矩阵

| 类别 | 命令/用例 | 状态 |
|---|---|---|
| TypeScript | `npx tsc --noEmit --pretty false` | 通过 |
| 定向 Jest | 并发下载/缓存、URL、启动、查询迟到响应、歌词生命周期 | 通过 |
| 全量 Jest | `npm test -- --runInBand` | 71 suites / 441 tests 通过 |
| 静态审计 | `npm run audit:round20-static` | 通过（需提升本地 NDK/JAR 读取权限） |
| 原生专项审计 | `npm run audit:round20-native` | 通过（默认 FFmpeg/WMA、App Kotlin、禁用 WMA 回滚编译） |
| 依赖审计 | `npm audit --audit-level=high` | 通过：18 Moderate、0 High、0 Critical |
| 锁文件安装 | `npm ci --ignore-scripts` + `npx patch-package` | 通过：1579 packages，两个补丁成功重放 |
| Android | `:app:compileReleaseKotlin --no-daemon --console=plain` | 通过 |
| 补丁与脚本 | `git diff --check`、`node --check generator/audit-round20-native.mjs` | 通过（仅 Windows 换行提示） |
| 真机 | G04 场景 | 当前无 ADB 设备，未执行 |

## 5. 执行记录

- 2026-07-19：建立计划并完成 R01–R12、R14；全量回归为 71 个 Jest suite / 441 个测试。
- 2026-07-19：Android `:app:compileReleaseKotlin` 通过；MPV Service、Bridge、LyricUtil 活动后端路由均纳入编译验证。
- 2026-07-19：`audit:round20-static` 通过；首次受 NDK/JAR 权限限制，提升本地读取权限后复跑通过。
- 2026-07-19：`audit:round20-native` 通过；默认 FFmpeg/WMA、MusicFree App Kotlin、禁用 WMA 回滚编译三段门禁全部成功。
- 2026-07-19：用户授权 npm 官方外联后完成 R13；在线审计从 4 个生产 High、6 个开发 High 收敛为完整依赖树 0 High / 0 Critical，保留 18 个只能通过破坏性 `--force` 处理的 Moderate。
- 2026-07-19：使用最终 `package-lock.json` 完成干净安装，并成功重放 `expo-liquid-glass-native`、`react-native-nitro-player` 补丁；顶层 `package.json` 依赖声明未改变。
- 2026-07-19：依赖树重排暴露 `@expo/cli` hoist 假设，已将 Gradle CLI 解析改为从 `expo/package.json` 所在依赖树定位；Metro bundle、App Kotlin 与原生三段审计复跑通过。
- 2026-07-19：最终复跑 TypeScript、全量 Jest、`git diff --check` 和原生审计脚本语法检查均通过；未触碰用户原有 `.env` 与无关未跟踪素材。
