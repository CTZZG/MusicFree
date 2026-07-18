export type PlayerBackendName = "nitro-player" | "mpv";

export type PlayerBackendState =
    | "idle"
    | "ready"
    | "playing"
    | "paused"
    | "buffering"
    | "stopped"
    | "ended"
    | "error";

export type PlayerAdapterRepeatMode = "off" | "queue" | "track";

export type PlayerAdapterRemoteControlMode = "native-session";

export type PlayerAdapterQueueOperation = "add" | "remove" | "clear" | "update";

export type PlayerAdapterTrackRef<TTrack = PlayerAdapterTrack> =
    | TTrack
    | string;

export type PlayerAdapterEvent =
    | "trackChanged"
    | "playbackStateChanged"
    | "progress"
    | "playbackSeeked"
    | "playbackError"
    | "playEnd"
    | "tracksNeedUpdate"
    | "temporaryQueueChanged"
    | "queuesChanged"
    | "queueChanged"
    | "androidAutoConnectionChanged"
    | "remotePlay"
    | "remotePause"
    | "remoteNext"
    | "remotePrevious"
    | "remoteSeek"
    | "remoteStop"
    | "remoteDuck";

export interface PlayerAdapterSubscription {
    remove(): void;
}

export interface PlayerAdapterProgress {
    position: number;
    duration: number;
    buffered: number;
}

export interface PlayerAdapterSeekedEvent {
    position: number;
    duration: number;
}

export interface PlayerAdapterPlaybackError {
    code?: string;
    message: string;
    backend?: PlayerBackendName;
    reason?: unknown;
    state?: unknown;
    nativeCode?: string | number;
    nativeMessage?: string;
    raw?: unknown;
}

export interface PlayerAdapterQueueMetadata {
    name?: string;
    description?: string | null;
    artwork?: string | null;
}

export interface PlayerAdapterQueueInfo<TTrack = PlayerAdapterTrack> {
    id: string;
    name: string;
    description?: string | null;
    artwork?: string | null;
    tracks: TTrack[];
}

export interface PlayerAdapterQueuesChangedEvent<TTrack = PlayerAdapterTrack> {
    queues: Array<PlayerAdapterQueueInfo<TTrack>>;
    operation?: PlayerAdapterQueueOperation;
}

export interface PlayerAdapterQueueChangedEvent<TTrack = PlayerAdapterTrack> {
    queueId: string;
    queue: PlayerAdapterQueueInfo<TTrack>;
    operation?: PlayerAdapterQueueOperation;
}

export type PlayerAdapterRemoteCapability =
    | "play"
    | "pause"
    | "next"
    | "previous"
    | "stop"
    | "seek";

export type PlayerAdapterTrackSourceOrigin =
    | "plugin"
    | "direct"
    | "embedded-cache"
    | "similar-plugin"
    | "recovery";

export interface PlayerAdapterTrackSourceMeta {
    quality?: IMusic.IQualityKey;
    origin?: PlayerAdapterTrackSourceOrigin;
    cacheKey?: string;
    recovered?: boolean;
    resolvedAt?: number;
}

export interface PlayerAdapterTrack {
    id: string;
    title: string;
    artist?: string;
    album?: string;
    duration?: number;
    url: string;
    artwork?: string | null;
    headers?: Record<string, string>;
    userAgent?: string;
    ekey?: string;
    cek?: string;
    playbackSource?: PlayerAdapterTrackSourceMeta;
    musicItem?: IMusic.IMusicItem;
}

export interface PlayerAdapterConfig {
    maxCacheSize?: number;
    progressUpdateEventInterval?: number;
    userAgent?: string;
    showInNotification?: boolean;
    stopWithApp?: boolean;
    notificationIcon?: unknown;
    alwaysPauseOnInterruption?: boolean;
    continuePlaybackOnAppKilled?: boolean;
    capabilities?: PlayerAdapterRemoteCapability[];
    compactCapabilities?: PlayerAdapterRemoteCapability[];
    notificationCapabilities?: PlayerAdapterRemoteCapability[];
    remoteDuckMode?: "pause" | "lowerVolume";
    remoteDuckVolume?: number;
}

export interface PlayerAdapterLoadQueueOptions {
    autoPlay?: boolean;
}

export interface PlayerAdapter<TTrack = PlayerAdapterTrack> {
    readonly name: PlayerBackendName;

    readonly remoteControlMode: PlayerAdapterRemoteControlMode;

    setup(config?: PlayerAdapterConfig): Promise<void>;

    configure(config?: PlayerAdapterConfig): Promise<void>;

    loadQueue(
        tracks: TTrack[],
        startIndex?: number,
        options?: PlayerAdapterLoadQueueOptions,
    ): Promise<void>;

    play(): Promise<void>;

    pause(): Promise<void>;

    stop(): Promise<void>;

    reset(): Promise<void>;

    skipToNext(): Promise<void>;

