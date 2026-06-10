// 国际化语言数据接口定义
export interface ILanguageData {
    // 通用词汇
    "common.setting": string; // 设置
    "common.software": string; // 软件
    "common.language": string; // 语言
    "common.theme": string; // 主题
    "common.other": string; // 其他
    "common.cancel": string; // 取消
    "common.about": string; // 关于
    "common.batchEdit": string; // 批量编辑
    "common.selectAll": string; // 全选
    "common.unselectAll": string; // 全不选
    "common.save": string; // 保存
    "common.notSave": string; // 不保存
    "common.download": string; // 下载
    "common.play": string; // 播放
    "common.delete": string; // 删除
    "common.unknownName": string; // 未知名称
    "common.default": string; // 默认
    "common.search": string; // 搜索
    "common.clear": string; // 清除
    "common.singleMusic": string; // 单曲
    "common.album": string; // 专辑
    "common.artist": string; // 艺术家
    "common.sheet": string; // 歌单
    "common.done": string; // 完成
    "common.edit": string; // 编辑
    "common.local": string; // 本地
    "common.sure": string; // 确定
    "common.confirm": string; // 确认
    "common.view": string; // 查看
    "common.open": string; // 打开
    "common.username": string; // 用户名
    "common.password": string; // 密码
    "common.cover": string; // 封面
    "common.name": string; // 名称
    "common.comment": string; // 评论
    "common.emptyList": string; // 空列表
    "common.loading": string; // 加载中
    "common.error": string; // 出错
    "common.clickToRetry": string; // 点击重试
    "common.failToLoad": string; // 加载失败
    "common.listReachEnd": string; // 列表到底

    // 侧边栏相关
    "sidebar.basicSettings": string; // 基本设置
    "sidebar.pluginManagement": string; // 插件管理
    "sidebar.themeSettings": string; // 主题设置
    "sidebar.scheduleClose": string; // 定时关闭
    "sidebar.backupAndResume": string; // 备份与恢复
    "sidebar.permissionManagement": string; // 权限管理
    "sidebar.checkUpdate": string; // 检查更新
    "sidebar.currentVersion": string; // 当前版本
    "sidebar.backToDesktop": string; // 返回桌面
    "sidebar.exitApp": string; // 退出应用
    "sidebar.languageSettings": string; // 语言设置

    // 检查更新相关
    "checkUpdate.error.latestVersion": string; // 当前已是最新版本

    // 首页相关
    "home.recommendSheet": string; // 推荐歌单
    "home.topList": string; // 榜单
    "home.playHistory": string; // 播放历史
    "home.localMusic": string; // 本地音乐
    "home.openSidebar.a11y": string; // 打开侧边栏
    "home.myPlaylists": string; // 我的歌单
    "home.starredPlaylists": string; // 我喜欢的歌单
    "home.newPlaylist.a11y": string; // 新建歌单
    "home.managePlaylists.a11y": string; // 管理歌单
    "home.managePlaylists.short": string; // 歌单管理
    "home.playlistManagement.a11y": string; // 歌单管理
    "home.importPlaylist.a11y": string; // 导入歌单
    "home.import.short": string; // 导入
    "home.playById.a11y": string; // 通过ID播放
    "home.myPlaylistsCount.a11y": string; // 我的歌单数量
    "home.starredPlaylistsCount.a11y": string; // 我喜欢的歌单数量
    "home.songCount": string; // 歌曲数量
    "home.clickToSearch": string; // 点击搜索
    "home.allSources": string; // 全部源
    "home.continueListening": string; // 继续听
    "home.recentListening": string; // 最近播放
    "home.musicSources": string; // 音乐源
    "home.enabledSourceCount": string; // 已启用插件源数量
    "home.manageSources": string; // 管理音乐源
    "home.manageSources.short": string; // 音乐源
    "home.quickAccess": string; // 快捷入口
    "home.discovery": string; // 发现
    "home.myMusic": string; // 我的音乐
    "home.startSearch": string; // 开始搜索
    "home.scanLocal": string; // 扫描本地
    "home.playById.short": string; // 播放ID
    "home.multiSourceSearch": string; // 多源搜索
    "home.sourceSupportedCount": string; // 可搜索源数量
    "home.favoriteSheet": string; // 我喜欢
    "home.localMusicShort": string; // 本地
    "home.starredShort": string; // 收藏
    "home.smartSheets": string; // 智能歌单
    "home.playlistCount": string; // 歌单数量
    "home.downloadQueueCount": string; // 下载队列数量
    "home.sourceCapability.search": string; // 搜索
    "home.sourceCapability.source": string; // 音源
    "home.sourceCapability.lyric": string; // 歌词
    "home.sourceCapability.wordLyric": string; // 逐字
    "home.sourceCapability.topList": string; // 榜单
    "home.sourceCapability.recommend": string; // 推荐
    "home.sourceCapability.album": string; // 专辑
    "home.sourceCapability.artist": string; // 歌手
    "home.sourceCapability.import": string; // 导入
    "home.sourceCapability.comment": string; // 评论

    // 对话框相关
    "dialog.deleteSheetTitle": string; // 删除歌单
    "dialog.deleteSheetContent": string; // 确定删除该歌单吗？

    "dialog.loading.reinitializeTrackPlayer": string;

    // 提示消息相关
    "toast.deleteSuccess": string; // 删除成功
    "toast.hasStarred": string; // 已收藏歌单
    "toast.hasUnstarred": string; // 已取消收藏歌单
    "toast.importSuccess": string; // 导入成功
    "toast.saveSuccess": string; // 保存成功
    "toast.syncSuccess": string; // 同步成功
    "toast.syncFail": string; // 同步失败
    "toast.sortHasBeenUpdated": string; // 排序已更新
    "toast.currentQualityNotAvailableForCurrentMusic": string; // 当前音乐的质量在此设备上不可用
    "toast.commmentNotAvaliableForCurrentMusic": string; // 当前音乐无法进行评论
    "toast.addToNextPlay": string; // 添加到下一曲
    "toast.beginDownload": string; // 开始下载
    "toast.rememberToSave": string; // 请记得保存

    // 本地音乐相关
    "localMusic.scanLocalMusic": string; // 扫描本地音乐
    "localMusic.beginScan": string; // 开始扫描
    "localMusic.downloadList": string; // 下载列表
    "localMusic.sourceFilter.all": string; // 全部来源
    "localMusic.fileMissing": string; // 文件不存在
    "localMusic.fileMissingTapHint": string; // 文件不存在点击提示
    "localMusic.relocateFile": string; // 重新定位文件
    "localMusic.relocateFileAction": string; // 使用此文件
    "localMusic.relocateSuccess": string; // 重新定位成功
    "localMusic.relocateFailed": string; // 重新定位失败
    "localMusic.artistFilter.all": string; // 全部歌手
    "localMusic.albumFilter.all": string; // 全部专辑
    "localMusic.metadataStatus.success": string; // 元数据已写入
    "localMusic.metadataStatus.failed": string; // 元数据失败
    "localMusic.metadataStatus.skipped": string; // 元数据未写入
    "localMusic.lyricFileStatus.success": string; // 歌词已写入
    "localMusic.lyricFileStatus.failed": string; // 歌词失败

