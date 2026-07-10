import notificationPermissionManager from "@/core/notificationPermissionManager";
import Mp3Util from "@/native/mp3Util";
import { devLog } from "@/utils/log";
import { withTimeout } from "@/utils/promiseTimeout";

const DEFAULT_NATIVE_NOTIFICATION_TIMEOUT_MS = 5000;

interface INotificationTask {
    taskId: string;
    musicItem: IMusic.IMusicItem;
    notificationId: string;
    lastUpdateTime: number;
    lastDownloadedSize: number;
}

export class DownloadNotificationManager {
    private isInitialized = false;
    private hasPromptedForDownload = false;
    private activeTasks = new Map<string, INotificationTask>();

    constructor(
        private readonly nativeOperationTimeoutMs = DEFAULT_NATIVE_NOTIFICATION_TIMEOUT_MS,
    ) {}

    private async runNativeOperation<T>(
        operation: () => PromiseLike<T>,
        timeoutMessage: string,
    ) {
        return withTimeout(
            Promise.resolve().then(operation),
            this.nativeOperationTimeoutMs,
            timeoutMessage,
        ).catch(() => false);
    }

    async initialize(): Promise<void> {
        notificationPermissionManager.setup();
        await notificationPermissionManager.silentRequestPermission();
        this.isInitialized = true;
    }

    async prepareForDownload(): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const hasPermission =
            await notificationPermissionManager.checkPermission();
        if (hasPermission) {
            return true;
        }

        if (this.hasPromptedForDownload) {
            return false;
        }

        this.hasPromptedForDownload = true;
        return notificationPermissionManager.requestPermission(true);
    }

    async showDownloadNotification(
        taskId: string,
        musicItem: IMusic.IMusicItem,
    ): Promise<void> {
        this.activeTasks.set(taskId, {
            taskId,
            musicItem,
            notificationId: taskId,
            lastUpdateTime: Date.now(),
            lastDownloadedSize: 0,
        });
    }

    async updateProgress(
        taskId: string,
        progress: IDownloadNotification.DownloadProgress,
    ): Promise<void> {
        const task = this.activeTasks.get(taskId);
        if (!task) {
            return;
        }
        task.lastUpdateTime = Date.now();
        task.lastDownloadedSize = progress.downloadedSize;
    }

    async showCompleted(
        taskId: string,
        musicItem: IMusic.IMusicItem,
        filePath: string,
    ): Promise<void> {
        this.activeTasks.delete(taskId);
        await this.runNativeOperation(
            () =>
                Mp3Util.publishDownloadCompleted(
                    taskId,
                    musicItem.title || "MusicFree",
                    filePath,
                ),
            "发布下载完成通知超时",
        );
    }

    async showError(taskId: string, error: string): Promise<void> {
        this.activeTasks.delete(taskId);
        devLog("info", "下载通知错误状态", { taskId, error });
    }

    async cancelNotification(taskId: string): Promise<void> {
        this.activeTasks.delete(taskId);
        await this.runNativeOperation(
            () =>
                Mp3Util.cancelDownloadNotification?.(taskId) ??
                Promise.resolve(false),
            "撤销下载通知超时",
        );
    }

    async clearAllNotifications(): Promise<void> {
        this.activeTasks.clear();
        await this.runNativeOperation(
            () =>
                Mp3Util.clearDownloadNotifications?.() ??
                Promise.resolve(false),
            "清理下载通知超时",
        );
    }

    async refreshNativeNotifications(): Promise<void> {
        await notificationPermissionManager.resetPermissionState();
        if (await notificationPermissionManager.checkPermission()) {
            await Mp3Util.refreshDownloadNotifications?.().catch(() => false);
        }
    }

    getActiveTaskCount(): number {
        return this.activeTasks.size;
    }

    async requestNotificationPermission(): Promise<boolean> {
        return notificationPermissionManager.requestPermission(true);
    }

    async checkNotificationPermission(): Promise<boolean> {
        return notificationPermissionManager.checkPermission();
    }

    async getPermissionStatusDescription(): Promise<string> {
        return notificationPermissionManager.getPermissionStatusDescription();
    }

    async openNotificationSettings(): Promise<void> {
        await notificationPermissionManager.openSettings();
    }
}

const downloadNotificationManager = new DownloadNotificationManager();
export default downloadNotificationManager;