    skipToPrevious(): Promise<void>;

    skipToIndex(index: number): Promise<boolean>;

    /**
     * 放弃尚未确认的切歌目标，并重新加载最后一次原生确认的 active track。
     * 仅供拥有“目标/已确认 active”双状态的后端实现失败回滚。
     */
    restoreActiveTrack?(options?: {autoPlay?: boolean}): Promise<boolean>;

    seekTo(position: number): Promise<void>;

    getProgress(): Promise<PlayerAdapterProgress>;

    getState(): Promise<PlayerBackendState>;

    getTrack?(index: number): Promise<TTrack | null | undefined>;

    getActiveTrack?(): Promise<TTrack | null | undefined>;

    getActiveTrackIndex?(): Promise<number | null | undefined>;

    getRate(): Promise<number>;

    setRate(rate: number): Promise<void>;

    setVolume(volume: number): Promise<void>;

    updateTrack(track: TTrack, index?: number): Promise<void>;

    setRepeatMode?(mode: PlayerAdapterRepeatMode): Promise<void>;

    getRepeatMode?(): Promise<PlayerAdapterRepeatMode>;

    getQueue?(): Promise<Array<TTrack | null | undefined>>;

    getNextTracks?(count: number): Promise<Array<TTrack | null | undefined>>;

    getTracksNeedingUrls?(): Promise<Array<TTrack | null | undefined>>;

    getTracksById?(
        trackIds: string[],
    ): Promise<Array<TTrack | null | undefined>>;

    updateTracks?(tracks: TTrack[]): Promise<void>;

    /**
     * 提前把应用层已经确认的下一首交给后端准备。
     * 仅用于支持 gapless / 预载；传 null 表示撤销预备下一首。
     * 后端不能据此改变应用层队列真相。
     */
    prepareNextTrack?(track?: TTrack | null): Promise<void>;

    /** 消费后端自己的 play-next/up-next 临时队列，不触碰主队列。 */
    consumeTemporaryNextTrack?(): Promise<boolean>;

    /** 后端内部一致性诊断；不得用 UI 镜像伪装原生 active 身份。 */
    getPlaybackDiagnostics?(): Promise<Record<string, unknown>>;

    /**
     * 把后端队列整体重排为最新的播放列表顺序（上层在每次 setPlayList 时调用）。
     * 用于像 mpv 这种由 JS 维护队列的后端，在洗牌/增删/重排后重新对齐内部队列与当前下标；
     * nitro 等以原生队列为准的后端无需实现。
     */
    syncQueueOrder?(tracks: TTrack[], activeKey?: string | null): Promise<void>;

    getCurrentQueueId?(): Promise<string | null | undefined>;

    getQueueInfo?(
        queueId?: string | null,
    ): Promise<PlayerAdapterQueueInfo<TTrack> | null | undefined>;

    getAllQueueInfos?(): Promise<Array<PlayerAdapterQueueInfo<TTrack>>>;

    createQueueInfo?(metadata?: PlayerAdapterQueueMetadata): Promise<string>;

    deleteQueueInfo?(queueId: string): Promise<void>;

    loadQueueInfo?(queueId: string, index?: number): Promise<void>;

    updateQueueInfo?(
        queueId: string,
        metadata: PlayerAdapterQueueMetadata,
    ): Promise<void>;

    playTrack?(
        track: PlayerAdapterTrackRef<TTrack>,
        queueId?: string | null,
    ): Promise<void>;

    addQueueTrack?(
        queueId: string,
        track: TTrack,
        index?: number,
    ): Promise<void>;

    addQueueTracks?(tracks: TTrack[], index?: number): Promise<void>;

    removeQueueTrack?(track: PlayerAdapterTrackRef<TTrack>): Promise<void>;

    reorderQueueTrack?(
        track: PlayerAdapterTrackRef<TTrack>,
        newIndex: number,
    ): Promise<void>;

    playNext?(track: PlayerAdapterTrackRef<TTrack>): Promise<void>;

    addToUpNext?(track: PlayerAdapterTrackRef<TTrack>): Promise<void>;

    removeFromPlayNext?(
        track: PlayerAdapterTrackRef<TTrack>,
    ): Promise<boolean>;

    removeFromUpNext?(
        track: PlayerAdapterTrackRef<TTrack>,
    ): Promise<boolean>;

    clearPlayNext?(): Promise<void>;

    clearUpNext?(): Promise<void>;

    reorderTemporaryTrack?(
        track: PlayerAdapterTrackRef<TTrack>,
        newIndex: number,
    ): Promise<boolean>;

    getPlayNextQueue?(): Promise<Array<TTrack | null | undefined>>;

    getUpNextQueue?(): Promise<Array<TTrack | null | undefined>>;

    isAndroidAutoConnected?(): Promise<boolean>;

    addEventListener(
        event: PlayerAdapterEvent,
        listener: (...args: any[]) => void,
    ): PlayerAdapterSubscription;
}
