import { NativeEventEmitter, NativeModules } from "react-native";

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
    albumArtist?: string;
    composer?: string;
    year?: string;
    genre?: string;
    trackNumber?: string;
    totalTracks?: string;
    discNumber?: string;
    totalDiscs?: string;
    isrc?: string;
    language?: string;
    encoder?: string;
    bpm?: string;
    mood?: string;
    rating?: string;
    publisher?: string;
    originalArtist?: string;
    originalAlbum?: string;
    originalYear?: string;
    url?: string;
    compilation?: boolean;
}

interface IMp3Util {
    getBasicMeta: (fileName: string) => Promise<IBasicMeta>;
    getMediaMeta: (fileNames: string[]) => Promise<IBasicMeta[]>;
    getMediaCoverImg: (mediaPath: string) => Promise<string | null>;
    /** 读取内嵌歌词 */
    getLyric: (mediaPath: string) => Promise<string>;
    /** 写入meta信息 */
    setMediaTag: (filePath: string, meta: IWritableMeta) => Promise<boolean>;
    setMediaCover?: (filePath: string, coverPath: string) => Promise<boolean>;
    setMediaTagWithCover?: (
        filePath: string,
        meta: IWritableMeta,
        coverPath?: string | null,
    ) => Promise<boolean>;
    getMediaTag: (filePath: string) => Promise<IWritableMeta>;
}

export interface INativeDownloadTaskStatus {
    taskId: string;
    status:
        | "PENDING"
        | "PREPARING"
        | "DOWNLOADING"
        | "PAUSED"
        | "COMPLETED"
        | "CANCELED"
        | "ERROR";
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
    areDownloadNotificationsEnabled: () => Promise<boolean>;
    openDownloadNotificationSettings: () => Promise<boolean>;
    clearDownloadNotifications: () => Promise<boolean>;
    cancelDownloadNotification: (taskId: string) => Promise<boolean>;
    publishDownloadCompleted: (
        taskId: string,
        title: string,
        filePath: string,
    ) => Promise<boolean>;
    refreshDownloadNotifications: () => Promise<boolean>;
}

const { Mp3Util: NativeMp3Util, NativeDownload: NativeDownloadModule } =
    NativeModules;

type NativeMp3UtilMethodName = keyof IMp3Util;

function getNativeMp3UtilMethod<T extends (...args: any[]) => any>(
    name: NativeMp3UtilMethodName,
): T | undefined {
    const method = NativeMp3Util?.[name];
    return typeof method === "function"
        ? method.bind(NativeMp3Util)
        : undefined;
}

export function isMp3UtilNativeMethodAvailable(name: NativeMp3UtilMethodName) {
    return !!getNativeMp3UtilMethod(name);
}

function requireNativeMp3UtilMethod<T extends (...args: any[]) => any>(
    name: NativeMp3UtilMethodName,
): T {
    const method = getNativeMp3UtilMethod<T>(name);
    if (!method) {
        throw new Error(`Mp3Util.${name} not available`);
    }
    return method;
}

export function getMp3UtilNativeDiagnostics() {
    const requiredMethods: NativeMp3UtilMethodName[] = [
        "getBasicMeta",
        "getMediaMeta",
        "getMediaCoverImg",
        "getLyric",
        "setMediaTag",
        "setMediaCover",
        "setMediaTagWithCover",
        "getMediaTag",
    ];

    return {
        hasNativeMp3Util: !!NativeMp3Util,
        mp3UtilMethods: NativeMp3Util ? Object.keys(NativeMp3Util) : [],
        mp3UtilMethodAvailability: Object.fromEntries(
            requiredMethods.map(method => [
                method,
                isMp3UtilNativeMethodAvailable(method),
            ]),
        ),
        hasNativeDownload: !!NativeDownloadModule,
        nativeDownloadMethods: NativeDownloadModule
            ? Object.keys(NativeDownloadModule)
            : [],
    };
}