    // 歌词相关
    "lyric.lyricLinkedFrom": string; // 歌词来自
    "lyric.unlinkLyric": string; // 取消链接歌词
    "lyric.noLyric": string; // 暂无歌词
    "lyric.searchLyric": string; // 搜索歌词
    "lyric.source.plugin": string; // 插件歌词来源
    "lyric.source.local": string; // 本地歌词来源
    "lyric.source.cache": string; // 缓存歌词来源
    "lyric.source.autoSearch": string; // 自动搜索歌词来源
    "lyric.noLyricReason.noCurrentMusic": string; // 当前无播放歌曲
    "lyric.noLyricReason.pluginNotFound": string; // 歌词插件不存在
    "lyric.noLyricReason.pluginNotSupported": string; // 插件不支持歌词
    "lyric.noLyricReason.pluginEmpty": string; // 插件返回空歌词
    "lyric.noLyricReason.autoSearchEmpty": string; // 自动搜索无歌词
    "lyric.noLyricReason.parseFailed": string; // 歌词解析失败
    "lyric.noLyricReason.timeout": string; // 歌词获取超时
    "lyric.noLyricReason.unknown": string; // 未知无歌词原因

    // 音乐列表编辑器相关
    "musicListEditor.selectMusicCount": string; // 选择的音乐数量
    "musicListEditor.addToNextPlay": string; // 添加到下一曲
    "musicListEditor.addToSheet": string; // 添加到歌单
    "musicSheetEditor.selectSheetCount": string; // 选择的歌单数量

    // 权限设置相关
    "permissionSetting.title": string; // 权限设置
    "permissionSetting.description": string; // 权限设置说明
    "permissionSetting.floatWindowPermission": string; // 悬浮窗权限
    "permissionSetting.floatWindowPermissionDescription": string; // 悬浮窗权限说明
    "permissionSetting.fileReadWritePermission": string; // 文件读写权限
    "permissionSetting.fileReadWritePermissionDescription": string; // 文件读写权限说明
    "permissionSetting.notificationPermission": string; // 通知权限
    "permissionSetting.notificationPermissionDescription": string; // 通知权限说明
    "permissionSetting.ignoreBatteryOptimization": string; // 忽略电池优化
    "permissionSetting.ignoreBatteryOptimizationDescription": string; // 忽略电池优化说明
    "notificationPermission.dialog.title": string; // 通知权限
    "notificationPermission.dialog.content": string; // 通知权限说明
    "notificationPermission.dialog.cancel": string; // 暂不开启
    "notificationPermission.dialog.ok": string; // 开启权限
    "notificationPermission.toast.enabled": string; // 通知权限已开启
    "notificationPermission.toast.disabled": string; // 通知权限未开启
    "notificationPermission.toast.requestFailed": string; // 请求通知权限失败
    "notificationPermission.status.enabled": string; // 通知权限已开启
    "notificationPermission.status.disabled": string; // 通知权限未开启

    // 推荐歌单相关
    "recommendSheet.title": string; // 推荐歌单

    // 搜索音乐列表相关
    "searchMusicList.searchPlaceHolder": string; // 搜索音乐
    "searchMusicList.searchLabel.a11y": string; // 搜索音乐标签

    // 搜索页面相关
    "searchPage.searchPlaceHolder": string; // 搜索
    "searchPage.searchLabel.a11y": string; // 搜索标签
    "searchPage.history": string; // 历史记录
    "searchPage.artistResultWorksNum": string; // 艺术家作品数量
    "searchPage.comingSoon": string; // 敬请期待
    "searchPage.albumDetailFallback": string; // 专辑详情不可用时回退搜索
    "searchPage.sourceEmptyResult": string; // 某来源无搜索结果
    "searchPage.sourceLoadFailed": string; // 某来源加载失败
    "globalSearch.title": string; // 全局搜索
    "globalSearch.placeholder": string; // 全局搜索占位
    "globalSearch.searchLabel.a11y": string; // 全局搜索标签
    "globalSearch.onlineSection": string; // 在线搜索分组
    "globalSearch.localSection": string; // 本地入口分组
    "globalSearch.musicTitle": string; // 搜索歌曲结果标题
    "globalSearch.musicDescription": string; // 搜索歌曲结果描述
    "globalSearch.pluginDescription": string; // 插件结果描述
    "globalSearch.sheetDescription": string; // 歌单结果描述
    "globalSearch.settingDescription": string; // 设置结果描述
    "globalSearch.emptyQuery": string; // 全局搜索空输入
    "globalSearch.noLocalResult": string; // 全局搜索无本地结果

    // 榜单相关
    "topList.title": string; // 榜单

    // 歌单详情相关
    "sheetDetail.totalMusicCount": string; // 歌曲总数
    "sheetDetail.editSheetInfo": string; // 编辑歌单信息
    "sheetDetail.batchEditMusic": string; // 批量编辑音乐
    "sheetDetail.sortMusic": string; // 排序音乐
    "sheetDetail.sortMusicOption.byTitle": string; // 按标题排序
    "sheetDetail.sortMusicOption.byArtist": string; // 按艺术家排序
    "sheetDetail.sortMusicOption.byAlbum": string; // 按专辑排序
    "sheetDetail.sortMusicOption.newest": string; // 最新
    "sheetDetail.sortMusicOption.oldest": string; // 最旧
    "sheetDetail.deleteSheet": string; // 删除歌单
    "sheetDetail.deleteSheetContent": string; // 确定删除该歌单吗？
    "sheetDetail.syncPlaylist": string; // 歌单同步

    // 历史记录相关
    "history.title": string; // 历史记录
    "history.clearHistory": string; // 清除历史记录
    "smartSheet.title": string; // 智能歌单
    "smartSheet.builtInTemplates": string; // 内置模板
    "smartSheet.pluginSources": string; // 插件来源
    "smartSheet.recentPlayed": string; // 最近播放
    "smartSheet.localMusic": string; // 本地音乐
    "smartSheet.downloaded": string; // 已下载歌曲
    "smartSheet.pluginSourceTitle": string; // 插件来源歌曲

