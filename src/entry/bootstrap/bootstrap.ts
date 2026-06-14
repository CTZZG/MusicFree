import "react-native-get-random-values";

import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog.ts";
import { ImgAsset } from "@/constants/assetsConst";
import { emptyFunction, localPluginHash, supportLocalMediaType } from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import Config from "@/core/appConfig";
import downloader, { DownloadFailReason, DownloaderEvent } from "@/core/downloader";
import i18n from "@/core/i18n";
import LocalMusicSheet from "@/core/localMusicSheet";
import lyricManager from "@/core/lyricManager";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import downloadNotificationManager from "@/core/downloadNotificationManager";
import LxSource from "@/core/lxSource";
import PluginManager from "@/core/pluginManager";
import { ROUTE_PATH, navigationRef } from "@/core/router";
import Theme from "@/core/theme";
import TrackPlayer from "@/core/trackPlayer";
import { maybeRunAutoWebdavBackup } from "@/core/webdavBackup";
import NativeUtils from "@/native/utils";
import { checkAndCreateDir } from "@/utils/fileUtils";
import { errorLog, trace } from "@/utils/log";
import PersistStatus from "@/utils/persistStatus";
import Toast from "@/utils/toast";
import { getAppUserAgent } from "@/utils/userAgentHelper";
import * as SplashScreen from "expo-splash-screen";
import { getDefaultStore } from "jotai";
import { Linking, Platform } from "react-native";
import { PERMISSIONS, check, request } from "react-native-permissions";
import bootstrapAtom from "./bootstrap.atom";
import playbackServiceObserver from "@/core/trackPlayer/playbackServiceObserver";
import telemetry from "@/core/telemetry";
import type { PlayerAdapterRemoteCapability } from "@/core/playerAdapter";

// 依赖管理
PluginManager.injectDependencies(Config);
musicHistory.injectDependencies(Config);
TrackPlayer.injectDependencies(Config, musicHistory, PluginManager);
downloader.injectDependencies(Config, PluginManager);
lyricManager.injectDependencies(TrackPlayer, Config, PluginManager);
MusicSheet.injectDependencies(Config);
telemetry.injectDependencies(Config);