export const NativeDownloadEmitter = NativeDownloadModule
    ? new NativeEventEmitter(NativeDownloadModule)
    : null;

const NativeDownloadBridge: INativeDownloadMethods = {
    isNativeDownloadAvailable() {
        return !!NativeDownloadModule?.addDownloadTask;
    },

    async addDownloadTask(params) {
        if (!NativeDownloadModule?.addDownloadTask) {
            throw new Error("NativeDownload.addDownloadTask not available");
        }
        return NativeDownloadModule.addDownloadTask({
            taskId: params.taskId,
            url: params.url,
            destinationPath: params.destinationPath,
            headers: params.headers ?? {},
            title: params.title ?? "MusicFree",
            description: params.description ?? "正在下载音乐文件...",
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

    async areDownloadNotificationsEnabled() {
        if (!NativeDownloadModule?.areDownloadNotificationsEnabled) {
            return false;
        }
        return NativeDownloadModule.areDownloadNotificationsEnabled();
    },

    async openDownloadNotificationSettings() {
        if (!NativeDownloadModule?.openDownloadNotificationSettings) {
            return false;
        }
        return NativeDownloadModule.openDownloadNotificationSettings();
    },

    async clearDownloadNotifications() {
        if (!NativeDownloadModule?.clearDownloadNotifications) {
            return false;
        }
        return NativeDownloadModule.clearDownloadNotifications();
    },

    async cancelDownloadNotification(taskId) {
        if (!NativeDownloadModule?.cancelDownloadNotification) {
            return false;
        }
        return NativeDownloadModule.cancelDownloadNotification(taskId);
    },

    async publishDownloadCompleted(taskId, title, filePath) {
        if (!NativeDownloadModule?.publishDownloadCompleted) {
            return false;
        }
        return NativeDownloadModule.publishDownloadCompleted(
            taskId,
            title,
            filePath,
        );
    },

    async refreshDownloadNotifications() {
        if (!NativeDownloadModule?.refreshDownloadNotifications) {
            return false;
        }
        return NativeDownloadModule.refreshDownloadNotifications();
    },
};

const NativeMp3UtilBridge: IMp3Util = {
    getBasicMeta(fileName) {
        return requireNativeMp3UtilMethod<IMp3Util["getBasicMeta"]>(
            "getBasicMeta",
        )(fileName);
    },

    getMediaMeta(fileNames) {
        return requireNativeMp3UtilMethod<IMp3Util["getMediaMeta"]>(
            "getMediaMeta",
        )(fileNames);
    },

    getMediaCoverImg(mediaPath) {
        return requireNativeMp3UtilMethod<IMp3Util["getMediaCoverImg"]>(
            "getMediaCoverImg",
        )(mediaPath);
    },

    getLyric(mediaPath) {
        return requireNativeMp3UtilMethod<IMp3Util["getLyric"]>("getLyric")(
            mediaPath,
        );
    },

    setMediaTag(filePath, meta) {
        return requireNativeMp3UtilMethod<IMp3Util["setMediaTag"]>(
            "setMediaTag",
        )(filePath, meta);
    },

    setMediaCover(filePath, coverPath) {
        return requireNativeMp3UtilMethod<Required<IMp3Util>["setMediaCover"]>(
            "setMediaCover",
        )(filePath, coverPath);
    },

    setMediaTagWithCover(filePath, meta, coverPath) {
        return requireNativeMp3UtilMethod<
            Required<IMp3Util>["setMediaTagWithCover"]
        >("setMediaTagWithCover")(filePath, meta, coverPath);
    },

    getMediaTag(filePath) {
        return requireNativeMp3UtilMethod<IMp3Util["getMediaTag"]>(
            "getMediaTag",
        )(filePath);
    },
};

const Mp3Util = {
    ...NativeMp3UtilBridge,
    ...NativeDownloadBridge,
};

export default Mp3Util as IMp3Util & INativeDownloadMethods;