    // 下载相关
    "downloading.title": string; // 下载
    "downloading.filter.all": string; // 全部
    "downloading.filter.active": string; // 进行中
    "downloading.filter.paused": string; // 已暂停
    "downloading.filter.completed": string; // 已完成
    "downloading.filter.error": string; // 失败
    "downloading.sourceFilter.title": string; // 插件来源
    "downloading.sourceFilter.all": string; // 全部来源
    "downloading.writeStatusFilter.title": string; // 写入结果
    "downloading.writeStatusFilter.all": string; // 全部写入结果
    "downloading.writeStatusFilter.metadataSuccess": string; // 元数据已写入
    "downloading.writeStatusFilter.metadataFailed": string; // 元数据失败
    "downloading.writeStatusFilter.metadataSkipped": string; // 元数据未写入
    "downloading.writeStatusFilter.lyricSuccess": string; // 歌词已写入
    "downloading.writeStatusFilter.lyricFailed": string; // 歌词失败
    "downloading.writeStatusSummary": string; // 写入结果摘要
    "downloading.sort.title": string; // 排序
    "downloading.sort.default": string; // 默认顺序
    "downloading.sort.completedNewest": string; // 完成时间从新到旧
    "downloading.sort.completedOldest": string; // 完成时间从旧到新
    "downloading.sort.titleName": string; // 按歌曲名
    "downloading.sort.artistName": string; // 按歌手名
    "downloading.detail.title": string; // 下载记录详情
    "downloading.detail.song": string; // 歌曲
    "downloading.detail.artist": string; // 歌手
    "downloading.detail.source": string; // 插件来源
    "downloading.detail.completedAt": string; // 完成时间
    "downloading.detail.fileName": string; // 文件名
    "downloading.detail.metadataStatus": string; // 元数据
    "downloading.detail.lyricStatus": string; // 歌词文件
    "downloading.detail.pendingWriteStatus": string; // 等待写入结果
    "downloading.detail.lyricSkipped": string; // 未写入
    "downloading.detail.copy": string; // 复制详情
    "downloading.detail.close": string; // 关闭
    "downloading.copyCompletedRecords": string; // 复制记录
    "downloading.copyCompletedRecordsSuccess": string; // 复制完成记录成功
    "downloading.exportCompletedRecords": string; // 导出记录
    "downloading.exportCompletedRecordsAction": string; // 导出到此处
    "downloading.exportCompletedRecordsSuccess": string; // 导出记录成功
    "downloading.exportCompletedRecordsFailed": string; // 导出记录失败
    "downloading.report.title": string; // 下载记录报告
    "downloading.report.generatedAt": string; // 生成时间
    "downloading.report.count": string; // 记录数量
    "downloading.report.metadataSummary": string; // 元数据统计
    "downloading.report.lyricSummary": string; // 歌词文件统计
    "downloading.report.filterStatus": string; // 状态筛选
    "downloading.report.filterSource": string; // 来源筛选
    "downloading.report.filterWrite": string; // 写入筛选
    "downloading.report.sort": string; // 排序
    "downloading.downloadFailReason.noWritePermission": string; // 下载失败：没有写入权限
    "downloading.downloadFailReason.failToFetchSource": string; // 下载失败：无法获取源
    "downloading.downloadFailReason.encryptedMediaUnsupported": string; // 下载失败：暂不支持加密音源
    "downloading.downloadFailReason.interrupted": string; // 下载失败：应用退出或重启导致中断
    "downloading.downloadFailReason.unknown": string; // 下载失败：未知原因
    "downloading.downloadStatus.completed": string; // 下载完成
    "downloading.downloadStatus.completedAt": string; // 下载完成时间
    "downloading.downloadStatus.downloadProgress": string; // 下载进度
    "downloading.downloadStatus.pending": string; // 等待中
    "downloading.downloadStatus.paused": string; // 已暂停
    "downloading.downloadStatus.preparing": string; // 准备中
    "downloading.clearCompleted": string; // 清理已完成
    "downloading.clearCompletedConfirm": string; // 清理已完成确认
    "downloading.clearCompletedSuccess": string; // 清理已完成成功
    "downloading.retryFailed": string; // 重试失败任务
    "downloading.retryFailedSuccess": string; // 重试失败任务成功
    "downloading.batchActionNoTasks": string; // 当前筛选下没有可处理任务
    "downloading.clearFailed": string; // 清理失败记录
    "downloading.clearFailedConfirm": string; // 清理失败记录确认
    "downloading.clearFailedSuccess": string; // 清理失败记录成功
    "downloading.pauseActive": string; // 暂停进行中任务
    "downloading.pauseActiveSuccess": string; // 暂停进行中任务成功
    "downloading.resumePaused": string; // 恢复暂停任务
    "downloading.resumePausedSuccess": string; // 恢复暂停任务成功

    // 艺术家详情相关
    "artistDetail.fansCount": string; // 粉丝数量
    "artistDetail.menu.batchEditMusic": string; // 批量编辑音乐
    "artistDetail.musicSheet": string; // 音乐歌单