async function bootstrapImpl() {
    await SplashScreen.preventAutoHideAsync()
        .then(result =>
            console.log(
                `SplashScreen.preventAutoHideAsync() succeeded: ${result}`,
            ),
        )
        .catch(console.warn);

    const bootstrapTimestamp: Record<string, number> = {};
    const bootstrapMetrics: Record<string, number> = {};

    bootstrapTimestamp.Start = Date.now();
    
    // 1. 检查权限
    if (Platform.OS === "android" && Platform.Version >= 30) {
        const hasPermission = await NativeUtils.checkStoragePermission();
        if (
            !hasPermission &&
            !PersistStatus.get("app.skipBootstrapStorageDialog")
        ) {
            showDialog("CheckStorage");
        }
    } else {
        const [readStoragePermission, writeStoragePermission] =
            await Promise.all([
                check(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE),
                check(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE),
            ]);
        if (
            !(
                readStoragePermission === "granted" &&
                writeStoragePermission === "granted"
            )
        ) {
            await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
            await request(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE);
        }
    }
    
    bootstrapTimestamp.PermissionChecked = Date.now();
    bootstrapMetrics.PermissionChecked = bootstrapTimestamp.PermissionChecked - bootstrapTimestamp.Start;

    // 2. 数据初始化
    /** 初始化路径 */
    await setupFolder();
    trace("文件夹初始化完成");
    bootstrapTimestamp.FolderSetup = Date.now();
    bootstrapMetrics.FolderSetup = bootstrapTimestamp.FolderSetup - bootstrapTimestamp.PermissionChecked;

    // 加载配置
    await Promise.all([
        Config.setup().then(() => {
            bootstrapTimestamp.ConfigSetup = Date.now();
            bootstrapMetrics.ConfigSetup = bootstrapTimestamp.ConfigSetup - bootstrapTimestamp.FolderSetup;
        }),
        MusicSheet.setup().then(() => {
            bootstrapTimestamp.MusicSheetSetup = Date.now();
            bootstrapMetrics.MusicSheetSetup = bootstrapTimestamp.MusicSheetSetup - bootstrapTimestamp.FolderSetup;
        }),
        musicHistory.setup().then(() => {
            bootstrapTimestamp.MusicHistorySetup = Date.now();
            bootstrapMetrics.MusicHistorySetup = bootstrapTimestamp.MusicHistorySetup - bootstrapTimestamp.FolderSetup;
        }),
    ]);
    bootstrapTimestamp.BatchConfigSetup = Date.now();
    bootstrapMetrics.BatchConfigSetup = bootstrapTimestamp.BatchConfigSetup - bootstrapTimestamp.FolderSetup;
    trace("配置初始化完成");

    downloader.setup();
    trace("下载历史初始化完成");

    // 加载插件
    await PluginManager.setup();
    bootstrapTimestamp.PluginSetup = Date.now();
    bootstrapMetrics.PluginSetup = bootstrapTimestamp.PluginSetup - bootstrapTimestamp.BatchConfigSetup;
    trace("插件初始化完成");

    await initTrackPlayer().catch(err => {
        errorLog("播放器初始化失败，等待前台重试", err);
        // 初始化播放器出错，延迟初始化
        const bootstrapState = getDefaultStore().get(bootstrapAtom);

        if (bootstrapState.state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "TrackPlayerError",
                reason: err,
            });
        }
    });

    await LocalMusicSheet.setup();
    trace("本地音乐初始化完成");
    bootstrapTimestamp.LocalMusicSheetSetup = Date.now();
    bootstrapMetrics.LocalMusicSheetSetup = bootstrapTimestamp.LocalMusicSheetSetup - bootstrapTimestamp.PluginSetup;

    Theme.setup();
    trace("主题初始化完成");
    bootstrapTimestamp.ThemeSetup = Date.now();
    bootstrapMetrics.ThemeSetup = bootstrapTimestamp.ThemeSetup - bootstrapTimestamp.LocalMusicSheetSetup;

    extraMakeup();

    i18n.setup();
    trace("多语言初始化完成");
    bootstrapTimestamp.I18nSetup = Date.now();
    bootstrapMetrics.I18nSetup = bootstrapTimestamp.I18nSetup - bootstrapTimestamp.ThemeSetup;
    
    ErrorUtils.setGlobalHandler(error => {
        telemetry.logException(error);
        errorLog("未捕获的错误", error);
    });


    // metrics属性
    telemetry.logMetric("Bootstrap.MainTrace", Date.now() - bootstrapTimestamp.Start, bootstrapMetrics);
}

/** 初始化 */
async function setupFolder() {
    await Promise.all([
        checkAndCreateDir(pathConst.dataPath),
        checkAndCreateDir(pathConst.logPath),
        checkAndCreateDir(pathConst.cachePath),
        checkAndCreateDir(pathConst.pluginPath),
        checkAndCreateDir(pathConst.lrcCachePath),
        checkAndCreateDir(pathConst.downloadCachePath),
        checkAndCreateDir(pathConst.localLrcPath),
        checkAndCreateDir(pathConst.downloadPath).then(() => {
            checkAndCreateDir(pathConst.downloadMusicPath);
        }),
    ]);
}

