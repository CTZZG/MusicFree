import {
    internalSerializeKey,
    supportLocalMediaType,
} from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import { IAppConfig } from "@/types/core/config";
import { IInjectable } from "@/types/infra";
import {
    addFileScheme,
    escapeCharacter,
    mkdirR,
    removeFileScheme,
} from "@/utils/fileUtils";
import { errorLog } from "@/utils/log";
import { patchMediaExtra } from "@/utils/mediaExtra";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import { hasEncryptedMediaSource } from "@/utils/mflac";
import network from "@/utils/network";
import {
    DEFAULT_FILE_NAMING_CONFIG,
    generateFileNameFromConfig,
} from "@/utils/fileNamingFormatter";
import { getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { nanoid } from "nanoid";
import path from "path-browserify";
import { useEffect, useMemo, useState } from "react";
import { copyFile, downloadFile, exists, unlink, writeFile } from "react-native-fs";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import Mp3Util, {
    INativeDownloadTaskStatus,
    NativeDownloadEmitter,
} from "@/native/mp3Util";
import LocalMusicSheet from "./localMusicSheet";
import { IPluginManager } from "@/types/core/pluginManager";
import musicMetadataManager from "./musicMetadataManager";
import downloadNotificationManager from "./downloadNotificationManager";
import type {
    IDownloadMetadataConfig,
    IDownloadTaskMetadata,
} from "@/types/metadata";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

type IWriteResult = "success" | "failed" | "skipped";

export enum DownloadStatus {
    // 等待下载
    Pending,
    // 准备下载链接
    Preparing,
    // 下载中
    Downloading,
    // 已暂停
    Paused,
    // 下载完成
    Completed,
    // 下载失败
    Error,
}

export enum DownloaderEvent {
    // 某次下载行为出错
    DownloadError = "download-error",

    // 下载任务更新
    DownloadTaskUpdate = "download-task-update",

    // 下载某个音乐时出错
    DownloadTaskError = "download-task-error",

    // 下载完成
    DownloadQueueCompleted = "download-queue-completed",

    // 下载任务列表刷新
    DownloadTaskListChanged = "download-task-list-changed",
}

export enum DownloadFailReason {
    /** 无网络 */
    NetworkOffline = "network-offline",
    /** 设置-禁止在移动网络下下载 */
    NotAllowToDownloadInCellular = "not-allow-to-download-in-cellular",
    /** 无法获取到媒体源 */
    FailToFetchSource = "no-valid-source",
    /** 加密媒体暂未支持 */
    EncryptedMediaUnsupported = "encrypted-media-unsupported",
    /** 没有文件写入的权限 */
    NoWritePermission = "no-write-permission",
    /** App 退出或重启导致任务中断 */
    Interrupted = "interrupted",
    Unknown = "unknown",
}

interface IDownloadTaskInfo {
    // 状态
    status: DownloadStatus;
    // 目标文件名
    filename: string;
    // 下载id
    jobId?: number;
    // 下载音质
    quality?: IMusic.IQualityKey;
    // 文件大小
    fileSize?: number;
    // 已下载大小
    downloadedSize?: number;
    // 原生下载器格式化进度
    progressText?: string;
    // 音乐信息
    musicItem: IMusic.IMusicItem;
    // 如果下载失败，下载失败的原因
    errorReason?: DownloadFailReason;
    // 下载完成时间
    completedAt?: number;
}

const downloadQueueAtom = atom<IMusic.IMusicItem[]>([]);
const downloadTasks = new Map<string, IDownloadTaskInfo>();
const downloadTasksStore = getOrCreateMMKV("music.DownloadTasks");
const downloadQueueStorageKey = "queue";
const downloadTasksStorageKey = "tasks";
const maxPersistedDownloadTasks = 200;

function normalizeRestoredDownloadTask(
    task: Partial<IDownloadTaskInfo> | null,
) {
    if (!task?.musicItem?.platform || !task.musicItem.id || !task.filename) {
        return null;
    }

    const status = Object.values(DownloadStatus).includes(task.status as any)
        ? task.status
        : DownloadStatus.Error;
    const shouldMarkInterrupted =
        status === DownloadStatus.Pending ||
        status === DownloadStatus.Preparing ||
        status === DownloadStatus.Downloading ||
        status === DownloadStatus.Paused;

    return {
        ...task,
        status: shouldMarkInterrupted ? DownloadStatus.Error : status,
        jobId: undefined,
        progressText: shouldMarkInterrupted ? undefined : task.progressText,
        errorReason: shouldMarkInterrupted
            ? DownloadFailReason.Interrupted
            : task.errorReason,
    } as IDownloadTaskInfo;
}

function persistDownloadState() {
    const queue = getDefaultStore().get(downloadQueueAtom);
    const queueKeys = new Set(queue.map(getMediaUniqueKey));
    const tasks = Array.from(downloadTasks.values())
        .filter(task => queueKeys.has(getMediaUniqueKey(task.musicItem)))
        .slice(-maxPersistedDownloadTasks);

    downloadTasksStore.set(
        downloadQueueStorageKey,
        safeStringify(queue.slice(-maxPersistedDownloadTasks)),
    );
    downloadTasksStore.set(downloadTasksStorageKey, safeStringify(tasks));
}

function setDownloadQueue(queue: IMusic.IMusicItem[]) {
    getDefaultStore().set(downloadQueueAtom, queue);
    persistDownloadState();
}

interface IEvents {
    /** 某次下载行为出现报错 */
    [DownloaderEvent.DownloadError]: (
        reason: DownloadFailReason,
        error?: Error,
    ) => void;
    /** 下载某个媒体时报错 */
    [DownloaderEvent.DownloadTaskError]: (
        reason: DownloadFailReason,
        mediaItem: IMusic.IMusicItem,
        error?: Error,
    ) => void;
    /** 下载任务更新 */
    [DownloaderEvent.DownloadTaskUpdate]: (task: IDownloadTaskInfo) => void;
    /** 下载队列清空 */
    [DownloaderEvent.DownloadQueueCompleted]: () => void;
    /** 下载任务列表刷新 */
    [DownloaderEvent.DownloadTaskListChanged]: () => void;
}

class Downloader extends EventEmitter<IEvents> implements IInjectable {
    private configService!: IAppConfig;
    private pluginManagerService!: IPluginManager;

    private downloadingCount = 0;

    private static generateLegacyFilename(musicItem: IMusic.IMusicItem) {
        return `${escapeCharacter(musicItem.platform)}@${escapeCharacter(
            musicItem.id,
        )}@${escapeCharacter(musicItem.title)}@${escapeCharacter(
            musicItem.artist,
        )}`.slice(0, 200);
    }

    injectDependencies(
        configService: IAppConfig,
        pluginManager: IPluginManager,
    ): void {
        this.configService = configService;
        this.pluginManagerService = pluginManager;
        musicMetadataManager.injectPluginManager(pluginManager);
    }

    setup() {
        const restoredQueue =
            safeParse<IMusic.IMusicItem[]>(
                downloadTasksStore.getString(downloadQueueStorageKey),
            ) ?? [];
        const restoredTasks =
            safeParse<Array<Partial<IDownloadTaskInfo>>>(
                downloadTasksStore.getString(downloadTasksStorageKey),
            ) ?? [];

        downloadTasks.clear();
        restoredTasks
            .map(normalizeRestoredDownloadTask)
            .filter((task): task is IDownloadTaskInfo => !!task)
            .forEach(task => {
                downloadTasks.set(getMediaUniqueKey(task.musicItem), task);
            });

        const restoredQueueKeys = new Set<string>();
        const queue = restoredQueue.filter(musicItem => {
            const key = getMediaUniqueKey(musicItem);
            if (!downloadTasks.has(key) || restoredQueueKeys.has(key)) {
                return false;
            }
            restoredQueueKeys.add(key);
            return true;
        });

        Array.from(downloadTasks.values()).forEach(task => {
            const key = getMediaUniqueKey(task.musicItem);
            if (!restoredQueueKeys.has(key)) {
                restoredQueueKeys.add(key);
                queue.push(task.musicItem);
            }
        });

        getDefaultStore().set(
            downloadQueueAtom,
            queue.slice(-maxPersistedDownloadTasks),
        );
        persistDownloadState();
    }

    private generateFilename(
        musicItem: IMusic.IMusicItem,
        quality?: IMusic.IQualityKey,
    ) {
        const config: IFileNaming.IFileNamingConfig = {
            type:
                this.configService.getConfig("basic.fileNamingType") ??
                DEFAULT_FILE_NAMING_CONFIG.type,
            preset:
                this.configService.getConfig("basic.fileNamingPreset") ??
                DEFAULT_FILE_NAMING_CONFIG.preset,
            custom:
                this.configService.getConfig("basic.fileNamingCustom") ??
                DEFAULT_FILE_NAMING_CONFIG.custom,
            showQuality:
                this.configService.getConfig("basic.fileNamingShowQuality") ??
                DEFAULT_FILE_NAMING_CONFIG.showQuality,
            maxLength:
                this.configService.getConfig("basic.fileNamingMaxLength") ??
                DEFAULT_FILE_NAMING_CONFIG.maxLength,
            keepExtension: DEFAULT_FILE_NAMING_CONFIG.keepExtension,
        };

        const result = generateFileNameFromConfig(
            musicItem,
            config,
            quality ??
                this.configService.getConfig("basic.defaultDownloadQuality") ??
                "standard",
        );

        return result.filename || Downloader.generateLegacyFilename(musicItem);
    }

    private async getAvailableDownloadPath(fileName: string) {
        let candidate = this.getDownloadPath(fileName);
        if (!(await exists(candidate))) {
            return candidate;
        }

        const extension = path.extname(fileName);
        const basename = extension
            ? fileName.slice(0, -extension.length)
            : fileName;
        for (let index = 1; index < 1000; index += 1) {
            candidate = this.getDownloadPath(
                `${basename} (${index})${extension}`,
            );
            if (!(await exists(candidate))) {
                return candidate;
            }
        }

        return this.getDownloadPath(`${basename}-${nanoid()}${extension}`);
    }

    private updateDownloadTask(
        musicItem: IMusic.IMusicItem,
        patch: Partial<IDownloadTaskInfo>,
    ) {
        const key = getMediaUniqueKey(musicItem);
        const previous = downloadTasks.get(key);
        const newValue = {
            ...previous,
            ...patch,
        } as IDownloadTaskInfo;
        downloadTasks.set(key, newValue);
        this.emit(DownloaderEvent.DownloadTaskUpdate, newValue);
        if (
            (patch.status !== undefined && patch.status !== previous?.status) ||
            patch.errorReason !== undefined ||
            patch.completedAt !== undefined ||
            patch.filename !== undefined ||
            patch.quality !== undefined
        ) {
            persistDownloadState();
        }
        return newValue;
    }

    // 开始下载
    private markTaskAsStarted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount++;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Preparing,
        });
    }

    private markTaskAsCompleted(musicItem: IMusic.IMusicItem) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Completed,
            completedAt: Date.now(),
        });
    }

    private markTaskAsError(
        musicItem: IMusic.IMusicItem,
        reason: DownloadFailReason,
        error?: Error,
    ) {
        this.downloadingCount--;
        this.updateDownloadTask(musicItem, {
            status: DownloadStatus.Error,
            errorReason: reason,
        });
        this.emit(DownloaderEvent.DownloadTaskError, reason, musicItem, error);
    }

    /** 匹配文件后缀 */
    private getExtensionName(url: string) {
        const regResult = url.match(
            /^https?\:\/\/.+\.([^\?\.]+?$)|(?:([^\.]+?)\?.+$)/,
        );
        if (regResult) {
            return regResult[1] ?? regResult[2] ?? "mp3";
        } else {
            return "mp3";
        }
    }

    /** 获取下载路径 */
    private getDownloadPath(fileName: string) {
        const dlPath =
            this.configService.getConfig("basic.downloadPath") ??
            pathConst.downloadMusicPath;
        if (!dlPath.endsWith("/")) {
            return `${dlPath}/${fileName ?? ""}`;
        }
        return fileName ? dlPath + fileName : dlPath;
    }

    /** 获取缓存的下载路径 */
    private getCacheDownloadPath(fileName: string) {
        const cachePath = pathConst.downloadCachePath;
        if (!cachePath.endsWith("/")) {
            return `${cachePath}/${fileName ?? ""}`;
        }
        return fileName ? cachePath + fileName : cachePath;
    }

    private getMetadataConfig(): IDownloadMetadataConfig {
        return {
            enabled:
                this.configService.getConfig("basic.writeMetadata") ?? false,
            writeCover:
                this.configService.getConfig("basic.writeMetadataCover") ??
                true,
            writeLyric:
                this.configService.getConfig("basic.writeMetadataLyric") ??
                true,
            fetchExtendedInfo:
                this.configService.getConfig("basic.writeMetadataExtended") ??
                false,
            lyricOrder: this.configService.getConfig("basic.lyricOrder") ?? [
                "romanization",
                "original",
                "translation",
            ],
            enableWordByWord:
                this.configService.getConfig("basic.enableWordByWordLyric") ??
                false,
            downloadLyricFile:
                this.configService.getConfig("basic.downloadLyricFile") ??
                false,
            lyricFileFormat:
                this.configService.getConfig("basic.lyricFileFormat") ?? "lrc",
        };
    }

    private canStartDownload() {
        if (network.isOffline) {
            this.emit(
                DownloaderEvent.DownloadError,
                DownloadFailReason.NetworkOffline,
            );
            return false;
        }

        if (
            network.isCellular &&
            !this.configService.getConfig("basic.useCelluarNetworkDownload")
        ) {
            this.emit(
                DownloaderEvent.DownloadError,
                DownloadFailReason.NotAllowToDownloadInCellular,
            );
            return false;
        }

        return true;
    }

    private async writeMetadataToFile(
        musicItem: IMusic.IMusicItem,
        filePath: string,
    ): Promise<IWriteResult> {
        const taskMetadata: IDownloadTaskMetadata = {
            musicItem,
            filePath,
            coverUrl:
                typeof musicItem.artwork === "string"
                    ? musicItem.artwork
                    : undefined,
        };

        const config = this.getMetadataConfig();
        if (!config.enabled || !musicMetadataManager.isAvailable()) {
            return "skipped";
        }

        const success = await musicMetadataManager.writeMetadataForDownloadTask(
            taskMetadata,
            config,
        );
        return success ? "success" : "failed";
    }

    private stripLyricTimestamps(lyric: string) {
        return lyric
            .split(/\r?\n/)
            .map(line =>
                line
                    .replace(/\[[^\]]+\]/g, "")
                    .replace(/<[\d:.]+>/g, "")
                    .trim(),
            )
            .filter(Boolean)
            .join("\n");
    }

    private async writeLyricFileForDownload(
        musicItem: IMusic.IMusicItem,
        filePath: string,
    ): Promise<IWriteResult> {
        const config = this.getMetadataConfig();
        if (!config.downloadLyricFile) {
            return "skipped";
        }

        const lyric = await musicMetadataManager.getLyricContentForDownload(
            musicItem,
            config,
        );
        if (!lyric?.trim()) {
            return "skipped";
        }

        const format = config.lyricFileFormat ?? "lrc";
        const cleanFilePath = removeFileScheme(filePath);
        const lyricPath = cleanFilePath.replace(/\.[^/.\\]+$/, `.${format}`);
        const content =
            format === "txt" ? this.stripLyricTimestamps(lyric) : lyric;

        await writeFile(lyricPath, content, "utf8");
        return "success";
    }

    private canUseNativeDownload() {
        return (
            !!NativeDownloadEmitter &&
            !!Mp3Util?.isNativeDownloadAvailable?.()
        );
    }

    private updateFromNativeTask(
        musicItem: IMusic.IMusicItem,
        task: INativeDownloadTaskStatus,
    ) {
        if (!downloadTasks.has(getMediaUniqueKey(musicItem))) {
            return;
        }

        let status = DownloadStatus.Downloading;
        switch (task.status) {
        case "PENDING":
        case "PREPARING":
            status = DownloadStatus.Preparing;
            break;
        case "DOWNLOADING":
            status = DownloadStatus.Downloading;
            break;
        case "PAUSED":
            status = DownloadStatus.Paused;
            break;
        case "COMPLETED":
            status = DownloadStatus.Completed;
            break;
        case "ERROR":
        case "CANCELED":
            status = DownloadStatus.Error;
            break;
        }

        this.updateDownloadTask(musicItem, {
            status,
            downloadedSize:
                typeof task.downloaded === "number"
                    ? task.downloaded
                    : undefined,
            fileSize:
                typeof task.total === "number" && task.total > 0
                    ? task.total
                    : undefined,
            progressText: task.progressText,
        });
    }

    private async downloadFileWithNative(
        musicItem: IMusic.IMusicItem,
        url: string,
        destinationPath: string,
        headers?: Record<string, string>,
    ) {
        if (!this.canUseNativeDownload()) {
            throw new Error("NativeDownload is not available");
        }

        const taskId = getMediaUniqueKey(musicItem);
        await downloadNotificationManager.prepareForDownload();
        await downloadNotificationManager.showDownloadNotification(
            taskId,
            musicItem,
        );
        await Mp3Util.removeDownloadTask(taskId).catch(() => {});

        return new Promise<void>((resolve, reject) => {
            let settled = false;
            let progressSubscription: { remove: () => void } | undefined;
            let statusSubscription: { remove: () => void } | undefined;
            const cleanup = () => {
                progressSubscription?.remove();
                statusSubscription?.remove();
            };
            const settle = (callback: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                callback();
            };

            progressSubscription = NativeDownloadEmitter!.addListener(
                "NativeDownloadProgressBatch",
                (event: any) => {
                    const items = Array.isArray(event?.items)
                        ? event.items
                        : [];
                    const progress = items.find(
                        (item: any) => item?.taskId === taskId,
                    );
                    if (!progress || !downloadTasks.has(taskId)) {
                        return;
                    }
                    this.updateDownloadTask(musicItem, {
                        status: DownloadStatus.Downloading,
                        downloadedSize:
                            typeof progress.downloaded === "number"
                                ? progress.downloaded
                                : undefined,
                        fileSize:
                            typeof progress.total === "number" &&
                            progress.total > 0
                                ? progress.total
                                : undefined,
                        progressText:
                            typeof progress.progressText === "string"
                                ? progress.progressText
                                : undefined,
                    });
                    void downloadNotificationManager.updateProgress(taskId, {
                        downloadedSize:
                            typeof progress.downloaded === "number"
                                ? progress.downloaded
                                : 0,
                        fileSize:
                            typeof progress.total === "number"
                                ? progress.total
                                : 0,
                        progress:
                            typeof progress.percent === "number"
                                ? progress.percent
                                : 0,
                    });
                },
            );

            statusSubscription = NativeDownloadEmitter!.addListener(
                "NativeDownloadTaskStatusChanged",
                (task: INativeDownloadTaskStatus) => {
                    if (task?.taskId !== taskId) {
                        return;
                    }
                    this.updateFromNativeTask(musicItem, task);
                    if (task.status === "COMPLETED") {
                        void downloadNotificationManager.showCompleted(
                            taskId,
                            musicItem,
                            task.destinationPath ?? destinationPath,
                        );
                        settle(resolve);
                    } else if (
                        task.status === "ERROR" ||
                        task.status === "CANCELED"
                    ) {
                        if (task.status === "CANCELED") {
                            void downloadNotificationManager.cancelNotification(
                                taskId,
                            );
                        } else {
                            void downloadNotificationManager.showError(
                                taskId,
                                task.error ?? "unknown error",
                            );
                        }
                        settle(() =>
                            reject(
                                new Error(
                                    task.error ||
                                        `Native download ${task.status}`,
                                ),
                            ),
                        );
                    }
                },
            );

            Mp3Util.addDownloadTask({
                taskId,
                url,
                destinationPath: removeFileScheme(destinationPath),
                headers: headers ?? {},
                title: musicItem.title || "MusicFree",
                description: musicItem.artist || "正在下载音乐文件...",
                coverUrl:
                    typeof musicItem.artwork === "string"
                        ? musicItem.artwork
                        : null,
            })
                .then(added => {
                    if (!added) {
                        settle(() =>
                            reject(new Error("Native download task rejected")),
                        );
                    }
                })
                .catch(error => {
                    settle(() => reject(error));
                });
        });
    }

    private async downloadNextPendingTask() {
        const maxDownloadCount = Math.max(
            1,
            Math.min(
                +(this.configService.getConfig("basic.maxDownload") || 3),
                10,
            ),
        );
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);

        // 如果超过最大下载数量，或者没有下载任务，则不执行
        if (
            this.downloadingCount >= maxDownloadCount ||
            this.downloadingCount >= downloadQueue.length
        ) {
            return;
        }

        // 寻找下一个pending task
        let nextTask: IDownloadTaskInfo | null = null;
        for (let i = 0; i < downloadQueue.length; i++) {
            const musicItem = downloadQueue[i];
            const key = getMediaUniqueKey(musicItem);
            const task = downloadTasks.get(key);
            if (task && task.status === DownloadStatus.Pending) {
                nextTask = task;
                break;
            }
        }

        // 没有下一个任务了
        if (!nextTask) {
            if (this.downloadingCount === 0) {
                this.emit(DownloaderEvent.DownloadQueueCompleted);
            }
            return;
        }

        const musicItem = nextTask.musicItem;
        // 更新下载状态
        this.markTaskAsStarted(musicItem);

        let url = musicItem.url;
        let headers = musicItem.headers;
        let ekey: string | undefined = musicItem.ekey;
        let foundEncryptedSource = false;

        const plugin = this.pluginManagerService.getByName(musicItem.platform);

        try {
            if (plugin) {
                const qualityOrder = getQualityOrder(
                    nextTask.quality ??
                        this.configService.getConfig(
                            "basic.defaultDownloadQuality",
                        ) ??
                        "standard",
                    this.configService.getConfig(
                        "basic.downloadQualityOrder",
                    ) ?? "asc",
                );
                let data: IPlugin.IMediaSourceResult | null = null;
                for (let quality of qualityOrder) {
                    try {
                        data = await plugin.methods.getMediaSource(
                            musicItem,
                            quality,
                            1,
                            true,
                        );
                        if (!data?.url) {
                            continue;
                        }
                        if (hasEncryptedMediaSource(data.url, data.ekey)) {
                            foundEncryptedSource = true;
                            data = null;
                            continue;
                        }
                        break;
                    } catch {}
                }
                url = data?.url ?? url;
                headers = data?.headers;
                ekey = data?.ekey;
            }
            if (!url) {
                throw new Error(
                    foundEncryptedSource
                        ? DownloadFailReason.EncryptedMediaUnsupported
                        : DownloadFailReason.FailToFetchSource,
                );
            }
            if (hasEncryptedMediaSource(url, ekey)) {
                throw new Error(DownloadFailReason.EncryptedMediaUnsupported);
            }
        } catch (e: any) {
            /** 无法下载，跳过 */
            errorLog("下载失败-无法获取下载链接", {
                item: {
                    id: musicItem.id,
                    title: musicItem.title,
                    platform: musicItem.platform,
                    quality: nextTask.quality,
                },
                reason: e?.message ?? e,
            });

            if (e.message === DownloadFailReason.FailToFetchSource) {
                this.markTaskAsError(
                    musicItem,
                    DownloadFailReason.FailToFetchSource,
                    e,
                );
            } else if (
                e.message === DownloadFailReason.EncryptedMediaUnsupported
            ) {
                this.markTaskAsError(
                    musicItem,
                    DownloadFailReason.EncryptedMediaUnsupported,
                    e,
                );
            } else {
                this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
            }
            return;
        }

        if (!downloadTasks.has(getMediaUniqueKey(musicItem))) {
            return;
        }

        // 预处理完成，可以开始处理下一个任务
        this.downloadNextPendingTask();

        // 下载逻辑
        // 识别文件后缀
        let extension = this.getExtensionName(url);
        if (supportLocalMediaType.every(item => item !== "." + extension)) {
            extension = "mp3";
        }

        // 缓存下载地址
        const cacheDownloadPath = addFileScheme(
            this.getCacheDownloadPath(`${nanoid()}.${extension}`),
        );

        // 真实下载地址
        const targetDownloadPath = addFileScheme(
            await this.getAvailableDownloadPath(
                `${nextTask.filename}.${extension}`,
            ),
        );

        // 检测下载位置是否存在
        try {
            const folder = path.dirname(targetDownloadPath);
            const folderExists = await exists(folder);
            if (!folderExists) {
                await mkdirR(folder);
            }
        } catch (e: any) {
            this.markTaskAsError(
                musicItem,
                DownloadFailReason.NoWritePermission,
                e,
            );
            return;
        }

        try {
            if (this.canUseNativeDownload()) {
                await this.downloadFileWithNative(
                    musicItem,
                    url,
                    cacheDownloadPath,
                    headers,
                );
            } else {
                const { promise } = downloadFile({
                    fromUrl: url ?? "",
                    toFile: cacheDownloadPath,
                    headers: headers,
                    background: true,
                    begin: res => {
                        this.updateDownloadTask(musicItem, {
                            status: DownloadStatus.Downloading,
                            downloadedSize: 0,
                            fileSize: res.contentLength,
                            jobId: res.jobId,
                        });
                    },
                    progress: res => {
                        this.updateDownloadTask(musicItem, {
                            status: DownloadStatus.Downloading,
                            downloadedSize: res.bytesWritten,
                            fileSize: res.contentLength,
                            jobId: res.jobId,
                        });
                    },
                });
                await promise;
            }

            if (!downloadTasks.has(getMediaUniqueKey(musicItem))) {
                throw new Error("Download task removed");
            }

            // 下载完成，移动文件
            await copyFile(cacheDownloadPath, targetDownloadPath);

            const metadataWriteTask = this.writeMetadataToFile(
                musicItem,
                targetDownloadPath,
            ).catch(e => {
                errorLog("元数据写入失败，但不影响下载完成", {
                    musicItem: musicItem.title,
                    error: e instanceof Error ? e.message : String(e),
                });
                return "failed" as IWriteResult;
            });
            const lyricWriteTask = this.writeLyricFileForDownload(
                musicItem,
                targetDownloadPath,
            ).catch(e => {
                errorLog("独立歌词文件写入失败，但不影响下载完成", {
                    musicItem: musicItem.title,
                    error: e instanceof Error ? e.message : String(e),
                });
                return "failed" as IWriteResult;
            });

            LocalMusicSheet.addMusic({
                ...musicItem,
                [internalSerializeKey]: {
                    localPath: targetDownloadPath,
                },
            });

            patchMediaExtra(musicItem, {
                downloaded: true,
                localPath: targetDownloadPath,
                downloadMetadataStatus: undefined,
                downloadLyricStatus: undefined,
            });

            void Promise.all([metadataWriteTask, lyricWriteTask]).then(
                ([metadataWriteStatus, lyricWriteStatus]) => {
                    patchMediaExtra(musicItem, {
                        downloadMetadataStatus: metadataWriteStatus,
                        downloadLyricStatus: lyricWriteStatus,
                    });
                },
            );

            this.markTaskAsCompleted(musicItem);
        } catch (e: any) {
            if (downloadTasks.has(getMediaUniqueKey(musicItem))) {
                this.markTaskAsError(musicItem, DownloadFailReason.Unknown, e);
            }
        }

        // 清理工作
        try {
            if (await exists(cacheDownloadPath)) {
                await unlink(cacheDownloadPath);
            }
        } catch {}
        this.downloadNextPendingTask();

    }

    isNativeDownloadControlAvailable() {
        return this.canUseNativeDownload();
    }

    async pause(musicItem: IMusic.IMusicItem) {
        if (!this.canUseNativeDownload()) {
            return false;
        }
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (
            !task ||
            (task.status !== DownloadStatus.Preparing &&
                task.status !== DownloadStatus.Downloading)
        ) {
            return false;
        }

        const paused = await Mp3Util.pauseDownloadTask(key).catch(() => false);
        if (paused && downloadTasks.has(key)) {
            this.updateDownloadTask(musicItem, {
                status: DownloadStatus.Paused,
            });
        }
        return paused;
    }

    async pauseTasks(musicItems?: IMusic.IMusicItem[]) {
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const candidates = musicItems ?? downloadQueue;
        let pausedCount = 0;

        for (const musicItem of candidates) {
            if (await this.pause(musicItem)) {
                pausedCount += 1;
            }
        }

        return pausedCount;
    }

    async resume(musicItem: IMusic.IMusicItem) {
        if (!this.canUseNativeDownload()) {
            return false;
        }
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task || task.status !== DownloadStatus.Paused) {
            return false;
        }

        const resumed = await Mp3Util.resumeDownloadTask(key).catch(
            () => false,
        );
        if (resumed && downloadTasks.has(key)) {
            this.updateDownloadTask(musicItem, {
                status: DownloadStatus.Preparing,
            });
        }
        return resumed;
    }

    async resumeTasks(musicItems?: IMusic.IMusicItem[]) {
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const candidates = musicItems ?? downloadQueue;
        let resumedCount = 0;

        for (const musicItem of candidates) {
            if (await this.resume(musicItem)) {
                resumedCount += 1;
            }
        }

        return resumedCount;
    }

    retry(musicItem: IMusic.IMusicItem) {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task || task.status !== DownloadStatus.Error) {
            return false;
        }
        if (!this.canStartDownload()) {
            return false;
        }

        const quality = task.quality;
        downloadTasks.delete(key);
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        setDownloadQueue(
            downloadQueue.filter(item => !isSameMediaItem(item, musicItem)),
        );
        this.download(musicItem, quality);
        return true;
    }

    retryFailedTasks(musicItems?: IMusic.IMusicItem[]) {
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const candidates = musicItems ?? downloadQueue;
        let retryCount = 0;

        if (!candidates.length || !this.canStartDownload()) {
            return retryCount;
        }

        candidates.forEach(musicItem => {
            if (this.retry(musicItem)) {
                retryCount += 1;
            }
        });

        return retryCount;
    }

    download(
        musicItems: IMusic.IMusicItem | IMusic.IMusicItem[],
        quality?: IMusic.IQualityKey,
    ) {
        if (!this.canStartDownload()) {
            return;
        }

        // 整理成数组
        if (!Array.isArray(musicItems)) {
            musicItems = [musicItems];
        }

        // 防止重复下载
        musicItems = musicItems.filter(m => {
            const key = getMediaUniqueKey(m);
            // 如果存在下载任务
            if (downloadTasks.has(key)) {
                return false;
            }
            // TODO: 如果已经下载了，也应该返回false
            if (LocalMusicSheet.isLocalMusic(m)) {
                return false;
            }

            // 设置下载任务
            downloadTasks.set(getMediaUniqueKey(m), {
                status: DownloadStatus.Pending,
                filename: this.generateFilename(m, quality),
                quality: quality,
                musicItem: m,
            });

            return true;
        });

        if (!musicItems.length) {
            return;
        }

        // 添加进任务队列
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const newDownloadQueue = [...downloadQueue, ...musicItems];
        setDownloadQueue(newDownloadQueue);

        this.downloadNextPendingTask();
    }

    remove(musicItem: IMusic.IMusicItem) {
        // 删除下载任务
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (
            task.status === DownloadStatus.Pending ||
            task.status === DownloadStatus.Error
        ) {
            void Mp3Util.removeDownloadTask(key).catch(() => {});
            void downloadNotificationManager.cancelNotification(key);
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            const newDownloadQueue = downloadQueue.filter(
                item => !isSameMediaItem(item, musicItem),
            );
            setDownloadQueue(newDownloadQueue);
            return true;
        }
        if (
            task.status === DownloadStatus.Preparing ||
            task.status === DownloadStatus.Downloading ||
            task.status === DownloadStatus.Paused
        ) {
            void Mp3Util.cancelDownloadTask(key).catch(() => {});
            void Mp3Util.removeDownloadTask(key).catch(() => {});
            void downloadNotificationManager.cancelNotification(key);
            this.downloadingCount = Math.max(0, this.downloadingCount - 1);
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            const newDownloadQueue = downloadQueue.filter(
                item => !isSameMediaItem(item, musicItem),
            );
            setDownloadQueue(newDownloadQueue);
            this.downloadNextPendingTask();
            return true;
        }
        return false;
    }

    clearCompletedTasks(musicItems?: IMusic.IMusicItem[]) {
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const candidateKeys = new Set(
            (musicItems ?? downloadQueue).map(getMediaUniqueKey),
        );
        const completedKeys = new Set<string>();
        downloadTasks.forEach((task, key) => {
            if (
                task.status === DownloadStatus.Completed &&
                candidateKeys.has(key)
            ) {
                completedKeys.add(key);
            }
        });
        if (!completedKeys.size) {
            return 0;
        }

        completedKeys.forEach(key => downloadTasks.delete(key));
        setDownloadQueue(
            downloadQueue.filter(
                musicItem => !completedKeys.has(getMediaUniqueKey(musicItem)),
            ),
        );
        this.emit(DownloaderEvent.DownloadTaskListChanged);
        return completedKeys.size;
    }

    clearFailedTasks(musicItems?: IMusic.IMusicItem[]) {
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const candidateKeys = new Set(
            (musicItems ?? downloadQueue).map(getMediaUniqueKey),
        );
        const failedKeys = new Set<string>();

        downloadTasks.forEach((task, key) => {
            if (
                task.status === DownloadStatus.Error &&
                candidateKeys.has(key)
            ) {
                failedKeys.add(key);
            }
        });
        if (!failedKeys.size) {
            return 0;
        }

        failedKeys.forEach(key => {
            void Mp3Util.removeDownloadTask(key).catch(() => {});
            void downloadNotificationManager.cancelNotification(key);
            downloadTasks.delete(key);
        });
        setDownloadQueue(
            downloadQueue.filter(
                musicItem => !failedKeys.has(getMediaUniqueKey(musicItem)),
            ),
        );
        this.emit(DownloaderEvent.DownloadTaskListChanged);
        return failedKeys.size;
    }
}