    // 插件设置相关
    "pluginSetting.pluginItem.options.updatePlugin": string; // 更新插件
    "pluginSetting.pluginItem.options.viewDetails": string; // 详情
    "pluginSetting.pluginItem.options.sharePlugin": string; // 分享插件
    "pluginSetting.pluginItem.options.testSearch": string; // 测试搜索
    "pluginSetting.pluginItem.options.testSearchPlaceHolder": string; // 测试搜索关键词
    "pluginSetting.pluginItem.options.uninstallPlugin": string; // 卸载插件
    "pluginSetting.pluginItem.options.uninstallPluginContent": string; // 确定卸载该插件吗？
    "pluginSetting.pluginItem.options.alternativePlugin": string; // 替代插件
    "pluginSetting.pluginItem.alternativePlugin": string; // 该插件实际使用的插件
    "pluginSetting.pluginItem.dialog.setAlternativePluginTitle": string; // 设置替代插件
    "pluginSetting.pluginItem.dialog.setAlternativePluginTip": string; // 将使用替代插件解析此插件的音乐源提示
    "pluginSetting.pluginItem.options.importMusic": string; // 导入音乐
    "pluginSetting.pluginItem.options.importMusicPlaceHolder": string; // 导入音乐链接
    "pluginSetting.pluginItem.options.importDialogTitle": string; // 导入音乐对话框标题
    "pluginSetting.pluginItem.options.importMusicDialogContent": string; // 导入音乐对话框内容
    "pluginSetting.pluginItem.options.importMusicToSheetName": string; // 导入音乐到歌单
    "pluginSetting.pluginItem.options.importSheet": string; // 导入歌单
    "pluginSetting.pluginItem.options.importSheetPlaceHolder": string; // 导入歌单链接
    "pluginSetting.pluginItem.options.importSheetDialogContent": string; // 导入歌单对话框内容
    "pluginSetting.pluginItem.options.userVariables": string; // 用户变量
    "pluginSetting.pluginItem.versionHint": string; // 版本提示
    "pluginSetting.pluginItem.author": string; // 作者
    "pluginSetting.filteringByPlugin": string; // 插件筛选提示
    "pluginSetting.pluginItem.source.network": string; // 网络安装
    "pluginSetting.pluginItem.source.localFile": string; // 本地文件
    "pluginSetting.pluginItem.source.unknown": string; // 来源未知
    "pluginSetting.pluginItem.capability.sync": string; // 同步
    "pluginSetting.pluginItem.detail.version": string; // 版本
    "pluginSetting.pluginItem.detail.author": string; // 作者
    "pluginSetting.pluginItem.detail.source": string; // 来源
    "pluginSetting.pluginItem.detail.sourceDetail": string; // 来源详情
    "pluginSetting.pluginItem.detail.hash": string; // 插件 Hash
    "pluginSetting.pluginItem.detail.capabilities": string; // 支持能力
    "pluginSetting.pluginItem.detail.noCapabilities": string; // 暂无可识别能力
    "pluginSetting.pluginItem.detail.diagnostics": string; // 最近诊断
    "pluginSetting.pluginItem.detail.noDiagnostics": string; // 最近无错误
    "pluginSetting.menu.subscriptionSetting": string; // 订阅设置
    "pluginSetting.menu.sort": string; // 排序
    "pluginSetting.menu.diagnostics": string; // 插件诊断
    "pluginSetting.menu.capabilityMatrix": string; // 插件能力矩阵
    "pluginSetting.menu.copyDiagnosticReport": string; // 复制诊断报告
    "pluginSetting.menu.exportDiagnosticReport": string; // 导出诊断报告
    "pluginSetting.menu.uninstallAll": string; // 卸载所有
    "pluginSetting.menu.uninstallAllContent": string; // 确定卸载所有插件吗？
    "pluginSetting.menu.installPlugin": string; // 安装插件
    "pluginSetting.menu.installPluginDialogPlaceholder": string; // 插件安装对话框占位符
    "pluginSetting.menu.pluginInstallFailedDialogTitle": string; // 插件安装失败对话框标题
    "pluginSetting.menu.pluginUpdateFailedDialogTitle": string; // 插件更新失败对话框标题
    "pluginSetting.fabOptions.installFromLocal": string; // 从本地安装
    "pluginSetting.fabOptions.installFromNetwork": string; // 从网络安装
    "pluginSetting.fabOptions.updateAllPlugins": string; // 更新所有插件
    "pluginSetting.fabOptions.updateSubscription": string; // 更新订阅
    "pluginSetting.subscription.urlType.singlePlugin": string; // 单插件订阅
    "pluginSetting.subscription.urlType.collection": string; // 订阅集合
    "pluginSetting.subscription.urlType.invalid": string; // 地址格式无效
    "pluginSetting.diagnostics.eventCount": string; // 插件诊断记录数量
    "pluginSetting.diagnostics.empty": string; // 暂无插件诊断记录
    "pluginSetting.diagnostics.filter.all": string; // 全部诊断
    "pluginSetting.diagnostics.filter.search": string; // 搜索诊断
    "pluginSetting.diagnostics.filter.source": string; // 播放源诊断
    "pluginSetting.diagnostics.filter.lyric": string; // 歌词诊断
    "pluginSetting.diagnostics.filter.install": string; // 安装诊断
    "pluginSetting.diagnostics.filter.other": string; // 其他诊断
    "pluginSetting.diagnostics.pluginFilter.title": string; // 插件筛选标题
    "pluginSetting.diagnostics.pluginFilter.all": string; // 全部插件筛选
    "pluginSetting.diagnostics.timeFilter.title": string; // 诊断时间范围标题
    "pluginSetting.diagnostics.timeFilter.all": string; // 全部时间
    "pluginSetting.diagnostics.timeFilter.today": string; // 今天
    "pluginSetting.diagnostics.timeFilter.last24h": string; // 最近 24 小时
    "pluginSetting.diagnostics.timeFilter.last7d": string; // 最近 7 天
    "pluginSetting.diagnostics.timeFilter.last30d": string; // 最近 30 天
    "pluginSetting.diagnostics.keywordFilter.title": string; // 诊断关键字筛选标题
    "pluginSetting.diagnostics.keywordFilter.placeholder": string; // 诊断关键字筛选占位文案
    "pluginSetting.diagnostics.clearFiltered": string; // 清理当前诊断
    "pluginSetting.diagnostics.clearFilteredConfirm": string; // 清理当前诊断确认
    "pluginSetting.diagnostics.clearSuccess": string; // 清理诊断成功
    "pluginSetting.diagnostics.activeFilters": string; // 当前诊断筛选摘要
    "pluginSetting.diagnostics.copyFilteredReportSuccess": string; // 复制当前筛选诊断报告成功
    "pluginSetting.diagnostics.exportReportAction": string; // 导出诊断报告到此处
    "pluginSetting.diagnostics.exportReportSuccess": string; // 导出诊断报告成功
    "pluginSetting.diagnostics.exportReportFailed": string; // 导出诊断报告失败
    "pluginSetting.capabilityMatrix.summary": string; // 插件能力矩阵摘要
    "pluginSetting.capabilityMatrix.empty": string; // 无插件能力信息
    "pluginSetting.capabilityMatrix.plugin": string; // 插件能力矩阵插件列
    "pluginSetting.capabilityMatrix.status": string; // 插件能力矩阵状态列
    "pluginSetting.capabilityMatrix.source": string; // 插件能力矩阵来源列
    "pluginSetting.capabilityMatrix.supportedCount": string; // 插件能力矩阵支持数列
    "pluginSetting.capabilityMatrix.enabled": string; // 已启用
    "pluginSetting.capabilityMatrix.disabled": string; // 已禁用
    "pluginSetting.testSearch.loading": string; // 测试搜索加载文案
    "pluginSetting.testSearch.resultTitle": string; // 测试搜索结果标题
    "pluginSetting.testSearch.resultSummary": string; // 测试搜索结果摘要
    "pluginSetting.testSearch.noResults": string; // 测试搜索无结果
    "pluginSetting.testSearch.isEnd.yes": string; // 测试搜索已到末页
    "pluginSetting.testSearch.isEnd.no": string; // 测试搜索未到末页
    "pluginSetting.testSearch.emptyKeyword": string; // 测试搜索空关键词
    "pluginSetting.testSearch.failed": string; // 测试搜索失败
    "pluginSetting.failReason": string; // 失败原因
    "pluginSetting.installResult.dialogTitle": string; // 插件安装结果
    "pluginSetting.installResult.success": string; // 安装成功
    "pluginSetting.installResult.failed": string; // 安装失败
    "pluginSetting.installResult.source": string; // 来源
    "pluginSetting.installResult.failureType": string; // 失败类型
    "pluginSetting.installResult.retryable": string; // 是否建议重试
    "pluginSetting.installResult.retryable.yes": string; // 建议重试
    "pluginSetting.installResult.retryable.no": string; // 不建议重试
    "pluginSetting.installResult.failureReason.file-read": string; // 本地文件读取失败
    "pluginSetting.installResult.failureReason.network": string; // 网络请求失败
    "pluginSetting.installResult.failureReason.not-found": string; // 插件地址不存在
    "pluginSetting.installResult.failureReason.parse": string; // 插件解析失败
    "pluginSetting.installResult.failureReason.newer-version-installed": string; // 已安装更新版本
    "pluginSetting.installResult.failureReason.unrecognized": string; // 无法识别插件内容
    "pluginSetting.installResult.failureReason.unknown": string; // 未知错误
    "pluginSetting.pluginInstallFailedDialogContent": string; // 插件安装失败对话框内容
    "pluginSetting.pluginUpdateFailedDialogContent": string; // 插件更新失败对话框内容