export async function initTrackPlayer() {
    const playerTimestamp: Record<string, number> = {};
    const playerMetrics: Record<string, number> = {}; 
    playerTimestamp.Start = Date.now();
    TrackPlayer.lockBackend();

    try {
        await TrackPlayer.playerAdapter.setup({
            maxCacheSize:
                Config.getConfig("basic.maxCacheSize") ?? 1024 * 1024 * 512,
        });
    } catch (e: any) {
        throw e;
    }
    playerTimestamp.BackendSetup = Date.now();
    playerMetrics.BackendSetup = playerTimestamp.BackendSetup - playerTimestamp.Start;

    const capabilities = Config.getConfig("basic.showExitOnNotification")
        ? [
            "play",
            "pause",
            "next",
            "previous",
            "stop",
        ]
        : [
            "play",
            "pause",
            "next",
            "previous",
        ];
    const remoteCapabilities = capabilities as PlayerAdapterRemoteCapability[];

    await TrackPlayer.playerAdapter.configure({
        notificationIcon: ImgAsset.logoTransparent,
        progressUpdateEventInterval: 0.1,
        alwaysPauseOnInterruption: true,
        continuePlaybackOnAppKilled: true,
        userAgent: getAppUserAgent(),
        capabilities: remoteCapabilities,
        compactCapabilities: remoteCapabilities,
        notificationCapabilities: [...remoteCapabilities, "seek"],
    });
    trace("播放器初始化完成");
    playerTimestamp.OptionsSetup = Date.now();
    playerMetrics.OptionsSetup = playerTimestamp.OptionsSetup - playerTimestamp.BackendSetup;

    await TrackPlayer.setupTrackPlayer();
    trace("播放列表初始化完成");
    playerTimestamp.PlayerSetup = Date.now();
    playerMetrics.PlayerSetup = playerTimestamp.PlayerSetup - playerTimestamp.OptionsSetup;

    await lyricManager.setup();
    trace("歌词模块初始化完成");
    playerTimestamp.LyricManagerSetup = Date.now();
    playerMetrics.LyricManagerSetup = playerTimestamp.LyricManagerSetup - playerTimestamp.PlayerSetup;

    // [新增] 设置播放服务观察者，用于和插件通信
    playbackServiceObserver.setupPlaybackObserver();
    telemetry.logMetric("Bootstrap.TrackPlayerTrace", Date.now() - playerTimestamp.Start, playerMetrics);
}


