# 系统代理封面与插件订阅转场修复

起点：`cb7e80b`，工作分支 `codex/fix-proxy-subscription-transition-20261007`。

## 已确认的问题与实现

### FlClash 系统代理下通知封面缺失

FlClash 开启“系统代理”时，会把 `127.0.0.1:<端口>` 注册为 HTTP 代理。OkHttp 4.10.0 使用同一个 DNS 回调解析远程目标和 HTTP 代理端点。原来的公网 DNS 过滤器把这个代理地址当成远程目标，抛出 `Blocked non-public host`，连接尚未到达代理便失败。页面用 expo-image 的普通客户端和独立缓存，所以页面有封面而通知、MediaSession 和 Live Update 没有图。

`PublicHttpsNetworkPolicy` 现在包装系统 ProxySelector，并在同一次选路的线程中记录目标域名和系统选定的 HTTP 代理端点。只有解析这些传输端点时使用系统 DNS；直接连接的目标仍使用原有公网过滤器。记录按线程隔离，并在下一次选路时替换，避免并发调用或 DIRECT 回落继承其他目标的放行。

没有要求用户关闭代理，也没有把 loopback 或私网地址全局加入白名单。原有目标 URL 校验、Fake-IP 兼容、跳转和凭据限制保留。这个工厂同时用于封面、下载和 QMC/CENC 网络请求，因此修复作用于共享传输层。

### 从右上角菜单进入订阅设置时两段动画重叠

AppBar 菜单关闭动画为 200ms，原先却在点击后 20ms 触发菜单动作，导航转场与仍在关闭的全局 Portal 菜单重叠。

现在等待 Reanimated 的关闭完成回调后才执行动作。中断关闭、重新打开菜单和页面卸载都会阻止旧动作执行；动作与回调按选择编号匹配，旧回调不会提前消费下一次选择，重复到达也只执行一次。未增加猜测动画时长的延迟。

插件子导航原先继承了导航主题的透明背景；现在每个场景使用 `useColors()` 解析后的页面底色，避免转场期间透出其他页面。保留原生滑动动画。

## 本地验证

- 原有 11 个网络策略测试及新增 7 个系统代理用例，共 18 个 JVM 测试通过。覆盖 loopback 代理、hostname 代理、多代理回落、私有目标拒绝、DIRECT 路径拒绝私有 DNS 响应、切换选路和线程隔离。
- 5 个 AppBar 组件测试通过，覆盖导航执行时序、中断关闭、重新打开菜单、卸载后的迟到回调，以及旧回调不能提前触发新选择。
- 完整 `npm run verify` 通过：168 个 Jest 测试套件、1206 个测试，27 个 generator 测试、1231 个布局测试。TypeScript、静态审计、patch 回放通过；ESLint 0 错误、218 个原有警告，基线未增加。
- 用户提供的插件订阅（地址不写入仓库）返回 7 个插件。下载并执行其中网易云、酷我、酷狗的真实搜索函数，关键词“带我去找夜生活”均返回歌曲和封面 URL，域名分别为 `p1.music.126.net`、`img4.kuwo.cn`、`imge.kugou.com`。这证明真实插件提供了封面元数据，不把封面缺失归因于订阅未返回图片。
- 外部订阅、插件代码和歌曲图片仅存于临时验证目录，没有提交到仓库；不会让日常单元测试依赖第三方网络或账号。
- 上述三张封面实测返回 HTTP 200、有效 JPEG。另以测试证书和 MockWebServer 模拟本机 HTTP 代理，验证 HTTPS CONNECT、TLS 域名校验，以及真实网易云封面 280498 字节的完整读取。测试客户端只信任临时测试证书，生产 TLS 配置没有修改。

## Android 模拟器验证

本地容器没有 Android SDK 或 KVM，因此使用 GitHub Actions 的一次性 Android 模拟器。新增 `proxy-subscription-check.yml`，仅构建 debug 应用和测试 APK，不发布 Release、不打 tag。