    // 提示消息相关 - 插件操作
    "toast.pluginUpdateSuccess": string; // 插件更新成功
    "toast.failToUpdatePlugin": string; // 插件更新失败
    "toast.copiedToClipboard": string; // 已复制到剪贴板
    "toast.copiedToClipboardFailed": string; // 复制失败
    "toast.failToSharePlugin": string; // 插件分享失败
    "toast.pluginUninstalled": string; // 插件已卸载
    "toast.toast.pluginUninstalled": string; // 插件已卸载
    "toast.failToImportMusic": string; // 音乐导入失败
    "toast.importing": string; // 正在导入
    "toast.failToImportSheet": string; // 歌单导入失败
    "toast.settingSuccess": string; // 设置成功
    "toast.installPluginSuccess": string; // 插件安装成功
    "toast.updatePluginSuccess": string; // 插件更新成功
    "toast.installPluginFail": string; // 插件安装失败
    "toast.allPluginInstallFailed": string; // 所有插件安装失败
    "toast.partialPluginInstallFailed": string; // 部分插件安装失败
    "toast.partialPluginInstallFailedWithReason": string; // 部分插件安装失败，原因：
    "toast.allPluginUpdateFailed": string; // 所有插件更新失败
    "toast.partialPluginUpdateFailed": string; // 部分插件更新失败
    "toast.noSubscription": string; // 没有订阅
    "toast.subscriptionInvalid": string; // 订阅无效
    "toast.subscriptionHaveToEndWithJs": string; // 订阅必须以.js结尾
    "toast.unknownError": string; // 未知错误

    // 主题设置相关
    "themeSettings.displayStyle": string; // 显示风格
    "themeSettings.followSystemTheme": string; // 跟随系统主题
    "themeSettings.setTheme": string; // 设置主题
    "themeSettings.lightMode": string; // 明亮模式
    "themeSettings.darkMode": string; // 黑暗模式
    "themeSettings.customMode": string; // 自定义模式
    "themeSettings.coverStyle": string; // 封面样式
    "themeSettings.coverStyleSquare": string; // 方形
    "themeSettings.coverStyleCircle": string; // 圆形


    // 自定义主题相关
    "setCustomTheme.customizeBackground": string; // 自定义背景
    "setCustomTheme.blur": string; // 模糊
    "setCustomTheme.opacity": string; // 不透明度
    "setCustomTheme.primaryColor": string; // 主题色
    "setCustomTheme.textColor": string; // 文字颜色
    "setCustomTheme.appBarColor": string; // 应用栏颜色
    "setCustomTheme.appBarTextColor": string; // 应用栏文字色
    "setCustomTheme.musicBarColor": string; // 音乐栏颜色
    "setCustomTheme.musicBarTextColor": string; // 音乐栏文字色
    "setCustomTheme.pageBackgroundColor": string; // 页面背景色
    "setCustomTheme.backdropColor": string; // 背景色
    "setCustomTheme.cardColor": string; // 卡片背景色
    "setCustomTheme.placeholderColor": string; // 输入框背景色
    "setCustomTheme.tabBarColor": string; // 导航栏背景色
    "setCustomTheme.notificationColor": string; // 提示、tips背景色

    // 备份与恢复相关
    "backupAndResume.beginBackup": string; // 开始备份
    "backupAndResume.backupDialogTitle": string; // 备份对话框标题
    "backupAndResume.backuping": string; // 正在备份
    "toast.backupSuccess": string; // 备份成功
    "toast.backupFail": string; // 备份失败
    "backupAndResume.resumeFromLocalFile": string; // 从本地文件恢复
    "backupAndResume.resuming": string; // 正在恢复
    "toast.resumeSuccess": string; // 恢复成功
    "toast.resumeFail": string; // 恢复失败
    "backupAndResume.resumeFromUrlDialogTitle": string; // 从URL恢复对话框标题
    "backupAndResume.resumeFromUrlDialogPlaceHolder": string; // 从URL恢复对话框占位符
    "toast.backupFileNotFound": string; // 备份文件未找到
    "toast.resumePreCheckFailed": string; // 恢复前检查失败
    "backupAndResume.setResumeMode": string; // 设置恢复模式
    "backupAndResume.resumeMode": string; // 恢复模式
    "backupAndResume.localBackup": string; // 本地备份
    "backupAndResume.backupToLocal": string; // 备份到本地
    "backupAndResume.webdavSettings": string; // WebDAV设置
    "backupAndResume.webdavUrl": string; // WebDAV URL
    "backupAndResume.backupToWebdav": string; // 备份到WebDAV
    "backupAndResume.resumeFromWebdav": string; // 从WebDAV恢复
    "backupAndResume.selectWebdavBackup": string; // 选择 WebDAV 备份
    "backupAndResume.webdavLatestBackup": string; // 最新备份
    "backupAndResume.webdavAutoBackup": string; // WebDAV自动备份
    "backupAndResume.webdavAutoBackup.off": string; // 关闭
    "backupAndResume.webdavAutoBackup.daily": string; // 每天
    "backupAndResume.webdavAutoBackup.weekly": string; // 每周
    "backupAndResume.webdavAutoBackupWifiOnly": string; // 仅 Wi-Fi 时自动备份
    "backupAndResume.webdavAutoBackupStatus": string; // 自动备份状态
    "backupAndResume.webdavAutoBackupStatus.never": string; // 尚未自动备份
    "backupAndResume.webdavAutoBackupStatus.success": string; // 上次成功
    "backupAndResume.webdavAutoBackupStatus.failed": string; // 上次失败
    "backupAndResume.webdavAutoBackupStatus.skipped": string; // 上次跳过
    "backupAndResume.webdavAutoBackupStatus.failureReason": string; // 失败原因
    "backupAndResume.webdavAutoBackupStatus.skipReason": string; // 跳过原因
    "backupAndResume.webdavAutoBackupStatus.skipReason.wifiOnly": string; // 当前不是 Wi-Fi 网络
    "backupAndResume.resumePreviewTitle": string; // 恢复前预览
    "backupAndResume.resumeReportTitle": string; // 恢复结果
    "backupAndResume.copyResumeReport": string; // 复制恢复报告
    "backupAndResume.startResume": string; // 开始恢复
    "backupAndResume.report.musicSheets": string; // 歌单
    "backupAndResume.report.musicItems": string; // 歌曲
    "backupAndResume.report.localMusic": string; // 本地音乐
    "backupAndResume.report.starredMusicSheets": string; // 收藏歌单
    "backupAndResume.report.plugins": string; // 插件
    "backupAndResume.report.pluginConfigs": string; // 插件配置
    "backupAndResume.report.preRestoreBackup": string; // 恢复前备份
    "backupAndResume.report.invalidPlugins": string; // 无效插件项
    "backupAndResume.report.success": string; // 成功
    "backupAndResume.report.skipped": string; // 跳过
    "backupAndResume.report.failed": string; // 失败
    "backupAndResume.report.failureReasons": string; // 失败原因
    "backupAndResume.resumeMode.append": string; // 附加
    "backupAndResume.resumeMode.overwrite-default": string; // 覆盖（默认）
    "backupAndResume.resumeMode.overwrite": string; // 覆盖