/** 不需要阻塞的 */
async function extraMakeup() {
    // 自动更新
    try {
        if (Config.getConfig("basic.autoUpdatePlugin")) {
            const lastUpdated = PersistStatus.get("app.pluginUpdateTime") || 0;
            const now = Date.now();
            if (Math.abs(now - lastUpdated) > 86400000) {
                PersistStatus.set("app.pluginUpdateTime", now);
                const plugins = PluginManager.getEnabledPlugins();
                for (let i = 0; i < plugins.length; ++i) {
                    const srcUrl = plugins[i].instance.srcUrl;
                    if (srcUrl) {
                        // 静默失败
                        await PluginManager.installPluginFromUrl(srcUrl).catch(emptyFunction);
                    }
                }
            }
        }
    } catch { }

    void maybeRunAutoWebdavBackup();

    function getComparableMediaUrl(url: string) {
        return url.split(/[?#]/)[0].toLowerCase();
    }

    function isSupportedMediaUrl(url: string) {
        const comparableUrl = getComparableMediaUrl(url);
        return supportLocalMediaType.some(it => comparableUrl.endsWith(it));
    }

    async function importAndPlayExternalMedia(url: string) {
        const musicItem = await PluginManager.getByHash(
            localPluginHash,
        )?.instance?.importMusicItem?.(url);
        console.log(musicItem);
        if (musicItem) {
            await TrackPlayer.play(musicItem, true);
        }
    }

    function readSchemeQueryParam(url: string, key: string) {
        const queryIndex = url.indexOf("?");
        if (queryIndex === -1) {
            return "";
        }
        const query = url.slice(queryIndex + 1).split("#")[0];
        const params = query.split("&");
        for (const param of params) {
            const [rawKey, ...rawValue] = param.split("=");
            if (decodeURIComponent(rawKey) === key) {
                return decodeURIComponent(rawValue.join("=") ?? "");
            }
        }
        return "";
    }

    async function searchAndPlayFirst(keyword: string) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) {
            Toast.warn(i18n.t("scheme.searchPlayFailed"));
            return;
        }
        const plugins = PluginManager.getSortedSearchablePlugins("music");
        for (const plugin of plugins) {
            try {
                const result = await plugin.methods.search(
                    trimmedKeyword,
                    1,
                    "music",
                );
                const musicItem = result?.data?.[0];
                if (musicItem) {
                    await TrackPlayer.play(musicItem as IMusic.IMusicItem, true);
                    return;
                }
            } catch (e: any) {
                trace("外部搜索播放失败，尝试下一个插件", {
                    plugin: plugin.name,
                    message: e?.message ?? String(e),
                });
            }
        }
        Toast.warn(i18n.t("scheme.searchPlayFailed"));
    }

    function openSearchPage(keyword: string, retryCount = 20) {
        const trimmedKeyword = keyword.trim();
        if (!trimmedKeyword) {
            return;
        }
        if (!navigationRef.isReady()) {
            if (retryCount > 0) {
                setTimeout(
                    () => openSearchPage(trimmedKeyword, retryCount - 1),
                    300,
                );
            }
            return;
        }
        navigationRef.navigate(ROUTE_PATH.SEARCH_PAGE, {
            initialQuery: trimmedKeyword,
            initialSearchType: "music",
            initialSearchToken: Date.now(),
        });
    }

    async function handlePlayerSchemeUrl(url: string) {
        if (!url.startsWith("musicfree://")) {
            return false;
        }
        const command = url
            .slice("musicfree://".length)
            .split("?")[0]
            .replace(/\/$/, "");

        if (command === "play") {
            await TrackPlayer.play();
            return true;
        }
        if (command === "pause") {
            await TrackPlayer.pause();
            return true;
        }
        if (command === "toggle-play" || command === "toggle") {
            const state = await TrackPlayer.playerAdapter.getState();
            if (state === "playing") {
                await TrackPlayer.pause();
            } else {
                await TrackPlayer.play();
            }
            return true;
        }
        if (command === "next" || command === "skip-next") {
            await TrackPlayer.skipToNext();
            return true;
        }
        if (command === "previous" || command === "skip-prev") {
            await TrackPlayer.skipToPrevious();
            return true;
        }
        if (command === "search") {
            openSearchPage(readSchemeQueryParam(url, "keyword"));
            return true;
        }
        if (command === "search-play") {
            await searchAndPlayFirst(readSchemeQueryParam(url, "keyword"));
            return true;
        }
        return false;
    }

    async function handleLinkingUrl(url: string) {
        // 插件
        try {
            if (url.startsWith("musicfree://install-lx-source/")) {
                const sourceUrl = decodeURIComponent(
                    url.slice("musicfree://install-lx-source/".length),
                );
                const result = await LxSource.installFromUrl(sourceUrl);
                if (result.success) {
                    Toast.success(i18n.t("lxSource.installSuccess", {
                        name: result.item?.metadata.name ?? "",
                    }));
                } else {
                    Toast.warn(i18n.t("lxSource.installFailed", {
                        reason: result.message ?? "",
                    }));
                }
            } else if (await handlePlayerSchemeUrl(url)) {
                return;
            } else if (url.startsWith("musicfree://install/")) {
                const plugins = url
                    .slice(20)
                    .split(",")
                    .map(decodeURIComponent);
                await Promise.all(
                    plugins.map(it =>
                        PluginManager.installPluginFromUrl(it).catch(emptyFunction),
                    ),
                );
                Toast.success("安装成功~");
            } else if (url.endsWith(".js")) {
                PluginManager.installPluginFromLocalFile(url, {
                    notCheckVersion: Config.getConfig(
                        "basic.notCheckPluginVersion",
                    ),
                })
                    .then(res => {
                        if (res.success) {
                            Toast.success(`插件「${res.pluginName}」安装成功~`);
                        } else {
                            Toast.warn("安装失败: " + res.message);
                        }
                    })
                    .catch(e => {
                        console.log(e);
                        Toast.warn(e?.message ?? "无法识别此插件");
                    });
            } else if (isSupportedMediaUrl(url)) {
                // 本地播放
                await importAndPlayExternalMedia(url);
            } else if (url.startsWith("content://")) {
                // 本地播放 (Android)
                await importAndPlayExternalMedia(url);
            }
        } catch (e: any) {
            trace("处理外部链接失败", {
                url,
                message: e?.message ?? String(e),
            });
        }
    }

    // 开启监听
    Linking.removeAllListeners("url");
    Linking.addEventListener("url", data => {
        if (data.url) {
            handleLinkingUrl(data.url);
        }
    });
    const initUrl = await Linking.getInitialURL();
    if (initUrl) {
        handleLinkingUrl(initUrl);
    }

    if (Config.getConfig("basic.autoPlayWhenAppStart")) {
        TrackPlayer.play();
    }
}


