# Round 19: RN / Expo / React 大版本升级 Spike

更新时间：2026-06-02

## 目标

在独立分支验证大版本升级是否可行，重点确认 Android 能否构建，并识别对私有 `react-native-track-player`、新架构、原生模块和发布链路的影响。

## 分支

- 分支：`codex/round19-rn-expo-upgrade`
- 基线：`codex/round14-discovery-hub`

## 升级范围

- React Native：`0.76.5` -> `0.85.3`
- Expo：`^52.0.0` -> `56.0.8`
- React：`18.3.1` -> `19.2.3`
- TypeScript：`^5.3.3` -> `~6.0.3`
- Android Gradle Wrapper：`8.10.2` -> `8.13`
- Android build tools / compileSdk：`35` -> `36`
- Android NDK：`26.1.10909125` -> `27.1.12297006`
- Reanimated / Worklets：`react-native-reanimated@4.4.0` + `react-native-worklets@0.9.1`

## 已完成

- 按 RN 0.85 / Expo 56 升级核心 JS 依赖、Expo 模块、RN 官方工具链和 Metro/Babel/TS 配置。
- 迁移 Android `settings.gradle` 到 Expo SDK 56 autolinking 插件方式。
- 将 `newArchEnabled` 显式设为 `true`。RN 0.85 已不再支持关闭 New Architecture，继续写 `false` 会导致部分库跳过 codegen。
- 修复 React 19 / TypeScript 6 下的 `useRef`、FlashList v2、Reanimated easing 类型等编译问题。
- 迁移 Android `MainApplication.kt` 到 `ExpoReactHostFactory`。
- 修复歌词原生模块访问 Activity 的 Kotlin API。
- 为私有 `react-native-track-player@4.1.1` 增加 `patch-package` 补丁，解决 RN 0.85/Kotlin 下 `Bundle?` 传给非空 `Bundle` 的编译错误。
- 升级 Reanimated/Worklets 到可编过 RN 0.85 的版本，并在 Expo install check 中排除这两个刻意偏离版本。

## 校验结果

- `npx tsc --noEmit --pretty false`：通过
- `npx expo-doctor`：通过，21/21
- `android/gradlew assembleDebug --no-daemon --stacktrace`：通过
- `android/gradlew assembleRelease --no-daemon --stacktrace`：通过
- Debug APK 输出：
  - `android/app/build/outputs/apk/debug/app-universal-debug.apk`
  - `android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk`
  - `android/app/build/outputs/apk/debug/app-armeabi-v7a-debug.apk`
  - `android/app/build/outputs/apk/debug/app-x86-debug.apk`
  - `android/app/build/outputs/apk/debug/app-x86_64-debug.apk`
- Release APK 输出：
  - `android/app/build/outputs/apk/release/app-universal-release.apk`
  - `android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
  - `android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk`
  - `android/app/build/outputs/apk/release/app-x86-release.apk`
  - `android/app/build/outputs/apk/release/app-x86_64-release.apk`

## 关键风险

- RN 0.85 默认进入 New Architecture。私有播放器虽然已经能编过 debug，但还需要真机验证播放、后台、通知、恢复播放、特殊格式、蓝牙/耳机控制。
- Reanimated/Worklets 使用了比 Expo 56 静态建议更新的版本，这是为了匹配 RN 0.85 和 NDK 27 编译。后续如果 Expo 56 发布补丁版本，需要重新确认是否可以回到 Expo 推荐矩阵。
- `targetSdkVersion` 仍保留为 `30`，本轮只升级 `compileSdkVersion` 到 36 来满足 AndroidX 依赖。后续若提升 targetSdk，需要单独做权限、通知、文件访问和后台播放回归。
- GitHub Actions 还需要在本分支推送后通过远端 CI 再确认。

## 后续清单

- 在真机安装 debug/release APK，回归播放、恢复播放、迷你歌词、歌词页、插件导入、下载、本地音乐、桌面歌词、后台控制。
- 如果私有播放器运行时有新架构问题，优先在 `CTZZG/react-native-track-player` fork 中正式合入 Kotlin 补丁和 RN 0.85 兼容改造，再移除主项目的 `patch-package` 补丁。
- 评估是否保持 Round 19 分支继续向前，或仅作为技术升级 Spike 存档，主线继续停留在 RN 0.76 / Expo 52。