const downloader = new Downloader();
export default downloader;

export function useDownloadTask(musicItem: IMusic.IMusicItem) {
    const [downloadStatus, setDownloadStatus] = useState(
        downloadTasks.get(getMediaUniqueKey(musicItem)) ?? null,
    );

    useEffect(() => {
        const callback = (task: IDownloadTaskInfo) => {
            if (isSameMediaItem(task?.musicItem, musicItem)) {
                setDownloadStatus(task);
            }
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, callback);

        return () => {
            downloader.off(DownloaderEvent.DownloadTaskUpdate, callback);
        };
    }, [musicItem]);

    return downloadStatus;
}

export function useDownloadTasksSnapshot() {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const update = () => {
            setVersion(prev => prev + 1);
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, update);
        downloader.on(DownloaderEvent.DownloadQueueCompleted, update);
        downloader.on(DownloaderEvent.DownloadTaskListChanged, update);

        return () => {
            downloader.off(DownloaderEvent.DownloadTaskUpdate, update);
            downloader.off(DownloaderEvent.DownloadQueueCompleted, update);
            downloader.off(DownloaderEvent.DownloadTaskListChanged, update);
        };
    }, []);

    return useMemo(() => new Map(downloadTasks), [version]);
}

export const useDownloadQueue = () => useAtomValue(downloadQueueAtom);
