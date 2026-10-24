# MusicFree v0.13.1

修复换音质后进度不准、Android Auto 列表显示错乱，并加强崩溃记录的隐私保护。

## 升级前请注意

- 需要 Android 14 及以上。Android 13 及以下请继续使用 v0.11.6。
- 直接覆盖安装即可。不要先卸载，卸载会清空歌单、设置和插件。

## 修复

- 换音质后，显示的播放进度偶尔比实际慢一点，现在已修正。
- 在车机（Android Auto）上来回打开“我喜欢”和“最近播放”时，偶尔会显示成另一个列表的内容，现在已修正。
- 崩溃记录（基本设置 → 开发选项 → 复制播放诊断）会遮住更多账号、密码、Cookie 等敏感信息。记录只存在手机上，不会上传。

## 下载

大部分手机下载 **arm64-v8a** 版；不确定就下载 **universal** 版（体积大一些，所有手机都能装）。

- `…-app-arm64-v8a-release.apk`：大部分手机
- `…-app-armeabi-v7a-release.apk`：32 位系统的手机
- `…-app-universal-release.apk`：通用版
- `…-app-x86_64-release.apk`、`…-app-x86-release.apk`：模拟器用

各文件的 SHA256 校验值见 `SHA256SUMS.txt`。