    // 基本设置相关
    "basicSettings.common": string; // 通用
    "basicSettings.maxHistoryLength": string; // 最大历史记录长度
    "basicSettings.musicDetailDefault": string; // 音乐详情默认
    "basicSettings.musicDetailDefault.album": string; // 专辑
    "basicSettings.musicDetailDefault.lyric": string; // 歌词
    "basicSettings.musicDetailAwake": string; // 唤醒音乐详情
    "basicSettings.associateLyricType": string; // 关联歌词类型
    "basicSettings.associateLyricType.input": string; // 输入
    "basicSettings.associateLyricType.search": string; // 搜索
    "basicSettings.showExitOnNotification": string; // 通知中显示退出
    "basicSettings.sheetAndAlbum": string; // 歌单和专辑
    "basicSettings.clickMusicInSearch": string; // 点击搜索中的音乐
    "basicSettings.clickMusicInSearch.playMusic": string; // 播放歌曲
    "basicSettings.clickMusicInSearch.playMusicAndReplace": string; // 播放歌曲并替换播放列表
    "basicSettings.clickMusicInAlbum": string; // 点击专辑内单曲时
    "basicSettings.clickMusicInAlbum.playMusic": string; // 播放歌曲
    "basicSettings.clickMusicInAlbum.playAlbum": string; // 播放专辑

    "basicSettings.musicOrderInLocalSheet": string; // 新建歌单时默认歌曲排序
    "basicSettings.musicOrderInLocalSheet.title": string; // 按歌曲名排序
    "basicSettings.musicOrderInLocalSheet.artist": string; // 按作者名排序
    "basicSettings.musicOrderInLocalSheet.album": string; // 按专辑名排序
    "basicSettings.musicOrderInLocalSheet.newest": string; // 按收藏时间从新到旧排序
    "basicSettings.musicOrderInLocalSheet.oldest": string; // 按收藏时间从旧到新排序

    "basicSettings.plugin": string; // 插件
    "basicSettings.autoUpdatePlugin": string; // 软件启动时自动更新插件
    "basicSettings.notCheckPluginVersion": string; // 安装插件时不校验版本
    "basicSettings.lazyLoadPlugin": string; // 启用插件懒加载
    "basicSettings.clearPluginCache": string; // 清除插件懒加载缓存

    "basicSettings.playback": string; // 播放
    "basicSettings.notInterrupt": string; // 允许与其他应用同时播放
    "basicSettings.autoPlayWhenAppStart": string; // 软件启动时自动播放歌曲
    "basicSettings.tryChangeSourceWhenPlayFail": string; // 播放失败时尝试更换音源
    "basicSettings.autoStopWhenError": string; // 播放失败时自动暂停
    "basicSettings.tempRemoteDuck": string; // 播放被暂时打断时
    "basicSettings.tempRemoteDuck.pause": string; // 暂停播放
    "basicSettings.tempRemoteDuck.lowerVolume": string; // 降低音量
    "basicSettings.tempRemoteDuck.volumeDecreaseLevel": string; // 音量降低幅度
    "basicSettings.qualityManagement": string; // 音质管理
    "basicSettings.qualityManagement.custom": string; // 自定义
    "basicSettings.defaultPlayQuality": string; // 默认播放音质
    "basicSettings.playQualityOrder": string; // 默认播放音质缺失时
    "basicSettings.playQualityOrder.asc": string; // 播放更高音质
    "basicSettings.playQualityOrder.desc": string; // 播放更低音质

    "basicSettings.download": string; // 下载
    "basicSettings.downloadPath": string; // 下载路径
    "basicSettings.fileSelector.selectFolder": string; // 选择文件夹
    "basicSettings.maxDownload": string; // 最大同时下载数目
    "basicSettings.defaultDownloadQuality": string; // 默认下载音质
    "basicSettings.downloadQualityOrder": string; // 默认下载音质缺失时
    "basicSettings.downloadQualityOrder.asc": string; // 下载更高音质
    "basicSettings.downloadQualityOrder.desc": string; // 下载更低音质
    "basicSettings.metadataSettings": string; // 音乐标签设置

    "basicSettings.network": string; // 网络
    "basicSettings.useCelluarNetworkPlay": string; // 使用移动网络播放
    "basicSettings.useCelluarNetworkDownload": string; // 使用移动网络下载

    "basicSettings.lyric": string; // 歌词
    "basicSettings.lyric.autoSearchLyric": string; // 歌词缺失时自动搜索歌词
    "basicSettings.lyric.showStatusBarLyric": string; // 开启桌面歌词
    "basicSettings.lyric.align": string; // 对齐方式
    "basicSettings.lyric.align.left": string; // 左对齐
    "basicSettings.lyric.align.center": string; // 居中对齐
    "basicSettings.lyric.align.right": string; // 右对齐
    "basicSettings.lyric.leftRightDistance": string; // 左右距离
    "basicSettings.lyric.topBottomDistance": string; // 上下距离
    "basicSettings.lyric.width": string; // 歌词宽度
    "basicSettings.lyric.fontSize": string; // 字体大小
    "basicSettings.lyric.detailSecondaryFontScale": string; // 详情页副行字号
    "basicSettings.lyric.statusBarShowTranslation": string; // 桌面歌词显示翻译
    "basicSettings.lyric.statusBarShowRomanization": string; // 桌面歌词显示音译
    "basicSettings.lyric.enableWordByWord": string; // 详情页逐字歌词
    "basicSettings.lyric.enableWordByWordFloat": string; // 逐字歌词浮动动画
    "basicSettings.lyric.pureWhiteMode": string; // 歌词纯白高亮
    "basicSettings.lyric.enableBreathingDots": string; // 空白歌词呼吸点
    "basicSettings.lyric.textColor": string; // 文本颜色
    "basicSettings.lyric.backgroundColor": string; // 文本背景色

    "basicSettings.cache": string; // 缓存
    "basicSettings.cache.musicCacheLimit": string; // 音乐缓存上限
    "basicSettings.cache.clearMusicCache": string; // 清除音乐缓存
    "basicSettings.cache.clearLyricCache": string; // 清除歌词缓存
    "basicSettings.cache.clearImageCache": string; // 清除图片缓存

    "basicSettings.developer": string; // 开发选项
    "basicSettings.developer.errorLog": string; // 记录错误日志
    "basicSettings.developer.traceLog": string; // 记录详细日志
    "basicSettings.developer.devLog": string; // 调试面板
    "basicSettings.developer.viewErrorLog": string; // 查看错误日志
    "basicSettings.developer.clearLog": string; // 清空日志
    "basicSettings.developer.disableTelemetry": string; // 禁止自动上报性能和异常信息

    // 编辑歌单信息弹窗
    "editMusicSheetInfo.title": string; // 编辑歌单信息
    "editMusicSheetInfo.changeCoverImageButton": string; // 更换封面
    "editMusicSheetInfo.resetCoverImageButton": string; // 恢复默认
    "editMusicSheetInfo.sheetName": string; // 歌单名
    "editMusicSheetInfo.changeSheetName": string; // 修改歌单名
    "editMusicSheetInfo.toast.success": string; // 更新歌单信息成功
    "editMusicSheetInfo.toast.defaultSheetRenameFail": string; // 默认歌单名称不可修改