function bindEvents() {
    // 下载事件
    downloader.on(DownloaderEvent.DownloadError, (reason) => {
        if (reason === DownloadFailReason.NetworkOffline) {
            Toast.warn("当前无网络连接，请等待网络恢复后重试");
        } else if (reason === DownloadFailReason.NotAllowToDownloadInCellular) {
            if (getCurrentDialog()?.name !== "SimpleDialog") {
                showDialog("SimpleDialog", {
                    title: "流量提醒",
                    content: "当前非WIFI环境，为节省流量，请到侧边栏设置中打开【使用移动网络下载】功能后方可继续下载",
                });
            }
        }
    });

    downloader.on(DownloaderEvent.DownloadTaskError, reason => {
        const reasonMap: Record<DownloadFailReason, string> = {
            [DownloadFailReason.NetworkOffline]:
                "当前无网络连接，请等待网络恢复后重试",
            [DownloadFailReason.NotAllowToDownloadInCellular]:
                "当前非WIFI环境，已停止下载",
            [DownloadFailReason.FailToFetchSource]: i18n.t(
                "downloading.downloadFailReason.failToFetchSource",
            ),
            [DownloadFailReason.EncryptedMediaUnsupported]: i18n.t(
                "downloading.downloadFailReason.encryptedMediaUnsupported",
            ),
            [DownloadFailReason.NoWritePermission]: i18n.t(
                "downloading.downloadFailReason.noWritePermission",
            ),
            [DownloadFailReason.Interrupted]: i18n.t(
                "downloading.downloadFailReason.interrupted",
            ),
            [DownloadFailReason.Unknown]: i18n.t(
                "downloading.downloadFailReason.unknown",
            ),
        };
        Toast.warn(reasonMap[reason] ?? reasonMap[DownloadFailReason.Unknown]);
    });

    downloader.on(DownloaderEvent.DownloadQueueCompleted, () => {
        Toast.success("下载任务已完成");
    });
}

export default async function () {
    try {
        await telemetry.setup().catch(console.warn);
        const startTime = Date.now();
        telemetry.logEvent("App.Bootstrap.Start");
        getDefaultStore().set(bootstrapAtom, {
            "state": "Loading",
        });
        await bootstrapImpl();
        await downloadNotificationManager.initialize().catch(() => {});
        bindEvents();
        if (getDefaultStore().get(bootstrapAtom).state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                "state": "Done",
            });
        }
        telemetry.logEvent("App.Bootstrap.Completed", {
            d: Date.now() - startTime,
            pluginCount: PluginManager.getPluginsCount(),
        });
    } catch (e: any) {
        errorLog("初始化出错", e);
        telemetry.logException(e);
        if (getDefaultStore().get(bootstrapAtom).state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "Fatal",
                reason: e,
            });
        }
    }
    // 隐藏开屏动画
    await SplashScreen.hideAsync();
}
