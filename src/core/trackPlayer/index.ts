import { AppState, AppStateStatus } from "react-native";
import { sortIndexSymbol, timeStampSymbol } from "@/constants/commonConst";
import delay from "@/utils/delay";
import getUrlExt from "@/utils/getUrlExt";
import { errorLog, trace } from "@/utils/log";
import { createMediaIndexMap } from "@/utils/mediaIndexMap";
import {
    getMediaUniqueKey,
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import {
    ensureAndroidAudioReadPermission,
    requiresAudioReadPermission,
} from "@/utils/androidMediaPermission";
import Network from "@/utils/network";
import PersistStatus from "@/utils/persistStatus";
import { convertToLegacyQuality, getQualityOrder } from "@/utils/qualities";
import EventEmitter from "eventemitter3";
import { produce } from "immer";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import shuffle from "@/utils/shuffle";
import { useEffect } from "react";
import LocalMusicSheet from "../localMusicSheet";
import {
    getDirectArtworkUri,
    mergeResolvedArtwork,
    resolveLocalMusicArtwork,
    stripEphemeralLocalArtwork,
} from "../localMusicArtworkManager";
import DislikeMusic from "../dislikeMusic";
import MediaCache from "../mediaCache";

import { MusicRepeatMode, TrackPlayerEvents } from "@/constants/trackPlayerConst";
import type { IAppConfig } from "@/types/core/config";
import type { IMusicHistory } from "@/types/core/musicHistory";
import {
    IQualityChangeResult,
    ITrackPlayer,
} from "@/types/core/trackPlayer/index";
import { IPluginManager } from "@/types/core/pluginManager";
import { getAppUserAgent } from "@/utils/userAgentHelper"; // <--- 新增UA统一导入
import { getNativeArtworkUri } from "@/utils/artworkSourcePolicy";
import { ImgAsset } from "@/constants/assetsConst";
import type {
    PlayerAdapter,
    PlayerAdapterProgress,
    PlayerAdapterRepeatMode,
    PlayerBackendState,
    PlayerAdapterTrack,
    PlayerAdapterTrackSourceMeta,
    PlayerAdapterTrackSourceOrigin,
    PlayerAdapterEvent,
} from "@/core/playerAdapter";
import { resolvePlayerAdapter } from "@/core/playerAdapter";
import { normalizeMusicState } from "@/utils/trackUtils";
import NativeUtils, { IPlaybackNativeDiagnostics } from "@/native/utils";
import {
    isStaleManualSkipIntent,
    withMediaSourceTimeout,
} from "./mediaSourceTimeoutPolicy";
import {
    findNextPlayableQueueItem,
    getSafeUnresolvedQueueUrl,
    getWrappedQueueItem,
    replaceQueueItemByIdentity,
    resolvePreviousQueueItem,
    resolvePreparedNextItem,
    resolvePreparedNextItems,
} from "./queuePolicy";
import {
    isUnsupportedEncryptedMediaSource,
    resolveEncryptedMediaStreamIfNeeded,
} from "@/service/encryptedMediaProxy";
import { getLyricCandidateDistance } from "../lyricSearchPolicy";
import { shouldEvictRecoveredRemoteSourceCacheAfterFailure } from "./sourceRecoveryPolicy";
import {
    IManualSkipOperationToken,
    IMpvTrackTransitionToken,
    ManualSkipOperationGate,
    MpvTrackTransitionGate,
    waitForExpectedActive,
} from "./manualSkipCoordinator";
import QualityChangeCoordinator, {
    commitQualitySourcePair,
} from "./qualityChangeCoordinator";
import { shouldHydratePlayerHooks } from "./playerStartupPolicy";
import BackendListenerLifecycle from "./backendListenerLifecycle";
import CrossfadeController from "./crossfadeController";
import LastfmScrobbler from "@/core/lastfm";
import {
    validateRemoteMediaUrlForPlayback,
} from "@/utils/remoteMediaUrl";
import { isMediaHttpAllowed } from "@/utils/mediaHttpCompatibilityPolicy";
import {
    classifyMediaSourceFailure,
    createMediaSourceFailure,
    createMediaSourceFailureResult,
    MediaSourceResolutionError,
    mediaSourceFailureFromPluginResult,
    preferUserFacingMediaSourceFailure,
    type MediaSourceAttemptType,
    type MediaSourceFailure,
    type MediaSourceFailureCode,
    type MediaSourceFailureContext,
} from "@/core/pluginManager/mediaSourceFailure";

type MusicFreePlayerTrack = PlayerAdapterTrack &
    Partial<IMusic.IMusicItem> &
    Record<string, any>;

interface IMpvManualSkipTransition {
    token: IMpvTrackTransitionToken;
    expectedMusic: IMusic.IMusicItem;
    previousMusic: IMusic.IMusicItem | null;
    previousProgress: PlayerAdapterProgress;
    resumeOnRollback: boolean;
    reason: string;
}

interface IPlaybackDiagnosticMusicIdentity {
    id?: string;
    title?: string;
    artist?: string;
    platform?: string;
}

interface IPlaybackDiagnosticTrackSummary
    extends IPlaybackDiagnosticMusicIdentity {
    album?: string;
    duration?: number;
    urlType: string;
    hasHeaders: boolean;
}

export interface IPlaybackDiagnosticSnapshot {
    backendName: string;
    backendState: PlayerBackendState;
    backendRepeatMode?: PlayerAdapterRepeatMode;
    backendCapabilities: {
        getNextTracks: boolean;
        prepareNextTrack: boolean;
        prepareNextTracks: boolean;
        syncQueueOrder: boolean;
        queueInfo: boolean;
        temporaryQueue: boolean;
        androidAuto: boolean;
    };
    rate: number;
    currentMusic: IMusic.IMusicItem | null;
    queueIndex: number;
    queueLength: number;
    queuePreview: {
        previous: IPlaybackDiagnosticMusicIdentity | null;
        next: IPlaybackDiagnosticMusicIdentity | null;
        playLaterLength: number;
        backendNextTracks: IPlaybackDiagnosticTrackSummary[];
    };
    preparedNext: {
        music: IPlaybackDiagnosticMusicIdentity | null;
        hasUrl: boolean;
        canUseNativePrepare: boolean;
        blockedByPlayLater: boolean;
        repeatSingle: boolean;
    };
    quality: IMusic.IQualityKey;
    repeatMode: MusicRepeatMode;
    progress: PlayerAdapterProgress;
    activeTrackIndex?: number | null;
    activeTrack?: {
        id?: string;
        title?: string;
        artist?: string;
        album?: string;
        duration?: number;
        urlType: string;
        hasHeaders: boolean;
        sourceQuality?: IMusic.IQualityKey;
        sourceOrigin?: PlayerAdapterTrackSourceOrigin;
        sourceRecovered?: boolean;
        sourceCacheKey?: string;
        sourceResolvedAt?: number;
    } | null;
    backendDiagnostics?: Record<string, unknown>;
    /** 淡入淡出的当前增益与是否正在跑坡道，用来区分「音量被谁压下去的」。 */
    crossfade: {
        gain: number;
        fading: boolean;
    };
    recentErrors: Array<{
        message: string;
        code?: string;
        createdAt: number;
    }>;
    recovery: {
        persistedMusic: IPlaybackDiagnosticMusicIdentity | null;
        persistedProgress: number | null;
        progressSavedAt: number | null;
        lastPersistedProgress: number | null;
        lastPersistedAt: number | null;
        lastRestoredMusic: IPlaybackDiagnosticMusicIdentity | null;
        lastRestoredProgress: number | null;
        lastRestoredAt: number | null;
        lastRestoredQueueLength: number | null;
    };
    native?: IPlaybackNativeDiagnostics;
}

const currentMusicAtom = atom<IMusic.IMusicItem | null>(null);
const repeatModeAtom = atom<MusicRepeatMode>(MusicRepeatMode.QUEUE);
const qualityAtom = atom<IMusic.IQualityKey>("standard");
const playListAtom = atom<IMusic.IMusicItem[]>([]);
const playLaterQueueAtom = atom<IMusic.IMusicItem[]>([]);
const musicStateAtom = atom<PlayerBackendState>("idle");
const playerReadyAtom = atom(false);
const progressAtom = atom<PlayerAdapterProgress>({
    position: 0,
    duration: 0,
    buffered: 0,
});
interface ITrackPlayerProgressSnapshot extends PlayerAdapterProgress {
    mediaKey?: string;
    sequence: number;
}
let progressSnapshotSequence = 0;
const progressSnapshotAtom = atom<ITrackPlayerProgressSnapshot>({
    position: 0,
    duration: 0,
    buffered: 0,
    sequence: 0,
});

function normalizeAdapterProgress(
    progress?: Partial<PlayerAdapterProgress> | null,
    fallbackDuration = 0,
): PlayerAdapterProgress {
    const position = Number(progress?.position);
    const duration = Number(progress?.duration);
    const buffered = Number(progress?.buffered);

    return {
        position: Number.isFinite(position) ? position : 0,
        duration:
            Number.isFinite(duration) && duration > 0
                ? duration
                : fallbackDuration,
        buffered: Number.isFinite(buffered) ? buffered : 0,
    };
}

function setPlayerProgress(
    progress?: Partial<PlayerAdapterProgress> | null,
    fallbackDuration = 0,
) {
    const normalizedProgress = normalizeAdapterProgress(
        progress,
        fallbackDuration,
    );
    const store = getDefaultStore();
    store.set(progressAtom, normalizedProgress);
    const currentMusic = store.get(currentMusicAtom);
    store.set(progressSnapshotAtom, {
        ...normalizedProgress,
        mediaKey: currentMusic
            ? getMediaUniqueKey(currentMusic)
            : undefined,
        sequence: ++progressSnapshotSequence,
    });
    return normalizedProgress;
}

function hasPlayableSourceUrl(
    source?: {url?: string | null} | null,
): source is {url: string} {
    return typeof source?.url === "string" && source.url.trim().length > 0;
}

function getMediaSourceResultFailure(
    source: IPlugin.IMediaSourceResult | null | undefined,
    context: MediaSourceFailureContext,
    fallbackCode: MediaSourceFailureCode,
) {
    return source?.failure
        ? mediaSourceFailureFromPluginResult(source.failure, context)
        : createMediaSourceFailure(fallbackCode, context);
}

class TrackPlayer
    extends EventEmitter<{
        [TrackPlayerEvents.PlayEnd]: () => void;
        [TrackPlayerEvents.CurrentMusicChanged]: (
            musicItem: IMusic.IMusicItem | null,
        ) => void;
        [TrackPlayerEvents.ProgressChanged]: (progress: {
            position: number;
            duration: number;
        }) => void;
        [TrackPlayerEvents.CellularPlayForbidden]: () => void;
        [TrackPlayerEvents.LocalAudioPermissionRequired]: () => void;
        [TrackPlayerEvents.AutoSkipDislikedMusic]: () => void;
        [TrackPlayerEvents.NoPlayableMusic]: () => void;
        [TrackPlayerEvents.MediaSourceFailed]: (
            failure: MediaSourceFailure,
        ) => void;
    }>
    implements ITrackPlayer {
    // 依赖
    private configService!: IAppConfig;
    private musicHistoryService!: IMusicHistory;
    private pluginManagerService!: IPluginManager;

    // 当前播放的音乐下标
    private currentIndex = -1;
    // 底层播放器桥接由配置选择，默认 Nitro Player，可选 MPV。
    private backend!: PlayerAdapter<any>;
    private nitroPendingSourceRequests = new Set<string>();
    private sourceRecoveryInFlight = new Set<string>();
    private sourceRecoveryAttemptedAt = new Map<string, number>();
    private nitroTrackChangeGuard: {key: string; until: number} | null = null;
    private isForceExiting = false;
    private lastProgressPersistedAt = 0;
    private lastProgressPersistedPosition = 0;
    private lastPlaybackRestoredAt: number | null = null;
    private lastPlaybackRestoredProgress: number | null = null;
    private lastPlaybackRestoredMusic: IMusic.IMusicItem | null = null;
    private lastPlaybackRestoredQueueLength: number | null = null;
    private recentPlaybackErrors: IPlaybackDiagnosticSnapshot["recentErrors"] =
        [];
    private backendListenerLifecycle = new BackendListenerLifecycle();
    /**
     * 淡入淡出执行器。音量是全局属性，除了启动时的归一没有别人写，所以直接
     * 让它独占；关掉设置时它会自己把音量平滑收回 1。
     */
    private crossfade = new CrossfadeController({
        applyGain: gain => {
            this.backend?.setVolume(gain).catch(() => undefined);
        },
        readSettings: () => ({
            enabled:
                this.configService?.getConfig("basic.crossfadeEnabled") === true,
            seconds:
                this.configService?.getConfig("basic.crossfadeSeconds") ?? 5,
        }),
    });
    private preparedNextSyncSerial = 0;
    private lastPlaybackTrackKey: string | null = null;
    private localArtworkSyncInFlight = new Set<string>();
    private lastMpvActiveTrackSyncAt = 0;
    private mpvActiveTrackSyncSerial = 0;
    private lastMpvHistoryGeneration: number | null = null;
    private handlingMpvNaturalEnd = false;
    /**
     * 自然结束处理的归属令牌。看门狗超时会放开重入锁让后续曲尾能进来，此时旧的
     * 处理器仍在跑——它的 finally 绝不能再去清新处理器的定时器或释放新处理器的
     * 锁（ABA），否则会出现两个处理器并发推进队列。只有仍持有令牌的一方有权释放。
     */
    private mpvNaturalEndOwner = 0;
    private mpvNaturalEndSequence = 0;
    /** 最近一次因为取不到音源而失败的歌曲，用于自然结束时的有界续播 */
    private lastInvalidSourceKey: string | null = null;
    private manualSkipGate = new ManualSkipOperationGate();
    private qualityChangeCoordinator = new QualityChangeCoordinator();
    private mpvTrackTransitionGate = new MpvTrackTransitionGate();
    private mpvManualSkipTransition: IMpvManualSkipTransition | null = null;
    // 播放队列索引map
    private playListIndexMap = createMediaIndexMap([] as IMusic.IMusicItem[]);

    private static maxMusicQueueLength = 10000;
    private static halfMaxMusicQueueLength = 5000;
    private static progressPersistIntervalMs = 1000;
    /** mpv 自然结束处理的兜底超时，防止取源挂起后永远不再切歌 */
    private static mpvNaturalEndTimeoutMs = 30000;
    /** 自然结束续播时，最多连续跳过几首取不到音源的歌 */
    private static mpvNaturalEndMaxSourceRetries = 3;
    /** 原生自动切歌后向前补充多少首已解析音源，维持 prepared-next runway */
    private static mpvSourceLookaheadSize = 3;
    private static sourceRecoveryCooldownMs = 30000;
    private static sourceRecoveryAttemptRetentionMs = 10 * 60 * 1000;
    private static sourceRecoveryAttemptMaxEntries = 256;
    private static toggleRepeatMapping = {
        [MusicRepeatMode.SHUFFLE]: MusicRepeatMode.SINGLE,
        [MusicRepeatMode.SINGLE]: MusicRepeatMode.QUEUE,
        [MusicRepeatMode.QUEUE]: MusicRepeatMode.SHUFFLE,
    };
    constructor() {
        super();
    }

    public get previousMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex - 1);
    }

    public get currentMusic() {
        return getDefaultStore().get(currentMusicAtom);
    }

    public getProgressSnapshot() {
        return getDefaultStore().get(progressSnapshotAtom);
    }

    public get nextMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic) {
            return null;
        }

        return this.getPlayListMusicAt(this.currentIndex + 1);
    }

    public get repeatMode() {
        return getDefaultStore().get(repeatModeAtom);
    }

    public get quality() {
        return getDefaultStore().get(qualityAtom);
    }

    public get playList() {
        return getDefaultStore().get(playListAtom);
    }

    public get playLaterQueue() {
        return getDefaultStore().get(playLaterQueueAtom);
    }

    public get playerAdapter() {
        if (!this.backend) {
            this.lockBackend();
        }
        return this.backend;
    }

    public get isReady() {
        return getDefaultStore().get(playerReadyAtom);
    }

    public setReady(ready: boolean) {
        getDefaultStore().set(playerReadyAtom, ready);
    }

    injectDependencies(
        configService: IAppConfig,
        musicHistoryService: IMusicHistory,
        pluginManager: IPluginManager,
    ): void {
        this.configService = configService;
        this.musicHistoryService = musicHistoryService;
        this.pluginManagerService = pluginManager;
    }

    lockBackend() {
        // 按配置选择播放内核（默认 nitro-player；mpv 为实验性可选后端）
        const configuredBackend =
            this.configService?.getConfig("basic.playerBackend") ??
            "nitro-player";
        const nextBackend = resolvePlayerAdapter(configuredBackend);
        if (this.backend && this.backend !== nextBackend) {
            this.disposeServiceListeners();
        }
        this.backend = nextBackend;
    }

    private disposeServiceListeners() {
        this.backendListenerLifecycle.dispose();
    }

    private addBackendListener(
        event: PlayerAdapterEvent,
        listener: (...args: any[]) => void,
    ) {
        this.backendListenerLifecycle.add(() =>
            this.backend.addEventListener(event, listener),
        );
    }

    async setupTrackPlayer() {
        this.lockBackend();
        const rate = PersistStatus.get("music.rate");
        const musicQueue = PersistStatus.get("music.playList");
        const playLaterQueue = PersistStatus.get("music.playLaterQueue");
        const repeatMode = PersistStatus.get("music.repeatMode");
        const progress = PersistStatus.get("music.progress");
        const progressSavedAt = PersistStatus.get("music.progressSavedAt");
        let track = PersistStatus.get("music.musicItem"); // <--- 改为 let
        const quality =
            PersistStatus.get("music.quality") ||
            this.configService.getConfig("basic.defaultPlayQuality") ||
            "standard";

        await this.backend.setVolume(1);
        this.crossfade.reset();
        // 离线期间攒下的 scrobble 在这里补交一次。
        LastfmScrobbler.flush().catch(() => undefined);
        // 状态恢复
        if (rate) {
            await this.backend.setRate(+rate / 100);
        }
        if (typeof progressSavedAt === "number") {
            this.lastProgressPersistedAt = progressSavedAt;
            this.lastProgressPersistedPosition =
                this.normalizeProgress(progress) ?? 0;
        }
        if (repeatMode) {
            getDefaultStore().set(
                repeatModeAtom,
                repeatMode as MusicRepeatMode,
            );
        }
        await this.syncBackendRepeatMode();

        if (musicQueue && Array.isArray(musicQueue)) {
            this.addAll(
                musicQueue,
                undefined,
                repeatMode === MusicRepeatMode.SHUFFLE,
            );
        }
        if (playLaterQueue && Array.isArray(playLaterQueue)) {
            this.setPlayLaterQueue(playLaterQueue);
        }
        if (track && !this.isInPlayList(track)) {
            this.add(track);
        }

        if (track && this.isInPlayList(track)) {
            if (!this.configService.getConfig("basic.autoPlayWhenAppStart")) {
                track.isInit = true;
            }
            this.lastPlaybackRestoredAt = Date.now();
            this.lastPlaybackRestoredProgress =
                this.normalizeProgress(progress) ?? 0;
            this.lastPlaybackRestoredMusic = track;
            this.lastPlaybackRestoredQueueLength = this.playList.length;
            // 添加 UA
            track.userAgent = track.userAgent || getAppUserAgent();

            // 异步
            this.pluginManagerService
                .getByMedia(track)
                ?.methods.getMediaSource(track, quality)
                .then(async newSource => {
                    newSource = await this.createPlayableSource(
                        newSource ?? null,
                        track,
                        quality,
                        "plugin",
                    );
                    if (!newSource?.url) {
                        return;
                    }
                    track.url = newSource?.url || track.url;
                    track.headers = newSource?.headers || track.headers;
                    track.playbackSource =
                        newSource?.playbackSource || track.playbackSource;
                    track.userAgent = track.userAgent || getAppUserAgent();

                    if (isSameMediaItem(this.currentMusic, track)) {
                        await this.setTrackSource(
                            track as MusicFreePlayerTrack,
                            false,
                            this.normalizeProgress(progress),
                        );
                    }
                })
                .catch(err => {
                    errorLog("恢复播放源失败", err?.message ?? err);
                });
            this.setCurrentMusic(track);
        }

        if (this.backendListenerLifecycle.begin()) {
            /**
             * 此事件可能会被触发多次（比如直接替换queue） 参考代码：https://github.com/doublesymmetry/KotlinAudio
             */
            this.addBackendListener("trackChanged", async evt => {
                if (this.isForceExiting) {
                    return;
                }
                if (this.shouldIgnoreMpvTrackChangeDuringManualSkip(evt)) {
                    return;
                }
                if (this.shouldIgnoreNitroTrackChange(evt)) {
                    return;
                }
                const syncedMusic = this.syncNitroCurrentMusic(
                    evt.track,
                    evt.reason,
                    evt.index,
                );
                trace("播放队列切歌", {
                    index: evt.index,
                    reason: evt.reason,
                    musicId: syncedMusic?.id,
                    platform: syncedMusic?.platform,
                });
                if (this.backend.name === "mpv") {
                    const generation = Number(evt.activationGeneration);
                    if (
                        syncedMusic &&
                        Number.isFinite(generation) &&
                        generation !== this.lastMpvHistoryGeneration
                    ) {
                        this.lastMpvHistoryGeneration = generation;
                        this.musicHistoryService.addMusic(syncedMusic);
                    }
                } else if (evt.reason === "end" || evt.reason === "repeat") {
                    if (syncedMusic) {
                        this.musicHistoryService.addMusic(syncedMusic);
                    }
                }
                if (this.backend.name !== "mpv" && evt.reason === "end") {
                    const playedLater = await this.playNextLaterQueue();
                    if (playedLater) {
                        this.emit(TrackPlayerEvents.PlayEnd);
                        return;
                    }
                    if (DislikeMusic.isDisliked(syncedMusic)) {
                        await this.skipAutoDislikedMusic();
                    }
                }
                if (
                    this.backend.name !== "mpv" &&
                    (evt.reason === "end" || evt.reason === "repeat")
                ) {
                    this.emit(TrackPlayerEvents.PlayEnd);
                }
            });

            this.addBackendListener("playEnd", async evt => {
                if (this.isForceExiting || this.backend.name !== "mpv") {
                    return;
                }
                if (this.hasActiveMpvManualSkipTransition()) {
                    trace("MPV 手动切歌期间忽略旧自然结束事件", {
                        endedMediaId: evt.endedMediaId,
                        promotedMediaId: evt.promotedMediaId,
                        expectedKey:
                            this.mpvManualSkipTransition?.token.expectedKey,
                    });
                    return;
                }
                await this.handleMpvNaturalEnd(evt).catch(error => {
                    errorLog("处理 mpv 自然结束失败", error?.message ?? error);
                });
            });

            this.addBackendListener("tracksNeedUpdate", async evt => {
                if (this.isForceExiting) {
                    return;
                }
                await this.resolveNitroQueuedTracks(evt?.tracks ?? []);
            });

            this.addBackendListener("playbackError", async e => {
                this.recordPlaybackError(e);
                errorLog("播放出错", e.message);
                // WARNING: 不稳定，报错的时候有可能track已经变到下一首歌去了
                const currentTrack = await this.backend.getActiveTrack?.();
                if (
                    this.shouldIgnoreMpvPlaybackErrorDuringManualSkip(
                        currentTrack,
                    )
                ) {
                    return;
                }
                if (currentTrack?.isInit) {
                    // HACK: 避免初始失败的情况
                    await this.backend.updateTrack(
                        {
                            ...currentTrack,
                            // @ts-ignore
                            isInit: undefined,
                            userAgent: getAppUserAgent(), // <--- 添加UA
                        } as MusicFreePlayerTrack,
                        0,
                    );
                    return;
                }

                if (e.message && e.message !== "android-io-file-not-found") {
                    trace("播放出错", {
                        message: e.message,
                        code: e.code,
                    });

                    const recovered =
                        await this.recoverCurrentSourceAfterPlaybackError(
                            e,
                            currentTrack as MusicFreePlayerTrack | null,
                        );
                    if (!recovered) {
                        this.handlePlayFail();
                    }
                }
            });

            this.addBackendListener("playbackStateChanged", state => {
                if (this.isForceExiting) {
                    return;
                }
                const normalizedState = normalizeMusicState(state);
                getDefaultStore().set(musicStateAtom, normalizedState);
                // 淡化坡道和收听计时都必须以后端的真实播放状态为准：通知栏、
                // 耳机线控、音频焦点丢失这些暂停根本不经过 TrackPlayer.pause()，
                // 只盯着那个方法会让淡出在暂停期间继续跑到 0，恢复播放后音量
                // 卡在静音上。
                if (normalizedState === "playing") {
                    this.crossfade.onPlay();
                    LastfmScrobbler.onResumed();
                } else {
                    this.crossfade.onPause();
                    LastfmScrobbler.onPaused();
                }
                if (
                    normalizedState === "paused" &&
                    !this.shouldSuppressMpvProgressDuringManualSkip()
                ) {
                    const syncSerial = this.mpvActiveTrackSyncSerial;
                    this.backend
                        .getProgress()
                        .then(adapterProgress => {
                            if (
                                syncSerial !==
                                    this.mpvActiveTrackSyncSerial ||
                                this.shouldSuppressMpvProgressDuringManualSkip()
                            ) {
                                return;
                            }
                            const currentProgress = setPlayerProgress(
                                adapterProgress,
                                this.currentMusic?.duration ?? 0,
                            );
                            this.persistPlaybackProgress(
                                currentProgress.position,
                                true,
                            );
                        })
                        .catch(() => undefined);
                }
            });

            this.addBackendListener("progress", adapterProgress => {
                if (this.isForceExiting) {
                    return;
                }
                if (this.shouldSuppressMpvProgressDuringManualSkip()) {
                    return;
                }
                this.syncMpvActiveTrackFromProgress("progress");
                const currentProgress = setPlayerProgress(
                    adapterProgress,
                    this.currentMusic?.duration ?? 0,
                );
                this.persistPlaybackProgress(currentProgress.position);
                this.crossfade.onProgress(currentProgress);
                LastfmScrobbler.onProgressTick();
            });

            this.addBackendListener("playbackSeeked", adapterProgress => {
                if (this.isForceExiting) {
                    return;
                }
                if (this.shouldSuppressMpvProgressDuringManualSkip()) {
                    return;
                }
                const currentProgress = setPlayerProgress(
                    adapterProgress,
                    this.currentMusic?.duration ?? 0,
                );
                this.persistPlaybackProgress(currentProgress.position, true);
                this.crossfade.onSeeked(currentProgress);
            });

            this.backendListenerLifecycle.addCleanup(() =>
                DislikeMusic.onUpdated(() => {
                    trace("不喜欢歌曲规则更新，重新同步预备下一首");
                    this.syncPreparedNextTrack("dislike-rules");
                }),
            );

            // mpv 的批量 runway 只在 JS 活着的时候才能补充；进入后台前主动补一次，
            // 尽量让 URL 在冻结前是新鲜的，缩小「后台连播撑不到下次自然切歌」的窗口。
            this.backendListenerLifecycle.addCleanup(() => {
                let lastAppState = AppState.currentState;
                const subscription = AppState.addEventListener(
                    "change",
                    (nextAppState: AppStateStatus) => {
                        if (
                            lastAppState === "active" &&
                            nextAppState.match(/inactive|background/)
                        ) {
                            trace("应用进入后台，补充一次预备下一首", {
                                nextAppState,
                            });
                            this.syncPreparedNextTrack("app-background");
                        }
                        lastAppState = nextAppState;
                    },
                );
                return () => subscription.remove();
            });

            this.backendListenerLifecycle.commit();
        }
    }

    /**************** 播放队列 ******************/
    getMusicIndexInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return -1;
        }
        return this.playListIndexMap.getIndex(musicItem);
    }

    isInPlayList(musicItem?: IMusic.IMusicItem | null) {
        if (!musicItem) {
            return false;
        }

        return this.playListIndexMap.has(musicItem);
    }

    private replacePlayListMusicIfPresent(
        musicItem: IMusic.IMusicItem,
        persist = true,
    ) {
        const result = replaceQueueItemByIdentity(
            this.playList,
            musicItem,
            isSameMediaItem,
        );
        if (!result.replaced) {
            return false;
        }

        trace("播放列表歌曲字段已更新", {
            musicId: musicItem.id,
            platform: musicItem.platform,
            index: result.index,
            hasUrl: !!musicItem.url,
            hasLocalPath: !!getLocalPath(musicItem),
            hasCencKey: !!musicItem.cek,
        });
        this.setPlayList(result.queue, persist);
        return true;
    }

    getPlayListMusicAt(index: number): IMusic.IMusicItem | null {
        return getWrappedQueueItem(this.playList, index);
    }

    private getWrappedPlayListIndex(index: number) {
        const len = this.playList.length;
        if (len === 0) {
            return -1;
        }
        return ((index % len) + len) % len;
    }

    isPlayListEmpty() {
        return this.playList.length === 0;
    }

    /****** 播放逻辑 *****/
    addAll(
        musicItems: Array<IMusic.IMusicItem>,
        beforeIndex?: number,
        shouldShuffle?: boolean,
    ): void {
        const now = Date.now();
        let newPlayList: IMusic.IMusicItem[] = [];
        let currentPlayList = this.playList;
        const queueMusicItems = musicItems.map((item, index) => ({
            ...item,
            [timeStampSymbol]: now,
            [sortIndexSymbol]: index,
        }));

        if (beforeIndex === undefined || beforeIndex < 0) {
            // 1.1. 添加到歌单末尾，并过滤掉已有的歌曲
            newPlayList = currentPlayList.concat(
                queueMusicItems.filter(item => !this.isInPlayList(item)),
            );
        } else {
            // 1.2. 新的播放列表，插入
            const indexMap = createMediaIndexMap(queueMusicItems);
            const beforeDraft = currentPlayList
                .slice(0, beforeIndex)
                .filter(item => !indexMap.has(item));
            const afterDraft = currentPlayList
                .slice(beforeIndex)
                .filter(item => !indexMap.has(item));

            newPlayList = [...beforeDraft, ...queueMusicItems, ...afterDraft];
        }

        // 如果太长了
        if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
            newPlayList = this.shrinkPlayListToSize(
                newPlayList,
                beforeIndex ?? newPlayList.length - 1,
            );
        }

        // 2. 如果需要随机
        if (shouldShuffle) {
            newPlayList = shuffle(newPlayList);
        }
        // 3. 设置播放列表
        this.setPlayList(newPlayList);
    }

    add(
        musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
        beforeIndex?: number,
    ): void {
        this.addAll(
            Array.isArray(musicItem) ? musicItem : [musicItem],
            beforeIndex,
        );
    }

    addNext(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]): void {
        const shouldAutoPlay = this.isPlayListEmpty() || !this.currentMusic;
        const musicItems = Array.isArray(musicItem) ? musicItem : [musicItem];
        const insertIndex = this.currentIndex + 1;
        const newItems = musicItems.filter(item => !this.isInPlayList(item));

        this.add(musicItems, insertIndex);

        if (!shouldAutoPlay && newItems.length > 0) {
            this.syncNitroQueueInsert(newItems, insertIndex).catch(error => {
                errorLog("同步下一首队列失败", error?.message ?? error);
            });
        }

        if (shouldAutoPlay) {
            this.play(Array.isArray(musicItem) ? musicItem[0] : musicItem);
        }
    }

    addPlayLater(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]): void {
        const musicItems = Array.isArray(musicItem) ? musicItem : [musicItem];
        const nextQueue = [...this.playLaterQueue];

        musicItems.forEach(item => {
            if (
                !nextQueue.some(queueItem =>
                    isSameMediaItem(queueItem, item),
                ) &&
                !this.isCurrentMusic(item)
            ) {
                nextQueue.push(item);
            }
        });

        this.setPlayLaterQueue(nextQueue);
        if (!this.currentMusic && nextQueue.length) {
            this.playNextLaterQueue().catch(error => {
                errorLog("稍后播放启动失败", error?.message ?? error);
            });
        }
    }

    removePlayLater(musicItem: IMusic.IMusicItem): void {
        this.setPlayLaterQueue(
            this.playLaterQueue.filter(
                item => !isSameMediaItem(item, musicItem),
            ),
        );
    }

    clearPlayLaterQueue(): void {
        this.setPlayLaterQueue([]);
    }

    async remove(musicItem: IMusic.IMusicItem): Promise<void> {
        const playList = this.playList;

        let newPlayList: IMusic.IMusicItem[] = [];
        let currentMusic: IMusic.IMusicItem | null = this.currentMusic;
        const targetIndex = this.getMusicIndexInPlayList(musicItem);
        let shouldPlayCurrent: boolean | null = null;
        if (targetIndex === -1) {
            // 1. 这种情况应该是出错了
            return;
        }
        // 2. 移除的是当前项
        if (this.currentIndex === targetIndex) {
            // 2.1 停止播放，移除当前项
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 2.2 设置新的播放列表，并更新当前音乐
            if (newPlayList.length === 0) {
                currentMusic = null;
                shouldPlayCurrent = false;
            } else {
                currentMusic =
                    newPlayList[this.currentIndex % newPlayList.length];
                try {
                    const state = await this.backend.getState();
                    shouldPlayCurrent = state === "playing";
                } catch {
                    shouldPlayCurrent = false;
                }
            }
            this.setCurrentMusic(currentMusic);
        } else {
            // 3. 删除
            newPlayList = produce(playList, draft => {
                draft.splice(targetIndex, 1);
            });
            // 如果删除的是当前播放歌曲之前的项，需要调整currentIndex
            if (targetIndex < this.currentIndex) {
                this.currentIndex--;
            }
        }

        this.setPlayList(newPlayList);
        if (shouldPlayCurrent === true) {
            await this.play(currentMusic, true);
        } else if (shouldPlayCurrent === false) {
            await this.backend.reset();
        } else {
            await this.syncNitroQueueRemove(musicItem).catch(error => {
                errorLog("同步移除队列失败", error?.message ?? error);
            });
        }
    }

    isCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        return isSameMediaItem(musicItem, this.currentMusic);
    }

    async play(
        musicItem?: IMusic.IMusicItem | null,
        forcePlay?: boolean,
        mpvTransitionOwner?: IMpvManualSkipTransition | null,
    ): Promise<void> {
        let ownedMpvTransition: IMpvManualSkipTransition | null = null;
        let sourceResolutionFailure: MediaSourceFailure | null = null;
        this.crossfade.onPlay();
        LastfmScrobbler.onResumed();
        try {
            trace("TrackPlayer.play start", {
                backend: this.backend.name,
                musicId: musicItem?.id ?? this.currentMusic?.id,
                platform: musicItem?.platform ?? this.currentMusic?.platform,
                forcePlay,
            });
            // 如果不传参，默认是播放当前音乐
            if (!musicItem) {
                musicItem = this.currentMusic;
            }
            trace("TrackPlayer.play resolved music", {
                backend: this.backend.name,
                musicId: musicItem?.id,
                platform: musicItem?.platform,
                isCurrent: this.isCurrentMusic(musicItem),
            });
            if (!musicItem) {
                throw new Error(PlayFailReason.PLAY_LIST_IS_EMPTY);
            }
            const sourceMusicItem = musicItem;
            const rememberSourceFailure = (
                failure?: MediaSourceFailure | null,
                attemptType: MediaSourceAttemptType = "original",
            ) => {
                if (!failure) {
                    return;
                }
                sourceResolutionFailure = preferUserFacingMediaSourceFailure(
                    sourceResolutionFailure,
                    failure,
                    attemptType,
                );
            };
            const createInvalidSourceError = () => {
                const failure =
                    sourceResolutionFailure ??
                    createMediaSourceFailure("unavailable", {
                        mediaKey: getMediaUniqueKey(sourceMusicItem),
                        pluginName: sourceMusicItem.platform,
                    });
                return new MediaSourceResolutionError(
                    failure.code,
                    PlayFailReason.INVALID_SOURCE,
                    {
                        mediaKey: failure.mediaKey,
                        pluginName: failure.pluginName,
                        quality: failure.quality,
                    },
                    failure.retryable,
                );
            };
            if (this.backend.name === "mpv" && !mpvTransitionOwner) {
                this.manualSkipGate.cancelPending();
            }
            const existingMpvTransition = this.mpvManualSkipTransition;
            if (
                existingMpvTransition &&
                this.isMpvManualSkipTransitionActive(
                    existingMpvTransition,
                ) &&
                existingMpvTransition.token.expectedKey ===
                    getMediaUniqueKey(musicItem) &&
                mpvTransitionOwner?.token.id !==
                    existingMpvTransition.token.id
            ) {
                await this.waitForMpvActiveMusic(
                    musicItem,
                    4300,
                    existingMpvTransition,
                );
                return;
            }
            const previousMusicBeforePlay = this.currentMusic;
            this.cancelMpvManualSkipTransitionForTarget(
                musicItem,
                "explicit-play",
            );
            if (
                this.backend.name === "mpv" &&
                !this.hasActiveMpvManualSkipTransition() &&
                (forcePlay ||
                    !isSameMediaItem(previousMusicBeforePlay, musicItem))
            ) {
                ownedMpvTransition = this.beginMpvManualSkipTransition(
                    musicItem,
                    previousMusicBeforePlay,
                    "explicit-play",
                );
                await this.pauseMpvActiveTrackForTransition(
                    ownedMpvTransition,
                );
                if (
                    !this.isMpvManualSkipTransitionActive(
                        ownedMpvTransition,
                    )
                ) {
                    return;
                }
            }

            const resolvedMusicItem = musicItem;
            const seekToTime = this.resolveResumeSeekTime(resolvedMusicItem);
            const shouldDeferMpvCurrentCommit =
                this.backend.name === "mpv" &&
                !!(ownedMpvTransition || mpvTransitionOwner);
            const isPlayRequestActive = () => {
                if (ownedMpvTransition) {
                    return this.isMpvManualSkipTransitionActive(
                        ownedMpvTransition,
                    );
                }
                if (mpvTransitionOwner) {
                    return this.isMpvManualSkipTransitionActive(
                        mpvTransitionOwner,
                    );
                }
                return this.isCurrentMusic(resolvedMusicItem);
            };
            const commitProposedMusic = () => {
                this.setCurrentMusic(resolvedMusicItem);
                const proposedProgress = setPlayerProgress(
                    {
                        position: seekToTime ?? 0,
                        duration: resolvedMusicItem.duration || 0,
                        buffered: seekToTime ?? 0,
                    },
                    resolvedMusicItem.duration || 0,
                );
                this.emit(
                    TrackPlayerEvents.ProgressChanged,
                    proposedProgress,
                );
            };

            // 1. 移动网络禁止播放
            const localPath = getLocalPath(musicItem);
            if (
                Network.isCellular &&
                !this.configService.getConfig("basic.useCelluarNetworkPlay") &&
                !LocalMusicSheet.isLocalMusic(musicItem) &&
                !localPath
            ) {
                await this.backend.reset();
                trace("TrackPlayer.play blocked by cellular policy", {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                });
                throw new Error(PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY);
            }

            // 1.5 播放本地文件需要音频读取权限。
            // targetSdk 36 下 READ_MEDIA_AUDIO 是新的运行时权限，不会从旧版的
            // READ_EXTERNAL_STORAGE 自动继承；此前只有本地音乐页的「扫描」按钮
            // 申请过，所以从旧版升级的用户点播本地歌曲只会拿到一个没有任何解释的
            // Source error。这里在真正取源之前补一次授权检查。
            if (
                requiresAudioReadPermission(localPath) &&
                !(await ensureAndroidAudioReadPermission())
            ) {
                await this.backend.reset();
                trace("TrackPlayer.play blocked by missing audio permission", {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                });
                throw new Error(PlayFailReason.MISSING_AUDIO_PERMISSION);
            }

            // 2. 如果是当前正在播放的音频
            const isCurrentMusic = this.isCurrentMusic(musicItem);
            const shouldUseCurrentFastPath = isCurrentMusic && !forcePlay;
            if (isCurrentMusic && !shouldUseCurrentFastPath) {
                trace("TrackPlayer.play bypass current fast path", {
                    backend: this.backend.name,
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                    forcePlay,
                });
            }
            if (shouldUseCurrentFastPath) {
                // 获取底层播放器中的当前 track
                trace("TrackPlayer.play current branch getActiveTrack start", {
                    backend: this.backend.name,
                });
                const currentTrack = await this.backend.getActiveTrack?.();
                trace("TrackPlayer.play current branch getActiveTrack end", {
                    hasTrack: !!currentTrack,
                    trackUrl: currentTrack?.url,
                    trackId: currentTrack?.id,
                    trackPlatform: currentTrack?.platform,
                });
                // 2.1 如果当前有源
                if (
                    currentTrack?.url &&
                    isSameMediaItem(
                        musicItem,
                        currentTrack as IMusic.IMusicItem,
                    )
                ) {
                    if (forcePlay) {
                        // 2.1.1 强制重新开始
                        await this.seekTo(0);
                    } else if (seekToTime) {
                        const currentProgress = await this.backend
                            .getProgress()
                            .catch(() => null);
                        if (!currentProgress || currentProgress.position < 1) {
                            await this.seekTo(seekToTime);
                        }
                    }
                    const currentState = await this.backend.getState();
                    if (currentState === "stopped" || currentState === "idle") {
                        await this.setTrackSource(
                            currentTrack,
                            true,
                            seekToTime,
                        );
                    }
                    if (currentState !== "playing") {
                        // 2.1.2 恢复播放
                        await this.backend.play();
                    }
                    // 这种情况下，播放队列和当前歌曲都不需要变化
                    return;
                }
                // 2.2 其他情况：重新获取源
            }

            // 3. 如果没有在播放列表中，添加到队尾；同时更新列表状态
            const inPlayList = this.isInPlayList(musicItem);
            if (!inPlayList) {
                this.add(musicItem);
            } else {
                this.replacePlayListMusicIfPresent(musicItem);
            }

            // 4. 更新列表状态和当前音乐
            if (!shouldDeferMpvCurrentCommit) {
                commitProposedMusic();
            }

            // 5. 获取音源
            let track: IMusic.IMusicItem;

            // 5.1 通过插件获取音源
            const plugin = this.pluginManagerService.getByName(
                musicItem.platform,
            );
            // 5.2 获取音质排序
            const qualityOrder = getQualityOrder(
                this.configService.getConfig("basic.defaultPlayQuality") ??
                    "standard",
                this.configService.getConfig("basic.playQualityOrder") ?? "asc",
            );
            // 5.3 插件返回音源
            let source: IPlugin.IMediaSourceResult | null = null;
            for (let quality of qualityOrder) {
                if (isPlayRequestActive()) {
                    trace("TrackPlayer.play getMediaSource start", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                        quality,
                    });
                    let candidate: IPlugin.IMediaSourceResult | null = null;
                    try {
                        // 硬超时：插件 Promise 永不 settle 时，这次切歌会一直挂着，
                        // 并占住手动切歌的串行队列，用户点通知栏就像没反应。
                        // 超时后走下面的失败分支继续推进；迟到的结果由
                        // isPlayRequestActive() 挡住，不会回写状态。
                        const sourceTask = plugin?.methods?.getMediaSource(
                            musicItem,
                            quality,
                        );
                        candidate = sourceTask
                            ? (await withMediaSourceTimeout(
                                Promise.resolve(sourceTask),
                            )) ?? null
                            : null;
                    } catch (error) {
                        rememberSourceFailure(
                            classifyMediaSourceFailure(error, {
                                mediaKey: getMediaUniqueKey(musicItem),
                                pluginName: plugin?.name ?? musicItem.platform,
                                quality,
                            }),
                        );
                    }
                    trace("TrackPlayer.play getMediaSource end", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                        quality,
                        hasSource: !!candidate?.url,
                    });
                    if (!candidate?.url) {
                        rememberSourceFailure(
                            getMediaSourceResultFailure(
                                candidate,
                                {
                                    mediaKey: getMediaUniqueKey(musicItem),
                                    pluginName:
                                        plugin?.name ?? musicItem.platform,
                                    quality,
                                },
                                "unavailable",
                            ),
                        );
                    }
                    // 5.3.1 获取到真实源
                    if (candidate?.url) {
                        if (this.isUnsupportedEncryptedSource(candidate)) {
                            rememberSourceFailure(
                                createMediaSourceFailure(
                                    "encrypted-unsupported",
                                    {
                                        mediaKey:
                                            getMediaUniqueKey(musicItem),
                                        pluginName:
                                            plugin?.name ??
                                            musicItem.platform,
                                        quality,
                                    },
                                ),
                            );
                            continue;
                        }
                        source = await this.createPlayableSource(
                            candidate,
                            musicItem,
                            quality,
                            "plugin",
                        );
                        if (source?.url) {
                            this.setQuality(source.quality ?? quality);
                            break;
                        }
                        rememberSourceFailure(
                            getMediaSourceResultFailure(
                                source,
                                {
                                    mediaKey: getMediaUniqueKey(musicItem),
                                    pluginName:
                                        plugin?.name ?? musicItem.platform,
                                    quality,
                                },
                                "source-rejected",
                            ),
                        );
                    }
                } else {
                    // 5.3.2 已经切换到其他歌曲了，
                    return;
                }
            }

            if (!isPlayRequestActive()) {
                return;
            }
            if (!source) {
                // 如果有source
                if (musicItem.source) {
                    for (let quality of qualityOrder) {
                        const legacyQuality = convertToLegacyQuality(quality);
                        const directSource =
                            musicItem.source[quality] ??
                            (legacyQuality
                                ? musicItem.source[legacyQuality]
                                : undefined);
                        if (directSource?.url) {
                            if (
                                this.isUnsupportedEncryptedSource(directSource)
                            ) {
                                rememberSourceFailure(
                                    createMediaSourceFailure(
                                        "encrypted-unsupported",
                                        {
                                            mediaKey:
                                                getMediaUniqueKey(musicItem),
                                            pluginName: musicItem.platform,
                                            quality,
                                        },
                                    ),
                                );
                                continue;
                            }
                            source = await this.createPlayableSource(
                                directSource,
                                musicItem,
                                quality,
                                "embedded-cache",
                            );
                            if (source?.url) {
                                this.setQuality(source.quality ?? quality);
                                break;
                            }
                            rememberSourceFailure(
                                getMediaSourceResultFailure(
                                    source,
                                    {
                                        mediaKey:
                                            getMediaUniqueKey(musicItem),
                                        pluginName: musicItem.platform,
                                        quality,
                                    },
                                    "source-rejected",
                                ),
                            );
                        }
                    }
                }
                // 5.4 没有返回源
                if (!source && !musicItem.url) {
                    // 插件失效的情况
                    if (
                        this.configService.getConfig(
                            "basic.tryChangeSourceWhenPlayFail",
                        )
                    ) {
                        // 重试
                        const similarMusic = await this.getSimilarMusic(
                            musicItem,
                            "music",
                            () => !isPlayRequestActive(),
                        );

                        if (similarMusic) {
                            const similarMusicPlugin =
                                this.pluginManagerService.getByMedia(
                                    similarMusic,
                                );

                            for (let quality of qualityOrder) {
                                if (isPlayRequestActive()) {
                                    let candidate: IPlugin.IMediaSourceResult | null =
                                        null;
                                    try {
                                        candidate =
                                            (await similarMusicPlugin?.methods?.getMediaSource(
                                                similarMusic,
                                                quality,
                                            )) ?? null;
                                    } catch (error) {
                                        rememberSourceFailure(
                                            classifyMediaSourceFailure(error, {
                                                mediaKey:
                                                    getMediaUniqueKey(
                                                        similarMusic,
                                                    ),
                                                pluginName:
                                                    similarMusicPlugin?.name ??
                                                    similarMusic.platform,
                                                quality,
                                            }),
                                            "similar",
                                        );
                                    }
                                    if (!candidate?.url) {
                                        rememberSourceFailure(
                                            getMediaSourceResultFailure(
                                                candidate,
                                                {
                                                    mediaKey:
                                                        getMediaUniqueKey(
                                                            similarMusic,
                                                        ),
                                                    pluginName:
                                                        similarMusicPlugin?.name ??
                                                        similarMusic.platform,
                                                    quality,
                                                },
                                                "unavailable",
                                            ),
                                            "similar",
                                        );
                                    }
                                    // 5.4.1 获取到真实源
                                    if (candidate?.url) {
                                        if (
                                            this.isUnsupportedEncryptedSource(
                                                candidate,
                                            )
                                        ) {
                                            rememberSourceFailure(
                                                createMediaSourceFailure(
                                                    "encrypted-unsupported",
                                                    {
                                                        mediaKey:
                                                            getMediaUniqueKey(
                                                                similarMusic,
                                                            ),
                                                        pluginName:
                                                            similarMusicPlugin?.name ??
                                                            similarMusic.platform,
                                                        quality,
                                                    },
                                                ),
                                                "similar",
                                            );
                                            continue;
                                        }
                                        source = await this.createPlayableSource(
                                            candidate,
                                            similarMusic,
                                            quality,
                                            "similar-plugin",
                                        );
                                        if (source?.url) {
                                            this.setQuality(
                                                source.quality ?? quality,
                                            );
                                            break;
                                        }
                                        rememberSourceFailure(
                                            getMediaSourceResultFailure(
                                                source,
                                                {
                                                    mediaKey:
                                                        getMediaUniqueKey(
                                                            similarMusic,
                                                        ),
                                                    pluginName:
                                                        similarMusicPlugin?.name ??
                                                        similarMusic.platform,
                                                    quality,
                                                },
                                                "source-rejected",
                                            ),
                                            "similar",
                                        );
                                    }
                                } else {
                                    // 5.4.2 已经切换到其他歌曲了，
                                    return;
                                }
                            }
                        }

                        if (!source) {
                            throw createInvalidSourceError();
                        }
                    } else {
                        throw createInvalidSourceError();
                    }
                } else if (!source && musicItem.url) {
                    const directSource = {
                        url: musicItem.url,
                        ekey: musicItem.ekey,
                        cek: musicItem.cek,
                    };
                    if (this.isUnsupportedEncryptedSource(directSource)) {
                        rememberSourceFailure(
                            createMediaSourceFailure(
                                "encrypted-unsupported",
                                {
                                    mediaKey: getMediaUniqueKey(musicItem),
                                    pluginName: musicItem.platform,
                                },
                            ),
                        );
                    } else {
                        source = await this.createPlayableSource(
                            directSource,
                            musicItem,
                            undefined,
                            "direct",
                        );
                        if (!source?.url) {
                            rememberSourceFailure(
                                getMediaSourceResultFailure(
                                    source,
                                    {
                                        mediaKey:
                                            getMediaUniqueKey(musicItem),
                                        pluginName: musicItem.platform,
                                    },
                                    "source-rejected",
                                ),
                            );
                        }
                    }
                }
            }

            if (!source?.url) {
                throw createInvalidSourceError();
            }
            if (this.isUnsupportedEncryptedSource(source)) {
                rememberSourceFailure(
                    createMediaSourceFailure("encrypted-unsupported", {
                        mediaKey: getMediaUniqueKey(musicItem),
                        pluginName: musicItem.platform,
                        quality: source.quality,
                    }),
                );
                throw createInvalidSourceError();
            }

            if (shouldDeferMpvCurrentCommit) {
                if (!isPlayRequestActive()) {
                    return;
                }
                commitProposedMusic();
            }

            // 6. 特殊类型源
            if (getUrlExt(source.url) === ".m3u8") {
                // @ts-ignore
                source.type = "hls";
            }
            // 7. 合并结果
            track = this.mergeTrackSource(
                musicItem,
                source,
            ) as IMusic.IMusicItem;

            track.userAgent = track.userAgent || getAppUserAgent();


            // MPV 只在原生确认 active identity 后计入历史；Nitro 保持显式播放路径。
            if (this.backend.name !== "mpv") {
                this.musicHistoryService.addMusic(musicItem);
            }
            trace("获取音源成功", {
                sourceType: this.getDiagnosticUrlType(source.url),
                encrypted: Boolean(source.ekey && source.cek),
                backend: this.backend.name,
            });
            // 9. 设置音源
            await this.setTrackSource(
                track as MusicFreePlayerTrack,
                true,
                seekToTime,
            );
            if (
                mpvTransitionOwner &&
                !this.isMpvManualSkipTransitionActive(mpvTransitionOwner)
            ) {
                return;
            }
            if (
                ownedMpvTransition &&
                this.isMpvManualSkipTransitionActive(ownedMpvTransition)
            ) {
                const confirmed = await this.confirmMpvManualSkip(
                    musicItem,
                    "explicit-play",
                    ownedMpvTransition,
                );
                if (confirmed) {
                    this.completeMpvManualSkipTransition(
                        ownedMpvTransition,
                        "explicit-play",
                    );
                } else {
                    await this.rollbackMpvManualSkipTransition(
                        ownedMpvTransition,
                        "explicit-play-timeout",
                    );
                    return;
                }
            }

            const supplementalInfoPromise = this.updateSupplementalMusicInfo(
                musicItem,
                track,
            );
            if (mpvTransitionOwner) {
                supplementalInfoPromise.catch(error => {
                    errorLog(
                        "切歌后补充歌曲信息失败",
                        error?.message ?? error,
                    );
                });
                return;
            }
            await supplementalInfoPromise;
        } catch (e: any) {
            const transitionToRollback =
                ownedMpvTransition &&
                this.isMpvManualSkipTransitionActive(ownedMpvTransition)
                    ? ownedMpvTransition
                    : mpvTransitionOwner &&
                        this.isMpvManualSkipTransitionActive(
                            mpvTransitionOwner,
                        )
                        ? mpvTransitionOwner
                        : null;
            if (transitionToRollback) {
                await this.rollbackMpvManualSkipTransition(
                    transitionToRollback,
                    "explicit-play-error",
                ).catch(() => undefined);
            }
            this.recordPlaybackError(e);
            const message = e?.message;
            trace(
                "TrackPlayer.play error",
                {
                    backend: this.backend.name,
                    message,
                    stack: e?.stack,
                },
                "error",
            );
            if (
                message ===
                "The player is not initialized. Call setupPlayer first."
            ) {
                await this.backend.setup();
                this.play(musicItem, forcePlay);
            } else if (message === PlayFailReason.FORBID_CELLUAR_NETWORK_PLAY) {
                this.emit(TrackPlayerEvents.CellularPlayForbidden);
            } else if (message === PlayFailReason.MISSING_AUDIO_PERMISSION) {
                // 不要走 handlePlayFail：那会自动跳到下一首，而队列里的其他本地
                // 歌曲同样会因为缺权限失败，结果是把整个队列快速跳完。
                this.emit(TrackPlayerEvents.LocalAudioPermissionRequired);
            } else if (message === PlayFailReason.INVALID_SOURCE) {
                trace("音源为空，播放失败");
                this.lastInvalidSourceKey = musicItem
                    ? getMediaUniqueKey(musicItem)
                    : null;
                this.emit(
                    TrackPlayerEvents.MediaSourceFailed,
                    classifyMediaSourceFailure(e, {
                        mediaKey: musicItem
                            ? getMediaUniqueKey(musicItem)
                            : undefined,
                        pluginName: musicItem?.platform,
                    }),
                );
                await this.handlePlayFail();
            } else if (message === PlayFailReason.PLAY_LIST_IS_EMPTY) {
                // 队列是空的，不应该出现这种情况
            }
        }
    }

    private async updateSupplementalMusicInfo(
        musicItem: IMusic.IMusicItem,
        track: IMusic.IMusicItem,
    ) {
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        let info: Partial<IMusic.IMusicItem> | null = null;
        try {
            info =
                (await plugin?.methods?.getMusicInfo?.(musicItem)) ?? null;
            if (
                (typeof info?.url === "string" && info.url.trim() === "") ||
                (info?.url && typeof info.url !== "string")
            ) {
                delete info.url;
            }
        } catch {}

        if (!info || !this.isCurrentMusic(musicItem)) {
            return;
        }
        const metadataMusic = this.mergeTrackSource(
            musicItem,
            info,
        ) as IMusic.IMusicItem;
        const mergedTrack = this.mergeTrackSource(track, info);
        mergedTrack.userAgent = mergedTrack.userAgent || getAppUserAgent();
        this.replacePlayListMusicIfPresent(metadataMusic, false);
        getDefaultStore().set(
            currentMusicAtom,
            mergedTrack as IMusic.IMusicItem,
        );
        await this.backend.updateTrack({
            ...mergedTrack,
            musicItem: metadataMusic,
        } as unknown as MusicFreePlayerTrack);
    }

    async pause(): Promise<void> {
        this.crossfade.onPause();
        LastfmScrobbler.onPaused();
        await this.backend.pause();
    }

    async prepareForAppExit(): Promise<void> {
        if (this.isForceExiting) {
            return;
        }
        this.isForceExiting = true;
        this.crossfade.dispose();
        // 退出前把当前这首结算掉，够阈值的话至少能进离线队列，下次启动补交。
        LastfmScrobbler.onPlaybackStopped();

        const currentMusic = this.currentMusic;
        if (currentMusic) {
            let progress = getDefaultStore().get(progressAtom);
            try {
                progress = normalizeAdapterProgress(
                    await this.backend.getProgress(),
                    currentMusic.duration ?? 0,
                );
                if (progress.position > 0) {
                    setPlayerProgress(progress, currentMusic.duration ?? 0);
                }
            } catch {
                // Use the last UI progress if the native player is already stopping.
            }

            if (progress.position > 0) {
                PersistStatus.set(
                    "music.musicItem",
                    stripEphemeralLocalArtwork(currentMusic),
                );
                this.persistPlaybackProgress(progress.position, true);
            }
        }
        this.disposeServiceListeners();
    }

    toggleRepeatMode(): void {
        this.setRepeatMode(TrackPlayer.toggleRepeatMapping[this.repeatMode]);
    }

    // 清空播放队列
    async clearPlayList(): Promise<void> {
        this.manualSkipGate.cancelPending();
        this.cancelMpvManualSkipTransition("clear-playlist");
        this.setPlayList([]);
        this.setCurrentMusic(null);

        await this.backend.reset();
        PersistStatus.set("music.musicItem", undefined);
        this.setPersistedPlaybackProgress(0);
    }

    async skipToNext(intentEnqueuedAt?: number): Promise<void> {
        return this.manualSkipGate.run(token => {
            if (this.shouldDropStaleSkipIntent(intentEnqueuedAt, "next")) {
                return Promise.resolve();
            }
            return this.skipToNextInternal(token);
        });
    }

    /**
     * 操作在串行队列里等太久就作废。远程命令送达时那一层拦的是「JS 被冻结、
     * 事件堆在桥上」；这一层拦的是「事件及时送到了，但操作排在一次挂死的取源
     * 后面」——真机上后者才是「点了没反应、回前台连跳好几首」的成因。
     */
    private shouldDropStaleSkipIntent(
        intentEnqueuedAt: number | undefined,
        label: string,
    ) {
        if (
            !isStaleManualSkipIntent({
                enqueuedAt: intentEnqueuedAt,
                now: Date.now(),
            })
        ) {
            return false;
        }
        trace("丢弃排队过久的手动切歌意图", {
            label,
            intentEnqueuedAt,
            waitedMs: Date.now() - (intentEnqueuedAt ?? 0),
        });
        return true;
    }

    private async skipToNextInternal(
        operationToken: IManualSkipOperationToken,
    ): Promise<void> {
        if (this.backend.name === "mpv") {
            await this.alignMpvCurrentBeforeManualSkip(
                "manual-next-start",
            );
            if (!this.manualSkipGate.isActive(operationToken)) {
                return;
            }
        }

        const playLaterTarget = this.playLaterQueue[0] ?? null;
        const playLaterTransition =
            this.backend.name === "mpv" && playLaterTarget
                ? this.beginMpvManualSkipTransition(
                    playLaterTarget,
                    this.currentMusic,
                    "play-later-next",
                )
                : null;
        if (playLaterTransition) {
            await this.pauseMpvActiveTrackForTransition(
                playLaterTransition,
            );
            if (
                !this.isMpvManualSkipTransitionActive(
                    playLaterTransition,
                )
            ) {
                return;
            }
        }
        let playedLater = false;
        try {
            playedLater = await this.playNextLaterQueue(
                playLaterTransition,
            );
        } catch (error) {
            if (playLaterTransition) {
                await this.rollbackMpvManualSkipTransition(
                    playLaterTransition,
                    "play-later-next-error",
                );
            }
            throw error;
        }
        if (playedLater) {
            if (this.backend.name === "mpv" && playLaterTarget) {
                const confirmed = await this.confirmMpvManualSkip(
                    playLaterTarget,
                    "play-later-next",
                    playLaterTransition,
                );
                if (confirmed && playLaterTransition) {
                    this.completeMpvManualSkipTransition(
                        playLaterTransition,
                        "play-later-next",
                    );
                } else if (playLaterTransition) {
                    await this.rollbackMpvManualSkipTransition(
                        playLaterTransition,
                        "play-later-next-timeout",
                    );
                }
            }
            return;
        }
        if (playLaterTransition) {
            await this.rollbackMpvManualSkipTransition(
                playLaterTransition,
                "play-later-next-missing",
            );
        }

        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        const previousMusic = this.currentMusic;
        let optimisticMpvNext: IMusic.IMusicItem | null = null;
        let mpvManualTransition: IMpvManualSkipTransition | null = null;
        let resolvedMpvNextTrack: MusicFreePlayerTrack | null = null;
        let mpvTemporaryNextTrack: Partial<IMusic.IMusicItem> | null = null;
        let mpvTemporaryNextMusic: IMusic.IMusicItem | null = null;
        if (this.backend.name === "mpv" && previousMusic) {
            const playNextQueuePromise = this.backend.getPlayNextQueue
                ? this.backend.getPlayNextQueue().catch(() => [])
                : Promise.resolve([]);
            const upNextQueuePromise = this.backend.getUpNextQueue
                ? this.backend.getUpNextQueue().catch(() => [])
                : Promise.resolve([]);
            const [playNextQueue, upNextQueue] = await Promise.all([
                playNextQueuePromise,
                upNextQueuePromise,
            ]);
            if (!this.manualSkipGate.isActive(operationToken)) {
                return;
            }
            mpvTemporaryNextTrack =
                playNextQueue.find(Boolean) ??
                upNextQueue.find(Boolean) ??
                null;
            mpvTemporaryNextMusic = mpvTemporaryNextTrack
                ? this.resolveMusicFromAdapterTrack(mpvTemporaryNextTrack)
                : null;
            const currentIndex = this.getMusicIndexInPlayList(previousMusic);
            const nextIndex = this.getWrappedPlayListIndex(currentIndex + 1);
            const queueNextMusic =
                nextIndex >= 0 ? this.playList[nextIndex] ?? null : null;
            optimisticMpvNext = mpvTemporaryNextTrack
                ? mpvTemporaryNextMusic
                : queueNextMusic;
            if (
                optimisticMpvNext &&
                !isSameMediaItem(previousMusic, optimisticMpvNext)
            ) {
                mpvManualTransition = this.beginMpvManualSkipTransition(
                    optimisticMpvNext,
                    previousMusic,
                    "manual-next",
                );
                await this.pauseMpvActiveTrackForTransition(
                    mpvManualTransition,
                );
                if (
                    !this.isMpvManualSkipTransitionActive(
                        mpvManualTransition,
                    )
                ) {
                    return;
                }
                resolvedMpvNextTrack =
                    await this.resolveMpvTransitionTrackSource(
                        optimisticMpvNext,
                        mpvManualTransition,
                    );
                if (
                    !this.isMpvManualSkipTransitionActive(
                        mpvManualTransition,
                    )
                ) {
                    return;
                }
                if (!resolvedMpvNextTrack) {
                    await this.playMpvTransitionTargetWithFallback(
                        optimisticMpvNext,
                        mpvManualTransition,
                        "manual-next-source-fallback",
                    );
                    return;
                }
                this.setCurrentMusic(optimisticMpvNext);
                setPlayerProgress({
                    position: 0,
                    duration: Number(optimisticMpvNext.duration) || 0,
                    buffered: 0,
                });
            }
        }

        let backendNextMusic: IMusic.IMusicItem | null = null;
        if (this.backend.getNextTracks && !mpvTemporaryNextTrack) {
            const nextTracks = await this.backend
                .getNextTracks(1)
                .catch(error => {
                    errorLog("后端下一首队列读取失败", error?.message ?? error);
                    return [];
                });
            if (
                this.backend.name === "mpv" &&
                !this.manualSkipGate.isActive(operationToken)
            ) {
                return;
            }
            if (nextTracks.length > 0) {
                backendNextMusic = this.resolveMusicFromAdapterTrack(
                    nextTracks[0],
                );
                if (
                    this.backend.name === "mpv" &&
                    !mpvManualTransition &&
                    previousMusic &&
                    backendNextMusic &&
                    !isSameMediaItem(previousMusic, backendNextMusic)
                ) {
                    mpvManualTransition =
                        this.beginMpvManualSkipTransition(
                            backendNextMusic,
                            previousMusic,
                            "manual-next-backend",
                        );
                    await this.pauseMpvActiveTrackForTransition(
                        mpvManualTransition,
                    );
                    if (
                        !this.isMpvManualSkipTransitionActive(
                            mpvManualTransition,
                        )
                    ) {
                        return;
                    }
                    resolvedMpvNextTrack =
                        await this.resolveMpvTransitionTrackSource(
                            backendNextMusic,
                            mpvManualTransition,
                        );
                    if (
                        !this.isMpvManualSkipTransitionActive(
                            mpvManualTransition,
                        )
                    ) {
                        return;
                    }
                    if (!resolvedMpvNextTrack) {
                        await this.playMpvTransitionTargetWithFallback(
                            backendNextMusic,
                            mpvManualTransition,
                            "manual-next-backend-source-fallback",
                        );
                        return;
                    }
                    this.setCurrentMusic(backendNextMusic);
                    setPlayerProgress({
                        position: 0,
                        duration: Number(backendNextMusic.duration) || 0,
                        buffered: 0,
                    });
                }
                if (this.backend.name !== "mpv" || !mpvManualTransition) {
                    await this.resolveNitroQueuedTracks(nextTracks).catch(
                        error => {
                            errorLog(
                                "后端下一首音源预解析失败",
                                error?.message ?? error,
                            );
                        },
                    );
                }
                if (
                    mpvManualTransition &&
                    !this.isMpvManualSkipTransitionActive(
                        mpvManualTransition,
                    )
                ) {
                    return;
                }
                if (
                    this.backend.name === "mpv" &&
                    !this.manualSkipGate.isActive(operationToken)
                ) {
                    return;
                }
            }
        }
        if (
            this.backend.name === "mpv" &&
            !this.manualSkipGate.isActive(operationToken)
        ) {
            return;
        }
        const expectedMpvNext = optimisticMpvNext ?? backendNextMusic;
        try {
            if (
                this.backend.name === "mpv" &&
                mpvTemporaryNextTrack &&
                resolvedMpvNextTrack &&
                this.backend.playTrack
            ) {
                const removedFromPlayNext =
                    (await this.backend.removeFromPlayNext?.(
                        mpvTemporaryNextTrack as PlayerAdapterTrack,
                    )) ?? false;
                if (!removedFromPlayNext) {
                    await this.backend.removeFromUpNext?.(
                        mpvTemporaryNextTrack as PlayerAdapterTrack,
                    );
                }
                await this.backend.playTrack(resolvedMpvNextTrack);
            } else if (
                this.backend.name === "mpv" &&
                mpvManualTransition &&
                expectedMpvNext
            ) {
                const expectedIndex =
                    this.getMusicIndexInPlayList(expectedMpvNext);
                const started = await this.backend.skipToIndex(expectedIndex);
                if (!started) {
                    throw new Error("MPV_TARGET_INDEX_UNAVAILABLE");
                }
            } else {
                await this.backend.skipToNext();
            }
        } catch (error) {
            if (mpvManualTransition) {
                await this.rollbackMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-next-error",
                );
            }
            throw error;
        }
        if (this.backend.name === "mpv" && expectedMpvNext) {
            const confirmed = await this.confirmMpvManualSkip(
                expectedMpvNext,
                "manual-next",
                mpvManualTransition,
            );
            if (confirmed && mpvManualTransition) {
                this.completeMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-next",
                );
            } else if (mpvManualTransition) {
                await this.rollbackMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-next-timeout",
                );
            }
            return;
        }
        const syncedMusic =
            await this.syncCurrentMusicFromBackendActiveTrack("manual");
        if (
            !syncedMusic &&
            optimisticMpvNext &&
            !isSameMediaItem(this.currentMusic, optimisticMpvNext)
        ) {
            this.setCurrentMusic(optimisticMpvNext);
        }
    }

    async skipToPrevious(intentEnqueuedAt?: number): Promise<void> {
        return this.manualSkipGate.run(token => {
            if (this.shouldDropStaleSkipIntent(intentEnqueuedAt, "previous")) {
                return Promise.resolve();
            }
            return this.skipToPreviousInternal(token);
        });
    }

    private async skipToPreviousInternal(
        operationToken: IManualSkipOperationToken,
    ): Promise<void> {
        if (this.backend.name === "mpv") {
            await this.alignMpvCurrentBeforeManualSkip(
                "manual-previous-start",
            );
            if (!this.manualSkipGate.isActive(operationToken)) {
                return;
            }
        }

        if (this.isPlayListEmpty()) {
            this.setCurrentMusic(null);
            return;
        }

        const currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
        const previous = resolvePreviousQueueItem(this.playList, currentIndex);
        if (!previous) {
            return;
        }

        trace("统一上一首切歌", {
            backend: this.backend.name,
            fromIndex: currentIndex,
            toIndex: previous.index,
            musicId: previous.item.id,
            platform: previous.item.platform,
        });
        if (this.backend.name === "mpv") {
            const currentMusic = this.currentMusic;
            const mpvManualTransition =
                this.beginMpvManualSkipTransition(
                    previous.item,
                    currentMusic,
                    "manual-previous",
                );
            await this.pauseMpvActiveTrackForTransition(
                mpvManualTransition,
            );
            if (
                !this.isMpvManualSkipTransitionActive(
                    mpvManualTransition,
                )
            ) {
                return;
            }
            const resolvedTrack = await this.resolveMpvTransitionTrackSource(
                previous.item,
                mpvManualTransition,
            );
            if (
                !this.isMpvManualSkipTransitionActive(mpvManualTransition)
            ) {
                return;
            }
            if (!resolvedTrack) {
                await this.playMpvTransitionTargetWithFallback(
                    previous.item,
                    mpvManualTransition,
                    "manual-previous-source-fallback",
                );
                return;
            }
            this.setCurrentMusic(previous.item);
            setPlayerProgress({
                position: 0,
                duration: Number(previous.item.duration) || 0,
                buffered: 0,
            });
            try {
                const started = await this.backend.skipToIndex(previous.index);
                if (!started) {
                    throw new Error("MPV_TARGET_INDEX_UNAVAILABLE");
                }
            } catch (error) {
                await this.rollbackMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-previous-error",
                );
                throw error;
            }
            const confirmed = await this.confirmMpvManualSkip(
                previous.item,
                "manual-previous",
                mpvManualTransition,
            );
            if (confirmed) {
                this.completeMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-previous",
                );
            } else {
                await this.rollbackMpvManualSkipTransition(
                    mpvManualTransition,
                    "manual-previous-timeout",
                );
            }
            return;
        }
        await this.play(previous.item, true);
    }

    private async readMpvActiveMusic() {
        if (this.backend.name !== "mpv") {
            return null;
        }
        const activeTrack = await this.backend
            .getActiveTrack?.()
            .catch(() => null);
        if (!activeTrack) {
            return null;
        }
        const activeIndex = await this.backend
            .getActiveTrackIndex?.()
            .catch(() => null);
        return this.resolveMusicFromAdapterTrack(
            activeTrack as Partial<IMusic.IMusicItem>,
            typeof activeIndex === "number" ? activeIndex : undefined,
        );
    }

    private async alignMpvCurrentBeforeManualSkip(reason: string) {
        const requestedMusic = this.currentMusic;
        if (
            requestedMusic &&
            (await this.waitForMpvActiveMusic(requestedMusic, 700))
        ) {
            return requestedMusic;
        }
        return this.syncCurrentMusicFromBackendActiveTrack(reason);
    }

    private async waitForMpvActiveMusic(
        expectedMusic: IMusic.IMusicItem,
        timeoutMs: number,
        transition?: IMpvManualSkipTransition | null,
    ) {
        return waitForExpectedActive(
            () => this.readMpvActiveMusic(),
            activeMusic => isSameMediaItem(activeMusic, expectedMusic),
            {
                timeoutMs,
                pollIntervalMs: 32,
                sleep: durationMs => delay(durationMs, false),
                isCancelled: transition
                    ? () =>
                        !this.isMpvManualSkipTransitionActive(transition)
                    : undefined,
            },
        );
    }

    private async confirmMpvManualSkip(
        expectedMusic: IMusic.IMusicItem,
        reason: string,
        transition?: IMpvManualSkipTransition | null,
    ) {
        if (
            transition &&
            !this.isMpvManualSkipTransitionActive(transition)
        ) {
            return false;
        }
        let activeMusic = await this.waitForMpvActiveMusic(
            expectedMusic,
            1600,
            transition,
        );
        if (!activeMusic) {
            if (
                transition &&
                !this.isMpvManualSkipTransitionActive(transition)
            ) {
                return false;
            }
            trace(
                "MPV 手动切歌确认超时，显式重载目标歌曲",
                {
                    reason,
                    expectedId: expectedMusic.id,
                    expectedPlatform: expectedMusic.platform,
                },
                "error",
            );
            await this.play(expectedMusic, true, transition);
            activeMusic = await this.waitForMpvActiveMusic(
                expectedMusic,
                2600,
                transition,
            );
        }
        if (!activeMusic) {
            trace(
                "MPV 手动切歌最终确认失败",
                {
                    reason,
                    expectedId: expectedMusic.id,
                    expectedPlatform: expectedMusic.platform,
                },
                "error",
            );
            return false;
        }
        if (
            transition &&
            !this.isMpvManualSkipTransitionActive(transition)
        ) {
            return false;
        }
        const syncedMusic =
            await this.syncCurrentMusicFromBackendActiveTrack(reason);
        return !!syncedMusic && isSameMediaItem(syncedMusic, expectedMusic);
    }

    private async playMpvTransitionTargetWithFallback(
        expectedMusic: IMusic.IMusicItem,
        transition: IMpvManualSkipTransition,
        reason: string,
    ) {
        await this.play(expectedMusic, true, transition);
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }
        const confirmed = await this.confirmMpvManualSkip(
            expectedMusic,
            reason,
            transition,
        );
        if (confirmed) {
            this.completeMpvManualSkipTransition(transition, reason);
            return true;
        }
        await this.rollbackMpvManualSkipTransition(
            transition,
            `${reason}-timeout`,
        );
        return false;
    }

    private beginMpvManualSkipTransition(
        expectedMusic: IMusic.IMusicItem,
        previousMusic: IMusic.IMusicItem | null,
        reason: string,
    ): IMpvManualSkipTransition {
        const token = this.mpvTrackTransitionGate.begin(
            getMediaUniqueKey(expectedMusic),
        );
        this.mpvActiveTrackSyncSerial += 1;
        const transition = {
            token,
            expectedMusic,
            previousMusic,
            previousProgress: {
                ...getDefaultStore().get(progressAtom),
            },
            resumeOnRollback: false,
            reason,
        };
        this.mpvManualSkipTransition = transition;
        trace("MPV 手动切歌事务开始", {
            id: token.id,
            reason,
            expectedKey: token.expectedKey,
            previousKey: previousMusic
                ? getMediaUniqueKey(previousMusic)
                : null,
        });
        return transition;
    }

    private async pauseMpvActiveTrackForTransition(
        transition: IMpvManualSkipTransition,
    ) {
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return;
        }
        const state = await this.backend.getState().catch(() => null);
        if (
            (state !== "playing" && state !== "buffering") ||
            !this.isMpvManualSkipTransitionActive(transition)
        ) {
            return;
        }
        transition.resumeOnRollback = true;
        await this.backend.pause().catch(() => undefined);
    }

    private isMpvManualSkipTransitionActive(
        transition?: IMpvManualSkipTransition | null,
    ) {
        return (
            !!transition &&
            this.mpvManualSkipTransition?.token.id === transition.token.id &&
            this.mpvTrackTransitionGate.isActive(transition.token)
        );
    }

    private hasActiveMpvManualSkipTransition() {
        return this.isMpvManualSkipTransitionActive(
            this.mpvManualSkipTransition,
        );
    }

    private shouldSuppressMpvProgressDuringManualSkip() {
        return (
            this.backend.name === "mpv" &&
            this.hasActiveMpvManualSkipTransition()
        );
    }

    private cancelMpvManualSkipTransition(reason: string) {
        const transition = this.mpvManualSkipTransition;
        if (
            !transition ||
            !this.isMpvManualSkipTransitionActive(transition)
        ) {
            return false;
        }
        this.mpvTrackTransitionGate.clear(transition.token);
        this.mpvManualSkipTransition = null;
        this.mpvActiveTrackSyncSerial += 1;
        this.manualSkipGate.cancelPending();
        trace("MPV 手动切歌事务被新操作取消", {
            id: transition.token.id,
            reason,
            expectedKey: transition.token.expectedKey,
        });
        return true;
    }

    private cancelMpvManualSkipTransitionForTarget(
        musicItem: IMusic.IMusicItem,
        reason: string,
    ) {
        const transition = this.mpvManualSkipTransition;
        if (
            !transition ||
            !this.isMpvManualSkipTransitionActive(transition)
        ) {
            return false;
        }
        if (
            transition.token.expectedKey === getMediaUniqueKey(musicItem)
        ) {
            return false;
        }
        return this.cancelMpvManualSkipTransition(reason);
    }

    private completeMpvManualSkipTransition(
        transition: IMpvManualSkipTransition,
        reason: string,
    ) {
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }
        this.mpvTrackTransitionGate.clear(transition.token);
        this.mpvManualSkipTransition = null;
        this.mpvActiveTrackSyncSerial += 1;
        trace("MPV 手动切歌事务完成", {
            id: transition.token.id,
            reason,
            expectedKey: transition.token.expectedKey,
        });
        return true;
    }

    private async rollbackMpvManualSkipTransition(
        transition: IMpvManualSkipTransition,
        reason: string,
    ) {
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }

        const activeMusic = await this.readMpvActiveMusic();
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }
        const backendProgress = activeMusic
            ? await this.backend.getProgress().catch(() => null)
            : null;
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }

        const restoredMusic = activeMusic ?? transition.previousMusic;
        let restoredProgress: PlayerAdapterProgress | null = null;
        if (restoredMusic) {
            this.setCurrentMusic(restoredMusic);
            const progress =
                backendProgress ??
                (transition.previousMusic &&
                isSameMediaItem(restoredMusic, transition.previousMusic)
                    ? transition.previousProgress
                    : {
                        position: 0,
                        duration: Number(restoredMusic.duration) || 0,
                        buffered: 0,
                    });
            restoredProgress = setPlayerProgress(
                progress,
                restoredMusic.duration ?? 0,
            );
            this.emit(TrackPlayerEvents.ProgressChanged, restoredProgress);
            this.persistPlaybackProgress(restoredProgress.position, true);
        }

        const targetAlreadyActive =
            !!activeMusic &&
            isSameMediaItem(activeMusic, transition.expectedMusic);
        let backendRestored = false;
        if (
            restoredMusic &&
            !targetAlreadyActive &&
            this.backend.restoreActiveTrack
        ) {
            backendRestored = await this.backend
                .restoreActiveTrack({
                    autoPlay: transition.resumeOnRollback,
                })
                .catch(error => {
                    errorLog(
                        "MPV 切歌回滚重新加载已确认曲目失败",
                        error?.message ?? error,
                    );
                    return false;
                });
            if (!this.isMpvManualSkipTransitionActive(transition)) {
                return false;
            }
            if (backendRestored && (restoredProgress?.position ?? 0) > 0) {
                await this.backend
                    .seekTo(restoredProgress!.position)
                    .catch(error => {
                        errorLog(
                            "MPV 切歌回滚恢复进度失败",
                            error?.message ?? error,
                        );
                    });
            }
        }
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }
        if (
            transition.resumeOnRollback &&
            restoredMusic &&
            (!backendRestored || targetAlreadyActive)
        ) {
            await this.backend.play().catch(error => {
                errorLog(
                    "MPV 手动切歌回滚后恢复播放失败",
                    error?.message ?? error,
                );
            });
        } else if (!transition.resumeOnRollback && restoredMusic) {
            await this.backend.pause().catch(() => undefined);
        }
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return false;
        }
        this.mpvTrackTransitionGate.clear(transition.token);
        this.mpvManualSkipTransition = null;
        this.mpvActiveTrackSyncSerial += 1;
        trace("MPV 手动切歌事务回滚", {
            id: transition.token.id,
            reason,
            expectedKey: transition.token.expectedKey,
            activeKey: activeMusic ? getMediaUniqueKey(activeMusic) : null,
        });
        return true;
    }

    private shouldIgnoreMpvTrackChangeDuringManualSkip(evt: {
        track?: Partial<IMusic.IMusicItem> | null;
        index?: number;
        reason?: unknown;
    }) {
        if (!this.hasActiveMpvManualSkipTransition()) {
            return false;
        }
        const musicItem = this.resolveMusicFromAdapterTrack(
            evt.track,
            evt.index,
        );
        const activeKey = musicItem ? getMediaUniqueKey(musicItem) : null;
        if (this.mpvTrackTransitionGate.acceptsActiveKey(activeKey)) {
            return false;
        }
        trace("MPV 手动切歌期间忽略旧 trackChanged", {
            reason: evt.reason,
            activeKey,
            expectedKey: this.mpvManualSkipTransition?.token.expectedKey,
        });
        return true;
    }

    private shouldIgnoreMpvPlaybackErrorDuringManualSkip(
        track?: Partial<IMusic.IMusicItem> | null,
    ) {
        if (!this.hasActiveMpvManualSkipTransition()) {
            return false;
        }
        const musicItem = this.resolveMusicFromAdapterTrack(track);
        const activeKey = musicItem ? getMediaUniqueKey(musicItem) : null;
        const shouldIgnore =
            !this.mpvTrackTransitionGate.acceptsActiveKey(activeKey);
        if (shouldIgnore) {
            trace("MPV 手动切歌期间忽略旧 playbackError", {
                activeKey,
                expectedKey:
                    this.mpvManualSkipTransition?.token.expectedKey,
            });
        }
        return shouldIgnore;
    }

    private shouldIgnoreMpvActiveMusicDuringManualSkip(
        activeMusic: IMusic.IMusicItem,
        reason?: unknown,
    ) {
        if (!this.hasActiveMpvManualSkipTransition()) {
            return false;
        }
        const activeKey = getMediaUniqueKey(activeMusic);
        if (this.mpvTrackTransitionGate.acceptsActiveKey(activeKey)) {
            return false;
        }
        trace("MPV 手动切歌期间忽略旧 active track 同步", {
            reason,
            activeKey,
            expectedKey: this.mpvManualSkipTransition?.token.expectedKey,
        });
        return true;
    }

    async changeQualityWithResult(
        newQuality: IMusic.IQualityKey,
    ): Promise<IQualityChangeResult> {
        const requestToken = this.qualityChangeCoordinator.begin();
        const superseded = (): IQualityChangeResult => ({
            success: false,
            requestedQuality: newQuality,
            superseded: true,
        });
        const fail = (
            failure: MediaSourceFailure,
            musicItem?: IMusic.IMusicItem | null,
        ): IQualityChangeResult => {
            if (
                !this.qualityChangeCoordinator.isActive(requestToken) ||
                (musicItem && !this.isCurrentMusic(musicItem))
            ) {
                return superseded();
            }
            this.recordPlaybackError({
                code: failure.code,
                message: `音质切换失败：${failure.code}`,
            });
            return {
                success: false,
                requestedQuality: newQuality,
                failure,
            };
        };

        // 获取当前的音乐和进度
        if (
            newQuality === this.quality &&
            !this.qualityChangeCoordinator.hasPendingCommit()
        ) {
            return {
                success: true,
                requestedQuality: newQuality,
                resolvedQuality: this.quality,
            };
        }

        // 获取当前歌曲
        const musicItem = this.currentMusic;
        if (!musicItem) {
            return fail(createMediaSourceFailure("unavailable", {
                quality: newQuality,
            }));
        }
        const failureContext = {
            mediaKey: getMediaUniqueKey(musicItem),
            pluginName: musicItem.platform,
            quality: newQuality,
        };

        let progress: PlayerAdapterProgress;
        try {
            progress = await this.backend.getProgress();
        } catch {
            return fail(createMediaSourceFailure(
                "backend-error",
                failureContext,
            ), musicItem);
        }
        if (
            !this.qualityChangeCoordinator.isActive(requestToken) ||
            !this.isCurrentMusic(musicItem)
        ) {
            return superseded();
        }

        const plugin = this.pluginManagerService.getByMedia(musicItem);
        let newSource: IPlugin.IMediaSourceResult | null = null;
        try {
            newSource = (await plugin?.methods?.getMediaSource(
                musicItem,
                newQuality,
            )) ?? null;
        } catch (error) {
            return fail(
                classifyMediaSourceFailure(error, failureContext),
                musicItem,
            );
        }
        if (
            !this.qualityChangeCoordinator.isActive(requestToken) ||
            !this.isCurrentMusic(musicItem)
        ) {
            return superseded();
        }
        if (!newSource?.url) {
            return fail(
                getMediaSourceResultFailure(
                    newSource,
                    failureContext,
                    "unavailable",
                ),
                musicItem,
            );
        }
        if (this.isUnsupportedEncryptedSource(newSource)) {
            return fail(createMediaSourceFailure(
                "encrypted-unsupported",
                failureContext,
            ), musicItem);
        }

        try {
            const playableSource = await this.createPlayableSource(
                newSource,
                musicItem,
                newQuality,
                "plugin",
            );
            if (
                !this.qualityChangeCoordinator.isActive(requestToken) ||
                !this.isCurrentMusic(musicItem)
            ) {
                return superseded();
            }
            if (!playableSource?.url) {
                return fail(
                    getMediaSourceResultFailure(
                        playableSource,
                        failureContext,
                        "source-rejected",
                    ),
                    musicItem,
                );
            }
            const resolvedQuality =
                playableSource.quality ?? newSource.quality ?? newQuality;
            const commit = await this.qualityChangeCoordinator.runLatest(
                requestToken,
                async (): Promise<IQualityChangeResult> => {
                    if (!this.isCurrentMusic(musicItem)) {
                        return superseded();
                    }
                    const playingState = await this.backend.getState();
                    if (
                        !this.qualityChangeCoordinator.isActive(requestToken) ||
                        !this.isCurrentMusic(musicItem)
                    ) {
                        return superseded();
                    }
                    const sourceAndQualityCommitted =
                        await commitQualitySourcePair({
                            resumePosition: progress.position ?? 0,
                            applySource: resumePosition =>
                                this.setTrackSource(
                                    this.mergeTrackSource(
                                        musicItem,
                                        playableSource,
                                    ) as unknown as MusicFreePlayerTrack,
                                    playingState === "playing",
                                    resumePosition,
                                ),
                            isTargetCurrent: () =>
                                this.isCurrentMusic(musicItem),
                            isRequestActive: () =>
                                this.qualityChangeCoordinator.isActive(
                                    requestToken,
                                ),
                            applyQuality: () =>
                                this.setQuality(resolvedQuality),
                        });
                    if (!sourceAndQualityCommitted) {
                        return superseded();
                    }
                    return {
                        success: true,
                        requestedQuality: newQuality,
                        resolvedQuality,
                    };
                },
            );
            if (!commit.executed) {
                return superseded();
            }
            return commit.value;
        } catch {
            return fail(createMediaSourceFailure(
                "backend-error",
                failureContext,
            ), musicItem);
        }
    }

    async changeQuality(newQuality: IMusic.IQualityKey): Promise<boolean> {
        return (await this.changeQualityWithResult(newQuality)).success;
    }

    async playWithReplacePlayList(
        musicItem: IMusic.IMusicItem,
        newPlayList: IMusic.IMusicItem[],
    ): Promise<void> {
        try {
            trace("TrackPlayer.playWithReplacePlayList start", {
                musicId: musicItem?.id,
                platform: musicItem?.platform,
                inputLength: newPlayList?.length ?? 0,
                repeatMode: this.repeatMode,
            });
            if (!Array.isArray(newPlayList) || newPlayList.length === 0) {
                newPlayList = [musicItem];
            }
            if (newPlayList.length === 0) {
                return;
            }

            const now = Date.now();
            if (newPlayList.length > TrackPlayer.maxMusicQueueLength) {
                newPlayList = this.shrinkPlayListToSize(
                    newPlayList,
                    newPlayList.findIndex(it => isSameMediaItem(it, musicItem)),
                );
            }

            const writablePlayList = newPlayList.map((it, index) => ({
                ...it,
                [timeStampSymbol]: now,
                [sortIndexSymbol]: index,
            }));
            const targetMusic = writablePlayList.find(it =>
                isSameMediaItem(it, musicItem),
            ) ?? {
                ...musicItem,
                [timeStampSymbol]: now,
                [sortIndexSymbol]: 0,
            };

            this.setPlayList(
                this.repeatMode === MusicRepeatMode.SHUFFLE
                    ? shuffle(writablePlayList)
                    : writablePlayList,
            );
            trace("TrackPlayer.playWithReplacePlayList before play", {
                musicId: targetMusic.id,
                platform: targetMusic.platform,
                queuedLength: writablePlayList.length,
                currentIndex: this.currentIndex,
            });
            await this.play(targetMusic, true);
            trace("TrackPlayer.playWithReplacePlayList end", {
                musicId: targetMusic.id,
                platform: targetMusic.platform,
            });
        } catch (e: any) {
            trace(
                "TrackPlayer.playWithReplacePlayList error",
                {
                    musicId: musicItem?.id,
                    platform: musicItem?.platform,
                    message: e?.message ?? String(e ?? ""),
                    stack: e?.stack,
                },
                "error",
            );
        }
    }

    async seekTo(progress: number) {
        this.setPersistedPlaybackProgress(progress);
        return this.backend.seekTo(progress);
    }

    getProgress = () => {
        if (this.shouldSuppressMpvProgressDuringManualSkip()) {
            const progress = getDefaultStore().get(progressAtom);
            return Promise.resolve({ ...progress });
        }
        return this.backend.getProgress();
    };
    getRate = () => this.backend.getRate();
    setRate = (rate: number) => this.backend.setRate(rate);
    reset = () => {
        this.manualSkipGate.cancelPending();
        this.cancelMpvManualSkipTransition("reset");
        return this.backend.reset();
    };

    async getPlaybackDiagnosticSnapshot(): Promise<IPlaybackDiagnosticSnapshot> {
        const currentMusic = this.currentMusic;
        const [
            backendState,
            progress,
            activeTrack,
            activeTrackIndex,
            rate,
            backendRepeatMode,
            nativeDiagnostics,
            backendNextTracks,
            backendDiagnostics,
        ] = await Promise.all([
            this.backend.getState().catch(() => "error" as PlayerBackendState),
            this.backend
                .getProgress()
                .then(it =>
                    normalizeAdapterProgress(it, currentMusic?.duration ?? 0),
                )
                .catch(() => getDefaultStore().get(progressAtom)),
            this.backend.getActiveTrack
                ? this.backend.getActiveTrack().catch(() => null)
                : Promise.resolve(null),
            this.backend.getActiveTrackIndex
                ? this.backend.getActiveTrackIndex().catch(() => null)
                : Promise.resolve(null),
            this.backend.getRate().catch(() => 1),
            this.backend.getRepeatMode
                ? this.backend.getRepeatMode().catch(() => undefined)
                : Promise.resolve(undefined),
            NativeUtils.getPlaybackNativeDiagnostics
                ? NativeUtils.getPlaybackNativeDiagnostics().catch(error => ({
                    error: this.sanitizeDiagnosticText(
                        error?.message ?? String(error ?? ""),
                    ),
                }))
                : Promise.resolve(undefined),
            this.backend.getNextTracks
                ? this.backend.getNextTracks(3).catch(() => [])
                : Promise.resolve([]),
            this.backend.getPlaybackDiagnostics
                ? this.backend.getPlaybackDiagnostics().catch(() => undefined)
                : Promise.resolve(undefined),
        ]);

        const queueIndex = this.getMusicIndexInPlayList(currentMusic);
        const backendCapabilities = this.getBackendCapabilities();
        const preparedNextMusic = this.resolvePreparedNextMusic();
        const preparedNextTrack = preparedNextMusic
            ? this.createNitroQueuedTrack(preparedNextMusic)
            : null;
        const activeTrackSummary = this.getDiagnosticTrackSummary(
            activeTrack as Partial<
                PlayerAdapterTrack & IMusic.IMusicItem
            > | null,
        );
        const backendNextTrackSummaries = backendNextTracks
            .map(track =>
                this.getDiagnosticTrackSummary(
                    track as Partial<
                        PlayerAdapterTrack & IMusic.IMusicItem
                    > | null,
                ),
            )
            .filter(
                (track): track is IPlaybackDiagnosticTrackSummary => !!track,
            );

        return {
            backendName: this.backend.name,
            backendState,
            backendRepeatMode,
            backendCapabilities,
            rate,
            currentMusic,
            queueIndex,
            queueLength: this.playList.length,
            queuePreview: {
                previous: this.getDiagnosticMusicIdentity(
                    queueIndex >= 0
                        ? this.getPlayListMusicAt(queueIndex - 1)
                        : null,
                ),
                next: this.getDiagnosticMusicIdentity(
                    queueIndex >= 0
                        ? this.getPlayListMusicAt(queueIndex + 1)
                        : null,
                ),
                playLaterLength: this.playLaterQueue.length,
                backendNextTracks: backendNextTrackSummaries,
            },
            preparedNext: {
                music: this.getDiagnosticMusicIdentity(preparedNextMusic),
                hasUrl: !!preparedNextTrack?.url,
                canUseNativePrepare: !!(
                    backendCapabilities.prepareNextTrack &&
                    preparedNextTrack?.url
                ),
                blockedByPlayLater: this.playLaterQueue.length > 0,
                repeatSingle: this.repeatMode === MusicRepeatMode.SINGLE,
            },
            quality: this.quality,
            repeatMode: this.repeatMode,
            progress,
            activeTrackIndex,
            activeTrack:
                activeTrack && activeTrackSummary
                    ? {
                        ...activeTrackSummary,
                        sourceQuality: activeTrack.playbackSource?.quality,
                        sourceOrigin: activeTrack.playbackSource?.origin,
                        sourceRecovered:
                              activeTrack.playbackSource?.recovered,
                        sourceCacheKey: activeTrack.playbackSource?.cacheKey,
                        sourceResolvedAt:
                              activeTrack.playbackSource?.resolvedAt,
                    }
                    : null,
            backendDiagnostics,
            crossfade: {
                gain: this.crossfade.getGain(),
                fading: this.crossfade.isFading(),
            },
            recentErrors: [...this.recentPlaybackErrors],
            recovery: {
                persistedMusic: this.getDiagnosticMusicIdentity(
                    PersistStatus.get("music.musicItem"),
                ),
                persistedProgress:
                    this.normalizeProgress(
                        PersistStatus.get("music.progress"),
                    ) ?? null,
                progressSavedAt:
                    PersistStatus.get("music.progressSavedAt") ?? null,
                lastPersistedProgress: this.lastProgressPersistedAt
                    ? this.lastProgressPersistedPosition
                    : null,
                lastPersistedAt: this.lastProgressPersistedAt || null,
                lastRestoredMusic: this.getDiagnosticMusicIdentity(
                    this.lastPlaybackRestoredMusic,
                ),
                lastRestoredProgress: this.lastPlaybackRestoredProgress,
                lastRestoredAt: this.lastPlaybackRestoredAt,
                lastRestoredQueueLength: this.lastPlaybackRestoredQueueLength,
            },
            native: nativeDiagnostics,
        };
    }

    /**************** 辅助函数 -- 设置内部状态 ****************/

    /**
     * 通知淡入淡出与 scrobble：当前曲目换人了。
     *
     * setCurrentMusic 会被乐观预切、原生确认、恢复播放等多条路径重复调到同一
     * 首歌上，所以这里按媒体唯一键去重——否则同一首歌会被反复「重新开始」，
     * scrobble 的收听计时永远归零，一条都攒不出来。
     */
    private notifyPlaybackTrackChanged(musicItem?: IMusic.IMusicItem | null) {
        const nextKey = musicItem ? getMediaUniqueKey(musicItem) : null;
        if (nextKey === this.lastPlaybackTrackKey) {
            return;
        }
        this.lastPlaybackTrackKey = nextKey;
        this.crossfade.onTrackStarted();
        LastfmScrobbler.onTrackStarted(musicItem ?? null);
    }

    private setCurrentMusic(musicItem?: IMusic.IMusicItem | null) {
        // 设置UI内部状态的musicitem
        if (!musicItem) {
            this.currentIndex = -1;
            getDefaultStore().set(currentMusicAtom, null);
            PersistStatus.set("music.musicItem", undefined);
            this.setPersistedPlaybackProgress(0);

            this.notifyPlaybackTrackChanged(null);
            this.emit(TrackPlayerEvents.CurrentMusicChanged, null);
            return;
        }
        const normalizedMusicItem =
            typeof musicItem.artwork === "string"
                ? musicItem
                : {
                    ...musicItem,
                    artwork: ImgAsset.albumDefault,
                };
        this.currentIndex = this.getMusicIndexInPlayList(normalizedMusicItem);
        getDefaultStore().set(currentMusicAtom, normalizedMusicItem);
        PersistStatus.set(
            "music.musicItem",
            stripEphemeralLocalArtwork(normalizedMusicItem),
        );

        this.notifyPlaybackTrackChanged(normalizedMusicItem);
        this.emit(TrackPlayerEvents.CurrentMusicChanged, normalizedMusicItem);
        this.syncLocalMusicArtwork(normalizedMusicItem).catch(error => {
            errorLog("同步本地音乐封面失败", error?.message ?? error);
        });
    }


    private async syncLocalMusicArtwork(musicItem: IMusic.IMusicItem) {
        if (getDirectArtworkUri(musicItem.artwork)) {
            return musicItem;
        }

        const key = getMediaUniqueKey(musicItem);
        if (this.localArtworkSyncInFlight.has(key)) {
            return musicItem;
        }

        this.localArtworkSyncInFlight.add(key);
        try {
            const artwork = await resolveLocalMusicArtwork(musicItem);
            if (!artwork) {
                return musicItem;
            }

            const queueIndex = this.getMusicIndexInPlayList(musicItem);
            const queueMusic =
                queueIndex >= 0 ? this.playList[queueIndex] : null;
            const metadataMusic = {
                ...(queueMusic ?? musicItem),
                artwork,
            } as IMusic.IMusicItem;

            if (queueMusic) {
                this.replacePlayListMusicIfPresent(metadataMusic, false);
            }

            const isCurrent = isSameMediaItem(this.currentMusic, musicItem);
            const currentMusic = isCurrent
                ? ({ ...this.currentMusic!, artwork } as IMusic.IMusicItem)
                : metadataMusic;
            if (isCurrent) {
                getDefaultStore().set(currentMusicAtom, currentMusic);
            }

            await this.backend.updateTrack({
                ...currentMusic,
                musicItem: metadataMusic,
            } as unknown as MusicFreePlayerTrack);
            this.syncPreparedNextTrack("local-artwork");
            return currentMusic;
        } finally {
            this.localArtworkSyncInFlight.delete(key);
        }
    }

    private setRepeatMode(mode: MusicRepeatMode) {
        const playList = this.playList;
        let newPlayList: IMusic.IMusicItem[];
        const prevMode = getDefaultStore().get(repeatModeAtom);
        if (
            (prevMode === MusicRepeatMode.SHUFFLE &&
                mode !== MusicRepeatMode.SHUFFLE) ||
            (mode === MusicRepeatMode.SHUFFLE &&
                prevMode !== MusicRepeatMode.SHUFFLE)
        ) {
            if (mode === MusicRepeatMode.SHUFFLE) {
                newPlayList = shuffle(playList);
            } else {
                newPlayList = this.sortByTimestampAndIndex(playList, true);
            }
            this.setPlayList(newPlayList);
        }

        getDefaultStore().set(repeatModeAtom, mode);
        this.syncBackendRepeatMode().catch(error => {
            errorLog("同步播放循环模式失败", error?.message ?? error);
        });
        this.syncPreparedNextTrack("repeat-mode");
        // 记录
        PersistStatus.set("music.repeatMode", mode);
    }

    private setQuality(quality: IMusic.IQualityKey) {
        getDefaultStore().set(qualityAtom, quality);
        PersistStatus.set("music.quality", quality);
    }

    private normalizeProgress(progress?: number | null) {
        return typeof progress === "number" &&
            Number.isFinite(progress) &&
            progress > 0
            ? progress
            : undefined;
    }

    private persistPlaybackProgress(progress?: number | null, force = false) {
        if (!this.currentMusic) {
            return;
        }
        const normalizedProgress =
            typeof progress === "number" &&
            Number.isFinite(progress) &&
            progress >= 0
                ? progress
                : undefined;
        if (normalizedProgress === undefined) {
            return;
        }
        if (!force && normalizedProgress <= 0) {
            return;
        }

        const now = Date.now();
        if (
            !force &&
            now - this.lastProgressPersistedAt <
                TrackPlayer.progressPersistIntervalMs &&
            Math.abs(normalizedProgress - this.lastProgressPersistedPosition) <
                1
        ) {
            return;
        }

        this.lastProgressPersistedAt = now;
        this.lastProgressPersistedPosition = normalizedProgress;
        this.setPersistedPlaybackProgress(normalizedProgress, now);
    }

    private setPersistedPlaybackProgress(
        progress: number,
        savedAt = Date.now(),
    ) {
        PersistStatus.set("music.progress", progress);
        PersistStatus.set("music.progressSavedAt", savedAt);
    }

    private getDiagnosticMusicIdentity(
        musicItem?: Partial<IMusic.IMusicItem> | null,
    ): IPlaybackDiagnosticMusicIdentity | null {
        if (!musicItem) {
            return null;
        }
        return {
            id: musicItem.id == null ? undefined : String(musicItem.id),
            title: musicItem.title,
            artist: musicItem.artist,
            platform: musicItem.platform,
        };
    }

    private getDiagnosticTrackSummary(
        track?: Partial<PlayerAdapterTrack & IMusic.IMusicItem> | null,
    ): IPlaybackDiagnosticTrackSummary | null {
        if (!track) {
            return null;
        }
        return {
            id: track.id == null ? undefined : String(track.id),
            title: track.title,
            artist: track.artist,
            album: track.album,
            platform: track.platform,
            duration: track.duration,
            urlType: this.getDiagnosticUrlType(track.url),
            hasHeaders: !!Object.keys(track.headers ?? {}).length,
        };
    }

    private getBackendCapabilities() {
        return {
            getNextTracks: !!this.backend.getNextTracks,
            prepareNextTrack: !!this.backend.prepareNextTrack,
            prepareNextTracks: !!this.backend.prepareNextTracks,
            syncQueueOrder: !!this.backend.syncQueueOrder,
            queueInfo: !!(
                this.backend.getCurrentQueueId ||
                this.backend.getQueueInfo ||
                this.backend.getAllQueueInfos
            ),
            temporaryQueue: !!(
                this.backend.playNext ||
                this.backend.addToUpNext ||
                this.backend.getPlayNextQueue ||
                this.backend.getUpNextQueue
            ),
            androidAuto: !!this.backend.isAndroidAutoConnected,
        };
    }

    private async ensureNitroAutoPlay(targetKey: string) {
        const retryDelays = [180, 520, 1100];
        for (let retryDelay of retryDelays) {
            await delay(retryDelay);

            const currentMusic = this.currentMusic;
            if (
                !currentMusic ||
                getMediaUniqueKey(currentMusic) !== targetKey
            ) {
                trace("自动播放补偿取消", {
                    targetKey,
                    currentKey: currentMusic
                        ? getMediaUniqueKey(currentMusic)
                        : null,
                });
                return;
            }

            const activeTrack = await this.backend
                .getActiveTrack?.()
                .catch(() => null);
            const activeMusic = this.resolveMusicFromAdapterTrack(
                activeTrack as Partial<IMusic.IMusicItem> | null,
            );
            const activeKey = activeMusic
                ? getMediaUniqueKey(activeMusic)
                : null;
            if (activeKey && activeKey !== targetKey) {
                trace("自动播放补偿等待目标曲", {
                    targetKey,
                    activeKey,
                });
                continue;
            }

            const state = await this.backend.getState().catch(() => "idle");
            if (state === "playing") {
                return;
            }

            trace("自动播放补偿", {
                targetKey,
                state,
                retryDelay,
            });
            await this.backend.play();
        }
    }

    private resolveResumeSeekTime(musicItem: IMusic.IMusicItem) {
        const itemCurrentTime = this.normalizeProgress(
            (musicItem as any)?._currentTime,
        );
        if (itemCurrentTime) {
            return itemCurrentTime;
        }

        const progress = this.normalizeProgress(
            PersistStatus.get("music.progress"),
        );
        if (!progress) {
            return undefined;
        }

        const persistedMusic = PersistStatus.get("music.musicItem");
        if (persistedMusic && !isSameMediaItem(musicItem, persistedMusic)) {
            return undefined;
        }

        return progress;
    }

    // 设置音源
    private async setTrackSource(
        track: MusicFreePlayerTrack,
        autoPlay = true,
        seekTo?: number,
    ) {
        const queueIndex = this.getMusicIndexInPlayList(
            track as unknown as IMusic.IMusicItem,
        );
        const queueMusic =
            queueIndex >= 0 ? this.playList[queueIndex] : null;
        const trackWithCurrentArtwork = mergeResolvedArtwork(
            track,
            isSameMediaItem(
                this.currentMusic,
                track as unknown as IMusic.IMusicItem,
            )
                ? this.currentMusic?.artwork
                : undefined,
        );
        const trackWithArtwork = mergeResolvedArtwork(
            trackWithCurrentArtwork,
            queueMusic?.artwork,
        );
        const clonedTrack = this.patchMediaArtwork(trackWithArtwork);
        if (!clonedTrack) {
            return;
        }
        const initialProgress = this.normalizeProgress(seekTo) ?? 0;
        clonedTrack.userAgent = clonedTrack.userAgent || getAppUserAgent();
        const nitroTargetKey = getMediaUniqueKey(
            clonedTrack as unknown as IMusic.IMusicItem,
        );
        const nitroQueue = this.getNitroQueue(
            clonedTrack as unknown as IMusic.IMusicItem,
        );
        this.nitroTrackChangeGuard =
            this.backend.name === "nitro-player"
                ? {
                    key: nitroTargetKey,
                    until: Date.now() + 5000,
                }
                : null;
        await this.backend.loadQueue(nitroQueue.tracks, nitroQueue.startIndex, {
            autoPlay,
        });
        await this.syncBackendRepeatMode();
        const startIndex = nitroQueue.startIndex;
        const lookaheadTracks = nitroQueue.tracks.slice(
            startIndex + 1,
            startIndex + 6,
        );
        this.resolveNitroQueuedTracks(lookaheadTracks).catch(error => {
            errorLog("预解析下一首失败", error?.message ?? error);
        });
        this.syncPreparedNextTrack("track-source");
        PersistStatus.set(
            "music.musicItem",
            stripEphemeralLocalArtwork(track as IMusic.IMusicItem),
        );
        this.setPersistedPlaybackProgress(initialProgress);
        const currentProgress = setPlayerProgress({
            position: initialProgress,
            duration: Number(track.duration) || 0,
            buffered: initialProgress,
        });
        this.emit(TrackPlayerEvents.ProgressChanged, currentProgress);
        // 先恢复位置再播放，避免重启恢复时短暂从 0 秒出声。
        if (initialProgress > 0) {
            await delay(100);
            await this.seekTo(initialProgress);
        }
        if (autoPlay) {
            await this.backend.play();
            if (nitroTargetKey) {
                this.ensureNitroAutoPlay(nitroTargetKey).catch(error => {
                    errorLog("自动播放补偿失败", error?.message ?? error);
                });
            }
        }
    }

    private resolvePreparedNextMusic() {
        return resolvePreparedNextItem({
            currentItem: this.currentMusic,
            queue: this.playList,
            currentIndex: this.currentIndex,
            repeatMode: this.repeatMode,
            playLaterQueueLength: this.playLaterQueue.length,
            isSameItem: isSameMediaItem,
            isSkipped: item => DislikeMusic.isDisliked(item),
        });
    }

    /** resolvePreparedNextMusic 的多首版本，供支持批量预备的后端（如 mpv）使用。 */
    private resolvePreparedNextMusicItems(count: number) {
        return resolvePreparedNextItems({
            currentItem: this.currentMusic,
            queue: this.playList,
            currentIndex: this.currentIndex,
            repeatMode: this.repeatMode,
            playLaterQueueLength: this.playLaterQueue.length,
            isSameItem: isSameMediaItem,
            isSkipped: item => DislikeMusic.isDisliked(item),
            count,
        });
    }

    private syncPreparedNextTrack(reason: string) {
        if (this.backend.prepareNextTracks) {
            this.syncPreparedNextTrackBatch(reason);
            return;
        }
        if (!this.backend.prepareNextTrack) {
            return;
        }

        const serial = ++this.preparedNextSyncSerial;
        const nextMusic = this.resolvePreparedNextMusic();
        const nextTrack = nextMusic
            ? this.createNitroQueuedTrack(nextMusic)
            : null;
        // 空 URL 会让 adapter 下发 prepareNext(null)，而原生的 prepareNext 在判空
        // 之前就已经 clearPreparedTrack(removeFromPlaylist=true)，且判空分支不打
        // 任何日志——于是唯一的 runway 被静默清掉，完全不可观测。这条 trace 就是
        // 为了让这种情况留下痕迹。
        if (nextMusic && !nextTrack?.url) {
            trace("预备下一首缺少音源，原生 runway 将被清空", {
                reason,
                serial,
                musicId: nextMusic.id,
                platform: nextMusic.platform,
            });
        }

        this.backend
            .prepareNextTrack(nextTrack as any)
            .then(() => {
                trace("同步预备下一首完成", {
                    reason,
                    serial,
                    musicId: nextMusic?.id,
                    platform: nextMusic?.platform,
                });
            })
            .catch(error => {
                if (serial !== this.preparedNextSyncSerial) {
                    return;
                }
                errorLog("同步预备下一首失败", error?.message ?? error);
            });
    }

    /**
     * prepareNextTracks 支持的后端（目前只有 mpv）专用：一次性把接下来
     * TrackPlayer.mpvSourceLookaheadSize 首依次交给原生，让原生自动接续
     * 播完这一批，不需要每首之间都等 JS 醒着再补一次 prepareNext。深度沿用
     * 现有的 JS 侧音源预解析窗口——超出这个窗口的曲目本来就还没解析出 URL，
     * adapter 自己会在 resolveNextCandidate 遇到未解析 URL 时提前截断。
     */
    private syncPreparedNextTrackBatch(reason: string) {
        const serial = ++this.preparedNextSyncSerial;
        const nextMusicItems = this.resolvePreparedNextMusicItems(
            TrackPlayer.mpvSourceLookaheadSize,
        );
        const nextTracks = nextMusicItems.map(item =>
            this.createNitroQueuedTrack(item),
        );

        if (nextMusicItems.length && !nextTracks[0]?.url) {
            trace("批量预备下一首缺少音源，原生 runway 将被清空", {
                reason,
                serial,
                musicId: nextMusicItems[0].id,
                platform: nextMusicItems[0].platform,
            });
        }

        this.backend
            .prepareNextTracks!(nextTracks.length ? nextTracks : [null as any])
            .then(() => {
                trace("批量同步预备下一首完成", {
                    reason,
                    serial,
                    count: nextTracks.length,
                    musicIds: nextMusicItems.map(item => item.id),
                });
            })
            .catch(error => {
                if (serial !== this.preparedNextSyncSerial) {
                    return;
                }
                errorLog("批量同步预备下一首失败", error?.message ?? error);
            });
    }

    /**
     * 设置播放队列
     * @param newPlayList 播放队列
     * @param persist 是否持久化
     */
    private setPlayList(newPlayList: IMusic.IMusicItem[], persist = true) {
        getDefaultStore().set(playListAtom, newPlayList);

        this.playListIndexMap = createMediaIndexMap(newPlayList);

        if (persist) {
            PersistStatus.set(
                "music.playList",
                newPlayList.map(stripEphemeralLocalArtwork),
            );
        }

        this.currentIndex = this.getMusicIndexInPlayList(this.currentMusic);
        // 把最新队列顺序同步给后端：mpv 等「JS 维护队列」的后端据此在洗牌/增删/重排后
        // 重新对齐内部队列与当前下标，避免下一首跳错；nitro 未实现该方法，无副作用。
        const activeKey = this.currentMusic
            ? getMediaUniqueKey(this.currentMusic)
            : null;
        this.backend
            .syncQueueOrder?.(newPlayList as any, activeKey)
            ?.catch(error => {
                errorLog("同步后端队列顺序失败", error?.message ?? error);
            });
        this.syncPreparedNextTrack("playlist");
    }

    private setPlayLaterQueue(queue: IMusic.IMusicItem[]) {
        getDefaultStore().set(playLaterQueueAtom, queue);
        PersistStatus.set(
            "music.playLaterQueue",
            queue.map(stripEphemeralLocalArtwork),
        );
        this.syncPreparedNextTrack("play-later");
    }

    private async playNextLaterQueue(
        mpvTransitionOwner?: IMpvManualSkipTransition | null,
    ) {
        const [nextMusic, ...restQueue] = this.playLaterQueue;
        if (!nextMusic) {
            return false;
        }

        this.setPlayLaterQueue(restQueue);
        if (!this.isInPlayList(nextMusic)) {
            this.add(
                nextMusic,
                this.currentIndex >= 0 ? this.currentIndex + 1 : undefined,
            );
        }
        await this.play(nextMusic, true, mpvTransitionOwner);
        return true;
    }

    private async handleMpvNaturalEnd(evt: {
        autoAdvanced?: boolean;
        endedMediaId?: string;
        promotedMediaId?: string;
        queueRevision?: number;
    }) {
        if (this.handlingMpvNaturalEnd) {
            trace("忽略重复的 mpv 自然结束事件", evt);
            return;
        }
        this.handlingMpvNaturalEnd = true;
        const owner = ++this.mpvNaturalEndSequence;
        this.mpvNaturalEndOwner = owner;
        // play() 里的插件取源和原生 loadQueue 都没有超时，一旦挂起，这个重入标志
        // 就会永久为 true，之后所有自然结束都被静默丢弃、再也不会自动切歌。
        // 看门狗保证标志一定会被放开。
        // 定时器句柄用局部常量持有，不再放进实例字段：否则旧处理器的 finally
        // 会把新处理器刚装上的看门狗一起清掉。
        const watchdog = setTimeout(() => {
            if (this.mpvNaturalEndOwner === owner) {
                errorLog(
                    "mpv 自然结束处理超时，强制解除重入锁",
                    `${TrackPlayer.mpvNaturalEndTimeoutMs}ms`,
                );
                this.mpvNaturalEndOwner = 0;
                this.handlingMpvNaturalEnd = false;
            }
        }, TrackPlayer.mpvNaturalEndTimeoutMs);
        try {
            this.emit(TrackPlayerEvents.PlayEnd);
            trace("统一处理 mpv 自然结束", {
                ...evt,
                currentIndex: this.currentIndex,
                currentMusicId: this.currentMusic?.id,
                repeatMode: this.repeatMode,
                playLaterLength: this.playLaterQueue.length,
            });

            // 原生 prepared promotion 已经通过身份/token/revision 校验并激活。
            if (evt.autoAdvanced) {
                const syncedMusic =
                    await this.syncCurrentMusicFromBackendActiveTrack(
                        "mpv-natural-end",
                    );
                if (
                    evt.promotedMediaId &&
                    (!syncedMusic ||
                        getMediaUniqueKey(syncedMusic) !== evt.promotedMediaId)
                ) {
                    trace(
                        "mpv 自动提升后 UI 身份复核失败",
                        {
                            promotedMediaId: evt.promotedMediaId,
                            currentMusicId: syncedMusic?.id,
                            currentMusicPlatform: syncedMusic?.platform,
                            queueRevision: evt.queueRevision,
                        },
                        "error",
                    );
                }
                // 原生已经自己进了下一首，但「再下一首」的预载必须在这里无条件补。
                // 以前只靠 syncNitroCurrentMusic 顺带补（它末尾会调
                // syncPreparedNextTrack("current-music")）：如果 trackChanged 先到
                // 并更新了 currentMusic，上面的 sync 就会在 isSameMediaItem 处直接
                // early-return，两条路都不补，原生手里就没有下一首了。
                // 后果是下一个曲尾只能靠 JS 实时响应；App 在后台时 JS 不一定跑得动，
                // 播放就卡死在曲尾（真机日志：14:09:58 和 14:19:17 两次切歌后都没有
                // prepareNext，随后 14:14 和 14:24 各出现一次 autoAdvanced=false，
                // 后者 JS 没响应，播放停止）。
                this.syncPreparedNextTrack("mpv-auto-advanced");
                // 不 await：取源要走网络，占住 handlingMpvNaturalEnd 重入锁会挡住
                // 后续的自然结束处理。
                this.replenishMpvSourceLookahead("mpv-auto-advanced").catch(
                    error => {
                        errorLog(
                            "补充 mpv 预载音源窗口失败",
                            error?.message ?? error,
                        );
                    },
                );
                return;
            }

            // 1. App“稍后播放”拥有最高优先级。
            if (await this.playNextLaterQueue()) {
                return;
            }

            // 2. 消费后端 play-next/up-next 临时队列，但不让后端决定主队列。
            if (await this.backend.consumeTemporaryNextTrack?.()) {
                return;
            }

            const currentMusic = this.currentMusic;
            if (!currentMusic) {
                await this.backend.stop().catch(() => undefined);
                return;
            }

            // 3. 单曲循环明确重载，禁止 prepared 同一首。
            if (this.repeatMode === MusicRepeatMode.SINGLE) {
                await this.play(currentMusic, true);
                return;
            }

            // 4/5. 主队列下一首，跳过不喜欢；到末尾时按队列模式回第一首。
            const candidate = findNextPlayableQueueItem(
                this.playList,
                this.currentIndex,
                currentMusic,
                {
                    isSameItem: isSameMediaItem,
                    isSkipped: item => DislikeMusic.isDisliked(item),
                },
            );
            if (candidate) {
                if (DislikeMusic.isDisliked(this.nextMusic)) {
                    this.emit(TrackPlayerEvents.AutoSkipDislikedMusic);
                }
                // play() 会吞掉取源失败，只发事件不再推进。以前一次网络抖动就
                // 让整个后台播放彻底停住，这里对「取不到音源」做有界续播。
                // 只处理 INVALID_SOURCE：缺权限/禁蜂窝仍然必须停下来提示用户，
                // 否则会把整条队列快速跳完。
                let nextCandidate: IMusic.IMusicItem | null = candidate;
                for (
                    let attempt = 0;
                    attempt < TrackPlayer.mpvNaturalEndMaxSourceRetries &&
                        nextCandidate;
                    attempt += 1
                ) {
                    const attemptKey = getMediaUniqueKey(nextCandidate);
                    this.lastInvalidSourceKey = null;
                    await this.play(nextCandidate, true);
                    if (this.lastInvalidSourceKey !== attemptKey) {
                        return;
                    }
                    const failedItem = nextCandidate;
                    nextCandidate = findNextPlayableQueueItem(
                        this.playList,
                        this.getMusicIndexInPlayList(failedItem),
                        failedItem,
                        {
                            isSameItem: isSameMediaItem,
                            isSkipped: item => DislikeMusic.isDisliked(item),
                        },
                    );
                    trace("自然结束续播取源失败，尝试下一首", {
                        failedMusicId: failedItem.id,
                        failedPlatform: failedItem.platform,
                        nextMusicId: nextCandidate?.id,
                        attempt: attempt + 1,
                    });
                }
                return;
            }

            // 6. 没有可播放项时保持 ended，并明确停止出声。
            await this.backend.stop().catch(() => undefined);
            this.emit(TrackPlayerEvents.NoPlayableMusic);
        } finally {
            clearTimeout(watchdog);
            // 只有仍然持有令牌的处理器才有权释放重入锁；被看门狗放开过的旧处理器
            // 到这里已经不是 owner，必须什么都不做。
            if (this.mpvNaturalEndOwner === owner) {
                this.mpvNaturalEndOwner = 0;
                this.handlingMpvNaturalEnd = false;
            }
        }
    }

    private async skipAutoDislikedMusic() {
        const currentMusic = this.currentMusic;
        if (!currentMusic || !DislikeMusic.isDisliked(currentMusic)) {
            return false;
        }

        const candidate = findNextPlayableQueueItem(
            this.playList,
            this.currentIndex,
            currentMusic,
            {
                isSameItem: isSameMediaItem,
                isSkipped: item => DislikeMusic.isDisliked(item),
            },
        );
        if (candidate) {
            this.emit(TrackPlayerEvents.AutoSkipDislikedMusic);
            await this.play(candidate, true);
            return true;
        }

        await this.pause().catch(() => undefined);
        this.emit(TrackPlayerEvents.NoPlayableMusic);
        return false;
    }

    /**************** 辅助函数 -- 工具方法 ****************/
    private shrinkPlayListToSize = (
        queue: IMusic.IMusicItem[],
        targetIndex = this.currentIndex,
    ) => {
        // 播放列表上限，太多无法缓存状态
        if (queue.length > TrackPlayer.maxMusicQueueLength) {
            if (targetIndex < TrackPlayer.halfMaxMusicQueueLength) {
                queue = queue.slice(0, TrackPlayer.maxMusicQueueLength);
            } else {
                const right = Math.min(
                    queue.length,
                    targetIndex + TrackPlayer.halfMaxMusicQueueLength,
                );
                const left = Math.max(
                    0,
                    right - TrackPlayer.maxMusicQueueLength,
                );
                queue = queue.slice(left, right);
            }
        }
        return queue;
    };

    private mergeTrackSource(
        mediaItem: ICommon.IMediaBase,
        props: Record<string, any> | undefined,
    ): ICommon.IMediaBase & Record<string, any> {
        const merged = {
            ...mediaItem,
            ...(props ?? {}),
            id: mediaItem.id,
            platform: mediaItem.platform,
        } as ICommon.IMediaBase & Record<string, any>;
        merged.userAgent = merged.userAgent || getAppUserAgent();
        return merged;
    }

    private createPlaybackSourceMeta(
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): PlayerAdapterTrackSourceMeta {
        return {
            ...(quality ? { quality } : {}),
            origin,
            cacheKey:
                mediaItem.platform && mediaItem.id
                    ? getMediaUniqueKey(mediaItem)
                    : undefined,
            recovered,
            resolvedAt: Date.now(),
        };
    }

    private withPlaybackSourceMeta<T extends IPlugin.IMediaSourceResult | null>(
        source: T,
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): T {
        if (!source) {
            return source;
        }
        return {
            ...source,
            playbackSource: this.createPlaybackSourceMeta(
                mediaItem,
                source.quality ?? quality,
                origin,
                recovered,
            ),
        } as T;
    }

    private async createPlayableSource(
        source: IPlugin.IMediaSourceResult | null | undefined,
        mediaItem: ICommon.IMediaBase,
        quality: IMusic.IQualityKey | undefined,
        origin: PlayerAdapterTrackSourceOrigin,
        recovered = false,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        let sourceWithMeta = this.withPlaybackSourceMeta(
            source ?? null,
            mediaItem,
            quality,
            origin,
            recovered,
        );
        const failureContext: MediaSourceFailureContext = {
            mediaKey:
                mediaItem.platform && mediaItem.id
                    ? getMediaUniqueKey(mediaItem)
                    : undefined,
            pluginName: mediaItem.platform,
            quality,
        };
        if (!hasPlayableSourceUrl(sourceWithMeta)) {
            return sourceWithMeta?.failure
                ? sourceWithMeta
                : createMediaSourceFailureResult(
                    createMediaSourceFailure("unavailable", failureContext),
                );
        }
        const allowInsecureHttpPlayback = isMediaHttpAllowed(
            this.configService,
        );
        if (/^https?:\/\//i.test(sourceWithMeta.url)) {
            const validation = await validateRemoteMediaUrlForPlayback(
                sourceWithMeta.url,
                {
                    allowHttp: allowInsecureHttpPlayback,
                },
            );
            if (!validation.ok) {
                errorLog("远程音源策略拒绝", validation.reason);
                return createMediaSourceFailureResult(
                    classifyMediaSourceFailure(
                        new Error(validation.reason),
                        failureContext,
                    ),
                );
            }
            sourceWithMeta = {
                ...sourceWithMeta,
                url: validation.url,
                allowInsecureHttpPlayback:
                    allowInsecureHttpPlayback &&
                    new URL(validation.url).protocol === "http:",
            };
        }
        if (this.isUnsupportedEncryptedSource(sourceWithMeta)) {
            return createMediaSourceFailureResult(
                createMediaSourceFailure(
                    "encrypted-unsupported",
                    failureContext,
                ),
            );
        }

        try {
            const playableSource =
                await resolveEncryptedMediaStreamIfNeeded(sourceWithMeta);
            return hasPlayableSourceUrl(playableSource)
                ? playableSource
                : createMediaSourceFailureResult(
                    createMediaSourceFailure(
                        "source-rejected",
                        failureContext,
                    ),
                );
        } catch (error: any) {
            errorLog("加密音源代理失败", {
                musicId: mediaItem.id,
                platform: mediaItem.platform,
                reason: error?.message ?? error,
            });
            return createMediaSourceFailureResult(
                classifyMediaSourceFailure(error, failureContext),
            );
        }
    }

    private isUnsupportedEncryptedSource(
        source?: {
            url?: string | null;
            ekey?: string | null;
            cek?: string | null;
        } | null,
    ) {
        return isUnsupportedEncryptedMediaSource(source);
    }

    private sortByTimestampAndIndex(array: any[], newArray = false) {
        if (newArray) {
            array = [...array];
        }
        return array.sort((a, b) => {
            const ts = a[timeStampSymbol] - b[timeStampSymbol];
            if (ts !== 0) {
                return ts;
            }
            return a[sortIndexSymbol] - b[sortIndexSymbol];
        });
    }

    private getPlayQualityOrder() {
        return getQualityOrder(
            this.configService.getConfig("basic.defaultPlayQuality") ??
                "standard",
            this.configService.getConfig("basic.playQualityOrder") ?? "asc",
        );
    }

    private createNitroQueuedTrack(musicItem: IMusic.IMusicItem) {
        return this.patchMediaArtwork({
            ...musicItem,
            // Remote sources enter the native queue only after createPlayableSource
            // has completed URL and DNS validation in resolveNitroQueuedTracks.
            url: getSafeUnresolvedQueueUrl(musicItem.url),
            userAgent: getAppUserAgent(),
            musicItem,
        } as unknown as MusicFreePlayerTrack) as MusicFreePlayerTrack;
    }

    private async syncNitroQueueInsert(
        musicItems: IMusic.IMusicItem[],
        index?: number,
    ) {
        if (!this.backend.addQueueTracks || musicItems.length === 0) {
            return;
        }
        await this.backend.addQueueTracks(
            musicItems.map(item => this.createNitroQueuedTrack(item)),
            index,
        );
    }

    private async syncNitroQueueRemove(musicItem: IMusic.IMusicItem) {
        if (!this.backend.removeQueueTrack) {
            return;
        }
        await this.backend.removeQueueTrack(
            this.createNitroQueuedTrack(musicItem),
        );
    }

    private getNitroQueue(currentTrack: IMusic.IMusicItem) {
        const fallbackTrack = this.patchMediaArtwork(
            currentTrack as unknown as MusicFreePlayerTrack,
        ) as MusicFreePlayerTrack;
        if (this.playList.length === 0) {
            return {
                tracks: [fallbackTrack],
                startIndex: 0,
            };
        }

        const currentIndex = this.getMusicIndexInPlayList(currentTrack);
        if (currentIndex < 0) {
            // 以前这里回落成 0，等于「让后端从队列第一首开始播」，
            // 重启恢复时身份对不上就会播成第一首。只加载这一首更符合调用语义。
            trace("当前歌曲不在播放列表中，仅加载单曲队列", {
                musicId: currentTrack.id,
                platform: currentTrack.platform,
                queueLength: this.playList.length,
            });
            return {
                tracks: [fallbackTrack],
                startIndex: 0,
            };
        }
        const startIndex = currentIndex;
        const currentKey = getMediaUniqueKey(currentTrack);
        const tracks = this.playList.map(musicItem => {
            if (getMediaUniqueKey(musicItem) === currentKey) {
                return fallbackTrack;
            }
            return this.createNitroQueuedTrack(musicItem);
        });

        return {
            tracks,
            startIndex,
        };
    }

    private resolveMusicFromAdapterTrack(
        track?: Partial<IMusic.IMusicItem> | null,
        preferredIndex?: number | null,
    ) {
        if (
            typeof preferredIndex === "number" &&
            preferredIndex >= 0 &&
            preferredIndex < this.playList.length
        ) {
            const indexedMusic = this.playList[preferredIndex];
            if (
                indexedMusic &&
                (!track?.platform ||
                    !track.id ||
                    isSameMediaItem(
                        indexedMusic,
                        track as Partial<IMusic.IMusicItem> as IMusic.IMusicItem,
                    ))
            ) {
                return indexedMusic;
            }
        }
        const nestedMusicItem = (track as {musicItem?: IMusic.IMusicItem})
            ?.musicItem;
        if (nestedMusicItem?.platform && nestedMusicItem.id) {
            const nestedIndex = this.playListIndexMap.getIndex(
                nestedMusicItem as ICommon.IMediaBase,
            );
            if (nestedIndex >= 0) {
                return this.playList[nestedIndex];
            }
            return nestedMusicItem;
        }
        if (!track?.platform || !track.id) {
            return null;
        }
        const index = this.playListIndexMap.getIndex(
            track as ICommon.IMediaBase,
        );
        return index >= 0 ? this.playList[index] : null;
    }

    private async syncCurrentMusicFromBackendActiveTrack(reason?: unknown) {
        if (this.backend.name !== "mpv") {
            return null;
        }
        const syncSerial = ++this.mpvActiveTrackSyncSerial;
        const activeTrack = await this.backend
            .getActiveTrack?.()
            .catch(error => {
                errorLog(
                    "同步 mpv 当前曲目失败：读取 active track 失败",
                    error?.message ?? error,
                );
                return null;
            });
        if (syncSerial !== this.mpvActiveTrackSyncSerial) {
            return null;
        }
        if (!activeTrack) {
            return null;
        }
        const activeIndex = await this.backend
            .getActiveTrackIndex?.()
            .catch(() => null);
        if (syncSerial !== this.mpvActiveTrackSyncSerial) {
            return null;
        }
        const preferredIndex =
            typeof activeIndex === "number" ? activeIndex : undefined;
        const activeMusic = this.resolveMusicFromAdapterTrack(
            activeTrack as Partial<IMusic.IMusicItem>,
            preferredIndex,
        );
        if (
            activeMusic &&
            this.shouldIgnoreMpvActiveMusicDuringManualSkip(
                activeMusic,
                reason,
            )
        ) {
            return null;
        }
        if (activeMusic && isSameMediaItem(this.currentMusic, activeMusic)) {
            return this.currentMusic;
        }
        const syncedMusic = this.syncNitroCurrentMusic(
            activeTrack as Partial<IMusic.IMusicItem>,
            reason,
            preferredIndex,
        );
        if (syncedMusic) {
            return syncedMusic;
        }
        const indexedMusic =
            typeof preferredIndex === "number"
                ? this.playList[preferredIndex]
                : null;
        if (indexedMusic) {
            const fallbackMusic = activeTrack?.url
                ? (this.mergeTrackSource(indexedMusic, {
                    url: activeTrack.url,
                    headers: activeTrack.headers,
                    userAgent: activeTrack.userAgent,
                    allowInsecureHttpPlayback:
                        activeTrack.allowInsecureHttpPlayback,
                    trustedLocalMediaProxy:
                        activeTrack.trustedLocalMediaProxy,
                    ekey: activeTrack.ekey,
                    cek: activeTrack.cek,
                    playbackSource: activeTrack.playbackSource,
                }) as IMusic.IMusicItem)
                : indexedMusic;
            this.setCurrentMusic(fallbackMusic);
            setPlayerProgress({
                position: 0,
                duration: Number(fallbackMusic.duration) || 0,
                buffered: 0,
            });
            this.syncPreparedNextTrack("mpv-active-index");
            return fallbackMusic;
        }
        if (activeTrack?.platform && activeTrack.id) {
            const fallbackMusic = activeTrack as IMusic.IMusicItem;
            this.setCurrentMusic(fallbackMusic);
            setPlayerProgress({
                position: 0,
                duration: Number(fallbackMusic.duration) || 0,
                buffered: 0,
            });
            this.syncPreparedNextTrack("mpv-active-track");
            return fallbackMusic;
        }
        return null;
    }

    private syncMpvActiveTrackFromProgress(reason?: unknown) {
        if (this.backend.name !== "mpv") {
            return;
        }
        const now = Date.now();
        if (now - this.lastMpvActiveTrackSyncAt < 1000) {
            return;
        }
        this.lastMpvActiveTrackSyncAt = now;
        this.syncCurrentMusicFromBackendActiveTrack(reason).catch(error => {
            errorLog(
                "同步 mpv 当前曲目失败",
                error?.message ?? error,
            );
        });
    }

    private shouldIgnoreNitroTrackChange(evt: {
        track?: Partial<IMusic.IMusicItem> | null;
        index?: number;
        reason?: unknown;
    }) {
        const guard = this.nitroTrackChangeGuard;
        if (!guard) {
            return false;
        }
        if (Date.now() > guard.until) {
            this.nitroTrackChangeGuard = null;
            return false;
        }

        const musicItem = this.resolveMusicFromAdapterTrack(evt.track);
        const eventKey = musicItem ? getMediaUniqueKey(musicItem) : null;
        if (eventKey === guard.key) {
            return false;
        }

        trace("队列切歌忽略", {
            index: evt.index,
            reason: evt.reason,
            eventMusicId: musicItem?.id,
            eventPlatform: musicItem?.platform,
            expectedKey: guard.key,
        });
        return true;
    }

    private async resolveDirectMediaSource(
        musicItem: IMusic.IMusicItem,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = this.getPlayQualityOrder();

        for (let quality of qualityOrder) {
            const candidate =
                (await plugin?.methods?.getMediaSource(musicItem, quality)) ??
                null;
            if (candidate?.url) {
                const source = await this.createPlayableSource(
                    candidate,
                    musicItem,
                    quality,
                    "plugin",
                );
                if (source?.url) {
                    return source;
                }
            }
        }

        if (musicItem.source) {
            for (let quality of qualityOrder) {
                const legacyQuality = convertToLegacyQuality(quality);
                const directSource =
                    musicItem.source[quality] ??
                    (legacyQuality
                        ? musicItem.source[legacyQuality]
                        : undefined);
                if (directSource?.url) {
                    const source = await this.createPlayableSource(
                        directSource,
                        musicItem,
                        quality,
                        "embedded-cache",
                    );
                    if (source?.url) {
                        return source;
                    }
                }
            }
        }

        if (musicItem.url) {
            return this.createPlayableSource(
                {
                    url: musicItem.url,
                    ekey: musicItem.ekey,
                    cek: musicItem.cek,
                },
                musicItem,
                undefined,
                "direct",
            );
        }

        return null;
    }

    private async resolveFreshMediaSource(
        musicItem: IMusic.IMusicItem,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        MediaCache.removeMediaCache(musicItem);
        const plugin = this.pluginManagerService.getByName(musicItem.platform);
        const qualityOrder = this.getPlayQualityOrder();

        for (let quality of qualityOrder) {
            const candidate =
                (await plugin?.methods?.getMediaSource(musicItem, quality)) ??
                null;
            if (candidate?.url) {
                const source = await this.createPlayableSource(
                    candidate,
                    musicItem,
                    quality,
                    "recovery",
                    true,
                );
                if (source?.url) {
                    return source;
                }
            }
        }

        if (musicItem.url) {
            const directSource = {
                url: musicItem.url,
                ekey: musicItem.ekey,
                cek: musicItem.cek,
            };
            return this.createPlayableSource(
                directSource,
                musicItem,
                undefined,
                "recovery",
                true,
            );
        }

        return null;
    }

    private pruneSourceRecoveryAttempts(now = Date.now()) {
        const minAttemptAt =
            now - TrackPlayer.sourceRecoveryAttemptRetentionMs;
        for (const [key, attemptedAt] of this.sourceRecoveryAttemptedAt) {
            if (
                attemptedAt < minAttemptAt &&
                !this.sourceRecoveryInFlight.has(key)
            ) {
                this.sourceRecoveryAttemptedAt.delete(key);
            }
        }

        const overflow =
            this.sourceRecoveryAttemptedAt.size -
            TrackPlayer.sourceRecoveryAttemptMaxEntries;
        if (overflow <= 0) {
            return;
        }

        const evictableKeys = [...this.sourceRecoveryAttemptedAt.entries()]
            .filter(([key]) => !this.sourceRecoveryInFlight.has(key))
            .sort(([, leftAt], [, rightAt]) => leftAt - rightAt)
            .slice(0, overflow)
            .map(([key]) => key);

        evictableKeys.forEach(key => {
            this.sourceRecoveryAttemptedAt.delete(key);
        });
    }

    private async recoverCurrentSourceAfterPlaybackError(
        error: any,
        activeTrack?: MusicFreePlayerTrack | null,
    ) {
        const musicItem =
            this.resolveMusicFromAdapterTrack(activeTrack) ?? this.currentMusic;
        if (!musicItem?.platform || !musicItem.id) {
            return false;
        }

        const key = getMediaUniqueKey(musicItem);
        if (this.sourceRecoveryInFlight.has(key)) {
            return true;
        }

        const now = Date.now();
        this.pruneSourceRecoveryAttempts(now);
        const lastAttemptAt = this.sourceRecoveryAttemptedAt.get(key) ?? 0;
        if (now - lastAttemptAt < TrackPlayer.sourceRecoveryCooldownMs) {
            if (
                this.shouldEvictRecoveredSourceCacheAfterFailure(
                    error,
                    musicItem,
                    activeTrack,
                )
            ) {
                MediaCache.removeMediaCache(musicItem);
                trace("播放源恢复跳过：冷却中，已清理疑似坏缓存", {
                    musicId: musicItem.id,
                    platform: musicItem.platform,
                    errorMessage: error?.message,
                    errorCode: error?.code,
                    nativeCode: error?.nativeCode,
                    nativeMessage: error?.nativeMessage,
                });
            }
            trace("播放源恢复跳过：冷却中", {
                musicId: musicItem.id,
                platform: musicItem.platform,
            });
            return false;
        }

        this.sourceRecoveryAttemptedAt.set(key, now);
        this.sourceRecoveryInFlight.add(key);
        try {
            const progress = await this.backend
                .getProgress()
                .catch(() => getDefaultStore().get(progressAtom));
            const seekTo = this.normalizeProgress(progress?.position) ?? 0;
            const source = await this.resolveFreshMediaSource(musicItem);
            if (
                !source?.url ||
                !isSameMediaItem(this.currentMusic, musicItem)
            ) {
                return false;
            }

            const recoveredTrack = this.mergeTrackSource(
                musicItem,
                source,
            ) as MusicFreePlayerTrack;
            recoveredTrack.userAgent =
                recoveredTrack.userAgent || getAppUserAgent();
            trace("播放源恢复：重新解析成功", {
                backend: this.backend.name,
                musicId: musicItem.id,
                platform: musicItem.platform,
                errorMessage: error?.message,
            });
            this.setCurrentMusic(recoveredTrack as IMusic.IMusicItem);
            await this.setTrackSource(recoveredTrack, true, seekTo);
            return true;
        } catch (recoveryError: any) {
            errorLog("播放源恢复失败", recoveryError?.message ?? recoveryError);
            return false;
        } finally {
            this.sourceRecoveryInFlight.delete(key);
        }
    }

    private shouldEvictRecoveredSourceCacheAfterFailure(
        error: any,
        musicItem: IMusic.IMusicItem,
        activeTrack?: MusicFreePlayerTrack | null,
    ) {
        return shouldEvictRecoveredRemoteSourceCacheAfterFailure({
            error,
            isLocalSource:
                !!getLocalPath(musicItem) ||
                !!LocalMusicSheet.isLocalMusic(musicItem),
            wasRecoveredSource:
                !!activeTrack?.playbackSource?.recovered ||
                !!musicItem.playbackSource?.recovered,
        });
    }

    private async resolveMpvTransitionTrackSource(
        musicItem: IMusic.IMusicItem,
        transition: IMpvManualSkipTransition,
    ) {
        if (!this.isMpvManualSkipTransitionActive(transition)) {
            return null;
        }
        try {
            const [source, artwork] = await Promise.all([
                this.resolveDirectMediaSource(musicItem),
                resolveLocalMusicArtwork(musicItem).catch(() => ""),
            ]);
            if (!this.isMpvManualSkipTransitionActive(transition)) {
                return null;
            }
            if (!source?.url) {
                trace(
                    "MPV 切歌目标未获得可播放 URL",
                    {
                        reason: transition.reason,
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                    },
                    "error",
                );
                return null;
            }

            const resolvedMusic =
                artwork && !getDirectArtworkUri(musicItem.artwork)
                    ? ({ ...musicItem, artwork } as IMusic.IMusicItem)
                    : musicItem;
            if (resolvedMusic !== musicItem) {
                this.replacePlayListMusicIfPresent(resolvedMusic, false);
            }
            const updatedTrack = this.patchMediaArtwork(
                this.mergeTrackSource(
                    resolvedMusic,
                    source,
                ) as unknown as MusicFreePlayerTrack,
            );
            if (!updatedTrack?.url) {
                return null;
            }
            const queueIndex = this.getMusicIndexInPlayList(resolvedMusic);
            await this.backend.updateTrack(
                updatedTrack,
                queueIndex >= 0 ? queueIndex : undefined,
            );
            return this.isMpvManualSkipTransitionActive(transition)
                ? updatedTrack
                : null;
        } catch (error: any) {
            errorLog(
                "MPV 切歌目标音源解析失败",
                error?.message ?? error,
            );
            return null;
        }
    }

    private async resolveNitroQueuedTracks(
        tracks: Array<Partial<IMusic.IMusicItem>>,
        transitionToken?: IMpvTrackTransitionToken,
    ) {
        for (let track of tracks) {
            if (
                transitionToken &&
                !this.mpvTrackTransitionGate.isActive(transitionToken)
            ) {
                return;
            }
            const musicItem = this.resolveMusicFromAdapterTrack(track);
            if (!musicItem) {
                continue;
            }

            const key = getMediaUniqueKey(musicItem);
            if (this.nitroPendingSourceRequests.has(key)) {
                continue;
            }

            this.nitroPendingSourceRequests.add(key);
            try {
                const [source, artwork] = await Promise.all([
                    this.resolveDirectMediaSource(musicItem),
                    resolveLocalMusicArtwork(musicItem).catch(() => ""),
                ]);
                if (
                    transitionToken &&
                    !this.mpvTrackTransitionGate.isActive(transitionToken)
                ) {
                    return;
                }
                const resolvedMusic =
                    artwork && !getDirectArtworkUri(musicItem.artwork)
                        ? ({ ...musicItem, artwork } as IMusic.IMusicItem)
                        : musicItem;
                if (resolvedMusic !== musicItem) {
                    this.replacePlayListMusicIfPresent(resolvedMusic, false);
                }
                if (!source?.url) {
                    continue;
                }
                const updatedTrack = this.patchMediaArtwork(
                    this.mergeTrackSource(
                        resolvedMusic,
                        source,
                    ) as unknown as MusicFreePlayerTrack,
                );
                if (updatedTrack) {
                    if (
                        transitionToken &&
                        !this.mpvTrackTransitionGate.isActive(
                            transitionToken,
                        )
                    ) {
                        return;
                    }
                    trace("预解析音源成功", {
                        musicId: musicItem.id,
                        platform: musicItem.platform,
                    });
                    await this.backend.updateTrack(updatedTrack);
                }
            } catch (error: any) {
                errorLog("预解析音源失败", error?.message ?? error);
            } finally {
                this.nitroPendingSourceRequests.delete(key);
            }
        }
        this.syncPreparedNextTrack("source-resolved");
    }

    private syncNitroCurrentMusic(
        track?: Partial<IMusic.IMusicItem> | null,
        reason?: unknown,
        preferredIndex?: number | null,
    ) {
        const musicItem = this.resolveMusicFromAdapterTrack(
            track,
            preferredIndex,
        );
        if (!musicItem) {
            return null;
        }
        const adapterArtwork = getDirectArtworkUri(track?.artwork);
        const syncedMusic = this.mergeTrackSource(musicItem, {
            ...(track?.url
                ? {
                    url: track.url,
                    headers: track.headers,
                    userAgent: track.userAgent,
                    allowInsecureHttpPlayback:
                        track.allowInsecureHttpPlayback,
                    trustedLocalMediaProxy: track.trustedLocalMediaProxy,
                    ekey: track.ekey,
                    cek: track.cek,
                    playbackSource: track.playbackSource,
                }
                : {}),
            ...(adapterArtwork ? { artwork: adapterArtwork } : {}),
        }) as IMusic.IMusicItem;
        const shouldResetProgress =
            !isSameMediaItem(this.currentMusic, syncedMusic) ||
            reason === "repeat";
        this.setCurrentMusic(syncedMusic);
        if (shouldResetProgress) {
            this.setPersistedPlaybackProgress(0);
            setPlayerProgress({
                position: 0,
                duration: Number(syncedMusic.duration) || 0,
                buffered: 0,
            });
        }
        this.syncPreparedNextTrack("current-music");
        return syncedMusic;
    }

    /**
     * 原生 prepared-next 只能预载「已经解析出 URL」的曲目：URL 为空时 adapter 会
     * 下发 prepareNext(null)，原生随即清空 runway。而音源预解析窗口原先只在显式
     * 加载（setTrackSource）时铺一次、覆盖之后 5 首，原生自动切歌会消耗窗口却不会
     * 补充。真机日志两轮都精确复现：显式加载后正好 5 次 autoAdvanced=true，第 6 个
     * 曲尾就变成 autoAdvanced=false，此后每个曲尾都要靠 JS 实时取源；App 在后台时
     * JS 迟到一次，播放就停在曲尾。所以每次自动切歌后都要把窗口向前补齐。
     */
    private async replenishMpvSourceLookahead(reason: string) {
        if (this.backend.name !== "mpv" || !this.backend.getTracksNeedingUrls) {
            return;
        }
        const startIndex = this.currentIndex;
        if (startIndex < 0) {
            return;
        }
        // 窗口必须和推进逻辑一样回绕：列表循环走到队尾时，下一首就是队首，
        // 而队首的 URL 可能是很久以前解析的。以前这里用 slice 不回绕，队尾时
        // 窗口为空直接 return，首曲的音源永远得不到刷新——回绕预载就会拿到
        // 一个过期 URL。offset 上限取 length-1，保证不会把当前曲自己算进来。
        const lookahead = Math.min(
            TrackPlayer.mpvSourceLookaheadSize,
            Math.max(this.playList.length - 1, 0),
        );
        const window: IMusic.IMusicItem[] = [];
        for (let offset = 1; offset <= lookahead; offset += 1) {
            const item = getWrappedQueueItem(this.playList, startIndex + offset);
            if (item) {
                window.push(item);
            }
        }
        if (!window.length) {
            return;
        }
        const needingUrls = await this.backend
            .getTracksNeedingUrls()
            .catch(() => [] as Array<Partial<IMusic.IMusicItem> | null | undefined>);
        const needingKeys = new Set(
            needingUrls
                .filter(Boolean)
                .map(track =>
                    getMediaUniqueKey(track as IMusic.IMusicItem),
                ),
        );
        const pending = window.filter(item =>
            needingKeys.has(getMediaUniqueKey(item)),
        );
        if (!pending.length) {
            return;
        }
        trace("补充 mpv 预载音源窗口", {
            reason,
            count: pending.length,
            startIndex,
        });
        // resolveNitroQueuedTracks 末尾会调 syncPreparedNextTrack("source-resolved")，
        // URL 落地后 runway 会自动重新武装。
        await this.resolveNitroQueuedTracks(pending);
    }

    private getBackendRepeatMode(
        mode: MusicRepeatMode = this.repeatMode,
    ): PlayerAdapterRepeatMode {
        if (mode === MusicRepeatMode.SINGLE) {
            return "track";
        }
        return "queue";
    }

    private async syncBackendRepeatMode() {
        await this.backend.setRepeatMode?.(this.getBackendRepeatMode());
    }

    private handlePlayFail() {
        trace("播放失败，不执行 JS 自动下一曲");
    }

    private recordPlaybackError(error: any) {
        const message = this.sanitizeDiagnosticText(
            error?.message ?? String(error ?? ""),
        );
        if (!message) {
            return;
        }
        this.recentPlaybackErrors = [
            {
                message,
                code: error?.code,
                createdAt: Date.now(),
            },
            ...this.recentPlaybackErrors,
        ].slice(0, 5);
    }

    private sanitizeDiagnosticText(value: string) {
        return value
            .replace(
                /(authorization|cookie|token|password)=([^&\s]+)/gi,
                "$1=***",
            )
            .replace(
                /(authorization|cookie|token|password):\s*([^\n]+)/gi,
                "$1: ***",
            );
    }

    private getDiagnosticUrlType(url?: string | null) {
        if (!url) {
            return "none";
        }
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes(".m3u8")) {
            return "hls";
        }
        if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://")) {
            return "http";
        }
        if (lowerUrl.startsWith("file://")) {
            return "file";
        }
        if (lowerUrl.startsWith("content://")) {
            return "content";
        }
        return "other";
    }

    /**
     *
     * @param musicItem 音乐类型
     * @param type 媒体类型
     * @param abortFunction 如果函数为true，则中断
     * @returns
     */
    private async getSimilarMusic<T extends ICommon.SupportMediaType>(
        musicItem: IMusic.IMusicItem,
        type: T = "music" as T,
        abortFunction?: () => boolean,
    ): Promise<ICommon.SupportMediaItemBase[T] | null> {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManagerService.getSearchablePlugins(type);

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin;

        const startTime = Date.now();

        for (let plugin of plugins) {
            // 超时时间：8s
            if (abortFunction?.() || Date.now() - startTime > 8000) {
                break;
            }
            if (plugin.name === musicItem.platform) {
                continue;
            }
            const results = await plugin.methods
                .search(keyword, 1, type)
                .catch(() => null);

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (
                    item.title === keyword &&
                    item.artist === musicItem.artist
                ) {
                    distance = 0;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                    break;
                } else {
                    const dist = getLyricCandidateDistance(
                        keyword,
                        musicItem,
                        item,
                    );
                    if (dist < distance) {
                        distance = dist;
                        minDistanceMusicItem = item;
                        targetPlugin = plugin;
                    }
                }
            }

            if (distance === 0) {
                break;
            }
        }
        if (minDistanceMusicItem && targetPlugin) {
            return minDistanceMusicItem as ICommon.SupportMediaItemBase[T];
        }

        return null;
    }

    private patchMediaArtwork(track: MusicFreePlayerTrack) {
        if (!track) {
            return null;
        }
        const artwork = getNativeArtworkUri(track.artwork);

        return {
            ...track,
            // System media notifications can only resolve real URIs. The RN
            // bundled default artwork is still applied by UI image components.
            artwork: artwork || undefined,
        };
    }
}