    // 对话框相关 - 缓存设置
    "dialog.setCacheTitle": string; // 设置缓存
    "dialog.setCachePlaceholder": string; // 输入缓存占用上限提示
    "dialog.clearMusicCacheTitle": string; // 清除音乐缓存
    "dialog.clearMusicCacheContent": string; // 清除音乐缓存确认内容
    "dialog.clearLyricCacheTitle": string; // 清除歌词缓存
    "dialog.clearLyricCacheContent": string; // 清除歌词缓存确认内容
    "dialog.clearImageCacheTitle": string; // 清除图片缓存
    "dialog.clearImageCacheContent": string; // 清除图片缓存确认内容
    "dialog.clearPluginCacheTitle": string; // 清除插件懒加载缓存
    "dialog.clearPluginCacheContent": string; // 清除插件懒加载缓存确认内容
    "dialog.errorLogTitle": string; // 错误日志
    "dialog.errorLogNoRecord": string; // 暂无记录
    "dialog.errorLogKnow": string; // 我知道了
    "dialog.errorLogCopy": string; // 复制日志
    "dialog.setScheduleCloseTime.title": string; // 设置定时关闭时间
    "dialog.setScheduleCloseTime.placeholder": string; // 请输入时间
    "dialog.setScheduleCloseTime.unit": string; // 分钟
    "dialog.setScheduleCloseTime.hint": string; // 最长支持设置24小时（1440分钟）

    // 提示消息相关 - 缓存和日志
    "toast.cacheSetSuccess": string; // 设置成功
    "toast.pluginCacheCleared": string; // 插件缓存已清除
    "toast.musicCacheCleared": string; // 已清除音乐缓存
    "toast.lyricCacheCleared": string; // 已清除歌词缓存
    "toast.imageCacheCleared": string; // 已清除图片缓存
    "toast.logCleared": string; // 日志已清空
    "toast.noFloatWindowPermission": string; // 无悬浮窗权限
    "toast.folderNotExistOrNoPermission": string; // 文件夹不存在或无权限
    "toast.telemetryNotAvailable": string; // 自动上报性能、异常信息功能暂不可用

    // 音质相关
    "musicQuality.low": string; // 低音质
    "musicQuality.standard": string; // 标准音质
    "musicQuality.high": string; // 高音质
    "musicQuality.super": string; // 超高音质

    // 播放全部栏相关
    "playAllBar.title": string; // 播放全部

    // 无插件相关
    "noPlugin.title": string; // 还没有安装插件
    "noPlugin.titleWithType": string; // 还没有安装支持类型的插件
    "noPlugin.description": string; // 无插件描述

    // 对话框相关 - 存储权限
    "dialog.checkStorage.title": string; // 存储权限
    "dialog.checkStorage.content.0": string; // 存储权限内容0
    "dialog.checkStorage.content.1": string; // 存储权限内容1
    "dialog.checkStorage.content.2": string; // 存储权限内容2
    "dialog.checkStorage.content.3": string; // 存储权限内容3
    "dialog.checkStorage.button.grantPermission": string; // 去授予权限
    "dialog.checkStorage.button.doNotShowAgain": string; // 不再提示

    // 对话框相关 - 下载
    "dialog.downloadDialog.title": string; // 发现新版本
    "dialog.downloadDialog.skipThisVersion": string; // 跳过此版本
    "dialog.downloadDialog.downloadUsingBrowser": string; // 从浏览器下载
    "dialog.downloadDialog.backupUrl": string; // 备用链接
    "dialog.editSheetDetail.sheetName": string; // 歌单名
    "dialog.subscriptionPluginDialog.title": string; // 订阅
    "dialog.markdownDialog.openExternalLink": string; // Markdown对话框打开外部链接
    "dialog.markdownDialog.clickToShowImage": string; // 点击展示图片
    "dialog.markdownDialog.loadFailed": string; // 图片加载失败
    "dialog.simpleDialog.hasUnsavedChange.title": string; // 未保存的更改
    "dialog.simpleDialog.hasUnsavedChange.content": string; // 未保存的更改提示

    // 面板相关 - 播放列表
    "panel.playList.title": string; // 播放列表
    "panel.playList.count": string; // 歌曲数量
    "panel.artistSelect.title": string; // 选择歌手
    "panel.artistSelect.description": string; // 选择歌手说明
    "panel.searchLrc.inputPlaceholder": string; // 搜索歌词输入占位符
    "panel.searchLrc.toast.settingSuccess": string; // 设置成功
    "panel.searchLrc.toast.failToSearch": string; // 设置失败

    // 面板相关 - 添加到歌单
    "panel.addToMusicSheet.title": string; // 添加到歌单
    "panel.addToMusicSheet.newMusicSheet": string; // 新建歌单
    "panel.addToMusicSheet.count": string; // 歌曲数量
    "panel.addToMusicSheet.toast.success": string; // 已添加到歌单
    "panel.addToMusicSheet.toast.fail": string; // 添加到歌单失败
    "panel.associateLrc.title": string; // 关联歌词
    "panel.associateLrc.inputPlaceholder": string; // 输入要关联歌词的歌曲ID
    "panel.associateLrc.targetExpired": string; // 地址失效
    "panel.associateLrc.toast.success": string; // 关联歌词成功
    "panel.associateLrc.toast.fail": string; // 关联歌词失败
    "panel.associateLrc.toast.unlinkSuccess": string; // 取消关联歌词成功
    "panel.createMusicSheet.title": string; // 新建歌单

    // 面板相关 - 图片查看器
    "panel.imageViewer.saveImage": string; // 保存图片
    "panel.imageViewer.saveImageSuccess": string; // 图片已保存
    "panel.imageViewer.saveImageFail": string; // 保存图片失败

    // 面板相关 - 颜色选择器
    "panel.colorPicker.title": string; // 选择颜色
    "panel.createMusicSheet.inputLabel": string; // 输入框
    "panel.importMusicSheet.title": string; // 导入歌单
    "panel.importMusicSheet.placeholder": string; // 输入目标歌单
    "panel.importMusicSheet.importing": string; // 正在导入中
    "panel.importMusicSheet.prepareImport": string; // 准备导入
    "panel.importMusicSheet.foundSongs": string; // 发现歌曲
    "panel.importMusicSheet.invalidLink": string; // 链接有误或目标歌单为空

    // 面板相关 - 音乐项歌词选项
    "panel.musicItemLyricOptions.author": string; // 作者
    "panel.musicItemLyricOptions.album": string; // 专辑
    "panel.musicItemLyricOptions.toggleDesktopLyric": string; // 桌面歌词开关
    "panel.musicItemLyricOptions.enableDesktopLyric": string; // 开启
    "panel.musicItemLyricOptions.disableDesktopLyric": string; // 关闭
    "panel.musicItemLyricOptions.desktopLyricPermissionError": string; // 桌面歌词权限错误
    "panel.musicItemLyricOptions.uploadLocalLyric": string; // 上传本地歌词
    "panel.musicItemLyricOptions.uploadLocalLyricTranslation": string; // 上传本地歌词翻译
    "panel.musicItemLyricOptions.deleteLocalLyric": string; // 删除本地歌词
    "panel.musicItemLyricOptions.settingFail": string; // 设置失败
    "panel.musicItemLyricOptions.deleteFail": string; // 删除失败

