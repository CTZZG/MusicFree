import {NativeEventEmitter, NativeModules} from 'react-native';

export interface IBasicMeta {
    album?: string;
    artist?: string;
    author?: string;
    duration?: string;
    title?: string;
}

export interface IWritableMeta extends IBasicMeta {
    lyric?: string;
    comment?: string;
}

interface IMp3Util {
    getBasicMeta: (fileName: string) => Promise<IBasicMeta>;
    getMediaMeta: (fileNames: string[]) => Promise<IBasicMeta[]>;
    getMediaCoverImg: (mediaPath: string) => Promise<string>;
    /** 读取内嵌歌词 */
    getLyric: (mediaPath: string) => Promise<string>;
    /** 写入meta信息 */
    setMediaTag: (filePath: string, meta: IWritableMeta) => Promise<void>;
    getMediaTag: (filePath: string) => Promise<IWritableMeta>;
}

export interface INativeDownloadTaskStatus {
    taskId: string;
    status:
        | 'PENDING'
        | 'PREPARING'
        | 'DOWNLOADING'
        | 'PAUSED'
        | 'COMPLETED'
        | 'CANCELED'
        | 'ERROR';
    downloaded: number;
    total: number;
    progressText?: string;
    error?: string | null;
    url?: string;
    destinationPath?: string;
    title?: string;
    description?: string;
    coverUrl?: string | null;
    extraJson?: string | null;
    createdAt?: number;
    updatedAt?: number;
}

export interface INativeDownloadTaskParams {
    taskId: string;
    url: string;
    destinationPath: string;
    headers?: Record<string, string>;
    title?: string;
    description?: string;
    coverUrl?: string | null;
    extraJson?: string | null;
}

export interface INativeDownloadProgressItem {
    taskId: string;
    downloaded: number;
    total: number;
    percent: number;
    progressText: string;
}

interface INativeDownloadMethods {
    isNativeDownloadAvailable: () => boolean;
    addDownloadTask: (params: INativeDownloadTaskParams) => Promise<boolean>;
    pauseDownloadTask: (taskId: string) => Promise<boolean>;
    resumeDownloadTask: (taskId: string) => Promise<boolean>;
    cancelDownloadTask: (taskId: string) => Promise<boolean>;
    removeDownloadTask: (taskId: string) => Promise<boolean>;
    getDownloadTaskStatus: (
        taskId: string,
    ) => Promise<INativeDownloadTaskStatus | null>;
    getAllDownloadTasks: () => Promise<INativeDownloadTaskStatus[]>;
    setDownloadMaxConcurrency: (max: number) => Promise<boolean>;
}

const {Mp3Util: NativeMp3Util, NativeDownload: NativeDownloadModule} =
    NativeModules;

export const NativeDownloadEmitter = NativeDownloadModule
    ? new NativeEventEmitter(NativeDownloadModule)
    : null;

const NativeDownloadBridge: INativeDownloadMethods = {
    isNativeDownloadAvailable() {
        return !!NativeDownloadModule?.addDownloadTask;
    },

    async addDownloadTask(params) {
        if (!NativeDownloadModule?.addDownloadTask) {
            throw new Error('NativeDownload.addDownloadTask not available');
        }
        return NativeDownloadModule.addDownloadTask({
            taskId: params.taskId,
            url: params.url,
            destinationPath: params.destinationPath,
            headers: params.headers ?? {},
            title: params.title ?? 'MusicFree',
            description: params.description ?? '正在下载音乐文件...',
            coverUrl: params.coverUrl ?? null,
            extraJson: params.extraJson ?? null,
        });
    },

    async pauseDownloadTask(taskId) {
        if (!NativeDownloadModule?.pauseDownloadTask) {
            return false;
        }
        return NativeDownloadModule.pauseDownloadTask(taskId);
    },

    async resumeDownloadTask(taskId) {
        if (!NativeDownloadModule?.resumeDownloadTask) {
            return false;
        }
        return NativeDownloadModule.resumeDownloadTask(taskId);
    },

    async cancelDownloadTask(taskId) {
        if (!NativeDownloadModule?.cancelDownloadTask) {
            return false;
        }
        return NativeDownloadModule.cancelDownloadTask(taskId);
    },

    async removeDownloadTask(taskId) {
        if (!NativeDownloadModule?.removeDownloadTask) {
            return false;
        }
        return NativeDownloadModule.removeDownloadTask(taskId);
    },

    async getDownloadTaskStatus(taskId) {
        if (!NativeDownloadModule?.getDownloadTaskStatus) {
            return null;
        }
        return NativeDownloadModule.getDownloadTaskStatus(taskId);
    },

    async getAllDownloadTasks() {
        if (!NativeDownloadModule?.getAllDownloadTasks) {
            return [];
        }
        return NativeDownloadModule.getAllDownloadTasks();
    },

    async setDownloadMaxConcurrency(max) {
        if (!NativeDownloadModule?.setDownloadMaxConcurrency) {
            return false;
        }
        return NativeDownloadModule.setDownloadMaxConcurrency(max);
    },
};

const Mp3Util = Object.assign({}, NativeMp3Util ?? {}, NativeDownloadBridge);

export default Mp3Util as IMp3Util & INativeDownloadMethods;
