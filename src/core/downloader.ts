import {
    internalSerializeKey,
    localPluginPlatform,
    supportLocalMediaType,
} from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import { IAppConfig } from "@/types/core/config";
import { IInjectable } from "@/types/infra";
import {
    addFileScheme,
    escapeCharacter,
    getFileName,
    mkdirR,
    removeFileScheme,
} from "@/utils/fileUtils";
import { errorLog } from "@/utils/log";
import {
    getMediaExtra,
    getMediaExtraProperty,
    patchMediaExtra,
    removeMediaExtra,
    setMediaExtra,
} from "@/utils/mediaExtra";
import {
    getLocalPath,
    getMediaUniqueKey,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { hasEncryptedMediaSource } from "@/utils/mflac";
import network from "@/utils/network";
import {
    DEFAULT_FILE_NAMING_CONFIG,
    generateFileNameFromConfig,
} from "@/utils/fileNamingFormatter";
import { createDownloadHeaders } from "@/utils/downloadHeaders";
import { getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { nanoid } from "nanoid";
import path from "path-browserify";
import { useEffect, useMemo, useState } from "react";
import {
    copyFile,
    downloadFile,
    exists,
    stat,
    stopDownload,
    unlink,
    writeFile,
} from "react-native-fs";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import Mp3Util, {
    getMp3UtilNativeDiagnostics,
    INativeDownloadTaskStatus,
    NativeDownloadEmitter,
} from "@/native/mp3Util";
import Cenc from "@/native/cenc";
import {
    canProxyCencSource,
    getPlayableCencKey,
} from "@/service/encryptedMediaProxy";
import LocalMusicSheet from "./localMusicSheet";
import { IPluginManager } from "@/types/core/pluginManager";
import musicMetadataManager from "./musicMetadataManager";
import downloadNotificationManager from "./downloadNotificationManager";
import type {
    IDownloadEnrichment,
    IDownloadMetadataConfig,
    IDownloadTaskMetadata,
} from "@/types/metadata";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { filterQueueableDownloadItems } from "./downloadQueuePolicy";
import { type DownloadWriteResult } from "./downloadFinalizationPolicy";
import {
    createDownloadAttemptIdentity,
    IDownloadAttemptIdentity,
    isSameDownloadAttempt,
    splitDownloadTaskRetention,
} from "./downloadTaskPolicy";
import {
    getDownloadFinalizationRollbackPaths,
    IDownloadFinalizationJournal,
    isDownloadFinalizationJournal,
    resolveDownloadFinalizationRecovery,
} from "./downloadFinalizationJournal";
import { runDownloadFinalizationTransaction } from "./downloadFinalizationRunner";
import { withTimeout } from "@/utils/promiseTimeout";

type IWriteResult = DownloadWriteResult;

export enum DownloadStatus {
    // 等待下载
    Pending = 0,
    // 准备下载链接
    Preparing = 1,
    // 下载中
    Downloading = 2,
    // 已暂停
    Paused = 3,
    // 下载完成
    Completed = 4,
    // 下载失败
    Error = 5,
    // 原始文件已下载，正在复制/解密/写入元数据
    Finalizing = 6,
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

interface IDownloadTaskInfo extends IDownloadAttemptIdentity {
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
    // 如果下载失败，保留底层错误摘要用于诊断
    errorMessage?: string;
    // 任务开始时间
    startedAt?: number;
    // 下载完成时间
    completedAt?: number;
    // 下载收尾事务日志，用于取消回滚与进程重启恢复
    finalization?: IDownloadFinalizationJournal;
}

export interface IDownloadDiagnosticSnapshot {
    nativeDownloadAvailable: boolean;
    downloadingCount: number;
    queueLength: number;
    counts: Record<string, number>;
    tasks: Array<{
        key: string;
        status: string;
        title?: string;
        artist?: string;
        platform?: string;
        id?: string;
        filename?: string;
        quality?: IMusic.IQualityKey;
        downloadedSize?: number;
        fileSize?: number;
        progressText?: string;
        errorReason?: DownloadFailReason;
        errorMessage?: string;
        startedAt?: number;
        completedAt?: number;
    }>;
}

const downloadQueueAtom = atom<IMusic.IMusicItem[]>([]);
const downloadTasks = new Map<string, IDownloadTaskInfo>();
const downloadTasksStore = getOrCreateMMKV("music.DownloadTasks");
const legacyDownloadQueueStorageKey = "queue";
const legacyDownloadTasksStorageKey = "tasks";
const downloadStorageSchemaKey = "schemaVersion";
const activeDownloadQueueStorageKey = "activeQueue";
const terminalDownloadQueueStorageKey = "terminalQueue";
const activeDownloadTasksStorageKey = "activeTasks";
const terminalDownloadTasksStorageKey = "terminalTasks";
const downloadStorageSchemaVersion = "2";
const maxPersistedTerminalTasks = 200;
const NATIVE_DOWNLOAD_STATUS_POLL_MS = 15000;
const NATIVE_DOWNLOAD_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_SOURCE_RESOLUTION_TIMEOUT_MS = 15_000;
const DOWNLOAD_SOURCE_PLUGIN_CALL_TIMEOUT_MS = 6_000;
const NATIVE_DOWNLOAD_PAUSED_ERROR = "Native download paused";
const DOWNLOAD_TASK_SNAPSHOT_THROTTLE_MS = 500;
const NATIVE_DOWNLOAD_BRIDGE_TIMEOUT_MS = 5000;

function normalizeRestoredDownloadTask(
    task: Partial<IDownloadTaskInfo> | null,
) {
    if (!task?.musicItem?.platform || !task.musicItem.id || !task.filename) {
        return null;
    }

    const logicalKey = task.logicalKey ?? getMediaUniqueKey(task.musicItem);
    const attemptId = task.attemptId ?? `restored-${nanoid()}`;
    const status = Object.values(DownloadStatus).includes(task.status as any)
        ? task.status
        : DownloadStatus.Error;
    const completedWithoutLocalPath =
        status === DownloadStatus.Completed && !getLocalPath(task.musicItem);
    const validFinalization = isDownloadFinalizationJournal(task.finalization)
        ? task.finalization
        : undefined;
    const resumableFinalizing =
        status === DownloadStatus.Finalizing && !!validFinalization;
    const shouldResumeAsPending =
        status === DownloadStatus.Pending ||
        status === DownloadStatus.Preparing ||
        status === DownloadStatus.Downloading;
    const shouldMarkInterrupted =
        (status === DownloadStatus.Finalizing && !validFinalization) ||
        completedWithoutLocalPath;
    const restoredStatus = shouldResumeAsPending
        ? DownloadStatus.Pending
        : resumableFinalizing
            ? DownloadStatus.Finalizing
            : shouldMarkInterrupted
                ? DownloadStatus.Error
                : status;

    return {
        ...task,
        logicalKey,
        attemptId,
        status: restoredStatus,
        finalization: resumableFinalizing ? validFinalization : undefined,
        jobId: undefined,
        downloadedSize: shouldResumeAsPending ? undefined : task.downloadedSize,
        fileSize: shouldResumeAsPending ? undefined : task.fileSize,
        progressText: shouldResumeAsPending ? undefined : task.progressText,
        completedAt: completedWithoutLocalPath ? undefined : task.completedAt,
        errorReason: shouldMarkInterrupted
            ? DownloadFailReason.Interrupted
            : shouldResumeAsPending || status === DownloadStatus.Paused
                ? undefined
                : task.errorReason,
        errorMessage: shouldMarkInterrupted
            ? completedWithoutLocalPath
                ? "completed task missing local path"
                : DownloadFailReason.Interrupted
            : shouldResumeAsPending || status === DownloadStatus.Paused
                ? undefined
                : task.errorMessage,
    } as IDownloadTaskInfo;
}

function isTerminalDownloadTask(task: IDownloadTaskInfo) {
    return (
        task.status === DownloadStatus.Completed ||
        task.status === DownloadStatus.Error
    );
}
function getDownloadStatusName(status: DownloadStatus) {
    return DownloadStatus[status] ?? `${status}`;
}

function getDownloadErrorMessage(error?: Error | null) {
    const message = `${error?.message ?? error ?? ""}`.trim();
    return message ? message.slice(0, 500) : undefined;
}

function isNativeDownloadPausedError(error: any) {
    return `${error?.message ?? error ?? ""}` === NATIVE_DOWNLOAD_PAUSED_ERROR;
}

function persistDownloadState() {
    const queue = getDefaultStore().get(downloadQueueAtom);
    const retained = splitDownloadTaskRetention(
        Array.from(downloadTasks.values()),
        {
            maxTerminalHistory: maxPersistedTerminalTasks,
            isTerminal: isTerminalDownloadTask,
            getTerminalOrder: task => task.completedAt ?? task.startedAt ?? 0,
        },
    );
    const activeKeys = new Set(retained.active.map(task => task.logicalKey));
    const terminalKeys = new Set(
        retained.terminal.map(task => task.logicalKey),
    );
    const activeQueue = queue.filter(musicItem =>
        activeKeys.has(getMediaUniqueKey(musicItem)),
    );
    const terminalQueue = queue.filter(musicItem =>
        terminalKeys.has(getMediaUniqueKey(musicItem)),
    );
    const activeQueueKeys = new Set(activeQueue.map(getMediaUniqueKey));
    const terminalQueueKeys = new Set(terminalQueue.map(getMediaUniqueKey));
    retained.active.forEach(task => {
        if (!activeQueueKeys.has(task.logicalKey)) {
            activeQueue.push(task.musicItem);
        }
    });
    retained.terminal.forEach(task => {
        if (!terminalQueueKeys.has(task.logicalKey)) {
            terminalQueue.push(task.musicItem);
        }
    });

    downloadTasksStore.set(
        activeDownloadQueueStorageKey,
        safeStringify(activeQueue),
    );
    downloadTasksStore.set(
        terminalDownloadQueueStorageKey,
        safeStringify(terminalQueue),
    );
    downloadTasksStore.set(
        activeDownloadTasksStorageKey,
        safeStringify(retained.active),
    );
    downloadTasksStore.set(
        terminalDownloadTasksStorageKey,
        safeStringify(retained.terminal),
    );
    downloadTasksStore.set(
        downloadStorageSchemaKey,
        downloadStorageSchemaVersion,
    );
}
function setDownloadQueue(queue: IMusic.IMusicItem[]) {
    getDefaultStore().set(downloadQueueAtom, queue);
    persistDownloadState();
}

function isDownloadedRemoteMusic(musicItem: IMusic.IMusicItem) {
    return (
        musicItem.platform !== localPluginPlatform && !!getLocalPath(musicItem)
    );
}

function getCompletedLocalDownloadFilename(musicItem: IMusic.IMusicItem) {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return Downloader.generateLegacyFilename(musicItem);
    }
    return (
        getFileName(removeFileScheme(localPath), true) ||
        Downloader.generateLegacyFilename(musicItem)
    );
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
    private reservedDownloadPaths = new Set<string>();

    static generateLegacyFilename(musicItem: IMusic.IMusicItem) {
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

    async setup() {
        const hasSeparatedStorage =
            downloadTasksStore.getString(downloadStorageSchemaKey) ===
            downloadStorageSchemaVersion;
        const restoredQueue = hasSeparatedStorage
            ? [
                ...(safeParse<IMusic.IMusicItem[]>(
                    downloadTasksStore.getString(
                        activeDownloadQueueStorageKey,
                    ),
                ) ?? []),
                ...(safeParse<IMusic.IMusicItem[]>(
                    downloadTasksStore.getString(
                        terminalDownloadQueueStorageKey,
                    ),
                ) ?? []),
            ]
            : safeParse<IMusic.IMusicItem[]>(
                downloadTasksStore.getString(legacyDownloadQueueStorageKey),
            ) ?? [];
        const restoredTasks = hasSeparatedStorage
            ? [
                ...(safeParse<Array<Partial<IDownloadTaskInfo>>>(
                    downloadTasksStore.getString(
                        terminalDownloadTasksStorageKey,
                    ),
                ) ?? []),
                ...(safeParse<Array<Partial<IDownloadTaskInfo>>>(
                    downloadTasksStore.getString(
                        activeDownloadTasksStorageKey,
                    ),
                ) ?? []),
            ]
            : safeParse<Array<Partial<IDownloadTaskInfo>>>(
                downloadTasksStore.getString(legacyDownloadTasksStorageKey),
            ) ?? [];

        downloadTasks.clear();
        restoredTasks
            .map(normalizeRestoredDownloadTask)
            .filter((task): task is IDownloadTaskInfo => !!task)
            .forEach(task => {
                downloadTasks.set(task.logicalKey, task);
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
            if (!restoredQueueKeys.has(task.logicalKey)) {
                restoredQueueKeys.add(task.logicalKey);
                queue.push(task.musicItem);
            }
        });

        if (!hasSeparatedStorage) {
            LocalMusicSheet.getMusicList().forEach(musicItem => {
                if (!isDownloadedRemoteMusic(musicItem)) {
                    return;
                }

                const key = getMediaUniqueKey(musicItem);
                if (!downloadTasks.has(key)) {
                    downloadTasks.set(key, {
                        ...createDownloadAttemptIdentity(key, nanoid),
                        status: DownloadStatus.Completed,
                        filename: getCompletedLocalDownloadFilename(musicItem),
                        musicItem,
                    });
                }
                if (!restoredQueueKeys.has(key)) {
                    restoredQueueKeys.add(key);
                    queue.push(musicItem);
                }
            });
        }

        const retained = splitDownloadTaskRetention(
            Array.from(downloadTasks.values()),
            {
                maxTerminalHistory: maxPersistedTerminalTasks,
                isTerminal: isTerminalDownloadTask,
                getTerminalOrder: task =>
                    task.completedAt ?? task.startedAt ?? 0,
            },
        );
        const retainedKeys = new Set(
            [...retained.active, ...retained.terminal].map(
                task => task.logicalKey,
            ),
        );
        downloadTasks.forEach((_task, key) => {
            if (!retainedKeys.has(key)) {
                downloadTasks.delete(key);
            }
        });
        getDefaultStore().set(
            downloadQueueAtom,
            queue.filter(item => retainedKeys.has(getMediaUniqueKey(item))),
        );
        persistDownloadState();
        // Clean up tasks restored by the native manager before recovery can
        // schedule any new JS task; otherwise the cleanup may delete a task
        // that was just created during finalization recovery.
        await this.cleanupRestoredNativeDownloadTasks();
        await this.recoverFinalizingTasks();
        if (
            !network.isOffline &&
            (!network.isCellular ||
                this.configService.getConfig(
                    "basic.useCelluarNetworkDownload",
                ))
        ) {
            this.downloadNextPendingTask();
        }
    }
    private getMaxDownloadCount() {
        return Math.max(
            1,
            Math.min(
                +(this.configService.getConfig("basic.maxDownload") || 3),
                10,
            ),
        );
    }

    private runNativeDownloadOperation<T>(
        operation: () => PromiseLike<T>,
        timeoutMessage: string,
    ) {
        return withTimeout(
            Promise.resolve().then(operation),
            NATIVE_DOWNLOAD_BRIDGE_TIMEOUT_MS,
            timeoutMessage,
        );
    }

    private async syncNativeMaxConcurrency(
        maxDownloadCount = this.getMaxDownloadCount(),
    ) {
        if (!this.canUseNativeDownload()) {
            return;
        }

        await this.runNativeDownloadOperation(
            () => Mp3Util.setDownloadMaxConcurrency(maxDownloadCount),
            "设置原生下载并发数超时",
        ).catch(() => false);
    }

    private async cleanupRestoredNativeDownloadTasks() {
        if (!this.canUseNativeDownload()) {
            return;
        }

        const tasks = await this.runNativeDownloadOperation(
            () => Mp3Util.getAllDownloadTasks(),
            "读取原生下载任务超时",
        ).catch(() => []);
        await Promise.all(
            tasks.map(task =>
                this.runNativeDownloadOperation(
                    () => Mp3Util.removeDownloadTask(task.taskId),
                    "清理原生下载任务超时",
                ).catch(() => false),
            ),
        );
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
        if (
            !this.reservedDownloadPaths.has(candidate) &&
            !(await exists(candidate))
        ) {
            this.reservedDownloadPaths.add(candidate);
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
            if (
                !this.reservedDownloadPaths.has(candidate) &&
                !(await exists(candidate))
            ) {
                this.reservedDownloadPaths.add(candidate);
                return candidate;
            }
        }

        candidate = this.getDownloadPath(`${basename}-${nanoid()}${extension}`);
        this.reservedDownloadPaths.add(candidate);
        return candidate;
    }

    private releaseReservedDownloadPath(filePath?: string | null) {
        if (!filePath) {
            return;
        }
        this.reservedDownloadPaths.delete(removeFileScheme(filePath));
    }

    private async hasDownloadArtifact(filePath: string) {
        try {
            const fileInfo = await stat(removeFileScheme(filePath));
            return Number(fileInfo.size) > 0;
        } catch {
            return false;
        }
    }

    private isCurrentDownloadAttempt(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
    ) {
        const logicalKey = getMediaUniqueKey(musicItem);
        return isSameDownloadAttempt(downloadTasks.get(logicalKey), {
            logicalKey,
            attemptId,
        });
    }

    private updateDownloadTask(
        musicItem: IMusic.IMusicItem,
        patch: Partial<IDownloadTaskInfo>,
        attemptId?: string,
    ) {
        const key = getMediaUniqueKey(musicItem);
        const previous = downloadTasks.get(key);
        if (
            !previous ||
            (attemptId &&
                !isSameDownloadAttempt(previous, {
                    logicalKey: key,
                    attemptId,
                }))
        ) {
            return previous;
        }
        const hasChanged =
            !previous ||
            Object.entries(patch).some(
                ([field, value]) =>
                    previous[field as keyof IDownloadTaskInfo] !== value,
            );
        if (!hasChanged) {
            return previous;
        }
        const newValue = {
            ...previous,
            ...patch,
        } as IDownloadTaskInfo;
        downloadTasks.set(key, newValue);
        this.emit(DownloaderEvent.DownloadTaskUpdate, newValue);
        if (
            (patch.status !== undefined && patch.status !== previous?.status) ||
            patch.errorReason !== undefined ||
            patch.errorMessage !== undefined ||
            patch.startedAt !== undefined ||
            patch.completedAt !== undefined ||
            patch.filename !== undefined ||
            patch.quality !== undefined ||
            patch.attemptId !== undefined ||
            patch.logicalKey !== undefined ||
            Object.prototype.hasOwnProperty.call(patch, "finalization")
        ) {
            persistDownloadState();
        }
        return newValue;
    }

    private updateDownloadTaskProgress(
        musicItem: IMusic.IMusicItem,
        patch: Pick<
            Partial<IDownloadTaskInfo>,
            "downloadedSize" | "fileSize" | "jobId" | "progressText"
        >,
        attemptId: string,
    ) {
        return this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Downloading,
                ...patch,
            },
            attemptId,
        );
    }

    private markTaskAsPaused(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
    ) {
        const key = getMediaUniqueKey(musicItem);
        const currentTask = downloadTasks.get(key);
        if (
            !currentTask ||
            !isSameDownloadAttempt(currentTask, { logicalKey: key, attemptId }) ||
            (currentTask.status !== DownloadStatus.Preparing &&
                currentTask.status !== DownloadStatus.Downloading)
        ) {
            return false;
        }

        this.updateDownloadTask(
            musicItem,
            { status: DownloadStatus.Paused },
            attemptId,
        );
        this.downloadingCount = Math.max(0, this.downloadingCount - 1);
        this.downloadNextPendingTask();
        return true;
    }

    private markTaskAsFinalizing(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
        finalization: IDownloadFinalizationJournal,
    ) {
        this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Finalizing,
                finalization,
            },
            attemptId,
        );
    }

    // 开始下载
    private markTaskAsStarted(musicItem: IMusic.IMusicItem, attemptId: string) {
        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            return;
        }
        this.downloadingCount++;
        this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Preparing,
                errorReason: undefined,
                errorMessage: undefined,
                startedAt: Date.now(),
            },
            attemptId,
        );
    }

    private markTaskAsCompleted(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
    ) {
        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            return;
        }
        this.downloadingCount = Math.max(0, this.downloadingCount - 1);
        this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Completed,
                errorReason: undefined,
                errorMessage: undefined,
                completedAt: Date.now(),
                finalization: undefined,
            },
            attemptId,
        );
    }

    private markTaskAsError(
        musicItem: IMusic.IMusicItem,
        reason: DownloadFailReason,
        error: Error | undefined,
        attemptId: string,
    ) {
        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            return;
        }
        this.downloadingCount = Math.max(0, this.downloadingCount - 1);
        this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Error,
                errorReason: reason,
                errorMessage: getDownloadErrorMessage(error),
                completedAt: Date.now(),
                finalization: undefined,
            },
            attemptId,
        );
        this.emit(DownloaderEvent.DownloadTaskError, reason, musicItem, error);
    }
    private classifyDownloadError(error: any): DownloadFailReason {
        if (network.isOffline) {
            return DownloadFailReason.NetworkOffline;
        }

        const message = `${error?.message ?? error ?? ""}`.toLowerCase();
        if (
            message.includes("eacces") ||
            message.includes("permission") ||
            message.includes("no space") ||
            message.includes("enospc")
        ) {
            return DownloadFailReason.NoWritePermission;
        }

        return DownloadFailReason.Unknown;
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
                this.configService.getConfig("basic.writeMetadata") ?? true,
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
                this.configService.getConfig("basic.downloadLyricFile") ?? true,
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
        config: IDownloadMetadataConfig,
        getEnrichment: () => Promise<IDownloadEnrichment>,
    ): Promise<IWriteResult> {
        const taskMetadata: IDownloadTaskMetadata = {
            musicItem,
            filePath,
            coverUrl:
                typeof musicItem.artwork === "string"
                    ? musicItem.artwork
                    : undefined,
        };

        if (!config.enabled) {
            return "skipped-disabled";
        }
        if (!musicMetadataManager.isAvailable()) {
            const diagnostics = getMp3UtilNativeDiagnostics();
            console.warn("Mp3Util metadata writer unavailable", diagnostics);
            errorLog("元数据写入组件不可用", diagnostics);
            return "skipped-unavailable";
        }

        const enrichment = await getEnrichment();
        const success = await musicMetadataManager.writeMetadataForDownloadTask(
            taskMetadata,
            config,
            enrichment,
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
        config: IDownloadMetadataConfig,
        getEnrichment: () => Promise<IDownloadEnrichment>,
        lyricPathOverride?: string,
    ): Promise<IWriteResult> {
        if (!config.downloadLyricFile) {
            return "skipped-disabled";
        }

        const { lyricContent: lyric } = await getEnrichment();
        if (!lyric?.trim()) {
            return "skipped-no-content";
        }

        const format = config.lyricFileFormat ?? "lrc";
        const cleanFilePath = removeFileScheme(filePath);
        const lyricPath =
            lyricPathOverride ??
            cleanFilePath.replace(/\.[^/.\\]+$/, `.${format}`);
        const content =
            format === "txt" ? this.stripLyricTimestamps(lyric) : lyric;

        await writeFile(lyricPath, content, "utf8");
        return "success";
    }

    private getFinalizationSidecarPaths(targetPath: string) {
        const config = this.getMetadataConfig();
        if (!config.downloadLyricFile) {
            return [];
        }
        const format = config.lyricFileFormat ?? "lrc";
        const lyricPath = targetPath.replace(/\.[^/.\\]+$/, `.${format}`);
        return lyricPath === targetPath ? [] : [lyricPath];
    }

    private assertFinalizationCanContinue(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
    ) {
        const logicalKey = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(logicalKey);
        if (!task || !isSameDownloadAttempt(task, { logicalKey, attemptId })) {
            throw new Error("Download task removed");
        }
        if (task.finalization?.cancelRequested) {
            throw new Error("Download finalization cancelled");
        }
        return task;
    }

    private updateFinalizationJournal(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
        journal: IDownloadFinalizationJournal,
    ) {
        this.assertFinalizationCanContinue(musicItem, attemptId);
        this.updateDownloadTask(
            musicItem,
            {
                status: DownloadStatus.Finalizing,
                finalization: journal,
            },
            attemptId,
        );
        return journal;
    }

    private async settleFinalizationWrite(
        kind: "metadata" | "lyric",
        operation: () => Promise<IWriteResult>,
    ): Promise<IWriteResult> {
        try {
            return await operation();
        } catch (error) {
            errorLog(
                kind === "metadata"
                    ? "元数据写入失败，但不影响下载完成"
                    : "独立歌词文件写入失败，但不影响下载完成",
                error instanceof Error ? error.message : String(error),
            );
            return "failed";
        }
    }

    private async unlinkFinalizationPath(filePath: string) {
        try {
            if (await exists(removeFileScheme(filePath))) {
                await unlink(removeFileScheme(filePath));
            }
            return true;
        } catch (error) {
            errorLog("下载收尾回滚删除文件失败", {
                filePath,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    private async rollbackFinalization(
        musicItem: IMusic.IMusicItem,
        journal: IDownloadFinalizationJournal,
    ) {
        const targetPath = addFileScheme(journal.targetPath);
        try {
            await LocalMusicSheet.removeMusicIfLocalPath(musicItem, targetPath);
        } catch (error) {
            throw new Error(
                `Failed to persist local music rollback: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        const mediaExtraPath = getMediaExtraProperty(musicItem, "localPath");
        if (
            typeof mediaExtraPath === "string" &&
            removeFileScheme(mediaExtraPath) ===
                removeFileScheme(journal.targetPath)
        ) {
            patchMediaExtra(musicItem, {
                downloaded: false,
                localPath: undefined,
                downloadMetadataStatus: undefined,
                downloadLyricStatus: undefined,
            });
        }

        const failedPaths: string[] = [];
        for (const filePath of getDownloadFinalizationRollbackPaths(journal)) {
            if (!(await this.unlinkFinalizationPath(filePath))) {
                failedPaths.push(filePath);
            }
        }
        if (failedPaths.length) {
            throw new Error(
                `Failed to remove finalization artifacts: ${failedPaths.join(
                    ", ",
                )}`,
            );
        }
        this.releaseReservedDownloadPath(journal.targetPath);
    }

    private finishCancelledFinalization(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
    ) {
        const logicalKey = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(logicalKey);
        if (!task || !isSameDownloadAttempt(task, { logicalKey, attemptId })) {
            return;
        }
        this.downloadingCount = Math.max(0, this.downloadingCount - 1);
        downloadTasks.delete(logicalKey);
        setDownloadQueue(
            getDefaultStore()
                .get(downloadQueueAtom)
                .filter(item => !isSameMediaItem(item, musicItem)),
        );
        this.emit(DownloaderEvent.DownloadTaskListChanged);
        this.downloadNextPendingTask();
    }

    private async handleFinalizationFailure(
        musicItem: IMusic.IMusicItem,
        attemptId: string,
        journal: IDownloadFinalizationJournal,
        error: Error,
    ) {
        const logicalKey = getMediaUniqueKey(musicItem);
        const taskBeforeRollback = downloadTasks.get(logicalKey);
        const latestJournal = isSameDownloadAttempt(taskBeforeRollback, {
            logicalKey,
            attemptId,
        })
            ? taskBeforeRollback?.finalization ?? journal
            : journal;
        try {
            await this.rollbackFinalization(musicItem, latestJournal);
        } catch (rollbackError) {
            errorLog("下载收尾回滚未完成，将在下次启动时重试", {
                attemptId,
                error:
                    rollbackError instanceof Error
                        ? rollbackError.message
                        : String(rollbackError),
            });
            const pendingRollbackTask = downloadTasks.get(logicalKey);
            if (
                isSameDownloadAttempt(pendingRollbackTask, {
                    logicalKey,
                    attemptId,
                }) &&
                pendingRollbackTask?.finalization
            ) {
                this.updateDownloadTask(
                    musicItem,
                    {
                        status: DownloadStatus.Finalizing,
                        errorMessage: getDownloadErrorMessage(error),
                        finalization: {
                            ...pendingRollbackTask.finalization,
                            rollbackRequested:
                                !pendingRollbackTask.finalization
                                    .cancelRequested,
                        },
                    },
                    attemptId,
                );
            }
            return;
        }
        const currentTask = downloadTasks.get(logicalKey);
        if (!isSameDownloadAttempt(currentTask, { logicalKey, attemptId })) {
            return;
        }
        if (
            currentTask?.finalization?.cancelRequested ||
            error.message === "Download finalization cancelled"
        ) {
            this.finishCancelledFinalization(musicItem, attemptId);
            return;
        }
        this.markTaskAsError(
            musicItem,
            this.classifyDownloadError(error),
            error,
            attemptId,
        );
    }

    private async runDownloadFinalization(params: {
        musicItem: IMusic.IMusicItem;
        attemptId: string;
        journal: IDownloadFinalizationJournal;
        cencDownloadKey?: string;
    }) {
        const { musicItem, attemptId, cencDownloadKey, journal } = params;
        const targetPath = addFileScheme(journal.targetPath);
        const metadataConfig = this.getMetadataConfig();
        let enrichmentPromise: Promise<IDownloadEnrichment> | undefined;
        const getEnrichment = () => {
            if (!enrichmentPromise) {
                enrichmentPromise = musicMetadataManager.getDownloadEnrichment(
                    musicItem,
                    metadataConfig,
                    typeof musicItem.artwork === "string"
                        ? musicItem.artwork
                        : undefined,
                );
            }
            return enrichmentPromise;
        };

        await runDownloadFinalizationTransaction(journal, {
            assertCanContinue: () =>
                this.assertFinalizationCanContinue(musicItem, attemptId),
            prepareArtifact: async () => {
                if (await exists(journal.targetPath)) {
                    await unlink(journal.targetPath);
                }
                this.assertFinalizationCanContinue(musicItem, attemptId);
                if (journal.requiresDecryption) {
                    if (!cencDownloadKey) {
                        throw new Error(
                            "Encrypted finalization cannot resume without its decryption key",
                        );
                    }
                    const decrypted = await Cenc.decryptFile(
                        journal.cachePath,
                        journal.targetPath,
                        cencDownloadKey,
                    );
                    if (!decrypted) {
                        throw new Error("CENC file decryption failed");
                    }
                } else {
                    await copyFile(journal.cachePath, journal.targetPath);
                }
                this.assertFinalizationCanContinue(musicItem, attemptId);
                if (!(await this.hasDownloadArtifact(journal.targetPath))) {
                    throw new Error("Final download artifact is empty");
                }
            },
            writeMetadata: () =>
                this.settleFinalizationWrite("metadata", () =>
                    this.writeMetadataToFile(
                        musicItem,
                        targetPath,
                        metadataConfig,
                        getEnrichment,
                    ),
                ),
            writeLyric: () =>
                this.settleFinalizationWrite("lyric", () =>
                    this.writeLyricFileForDownload(
                        musicItem,
                        targetPath,
                        metadataConfig,
                        getEnrichment,
                        journal.sidecarPaths[0],
                    ),
                ),
            indexLocalMusic: async () => {
                const localMusicItem = {
                    ...musicItem,
                    [internalSerializeKey]: {
                        ...(musicItem[internalSerializeKey] ?? {}),
                        localPath: targetPath,
                    },
                };
                await LocalMusicSheet.upsertMusic(localMusicItem);
                try {
                    this.assertFinalizationCanContinue(musicItem, attemptId);
                } catch (error) {
                    await LocalMusicSheet.removeMusicIfLocalPath(
                        musicItem,
                        targetPath,
                    ).catch(() => false);
                    throw error;
                }
            },
            commitMediaExtra: async currentJournal => {
                patchMediaExtra(musicItem, {
                    downloaded: true,
                    localPath: targetPath,
                    downloadMetadataStatus:
                        currentJournal.metadataResult ?? "failed",
                    downloadLyricStatus: currentJournal.lyricResult ?? "failed",
                });
            },
            verifyFinalArtifact: async () => {
                if (!(await this.hasDownloadArtifact(journal.targetPath))) {
                    throw new Error(
                        "Final download artifact is missing or empty",
                    );
                }
            },
            persistJournal: nextJournal =>
                this.updateFinalizationJournal(
                    musicItem,
                    attemptId,
                    nextJournal,
                ),
            cleanupCache: async () => {
                await this.unlinkFinalizationPath(journal.cachePath);
            },
            releaseReservation: () =>
                this.releaseReservedDownloadPath(journal.targetPath),
            publishCompletion: () =>
                downloadNotificationManager.showCompleted(
                    attemptId,
                    musicItem,
                    targetPath,
                ),
            cancelPublishedCompletion: () =>
                downloadNotificationManager.cancelNotification(attemptId),
            removeNativeTask: async () => {
                await this.runNativeDownloadOperation(
                    () => Mp3Util.removeDownloadTask(attemptId),
                    "确认原生下载任务完成超时",
                );
            },
            completeTask: () => this.markTaskAsCompleted(musicItem, attemptId),
        });
    }

    private async recoverFinalizingTasks() {
        const tasks = Array.from(downloadTasks.values()).filter(
            task =>
                task.status === DownloadStatus.Finalizing &&
                !!task.finalization,
        );
        for (const task of tasks) {
            const journal = task.finalization!;
            this.reservedDownloadPaths.add(journal.targetPath);
            const [cacheExists, targetExists] = await Promise.all([
                this.hasDownloadArtifact(journal.cachePath),
                this.hasDownloadArtifact(journal.targetPath),
            ]);
            const decision = resolveDownloadFinalizationRecovery({
                journal,
                cacheExists,
                targetExists,
            });
            if (decision.action === "rollback") {
                try {
                    await this.rollbackFinalization(task.musicItem, journal);
                } catch (rollbackError) {
                    errorLog("启动恢复下载收尾回滚失败，将保留日志重试", {
                        attemptId: task.attemptId,
                        error:
                            rollbackError instanceof Error
                                ? rollbackError.message
                                : String(rollbackError),
                    });
                    continue;
                }
                if (decision.reason === "cancelled") {
                    this.finishCancelledFinalization(
                        task.musicItem,
                        task.attemptId,
                    );
                } else {
                    this.markTaskAsError(
                        task.musicItem,
                        DownloadFailReason.Interrupted,
                        new Error(
                            decision.reason === "failed"
                                ? "Previous finalization failed and was rolled back"
                                : "Finalization artifacts are missing",
                        ),
                        task.attemptId,
                    );
                }
                continue;
            }

            let recoveryJournal = journal;
            if (
                decision.action === "continue" &&
                decision.from !== journal.stage
            ) {
                recoveryJournal = this.updateFinalizationJournal(
                    task.musicItem,
                    task.attemptId,
                    {
                        ...journal,
                        stage: decision.from,
                        metadataResult: undefined,
                        lyricResult: undefined,
                    },
                );
            }
            try {
                await this.runDownloadFinalization({
                    musicItem: task.musicItem,
                    attemptId: task.attemptId,
                    journal: recoveryJournal,
                });
            } catch (error) {
                await this.handleFinalizationFailure(
                    task.musicItem,
                    task.attemptId,
                    recoveryJournal,
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        }
    }
    private canUseNativeDownload() {
        return (
            !!NativeDownloadEmitter && !!Mp3Util?.isNativeDownloadAvailable?.()
        );
    }

    private updateFromNativeTask(
        musicItem: IMusic.IMusicItem,
        task: INativeDownloadTaskStatus,
        attemptId: string,
    ) {
        if (
            task.taskId !== attemptId ||
            !this.isCurrentDownloadAttempt(musicItem, attemptId)
        ) {
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
            status = DownloadStatus.Finalizing;
            break;
        case "ERROR":
        case "CANCELED":
            status = DownloadStatus.Error;
            break;
        }

        this.updateDownloadTask(
            musicItem,
            {
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
            },
            attemptId,
        );
    }

    private async downloadFileWithNative(
        musicItem: IMusic.IMusicItem,
        url: string,
        destinationPath: string,
        attemptId: string,
        headers?: Record<string, string>,
    ) {
        if (!this.canUseNativeDownload()) {
            throw new Error("NativeDownload is not available");
        }

        const logicalKey = getMediaUniqueKey(musicItem);
        const identity = { logicalKey, attemptId };
        const taskId = attemptId;
        await downloadNotificationManager.prepareForDownload();
        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            throw new Error("Download task removed");
        }
        await downloadNotificationManager.showDownloadNotification(
            taskId,
            musicItem,
        );
        await this.runNativeDownloadOperation(
            () => Mp3Util.removeDownloadTask(taskId),
            "重置原生下载任务超时",
        ).catch(() => false);
        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            await downloadNotificationManager.cancelNotification(taskId);
            throw new Error("Download task removed");
        }

        return new Promise<void>((resolve, reject) => {
            let settled = false;
            let lastDownloadedBytes = -1;
            let idleTimeout: ReturnType<typeof setTimeout> | undefined;
            let statusPoll: ReturnType<typeof setInterval> | undefined;
            let progressSubscription: {remove: () => void} | undefined;
            let statusSubscription: {remove: () => void} | undefined;
            const cleanup = () => {
                if (idleTimeout) {
                    clearTimeout(idleTimeout);
                    idleTimeout = undefined;
                }
                if (statusPoll) {
                    clearInterval(statusPoll);
                    statusPoll = undefined;
                }
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
            const abortNativeTask = () => {
                void Mp3Util.cancelDownloadTask(taskId).catch(() => {});
                void Mp3Util.removeDownloadTask(taskId).catch(() => {});
                void downloadNotificationManager.cancelNotification(taskId);
            };
            const rejectAsRemoved = () => {
                abortNativeTask();
                settle(() => reject(new Error("Download task removed")));
            };
            const resetIdleTimeout = () => {
                if (idleTimeout) {
                    clearTimeout(idleTimeout);
                }
                idleTimeout = setTimeout(() => {
                    abortNativeTask();
                    settle(() =>
                        reject(
                            new Error(
                                `Native download timed out after ${Math.round(
                                    NATIVE_DOWNLOAD_IDLE_TIMEOUT_MS / 1000,
                                )}s without activity`,
                            ),
                        ),
                    );
                }, NATIVE_DOWNLOAD_IDLE_TIMEOUT_MS);
            };
            const noteByteProgress = (downloaded?: number) => {
                if (
                    typeof downloaded === "number" &&
                    Number.isFinite(downloaded) &&
                    downloaded > lastDownloadedBytes
                ) {
                    lastDownloadedBytes = downloaded;
                    resetIdleTimeout();
                }
            };
            const rejectAsPaused = () => {
                settle(() => reject(new Error(NATIVE_DOWNLOAD_PAUSED_ERROR)));
            };
            const getCurrentTask = () => {
                const currentTask = downloadTasks.get(logicalKey);
                return isSameDownloadAttempt(currentTask, identity)
                    ? currentTask
                    : undefined;
            };
            const isCurrentTaskPaused = () =>
                getCurrentTask()?.status === DownloadStatus.Paused;
            const handleNativeStatus = (task: INativeDownloadTaskStatus) => {
                if (task.taskId !== taskId) {
                    return;
                }
                if (!getCurrentTask()) {
                    rejectAsRemoved();
                    return;
                }
                if (
                    task.status === "PAUSED" ||
                    (task.status === "CANCELED" && isCurrentTaskPaused())
                ) {
                    this.markTaskAsPaused(musicItem, attemptId);
                    rejectAsPaused();
                    return;
                }

                noteByteProgress(task.downloaded);
                this.updateFromNativeTask(musicItem, task, attemptId);
                if (task.status === "COMPLETED") {
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
                                task.error || `Native download ${task.status}`,
                            ),
                        ),
                    );
                }
            };
            const pollNativeStatus = () => {
                if (settled) {
                    return;
                }
                if (!getCurrentTask()) {
                    rejectAsRemoved();
                    return;
                }
                this.runNativeDownloadOperation(
                    () => Mp3Util.getDownloadTaskStatus(taskId),
                    "轮询原生下载状态超时",
                )
                    .then(task => {
                        if (settled) {
                            return;
                        }
                        if (!getCurrentTask()) {
                            rejectAsRemoved();
                            return;
                        }
                        if (!task) {
                            if (isCurrentTaskPaused()) {
                                rejectAsPaused();
                                return;
                            }
                            this.hasDownloadArtifact(destinationPath)
                                .then(hasArtifact => {
                                    if (settled) {
                                        return;
                                    }
                                    if (!getCurrentTask()) {
                                        rejectAsRemoved();
                                        return;
                                    }
                                    if (hasArtifact) {
                                        settle(resolve);
                                    } else {
                                        settle(() =>
                                            reject(
                                                new Error(
                                                    "Native download task disappeared",
                                                ),
                                            ),
                                        );
                                    }
                                })
                                .catch(() => {
                                    settle(() =>
                                        reject(
                                            new Error(
                                                "Native download task disappeared",
                                            ),
                                        ),
                                    );
                                });
                            return;
                        }
                        handleNativeStatus(task);
                    })
                    .catch(() => {
                        // Keep the idle watchdog as the final failure boundary.
                    });
            };

            resetIdleTimeout();
            statusPoll = setInterval(
                pollNativeStatus,
                NATIVE_DOWNLOAD_STATUS_POLL_MS,
            );

            progressSubscription = NativeDownloadEmitter!.addListener(
                "NativeDownloadProgressBatch",
                (event: any) => {
                    const items = Array.isArray(event?.items)
                        ? event.items
                        : [];
                    const progress = items.find(
                        (item: any) => item?.taskId === taskId,
                    );
                    if (!progress || !getCurrentTask()) {
                        return;
                    }
                    const downloaded =
                        typeof progress.downloaded === "number"
                            ? progress.downloaded
                            : undefined;
                    noteByteProgress(downloaded);
                    this.updateDownloadTaskProgress(
                        musicItem,
                        {
                            downloadedSize: downloaded,
                            fileSize:
                                typeof progress.total === "number" &&
                                progress.total > 0
                                    ? progress.total
                                    : undefined,
                            progressText:
                                typeof progress.progressText === "string"
                                    ? progress.progressText
                                    : undefined,
                        },
                        attemptId,
                    );
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
                    handleNativeStatus(task);
                },
            );

            this.runNativeDownloadOperation(
                () =>
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
                        extraJson: safeStringify(identity),
                    }),
                "创建原生下载任务超时",
            )
                .then(added => {
                    if (!added) {
                        settle(() =>
                            reject(new Error("Native download task rejected")),
                        );
                        return;
                    }
                    if (!getCurrentTask()) {
                        rejectAsRemoved();
                    }
                })
                .catch(error => {
                    abortNativeTask();
                    settle(() => reject(error));
                });
        });
    }
    private stopJsDownloadIfNeeded(task: IDownloadTaskInfo) {
        if (this.canUseNativeDownload() || typeof task.jobId !== "number") {
            return;
        }

        try {
            stopDownload(task.jobId);
        } catch {}
    }

    private async downloadNextPendingTask() {
        const maxDownloadCount = this.getMaxDownloadCount();
        void this.syncNativeMaxConcurrency(maxDownloadCount);
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
        const attemptId = nextTask.attemptId;
        let taskQuality = nextTask.quality;
        let taskFilename = nextTask.filename;
        // 更新下载状态
        this.markTaskAsStarted(musicItem, attemptId);

        let url = musicItem.url;
        let headers = createDownloadHeaders(
            (musicItem as any).headers,
            (musicItem as any).userAgent,
        );
        let ekey: string | undefined = musicItem.ekey;
        let cek: string | undefined = musicItem.cek;
        let foundEncryptedSource = false;
        let resolvedQuality = taskQuality;

        const plugin = this.pluginManagerService.getByName(musicItem.platform);

        try {
            if (plugin) {
                const qualityOrder = getQualityOrder(
                    taskQuality ??
                        this.configService.getConfig(
                            "basic.defaultDownloadQuality",
                        ) ??
                        "standard",
                    this.configService.getConfig(
                        "basic.downloadQualityOrder",
                    ) ?? "asc",
                );
                let data: IPlugin.IMediaSourceResult | null = null;
                const sourceResolutionDeadline =
                    Date.now() + DOWNLOAD_SOURCE_RESOLUTION_TIMEOUT_MS;
                for (let quality of qualityOrder) {
                    const remainingSourceResolutionMs =
                        sourceResolutionDeadline - Date.now();
                    if (remainingSourceResolutionMs <= 0) {
                        break;
                    }
                    try {
                        data = await withTimeout(
                            Promise.resolve().then(() =>
                                plugin.methods.getMediaSource(
                                    musicItem,
                                    quality,
                                    1,
                                    true,
                                ),
                            ),
                            Math.min(
                                remainingSourceResolutionMs,
                                DOWNLOAD_SOURCE_PLUGIN_CALL_TIMEOUT_MS,
                            ),
                            "获取下载媒体源超时",
                        );
                        if (!data?.url) {
                            continue;
                        }
                        if (
                            hasEncryptedMediaSource(data.url, data.ekey) &&
                            !canProxyCencSource(data)
                        ) {
                            foundEncryptedSource = true;
                            data = null;
                            continue;
                        }
                        resolvedQuality = data.quality ?? quality;
                        break;
                    } catch {}
                }
                if (!data?.url && foundEncryptedSource) {
                    throw new Error(
                        DownloadFailReason.EncryptedMediaUnsupported,
                    );
                }
                url = data?.url ?? url;
                if (data?.url) {
                    headers = createDownloadHeaders(
                        data.headers,
                        data.userAgent ?? (musicItem as any).userAgent,
                    );
                }
                ekey = data?.ekey;
                cek = data?.cek;
            }
            if (!url) {
                throw new Error(
                    foundEncryptedSource
                        ? DownloadFailReason.EncryptedMediaUnsupported
                        : DownloadFailReason.FailToFetchSource,
                );
            }
            const cencDownloadKey = canProxyCencSource({ url, cek })
                ? getPlayableCencKey({ url, cek })
                : undefined;
            if (hasEncryptedMediaSource(url, ekey) && !cencDownloadKey) {
                const error = new Error(
                    cek
                        ? `${DownloadFailReason.EncryptedMediaUnsupported}: CENC key present but native decrypt proxy is not available`
                        : DownloadFailReason.EncryptedMediaUnsupported,
                );
                throw error;
            }
            if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
                return;
            }
            if (resolvedQuality && resolvedQuality !== taskQuality) {
                taskQuality = resolvedQuality;
                taskFilename = this.generateFilename(
                    musicItem,
                    resolvedQuality,
                );
                this.updateDownloadTask(
                    musicItem,
                    {
                        quality: resolvedQuality,
                        filename: taskFilename,
                    },
                    attemptId,
                );
            }
        } catch (e: any) {
            /** 无法下载，跳过 */
            errorLog("下载失败-无法获取下载链接", {
                item: {
                    id: musicItem.id,
                    title: musicItem.title,
                    platform: musicItem.platform,
                    quality: taskQuality,
                },
                reason: e?.message ?? e,
            });

            if (e.message === DownloadFailReason.FailToFetchSource) {
                this.markTaskAsError(
                    musicItem,
                    DownloadFailReason.FailToFetchSource,
                    e,
                    attemptId,
                );
            } else if (
                `${e.message ?? e}`.startsWith(
                    DownloadFailReason.EncryptedMediaUnsupported,
                )
            ) {
                this.markTaskAsError(
                    musicItem,
                    DownloadFailReason.EncryptedMediaUnsupported,
                    e,
                    attemptId,
                );
            } else {
                this.markTaskAsError(
                    musicItem,
                    this.classifyDownloadError(e),
                    e,
                    attemptId,
                );
            }
            this.downloadNextPendingTask();
            return;
        }

        if (!this.isCurrentDownloadAttempt(musicItem, attemptId)) {
            return;
        }

        // 预处理完成，可以开始处理下一个任务
        this.downloadNextPendingTask();

        // 下载逻辑
        // 识别文件后缀
        const cencDownloadKey = canProxyCencSource({ url, cek })
            ? getPlayableCencKey({ url, cek })
            : undefined;
        let extension = cencDownloadKey
            ? "m4a"
            : this.getExtensionName(url).toLowerCase();
        if (
            !cencDownloadKey &&
            supportLocalMediaType.every(item => item !== "." + extension)
        ) {
            extension = "mp3";
        }
        const cacheExtension = cencDownloadKey ? "cenc" : extension;

        // 缓存下载地址
        const rawCacheDownloadPath = this.getCacheDownloadPath(
            `${nanoid()}.${cacheExtension}`,
        );

        // 真实下载地址
        const rawTargetDownloadPath = await this.getAvailableDownloadPath(
            `${taskFilename}.${extension}`,
        );

        // 检测下载位置是否存在
        try {
            const folder = path.dirname(rawTargetDownloadPath);
            const folderExists = await exists(folder);
            if (!folderExists) {
                await mkdirR(folder);
            }
        } catch (e: any) {
            this.releaseReservedDownloadPath(rawTargetDownloadPath);
            this.markTaskAsError(
                musicItem,
                DownloadFailReason.NoWritePermission,
                e,
                attemptId,
            );
            this.downloadNextPendingTask();
            return;
        }

        let downloadSucceeded = false;
        let finalizationJournal: IDownloadFinalizationJournal | undefined;
        try {
            if (this.canUseNativeDownload()) {
                await this.downloadFileWithNative(
                    musicItem,
                    url,
                    rawCacheDownloadPath,
                    attemptId,
                    headers,
                );
            } else {
                const { promise } = downloadFile({
                    fromUrl: url ?? "",
                    toFile: rawCacheDownloadPath,
                    headers: headers,
                    background: true,
                    begin: res => {
                        this.updateDownloadTaskProgress(
                            musicItem,
                            {
                                downloadedSize: 0,
                                fileSize: res.contentLength,
                                jobId: res.jobId,
                            },
                            attemptId,
                        );
                    },
                    progress: res => {
                        this.updateDownloadTaskProgress(
                            musicItem,
                            {
                                downloadedSize: res.bytesWritten,
                                fileSize: res.contentLength,
                                jobId: res.jobId,
                            },
                            attemptId,
                        );
                    },
                });
                await promise;
            }

            this.assertFinalizationCanContinue(musicItem, attemptId);
            finalizationJournal = {
                stage: "prepared",
                cachePath: rawCacheDownloadPath,
                targetPath: rawTargetDownloadPath,
                sidecarPaths: this.getFinalizationSidecarPaths(
                    rawTargetDownloadPath,
                ),
                requiresDecryption: !!cencDownloadKey,
            };
            this.markTaskAsFinalizing(
                musicItem,
                attemptId,
                finalizationJournal,
            );
            await this.runDownloadFinalization({
                musicItem,
                attemptId,
                journal: finalizationJournal,
                cencDownloadKey,
            });
            downloadSucceeded = true;
        } catch (error) {
            const normalizedError =
                error instanceof Error ? error : new Error(String(error));
            if (finalizationJournal) {
                await this.handleFinalizationFailure(
                    musicItem,
                    attemptId,
                    finalizationJournal,
                    normalizedError,
                );
            } else {
                const currentTask = downloadTasks.get(
                    getMediaUniqueKey(musicItem),
                );
                if (
                    isSameDownloadAttempt(currentTask, {
                        logicalKey: getMediaUniqueKey(musicItem),
                        attemptId,
                    }) &&
                    currentTask?.status !== DownloadStatus.Paused &&
                    !isNativeDownloadPausedError(normalizedError)
                ) {
                    this.markTaskAsError(
                        musicItem,
                        this.classifyDownloadError(normalizedError),
                        normalizedError,
                        attemptId,
                    );
                }
            }
        }

        if (!finalizationJournal) {
            await this.unlinkFinalizationPath(rawCacheDownloadPath);
            if (!downloadSucceeded) {
                await this.unlinkFinalizationPath(rawTargetDownloadPath);
            }
            this.releaseReservedDownloadPath(rawTargetDownloadPath);
        }
        this.downloadNextPendingTask();
    }

    isNativeDownloadControlAvailable() {
        return this.canUseNativeDownload();
    }

    getDownloadDiagnosticSnapshot(): IDownloadDiagnosticSnapshot {
        const queue = getDefaultStore().get(downloadQueueAtom);
        const counts: Record<string, number> = {};
        const tasks = Array.from(downloadTasks.entries()).map(([key, task]) => {
            const status = getDownloadStatusName(task.status);
            counts[status] = (counts[status] ?? 0) + 1;
            return {
                key,
                status,
                title: task.musicItem.title,
                artist: task.musicItem.artist,
                platform: task.musicItem.platform,
                id: task.musicItem.id,
                filename: task.filename,
                quality: task.quality,
                downloadedSize: task.downloadedSize,
                fileSize: task.fileSize,
                progressText: task.progressText,
                errorReason: task.errorReason,
                errorMessage: task.errorMessage,
                startedAt: task.startedAt,
                completedAt: task.completedAt,
            };
        });

        return {
            nativeDownloadAvailable: this.canUseNativeDownload(),
            downloadingCount: this.downloadingCount,
            queueLength: queue.length,
            counts,
            tasks,
        };
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

        const paused = await this.runNativeDownloadOperation(
            () => Mp3Util.pauseDownloadTask(task.attemptId),
            "暂停原生下载任务超时",
        ).catch(() => false);
        if (paused && this.isCurrentDownloadAttempt(musicItem, task.attemptId)) {
            this.markTaskAsPaused(musicItem, task.attemptId);
            void this.runNativeDownloadOperation(
                () => Mp3Util.removeDownloadTask(task.attemptId),
                "清理已暂停原生下载任务超时",
            ).catch(() => false);
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

        await this.runNativeDownloadOperation(
            () => Mp3Util.removeDownloadTask(task.attemptId),
            "恢复前清理原生下载任务超时",
        ).catch(() => false);
        await downloadNotificationManager.cancelNotification(task.attemptId);
        if (!this.isCurrentDownloadAttempt(musicItem, task.attemptId)) {
            return false;
        }
        const nextIdentity = createDownloadAttemptIdentity(key, nanoid);
        this.updateDownloadTask(
            musicItem,
            {
                ...nextIdentity,
                status: DownloadStatus.Pending,
                downloadedSize: undefined,
                fileSize: undefined,
                progressText: undefined,
                jobId: undefined,
            },
            task.attemptId,
        );
        this.downloadNextPendingTask();
        return true;
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

    /**
     * 重新下载：用于已完成但本地文件丢失（或需要覆盖）的任务。
     * 已完成的歌会被 filterQueueableDownloadItems 的本地去重跳过，
     * 因此先移除本地记录再重新入队。
     */
    async redownload(
        musicItem: IMusic.IMusicItem,
        quality?: IMusic.IQualityKey,
    ) {
        if (!this.canStartDownload()) {
            return false;
        }
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (
            task &&
            task.status !== DownloadStatus.Completed &&
            task.status !== DownloadStatus.Error
        ) {
            return false;
        }

        const resolvedQuality = quality ?? task?.quality;
        const previousQueue = getDefaultStore().get(downloadQueueAtom);
        const previousLocalMusicItem = LocalMusicSheet.getMusicList().find(item =>
            isSameMediaItem(item, musicItem),
        );
        const previousMediaExtra = getMediaExtra(musicItem);

        await LocalMusicSheet.removeMusic(musicItem);
        try {
            patchMediaExtra(musicItem, {
                downloaded: false,
                localPath: undefined,
            });
        } catch (error) {
            if (previousLocalMusicItem) {
                await LocalMusicSheet.upsertMusic(previousLocalMusicItem).catch(
                    restoreError => {
                        errorLog("恢复重下载前的本地音乐记录失败", restoreError);
                    },
                );
            }
            throw error;
        }

        let nextTask: IDownloadTaskInfo | undefined;
        try {
            nextTask = {
                ...createDownloadAttemptIdentity(key, nanoid),
                status: DownloadStatus.Pending,
                filename: this.generateFilename(musicItem, resolvedQuality),
                quality: resolvedQuality,
                musicItem,
            };
            downloadTasks.set(key, nextTask);
            setDownloadQueue([
                ...previousQueue.filter(
                    item => !isSameMediaItem(item, musicItem),
                ),
                musicItem,
            ]);
        } catch (error) {
            if (task) {
                downloadTasks.set(key, task);
            } else {
                downloadTasks.delete(key);
            }
            getDefaultStore().set(downloadQueueAtom, previousQueue);
            if (previousLocalMusicItem) {
                await LocalMusicSheet.upsertMusic(previousLocalMusicItem).catch(
                    restoreError => {
                        errorLog("恢复重下载前的本地音乐记录失败", restoreError);
                    },
                );
            }
            try {
                if (previousMediaExtra) {
                    setMediaExtra(musicItem, previousMediaExtra);
                } else {
                    removeMediaExtra(musicItem);
                }
            } catch (restoreError) {
                errorLog("恢复重下载前的媒体附加信息失败", restoreError);
            }
            throw error;
        }

        if (task) {
            void this.runNativeDownloadOperation(
                () => Mp3Util.removeDownloadTask(task.attemptId),
                "重下载前清理原生下载任务超时",
            ).catch(() => false);
            void downloadNotificationManager.cancelNotification(task.attemptId);
        }
        if (nextTask) {
            this.emit(DownloaderEvent.DownloadTaskUpdate, nextTask);
        }
        this.emit(DownloaderEvent.DownloadTaskListChanged);
        this.downloadNextPendingTask();
        return true;
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

        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const nextTask: IDownloadTaskInfo = {
            ...task,
            ...createDownloadAttemptIdentity(key, nanoid),
            status: DownloadStatus.Pending,
            downloadedSize: undefined,
            fileSize: undefined,
            progressText: undefined,
            jobId: undefined,
            errorReason: undefined,
            errorMessage: undefined,
            startedAt: undefined,
            completedAt: undefined,
            finalization: undefined,
        };

        try {
            downloadTasks.set(key, nextTask);
            setDownloadQueue([
                ...downloadQueue.filter(
                    item => !isSameMediaItem(item, musicItem),
                ),
                musicItem,
            ]);
        } catch (error) {
            downloadTasks.set(key, task);
            getDefaultStore().set(downloadQueueAtom, downloadQueue);
            errorLog("持久化重试下载任务失败", error);
            return false;
        }

        void this.runNativeDownloadOperation(
            () => Mp3Util.removeDownloadTask(task.attemptId),
            "重试前清理原生下载任务超时",
        ).catch(() => false);
        void downloadNotificationManager.cancelNotification(task.attemptId);
        this.emit(DownloaderEvent.DownloadTaskUpdate, nextTask);
        this.emit(DownloaderEvent.DownloadTaskListChanged);
        this.downloadNextPendingTask();
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
        musicItems = filterQueueableDownloadItems(musicItems, {
            activeTaskKeys: new Set(downloadTasks.keys()),
            localMusicItems: LocalMusicSheet.getMusicList(),
            getKey: getMediaUniqueKey,
        });
        musicItems.forEach(m => {
            const key = getMediaUniqueKey(m);

            // 设置下载任务
            downloadTasks.set(key, {
                ...createDownloadAttemptIdentity(key, nanoid),
                status: DownloadStatus.Pending,
                filename: this.generateFilename(m, quality),
                quality: quality,
                musicItem: m,
            });
        });

        if (!musicItems.length) {
            return;
        }

        // 添加进任务队列
        const downloadQueue = getDefaultStore().get(downloadQueueAtom);
        const newDownloadQueue = [...downloadQueue, ...musicItems];
        setDownloadQueue(newDownloadQueue);
        musicItems.forEach(musicItem => {
            const task = downloadTasks.get(getMediaUniqueKey(musicItem));
            if (task) {
                this.emit(DownloaderEvent.DownloadTaskUpdate, task);
            }
        });
        this.emit(DownloaderEvent.DownloadTaskListChanged);

        this.downloadNextPendingTask();
    }

    remove(musicItem: IMusic.IMusicItem) {
        const key = getMediaUniqueKey(musicItem);
        const task = downloadTasks.get(key);
        if (!task) {
            return false;
        }
        if (
            task.status === DownloadStatus.Pending ||
            task.status === DownloadStatus.Error
        ) {
            void Mp3Util.removeDownloadTask(task.attemptId).catch(() => {});
            void downloadNotificationManager.cancelNotification(task.attemptId);
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            setDownloadQueue(
                downloadQueue.filter(item => !isSameMediaItem(item, musicItem)),
            );
            return true;
        }
        if (task.status === DownloadStatus.Finalizing && task.finalization) {
            this.updateDownloadTask(
                musicItem,
                {
                    finalization: {
                        ...task.finalization,
                        cancelRequested: true,
                    },
                },
                task.attemptId,
            );
            void Mp3Util.cancelDownloadTask(task.attemptId).catch(() => {});
            void Mp3Util.removeDownloadTask(task.attemptId).catch(() => {});
            void downloadNotificationManager.cancelNotification(task.attemptId);
            return true;
        }
        if (
            task.status === DownloadStatus.Preparing ||
            task.status === DownloadStatus.Downloading ||
            task.status === DownloadStatus.Paused ||
            (task.status === DownloadStatus.Finalizing && !task.finalization)
        ) {
            this.stopJsDownloadIfNeeded(task);
            void Mp3Util.cancelDownloadTask(task.attemptId).catch(() => {});
            void Mp3Util.removeDownloadTask(task.attemptId).catch(() => {});
            void downloadNotificationManager.cancelNotification(task.attemptId);
            if (task.status !== DownloadStatus.Paused) {
                this.downloadingCount = Math.max(
                    0,
                    this.downloadingCount - 1,
                );
            }
            downloadTasks.delete(key);
            const downloadQueue = getDefaultStore().get(downloadQueueAtom);
            setDownloadQueue(
                downloadQueue.filter(item => !isSameMediaItem(item, musicItem)),
            );
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
            const task = downloadTasks.get(key);
            if (task) {
                void Mp3Util.removeDownloadTask(task.attemptId).catch(() => {});
                void downloadNotificationManager.cancelNotification(
                    task.attemptId,
                );
            }
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
        // 列表复用单元格时 musicItem 会变化，必须同步重置，否则短暂显示上一首的状态
        setDownloadStatus(
            downloadTasks.get(getMediaUniqueKey(musicItem)) ?? null,
        );
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
        let updateTimer: ReturnType<typeof setTimeout> | undefined;
        const update = () => {
            setVersion(prev => prev + 1);
        };
        const scheduleUpdate = () => {
            if (updateTimer) {
                return;
            }
            updateTimer = setTimeout(() => {
                updateTimer = undefined;
                update();
            }, DOWNLOAD_TASK_SNAPSHOT_THROTTLE_MS);
        };
        downloader.on(DownloaderEvent.DownloadTaskUpdate, scheduleUpdate);
        downloader.on(DownloaderEvent.DownloadQueueCompleted, update);
        downloader.on(DownloaderEvent.DownloadTaskListChanged, update);

        return () => {
            if (updateTimer) {
                clearTimeout(updateTimer);
            }
            downloader.off(DownloaderEvent.DownloadTaskUpdate, scheduleUpdate);
            downloader.off(DownloaderEvent.DownloadQueueCompleted, update);
            downloader.off(DownloaderEvent.DownloadTaskListChanged, update);
        };
    }, []);

    return useMemo(() => new Map(downloadTasks), [version]);
}

export const useDownloadQueue = () => useAtomValue(downloadQueueAtom);