    // 面板相关 - 音乐项选项    
    "panel.musicItemOptions.author": string; // 作者
    "panel.musicItemOptions.album": string; // 专辑
    "panel.musicItemOptions.downloaded": string; // 已下载
    "panel.musicItemOptions.readComment": string; // 查看评论
    "panel.musicItemOptions.deleteLocalDownload": string; // 删除本地下载
    "panel.musicItemOptions.deleteLocalDownloadConfirm": string; // 删除本地下载确认
    "panel.musicItemOptions.associatedLyric": string; // 已关联歌词
    "panel.musicItemOptions.associateLyric": string; // 关联歌词
    "panel.musicItemOptions.unassociateLyric": string; // 解除关联歌词    
    "panel.musicItemOptions.unassociateLyricSuccess": string; // 已解除关联歌词
    "panel.musicItemOptions.timingClose": string; // 定时关闭
    "panel.musicItemOptions.clearPluginCache": string; // 清除插件缓存
    "panel.musicItemOptions.cacheCleared": string; // 缓存已清除
    "panel.musicItemOptions.deleteFailed": string; // 删除失败
    "panel.musicItemOptions.formatDiagnostics": string; // 格式支持诊断
    "panel.musicItemOptions.formatDiagnosticsTitle": string; // 格式支持诊断标题

    // 面板相关 - 音质设置
    "panel.musicQuality.title": string; // 设置音质

    // 面板相关 - 音质管理
    "panel.qualityTranslation.title": string; // 音质管理
    "panel.qualityTranslation.description": string; // 音质管理说明
    "panel.qualityTranslation.customKeyPlaceholder": string; // 自定义音质键提示
    "panel.qualityTranslation.builtin": string; // 内置
    "panel.qualityTranslation.labelLabel": string; // 标签
    "panel.qualityTranslation.abbrLabel": string; // 缩写
    "panel.qualityTranslation.resetDefault": string; // 恢复默认
    "panel.qualityTranslation.saveSuccess": string; // 保存成功
    "panel.qualityTranslation.resetTitle": string; // 恢复默认标题
    "panel.qualityTranslation.resetContent": string; // 恢复默认说明
    "panel.qualityTranslation.resetSuccess": string; // 恢复默认成功
    "panel.qualityTranslation.emptyList": string; // 空音质列表
    "panel.qualityTranslation.addInvalid": string; // 添加失败
    "panel.qualityTranslation.addDuplicate": string; // 重复音质键
    "panel.qualityTranslation.deleteSuccess": string; // 删除成功
    "panel.qualityTranslation.deleteBuiltinTitle": string; // 删除内置音质标题
    "panel.qualityTranslation.deleteBuiltinContent": string; // 删除内置音质说明

    // 面板相关 - 音乐标签设置
    "panel.musicMetadataSettings.title": string; // 音乐标签设置
    "panel.musicMetadataSettings.section.basic": string; // 基础
    "panel.musicMetadataSettings.section.lyric": string; // 歌词
    "panel.musicMetadataSettings.section.actions": string; // 操作
    "panel.musicMetadataSettings.writeMetadata": string; // 下载时写入音乐标签
    "panel.musicMetadataSettings.writeCover": string; // 写入封面
    "panel.musicMetadataSettings.writeLyric": string; // 写入歌词
    "panel.musicMetadataSettings.enableWordByWord": string; // 保留逐字歌词
    "panel.musicMetadataSettings.downloadLyricFile": string; // 下载独立歌词文件
    "panel.musicMetadataSettings.lyricFileFormat": string; // 歌词文件格式
    "panel.musicMetadataSettings.lyricFileFormatLrc": string; // LRC
    "panel.musicMetadataSettings.lyricFileFormatTxt": string; // TXT
    "panel.musicMetadataSettings.resetDefault": string; // 恢复默认
    "panel.musicMetadataSettings.saveSuccess": string; // 保存成功
    "panel.musicMetadataSettings.resetSuccess": string; // 恢复默认成功
    "panel.musicMetadataSettings.emptyLyricOrder": string; // 歌词顺序为空
    "panel.musicMetadataSettings.currentLyricOrder": string; // 当前歌词顺序
    "panel.musicMetadataSettings.noLyricOrder": string; // 未选择歌词内容
    "panel.musicMetadataSettings.lyric.original": string; // 原文歌词
    "panel.musicMetadataSettings.lyric.translation": string; // 翻译歌词
    "panel.musicMetadataSettings.lyric.romanization": string; // 音译歌词

    // 面板相关 - 通过ID播放
    "panel.playById.title": string; // 通过ID播放
    "panel.playById.selectPlugin": string; // 选择插件
    "panel.playById.inputLabel": string; // 输入ID
    "panel.playById.placeholder": string; // 输入提示
    "panel.playById.hint": string; // 使用提示
    "panel.playById.qqHint": string; // QQ音乐提示
    "panel.playById.selectPluginFirst": string; // 请先选择插件
    "panel.playById.inputIdFirst": string; // 请先输入ID
    "panel.playById.unknownArtist": string; // 未知歌手
    "panel.playById.playingNow": string; // 开始播放
    "panel.playById.fetchFailed": string; // 获取歌曲信息失败

    // 面板相关 - 搜索歌词
    "panel.searchLrc.unnamed": string; // 未命名
    "panel.searchLrc.notSupported": string; // 搜索歌词

    // 面板相关 - 字体大小设置
    "panel.setFontSize.title": string; // 设置字体大小
    "panel.setFontSize.small": string; // 小
    "panel.setFontSize.standard": string; // 标准
    "panel.setFontSize.large": string; // 大
    "panel.setFontSize.extraLarge": string; // 超大

    // 面板相关 - 歌词偏移设置
    "panel.setLyricOffset.title": string; // 设置歌词进度
    "panel.setLyricOffset.normal": string; // 正常
    "panel.setLyricOffset.delay": string; // 延后
    "panel.setLyricOffset.advance": string; // 提前
    "panel.setLyricOffset.reset": string; // 重置

    // 面板相关 - 简单输入
    "panel.simpleInput.inputLabel": string; // 输入框

    // 面板相关 - 定时关闭
    "panel.timingClose.countdown": string; // 关闭倒计时
    "panel.timingClose.customize": string; // 自定义
    "panel.timingClose.cancelScheduleClose": string; // 取消定时关闭
    "panel.timingClose.closeAfterPlay": string; // 播放完歌曲再关闭

    // 面板相关 - 播放速度
    "panel.playRate.title": string; // 播放速度

    // 面板相关 - 歌单标签
    "panel.sheetTags.title": string; // 歌单类别

    // 播放模式相关
    "repeatMode.SHUFFLE": string; // 随机播放
    "repeatMode.QUEUE": string; // 列表循环
    "repeatMode.SINGLE": string; // 单曲循环
}

// 语言接口定义
export interface ILanguage {
    locale: string; // 语言代码
    name: string; // 语言名称
    languageData: ILanguageData; // 语言数据
}
