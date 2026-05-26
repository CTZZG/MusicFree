declare namespace IDownloadNotification {
    interface DownloadProgress {
        downloadedSize: number;
        fileSize: number;
        progress: number;
        speed?: number;
    }

    interface IDownloadNotificationManager {
        initialize(): Promise<void>;
        showDownloadNotification(
            taskId: string,
            musicItem: IMusic.IMusicItem,
        ): Promise<void>;
        updateProgress(
            taskId: string,
            progress: DownloadProgress,
        ): Promise<void>;
        showCompleted(
            taskId: string,
            musicItem: IMusic.IMusicItem,
            filePath: string,
        ): Promise<void>;
        showError(taskId: string, error: string): Promise<void>;
        cancelNotification(taskId: string): Promise<void>;
    }
}