检查限定为 `:app:` 的 Gradle 任务。原来的 APK splits 硬编码四种 ABI，RN 插件在启用 splits 时又不会将 `reactNativeArchitectures` 写入 abiFilters，所以仅传 `-PreactNativeArchitectures=x86_64` 仍会构建四种应用 ABI；现在 splits 读取同一属性，模拟检查真正只构建 x86_64。默认属性仍为原来的四种架构，常规发行构建保持四种 ABI。

第一次完整测试 APK 编译暴露了原有共享测试目录的兼容问题：41 个 Kotlin 测试方法使用含空格的反引号名称，JVM 允许，但项目最低版本配置（根配置 minSdk 24）对应的 DEX 不允许；D8 报 `Space characters in SimpleName ... are not allowed prior to DEX version 040`。已把这些方法改为普通 camelCase 名称，断言和测试逻辑不变，没有提高应用最低系统版本。系统代理测试的本机服务器也明确绑定 IPv4，避免 `localhost` 在 Android 上解析为 IPv6 时与模拟的 127.0.0.1 代理不一致。

常规 [CI 37654645890](https://github.com/CTZZG/MusicFree/actions/runs/37654645890) 已通过：质量门通过，Gradle `testDebugUnitTest` 实际执行 14 个测试类、75 个用例，0 失败、0 错误、0 跳过。已下载并核对 XML 报告，其中公网策略 11 个、系统代理 7 个用例全部通过。

流程包括：

1. Gradle Android 单元测试与测试 APK 编译。
2. Android 36 模拟器中运行网络策略测试。
3. `NotificationArtworkProxyTest` 绑定真实 MpvPlaybackService，通过系统选定的本机 HTTP 代理下载 PNG，验证真实 Bitmap 解码成功，封面进入 MediaSession 的 ART 和 ALBUM_ART。
4. Debug 应用通过 Metro 启动，打开插件管理右上角菜单，进入订阅设置后返回。保留动画并录制视频，上传截图、日志和测试报告。

应用和测试 APK 按原生源码、Gradle 配置、依赖锁文件与补丁的哈希缓存，缓存不包含 Metro 的 JS 内容；JS 和录屏脚本更新会在本次检出的代码上验证。原生改动会使 APK 缓存失效。安装后直接以 `adb shell am instrument` 运行指定测试类，校验报告的总数、每个完成状态、测试类和最终 instrumentation 结果码；不能仅凭 adb 退出码认为 JUnit 通过。结果保存在 `instrumentation-summary.json` 和完整日志中。常规 CI 仍运行 Gradle 单元测试。

[模拟器运行 37668217146](https://github.com/CTZZG/MusicFree/actions/runs/37668217146) 已实际执行全部 19 个测试：新增系统代理 7 个、真实服务取图 1 个全部通过，确认解码后的 Bitmap 进入 MediaSession 的 ART 与 ALBUM_ART。原有公网策略的 4 个跳转用例失败，原因是测试服务器监听 IPv4，但客户端用 `getLoopbackAddress()` 在 Android 上选择了 `::1`；其余 7 个通过。现已统一该测试配置的绑定和解析地址为 127.0.0.1，不修改生产 IPv6 或私网策略；下一次运行应重新验证全部 19 个，并继续订阅界面流程。

最终模拟器结果另行补充，不能把 JVM 或组件测试等同于模拟器视觉验收，也不声称已经验证所有厂商的 Live Update 外观。

## 交接注意

- `ProxyRouteDns` 依赖 OkHttp 4.10 的选路和 DNS 在调用线程同步执行这一行为；升级 OkHttp 时保留系统代理、DIRECT 回落和并发测试。
- 这轮没有改上一份代码复核里列出的备用来源恢复和队列遗留问题，避免混合任务。
- 用户不需要为了诊断安装 adb 或提供日志；已使用订阅与测试环境自行收集证据。真实设备的厂商展示差异可在代码和模拟器验证完成后作为补充验收。
