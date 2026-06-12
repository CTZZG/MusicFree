export type ILxSourceKey = "kw" | "kg" | "tx" | "wy" | "mg" | "local";

export type ILxSourceAction = "musicUrl" | "lyric" | "pic";

export type ILxQuality = "128k" | "320k" | "flac" | "flac24bit";

export interface ILxSourceMetadata {
    name: string;
    description?: string;
    version?: string;
    author?: string;
    homepage?: string;
}

export interface ILxSourceActionInfo {
    name?: string;
    type?: "music";
    actions?: ILxSourceAction[];
    qualitys?: ILxQuality[];
}

export type ILxSourceInitSources = Partial<Record<ILxSourceKey, ILxSourceActionInfo>>;

export interface ILxSourceItem {
    id: string;
    enabled: boolean;
    script: string;
    metadata: ILxSourceMetadata;
    sourceUrl?: string;
    localPath?: string;
    sources?: ILxSourceInitSources;
    installedAt: number;
    updatedAt: number;
}

export interface ILxSourceInstallResult {
    success: boolean;
    message?: string;
    item?: ILxSourceItem;
}

export interface ILxMusicInfo {
    name: string;
    singer: string;
    source: ILxSourceKey;
    songmid: string | number;
    img?: string;
    albumId?: string | number;
    albumName?: string;
    interval?: string;
    types: Array<{
        type: ILxQuality;
        size?: string | number | null;
        hash?: string;
    }>;
    hash?: string;
    strMediaMid?: string;
    albumMid?: string;
    copyrightId?: string;
    lrcUrl?: string;
    trcUrl?: string;
    mrcUrl?: string;
    [key: string]: any;
}

export interface ILxRequestPayload {
    source: ILxSourceKey;
    action: ILxSourceAction;
    info: {
        type?: ILxQuality | null;
        musicInfo: ILxMusicInfo;
    };
}

export type ILxRequestHandler = (payload: ILxRequestPayload) => Promise<any>;

export interface ILxSourceRuntime {
    metadata: ILxSourceMetadata;
    sources: ILxSourceInitSources;
    request: ILxRequestHandler;
}