export const usePlayList = () => useAtomValue(playListAtom);
export const usePlayLaterQueue = () => useAtomValue(playLaterQueueAtom);
export const useCurrentMusic = () => useAtomValue(currentMusicAtom);
export const useRepeatMode = () => useAtomValue(repeatModeAtom);
export const useMusicQuality = () => useAtomValue(qualityAtom);
export function useMusicState() {
    const musicState = useAtomValue(musicStateAtom);
    const playerReady = useAtomValue(playerReadyAtom);

    useEffect(() => {
        if (!shouldHydratePlayerHooks(playerReady)) {
            return;
        }
        let cancelled = false;
        trackPlayer.playerAdapter
            .getState()
            .then(state => {
                if (!cancelled) {
                    getDefaultStore().set(musicStateAtom, state);
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [playerReady]);

    return musicState;
}

export function useProgress(_updateInterval?: number) {
    const progress = useAtomValue(progressAtom);
    const playerReady = useAtomValue(playerReadyAtom);

    useEffect(() => {
        if (!shouldHydratePlayerHooks(playerReady)) {
            return;
        }
        let cancelled = false;
        trackPlayer
            .getProgress()
            .then(currentProgress => {
                if (!cancelled) {
                    setPlayerProgress(
                        currentProgress,
                        trackPlayer.currentMusic?.duration ?? 0,
                    );
                }
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
        };
    }, [playerReady]);

    return progress;
}
export type { PlayerBackendState as MusicState };

enum PlayFailReason {
    /** 禁止移动网络播放 */
    FORBID_CELLUAR_NETWORK_PLAY = "FORBID_CELLUAR_NETWORK_PLAY",
    /** 播放列表为空 */
    PLAY_LIST_IS_EMPTY = "PLAY_LIST_IS_EMPTY",
    /** 无效源 */
    INVALID_SOURCE = "INVALID_SOURCE",
    /** 缺少本地音频读取权限 */
    MISSING_AUDIO_PERMISSION = "MISSING_AUDIO_PERMISSION",
    /** 非当前音乐 */
}

const trackPlayer = new TrackPlayer();
export default trackPlayer;
