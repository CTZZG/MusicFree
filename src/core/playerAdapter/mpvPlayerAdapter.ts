import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { errorLog, trace } from "@/utils/log";
import NativeMpvPlayer, {
    MpvActiveTrackChangedEvent,
    MpvEndedEvent,
    MpvLoadPayload,
    MpvPlayerState,
    MpvQueueSnapshotTrack,
    MpvRemoteCommand,
} from "./nativeMpvPlayer";
import { encodeMpvMediaId, matchesMpvMediaId } from "./mpvMediaId";
import {
    collectMpvNextIndices,
    computeMpvNextIndex,
    computeMpvPreviousIndex,
    isValidMpvQueueIndex,
    resolveMpvPlayAction,
    resolveMpvLoadQueueStartIndex,
    resolveMpvCurrentIndexAfterQueueSync,
} from "./mpvQueue";
import type {
    PlayerAdapter,
    PlayerAdapterConfig,
    PlayerAdapterEvent,
    PlayerAdapterLoadQueueOptions,
    PlayerAdapterPlaybackError,
    PlayerAdapterProgress,
    PlayerAdapterRepeatMode,
    PlayerAdapterSeekedEvent,
    PlayerAdapterSubscription,
    PlayerAdapterTrack,
    PlayerAdapterTrackRef,
    PlayerBackendState,
} from "./types";

/**
 * mpv 播放内核适配器（实验性，仅 Android）。
 *
 * 与 NitroPlayerAdapter 不同：队列、当前下标、repeat、自动切歌全部由本适配器在 JS 侧管理，
 * 原生 mpv 只负责「播放单个 URL + 上报进度/结束」。这样队列只有一个真相来源（本适配器），
 * 避免了老 dev-mpv1 中原生/JS 双队列对账导致的状态同步问题。
 *
 * 对上层 trackPlayer 而言，本适配器在事件契约上「装成」Nitro：
 * - trackChanged：{ track, index, reason }，reason="end" 触发上层 PlayEnd / 播放下一首逻辑
 * - progress / playbackStateChanged / playbackSeeked / playbackError / tracksNeedUpdate
 */

export type MpvTrack = PlayerAdapterTrack & Partial<IMusic.IMusicItem>;
type TrackChangeReason = "playStart" | "manual" | "end" | "repeat";
const MPV_QUEUE_ID = "musicfree-mpv-queue";
const MPV_QUEUE_NAME = "MusicFree Playback Queue";
const END_POSITION_EPSILON_SECONDS = 0.75;
interface PreparedNextTrack {
    key: string;
    track: MpvTrack;
    nativePrepared: boolean;
    index: number;
    sourceMediaId: string | null;
    mediaId: string;
    loadGeneration: number;
    prepareToken: number;
    queueRevision: number;
}
interface PendingActivation {
    key: string;
    mediaId: string;
    index: number;
    loadGeneration: number;
    queueRevision: number;
    reason: TrackChangeReason;
    autoPlay: boolean;
}

function keyOf(track: MpvTrack): string {
    if (track.platform && track.id) {
        return getMediaUniqueKey(track as unknown as IMusic.IMusicItem);
    }
    return track.id;
}

function isPlayableUrl(url?: string | null): url is string {
    return typeof url === "string" && url.trim().length > 0;
}

function normalizeArtist(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(item =>
                item && typeof item === "object" && "name" in item
                    ? String((item as {name?: unknown}).name ?? "")
                    : String(item ?? ""),
            )
            .filter(Boolean)
            .join(", ");
    }
    return typeof value === "string" ? value : String(value ?? "");
}

function mapMpvState(state: MpvPlayerState): PlayerBackendState {
    switch (state) {
    case "playing":
        return "playing";
    case "paused":
        return "paused";
    case "buffering":
        return "buffering";
    case "ended":
        return "ended";
    case "error":
        return "error";
    default:
        return "idle";
    }
}

function toLoadPayload(
    track: MpvTrack,
    identity: Pick<
        MpvLoadPayload,
        "mediaId" | "loadGeneration" | "prepareToken" | "queueRevision"
    >,
    autoPlay = true,
): MpvLoadPayload {
    return {
        url: track.url ?? "",
        ...identity,
        headers: track.headers,
        userAgent: track.userAgent,
        title: typeof track.title === "string" ? track.title : "",
        artist: normalizeArtist(track.artist),
        album: typeof track.album === "string" ? track.album : "",
        artwork: typeof track.artwork === "string" ? track.artwork : null,
        duration: Number(track.duration) || 0,
        autoPlay,
    };
}

function toQueueSnapshotTrack(track: MpvTrack): MpvQueueSnapshotTrack {
    return {
        id: encodeMpvMediaId(keyOf(track)),
        title: typeof track.title === "string" ? track.title : "",
        artist: normalizeArtist(track.artist),
        album: typeof track.album === "string" ? track.album : "",
        artwork: typeof track.artwork === "string" ? track.artwork : null,
    };
}

export class MpvPlayerAdapter implements PlayerAdapter<MpvTrack> {
    readonly name = "mpv" as const;
    readonly remoteControlMode = "native-session" as const;

    private queue: MpvTrack[] = [];
    private desiredIndex = -1;
    private pendingIndex = -1;
    private activeIndex = -1;
    private activeTrack: MpvTrack | null = null;
    private activeMediaId: string | null = null;
    private activeLoadGeneration: number | null = null;
    private queueRevision = 0;
    private loadGenerationSerial = Date.now() * 1000;
    private prepareTokenSerial = Date.now() * 1000;
    private pendingActivation: PendingActivation | null = null;
    private recoveringIdentity = false;
    private repeatMode: PlayerAdapterRepeatMode = "off";
    private rate = 1;
    private volume = 1;
    private duckedVolume: number | null = null;
    private duckRatio = 1;
    private currentState: PlayerBackendState = "idle";
    private currentProgress: PlayerAdapterProgress = {
        position: 0,
        duration: 0,
        buffered: 0,
    };
    private suppressNativeEndedStateUntil = 0;
    private playNextQueue: MpvTrack[] = [];
    private upNextQueue: MpvTrack[] = [];
    private preparedNextTrack: PreparedNextTrack | null = null;
    private confirmedPromotion: PreparedNextTrack | null = null;
    /** 是否已向原生加载过音轨（决定 play() 是 resume 还是首次加载） */
    private hasLoaded = false;
    /** 等待 URL 解析后再加载的下标（-1 表示无） */
    private pendingLoadIndex = -1;
    private pendingLoadReason: TrackChangeReason = "playStart";
    private pendingLoadAutoPlay = true;
    private nativeListenersBound = false;
    private setupPromise: Promise<void> | null = null;
    private androidAutoConnected = false;

    private trackChangedListeners = new Set<(...a: any[]) => void>();
    private playbackStateChangedListeners = new Set<(...a: any[]) => void>();
    private progressListeners = new Set<(...a: any[]) => void>();
    private playbackSeekedListeners = new Set<(...a: any[]) => void>();
    private playbackErrorListeners = new Set<(...a: any[]) => void>();
    private tracksNeedUpdateListeners = new Set<(...a: any[]) => void>();
    private playEndListeners = new Set<(...a: any[]) => void>();
    private temporaryQueueChangedListeners = new Set<(...a: any[]) => void>();
    private androidAutoConnectionChangedListeners = new Set<
        (...a: any[]) => void
    >();
    private queuesChangedListeners = new Set<(...a: any[]) => void>();
    private queueChangedListeners = new Set<(...a: any[]) => void>();
    private remoteListeners: Partial<
        Record<PlayerAdapterEvent, Set<(...a: any[]) => void>>
    > = {};

    /**************** setup / configure ****************/

    async setup(config?: PlayerAdapterConfig) {
        if (this.setupPromise) {
            return this.setupPromise;
        }
        this.setupPromise = (async () => {
            if (!NativeMpvPlayer.isAvailable()) {
                throw new Error(
                    "已选择 mpv 播放内核，但当前未检测到 mpv 原生模块。" +
                        "请在 Android 上构建包含 MpvPlayer 的版本，或在设置中切回 Nitro 内核。",
                );
            }
            this.bindNativeListeners();
            await NativeMpvPlayer.initialize({
                userAgent: config?.userAgent,
                maxCacheSize: config?.maxCacheSize,
                remoteDuckMode: config?.remoteDuckMode,
                remoteDuckVolume: config?.remoteDuckVolume,
                progressIntervalMs: config?.progressUpdateEventInterval,
                showStopAction:
                    config?.notificationCapabilities?.includes("stop") ??
                    config?.capabilities?.includes("stop") ??
                    false,
            });
            this.androidAutoConnected =
                await NativeMpvPlayer.isAndroidAutoConnected().catch(
                    () => false,
                );
            trace("MpvPlayer.setup done");
        })();
        return this.setupPromise;
    }

    async configure(config?: PlayerAdapterConfig) {
        // mpv 原生模块在 setup 阶段初始化；通知/MediaSession 由原生服务自管理。
        trace("MpvPlayer.configure", {
            showInNotification: config?.showInNotification,
        });
    }

    private bindNativeListeners() {
        if (this.nativeListenersBound) {
            return;
        }
        this.nativeListenersBound = true;

        NativeMpvPlayer.addStateChangedListener(({ state }) => {
            const mappedState = mapMpvState(state);
            if (
                mappedState === "ended" &&
                Date.now() < this.suppressNativeEndedStateUntil
            ) {
                return;
            }
            this.emitPlaybackStateChanged(mappedState);
        });

        NativeMpvPlayer.addProgressListener(
            ({ position, duration, buffered }) => {
                this.currentProgress = {
                    position,
                    duration: duration || this.currentProgress.duration,
                    buffered: Math.max(position, buffered ?? position),
                };
                this.progressListeners.forEach(l => l(this.currentProgress));
            },
        );

        NativeMpvPlayer.addActiveTrackChangedListener(event => {
            this.handleNativeActiveTrackChanged(event).catch(error =>
                errorLog("MpvPlayer 激活身份同步失败", error?.message ?? error),
            );
        });

        NativeMpvPlayer.addEndedListener(event => {
            this.handleNativeEnded(event).catch(error =>
                errorLog("MpvPlayer 自动切歌失败", error?.message ?? error),
            );
        });

        NativeMpvPlayer.addErrorListener(({ message, code }) => {
            this.currentState = "error";
            const error: PlayerAdapterPlaybackError = {
                code: "mpv-playback-error",
                message: message || "mpv playback error",
                backend: this.name,
                nativeCode: code,
                nativeMessage: message,
            };
            errorLog("MpvPlayer 播放出错", message);
            this.playbackErrorListeners.forEach(l => l(error));
        });

        NativeMpvPlayer.addRemoteCommandListener(
            ({ command, position, volume, mediaId }) => {
                this.handleRemoteCommand(command, position, volume, mediaId);
            },
        );

        NativeMpvPlayer.addAndroidAutoConnectionChangedListener(
            ({ connected }) => {
                this.androidAutoConnected = Boolean(connected);
                this.androidAutoConnectionChangedListeners.forEach(listener =>
                    listener({ connected: this.androidAutoConnected }),
                );
            },
        );
    }

    /**************** 队列加载与切歌 ****************/

    private nextLoadGeneration() {
        this.loadGenerationSerial += 1;
        return this.loadGenerationSerial;
    }

    private nextPrepareToken() {
        this.prepareTokenSerial += 1;
        return this.prepareTokenSerial;
    }

    private bumpQueueRevision() {
        this.queueRevision += 1;
        return this.queueRevision;
    }

    async loadQueue(
        tracks: MpvTrack[],
        startIndex = 0,
        options?: PlayerAdapterLoadQueueOptions,
    ) {
        this.bumpQueueRevision();
        this.queue = tracks.slice();
        this.playNextQueue = [];
        this.upNextQueue = [];
        this.preparedNextTrack = null;
        this.confirmedPromotion = null;
        const target = resolveMpvLoadQueueStartIndex(
            this.queue.length,
            startIndex,
        );
        this.desiredIndex = target ?? -1;
        this.pendingIndex = -1;
        this.activeIndex = this.activeMediaId
            ? this.queue.findIndex(item => keyOf(item) === this.activeMediaId)
            : -1;
        if (this.activeIndex >= 0) {
            this.activeTrack = this.queue[this.activeIndex];
        }
        this.pendingActivation = null;
        this.pendingLoadIndex = -1;
        this.emitQueueChanged("update");
        this.emitTemporaryQueueChanged();
        trace("MpvPlayer.loadQueue", {
            count: this.queue.length,
            startIndex: target,
            autoPlay: options?.autoPlay ?? true,
        });
        if (target == null) {
            await NativeMpvPlayer.prepareNext(null).catch(() => undefined);
            await NativeMpvPlayer.stop().catch(() => undefined);
            this.hasLoaded = false;
            this.currentState = "stopped";
            this.currentProgress = { position: 0, duration: 0, buffered: 0 };
            if (this.queue.length > 0) {
                this.playbackErrorListeners.forEach(l =>
                    l({
                        code: "mpv-invalid-start-index",
                        message: `Invalid MPV queue start index: ${startIndex}`,
                        backend: this.name,
                    } as PlayerAdapterPlaybackError),
                );
            }
            return;
        }
        await this.playIndex(target, "playStart", options?.autoPlay ?? true);
    }

    /** 加载并播放指定下标；URL 未就绪时发 tracksNeedUpdate 并挂起 */
    private async playIndex(
        index: number,
        reason: TrackChangeReason,
        autoPlay = true,
    ) {
        if (index < 0 || index >= this.queue.length) {
            await this.stop();
            return;
        }
        this.desiredIndex = index;
        this.pendingIndex = index;
        const track = this.queue[index];
        this.preparedNextTrack = null;

        if (!isPlayableUrl(track.url)) {
            // 音源未解析，挂起，等上层通过 updateTrack 回填 URL
            this.pendingLoadIndex = index;
            this.pendingLoadReason = reason;
            this.pendingLoadAutoPlay = autoPlay;
            trace("MpvPlayer.playIndex 等待音源解析", { index });
            this.tracksNeedUpdateListeners.forEach(l =>
                l({ tracks: [track], lookahead: 0 }),
            );
            return;
        }

        this.pendingLoadIndex = -1;
        const mediaId = keyOf(track);
        const loadGeneration = this.nextLoadGeneration();
        const activation: PendingActivation = {
            key: mediaId,
            mediaId,
            index,
            loadGeneration,
            queueRevision: this.queueRevision,
            reason,
            autoPlay,
        };
        this.pendingActivation = activation;
        try {
            await NativeMpvPlayer.loadAndPlay(
                toLoadPayload(
                    track,
                    {
                        mediaId,
                        loadGeneration,
                        prepareToken: 0,
                        queueRevision: this.queueRevision,
                    },
                    autoPlay,
                ),
            );
            this.hasLoaded = true;
            this.currentProgress = {
                position: 0,
                duration: Number(track.duration) || 0,
                buffered: 0,
            };
        } catch (error: any) {
            if (this.pendingActivation?.loadGeneration === loadGeneration) {
                this.pendingActivation = null;
                this.pendingIndex = -1;
                this.desiredIndex = this.activeIndex;
            }
            errorLog("MpvPlayer.loadAndPlay 失败", error?.message ?? error);
            this.playbackErrorListeners.forEach(l =>
                l({
                    code: "mpv-load-failed",
                    message: error?.message ?? "mpv load failed",
                    backend: this.name,
                } as PlayerAdapterPlaybackError),
            );
        }
    }

    async prepareNextTrack(track?: MpvTrack | null) {
        if (!track) {
            this.preparedNextTrack = null;
            this.nextPrepareToken();
            await NativeMpvPlayer.prepareNext(null).catch(() => undefined);
            return;
        }

        const key = keyOf(track);
        const queueTrack =
            this.queue.find(item => keyOf(item) === key) ?? track;
        const resolvedTrack = isPlayableUrl(queueTrack.url)
            ? queueTrack
            : track;
        const nativePrepared = isPlayableUrl(resolvedTrack.url);
        const index = this.indexOfRef(resolvedTrack);
        const canPrepare =
            nativePrepared &&
            this.repeatMode !== "track" &&
            this.playNextQueue.length === 0 &&
            this.upNextQueue.length === 0 &&
            this.activeIndex >= 0 &&
            index === this.activeIndex + 1;

        const existingPrepared = this.preparedNextTrack;
        if (
            canPrepare &&
            existingPrepared &&
            existingPrepared.mediaId === key &&
            existingPrepared.sourceMediaId === this.activeMediaId &&
            existingPrepared.index === index &&
            existingPrepared.queueRevision === this.queueRevision &&
            existingPrepared.track.url === resolvedTrack.url
        ) {
            // TrackPlayer 会在封面补齐、音源预解析等多个时机重复同步同一首
            // prepared next。重复 remove/append 会使已经在原生切换中的 token
            // 失效，最终出现“声音已到 B，UI 仍是 A”。相同身份应保持幂等。
            this.preparedNextTrack = {
                ...existingPrepared,
                track: resolvedTrack,
            };
            return;
        }

        const prepareToken = this.nextPrepareToken();
        const loadGeneration = this.nextLoadGeneration();
        this.preparedNextTrack = {
            key,
            track: resolvedTrack,
            nativePrepared: canPrepare,
            index,
            sourceMediaId: this.activeMediaId,
            mediaId: key,
            loadGeneration,
            prepareToken,
            queueRevision: this.queueRevision,
        };

        if (!canPrepare) {
            this.preparedNextTrack = null;
            await NativeMpvPlayer.prepareNext(null).catch(() => undefined);
            return;
        }

        try {
            await NativeMpvPlayer.prepareNext(
                toLoadPayload(resolvedTrack, {
                    mediaId: key,
                    loadGeneration,
                    prepareToken,
                    queueRevision: this.queueRevision,
                }),
            );
        } catch (error) {
            if (this.preparedNextTrack?.prepareToken === prepareToken) {
                this.preparedNextTrack = null;
            }
            throw error;
        }
    }

    private getQueueInfoSnapshot() {
        return {
            id: MPV_QUEUE_ID,
            name: MPV_QUEUE_NAME,
            tracks: this.queue.slice(),
        };
    }

    private emitQueueChanged(
        operation?: "add" | "remove" | "clear" | "update",
    ) {
        const queue = this.getQueueInfoSnapshot();
        const queuesPayload = {
            queues: [queue],
            operation,
        };
        const queuePayload = {
            queueId: MPV_QUEUE_ID,
            queue,
            operation,
        };
        this.queuesChangedListeners.forEach(l => l(queuesPayload));
        this.queueChangedListeners.forEach(l => l(queuePayload));
        this.syncNativeQueueSnapshot();
    }

    private syncNativeQueueSnapshot() {
        try {
            NativeMpvPlayer.updateQueueSnapshot({
                currentIndex: this.activeIndex,
                tracks: this.queue.map(toQueueSnapshotTrack),
            }).catch(() => undefined);
        } catch {
            // Native module may be temporarily unavailable while backend setup is recovering.
        }
    }

    private emitTemporaryQueueChanged() {
        const payload = {
            playNextQueue: this.playNextQueue.slice(),
            upNextQueue: this.upNextQueue.slice(),
        };
        this.temporaryQueueChangedListeners.forEach(l => l(payload));
    }

    private async clearPreparedNextTrack() {
        this.preparedNextTrack = null;
        this.nextPrepareToken();
        await NativeMpvPlayer.prepareNext(null).catch(() => undefined);
    }

    private emitTrackChanged(
        track: MpvTrack,
        index: number,
        reason: TrackChangeReason,
    ) {
        const payload = {
            track,
            index,
            reason,
            activationGeneration: this.activeLoadGeneration,
            queueRevision: this.queueRevision,
            mediaId: this.activeMediaId,
        };
        trace("MpvPlayer.trackChanged", {
            index,
            reason,
            musicId: track.id,
            platform: track.platform,
        });
        this.trackChangedListeners.forEach(l => l(payload));
        this.syncNativeQueueSnapshot();
    }

    private emitPlaybackStateChanged(state: PlayerBackendState) {
        this.currentState = state;
        this.playbackStateChangedListeners.forEach(l => l(this.currentState));
    }

    private matchesPreparedIdentity(event: {
        mediaId?: string;
        loadGeneration?: number;
        prepareToken?: number;
        queueRevision?: number;
    }, prepared = this.preparedNextTrack) {
        return !!(
            prepared &&
            event.mediaId === prepared.mediaId &&
            event.loadGeneration === prepared.loadGeneration &&
            event.prepareToken === prepared.prepareToken &&
            event.queueRevision === prepared.queueRevision
        );
    }

    private commitActiveTrack(
        index: number,
        mediaId: string,
        loadGeneration: number,
        reason: TrackChangeReason,
    ) {
        const track = this.queue[index];
        if (!track || keyOf(track) !== mediaId) {
            return false;
        }
        const alreadyCommitted =
            this.activeMediaId === mediaId &&
            this.activeLoadGeneration === loadGeneration;
        this.activeIndex = index;
        this.activeTrack = track;
        this.desiredIndex = index;
        this.pendingIndex = -1;
        this.pendingLoadIndex = -1;
        this.pendingActivation = null;
        this.activeMediaId = mediaId;
        this.activeLoadGeneration = loadGeneration;
        this.hasLoaded = true;
        this.currentProgress = {
            position: 0,
            duration: Number(track.duration) || 0,
            buffered: 0,
        };
        NativeMpvPlayer.updateMetadata({
            title: typeof track.title === "string" ? track.title : "",
            artist: normalizeArtist(track.artist),
            album: typeof track.album === "string" ? track.album : "",
            artwork: typeof track.artwork === "string" ? track.artwork : null,
            duration: Number(track.duration) || 0,
        }).catch(() => undefined);
        if (!alreadyCommitted) {
            this.emitTrackChanged(track, index, reason);
        }
        return true;
    }

    private async recoverFromIdentityMismatch(
        source: string,
        nativeMediaId?: string,
    ) {
        if (this.recoveringIdentity) {
            return;
        }
        this.recoveringIdentity = true;
        try {
            trace(
                "MpvPlayer identity mismatch",
                {
                    source,
                    queueRevision: this.queueRevision,
                    desiredIndex: this.desiredIndex,
                    pendingIndex: this.pendingIndex,
                    activeIndex: this.activeIndex,
                    activeMediaId: this.activeMediaId,
                    nativeMediaId,
                    pendingGeneration: this.pendingActivation?.loadGeneration,
                    preparedToken: this.preparedNextTrack?.prepareToken,
                },
                "error",
            );
            await this.clearPreparedNextTrack();
            await NativeMpvPlayer.stop().catch(() => undefined);
            this.hasLoaded = false;
            this.activeIndex = -1;
            this.activeTrack = null;
            this.activeMediaId = null;
            this.activeLoadGeneration = null;
            if (isValidMpvQueueIndex(this.desiredIndex, this.queue.length)) {
                await this.playIndex(this.desiredIndex, "manual");
            }
        } finally {
            this.recoveringIdentity = false;
        }
    }

    private async handleNativeActiveTrackChanged(
        event: MpvActiveTrackChangedEvent,
    ) {
        if (event.source === "prepared" && this.matchesPreparedIdentity(event)) {
            const prepared = this.preparedNextTrack!;
            this.confirmedPromotion = prepared;
            this.preparedNextTrack = null;
            this.commitActiveTrack(
                prepared.index,
                prepared.mediaId,
                prepared.loadGeneration,
                "end",
            );
            return;
        }

        const pending = this.pendingActivation;
        if (
            event.source === "loaded" &&
            pending &&
            event.mediaId === pending.mediaId &&
            event.loadGeneration === pending.loadGeneration &&
            event.queueRevision === pending.queueRevision
        ) {
            this.commitActiveTrack(
                pending.index,
                pending.mediaId,
                pending.loadGeneration,
                pending.reason,
            );
            return;
        }

        if (
            event.mediaId === this.activeMediaId &&
            event.loadGeneration === this.activeLoadGeneration
        ) {
            return;
        }
        await this.recoverFromIdentityMismatch(
            `active-${event.source}`,
            event.mediaId,
        );
    }

    /** 自然结束只确认原生 prepared promotion；其余下一首由 TrackPlayer 决定。 */
    private async handleNativeEnded(event: MpvEndedEvent) {
        this.suppressNativeEndedStateUntil = Date.now() + 3000;
        const endedMediaId = event.endedMediaId;
        const promoted = this.confirmedPromotion ?? this.preparedNextTrack;
        const acceptedPromotion =
            Boolean(event.autoAdvanced) &&
            this.matchesPreparedIdentity({
                mediaId: event.promotedMediaId,
                loadGeneration: event.loadGeneration,
                prepareToken: event.prepareToken,
                queueRevision: event.queueRevision,
            }, promoted);
        const expectedEndedMediaId = acceptedPromotion
            ? promoted?.sourceMediaId
            : this.activeMediaId;
        if (
            endedMediaId &&
            expectedEndedMediaId &&
            endedMediaId !== expectedEndedMediaId
        ) {
            await this.recoverFromIdentityMismatch("ended", endedMediaId);
            return;
        }
        if (acceptedPromotion) {
            const prepared = promoted!;
            this.commitActiveTrack(
                prepared.index,
                prepared.mediaId,
                prepared.loadGeneration,
                "end",
            );
            if (this.preparedNextTrack?.prepareToken === prepared.prepareToken) {
                this.preparedNextTrack = null;
            }
            this.confirmedPromotion = null;
        } else if (event.autoAdvanced) {
            this.confirmedPromotion = null;
            await this.recoverFromIdentityMismatch(
                "prepared-promotion",
                event.promotedMediaId,
            );
            return;
        } else {
            this.confirmedPromotion = null;
            this.preparedNextTrack = null;
            this.suppressNativeEndedStateUntil = 0;
            this.emitPlaybackStateChanged("ended");
        }

        this.playEndListeners.forEach(l =>
            l({
                reason: "end",
                index: this.activeIndex,
                trackId: this.queue[this.activeIndex]?.id,
                endedMediaId,
                promotedMediaId: acceptedPromotion
                    ? event.promotedMediaId
                    : undefined,
                autoAdvanced: acceptedPromotion,
                activationGeneration: event.loadGeneration,
                queueRevision: event.queueRevision,
            }),
        );
    }

    private isAtTrackEnd(progress = this.currentProgress) {
        const position = Number(progress.position);
        const duration = Number(progress.duration);
        return (
            Number.isFinite(position) &&
            Number.isFinite(duration) &&
            duration > 0 &&
            position >= Math.max(0, duration - END_POSITION_EPSILON_SECONDS)
        );
    }

    private async finishCurrentTrackFromEndSeek() {
        await NativeMpvPlayer.pause().catch(() => undefined);
        await this.handleNativeEnded({ reason: "end", autoAdvanced: false });
    }

    private shiftTemporaryNextTrack() {
        const next = this.playNextQueue.shift() ?? this.upNextQueue.shift();
        if (next) {
            this.emitTemporaryQueueChanged();
        }
        return next;
    }

    private async playResolvedTemporaryTrack(
        track: MpvTrack,
        reason: TrackChangeReason,
    ) {
        const existingIndex = this.indexOfRef(track);
        if (existingIndex >= 0) {
            await this.playIndex(existingIndex, reason);
            return;
        }
        const insertIndex =
            this.desiredIndex >= 0
                ? Math.min(this.desiredIndex + 1, this.queue.length)
                : this.queue.length;
        this.bumpQueueRevision();
        await this.clearPreparedNextTrack();
        this.queue.splice(insertIndex, 0, track);
        this.activeIndex = this.activeMediaId
            ? this.queue.findIndex(item => keyOf(item) === this.activeMediaId)
            : -1;
        this.emitQueueChanged("add");
        await this.playIndex(insertIndex, reason);
    }

    /** 计算下一首下标；wrapForManual=true 时手动切歌在末尾回绕 */
    private computeNextIndex(wrapForManual: boolean): number | null {
        return computeMpvNextIndex(
            {
                currentIndex: this.desiredIndex,
                queueLength: this.queue.length,
                repeatMode: this.repeatMode,
            },
            wrapForManual,
        );
    }

    /**************** 基础控制 ****************/

    async play() {
        if (this.pendingActivation) {
            if (!this.pendingActivation.autoPlay) {
                await NativeMpvPlayer.resume();
            }
            return;
        }
        const progress = this.hasLoaded
            ? await this.getProgress()
            : this.currentProgress;
        const action = resolveMpvPlayAction({
            hasLoaded: this.hasLoaded,
            currentState: this.currentState,
            currentIndex: this.desiredIndex,
            queueLength: this.queue.length,
            isAtTrackEnd: this.isAtTrackEnd(progress),
        });

        switch (action) {
        case "finish-ended":
            await this.finishCurrentTrackFromEndSeek();
            break;
        case "reload-current":
            await this.playIndex(this.desiredIndex, "playStart");
            break;
        case "resume":
            await NativeMpvPlayer.resume();
            break;
        case "none":
            break;
        }
    }

    async pause() {
        await NativeMpvPlayer.pause();
    }

    async stop() {
        await NativeMpvPlayer.stop().catch(() => undefined);
        this.hasLoaded = false;
        this.preparedNextTrack = null;
        this.confirmedPromotion = null;
        this.pendingActivation = null;
        this.pendingIndex = -1;
        this.activeIndex = -1;
        this.activeTrack = null;
        this.activeMediaId = null;
        this.activeLoadGeneration = null;
        this.currentState = "stopped";
        this.currentProgress = {
            ...this.currentProgress,
            position: 0,
            buffered: 0,
        };
    }

    async reset() {
        await NativeMpvPlayer.stop().catch(() => undefined);
        this.queue = [];
        this.bumpQueueRevision();
        this.desiredIndex = -1;
        this.pendingIndex = -1;
        this.activeIndex = -1;
        this.activeTrack = null;
        this.activeMediaId = null;
        this.activeLoadGeneration = null;
        this.pendingActivation = null;
        this.pendingLoadIndex = -1;
        this.hasLoaded = false;
        this.playNextQueue = [];
        this.upNextQueue = [];
        this.preparedNextTrack = null;
        this.confirmedPromotion = null;
        this.currentState = "idle";
        this.currentProgress = { position: 0, duration: 0, buffered: 0 };
        this.emitQueueChanged("clear");
        this.emitTemporaryQueueChanged();
    }

    async skipToNext() {
        const temporaryNext = this.shiftTemporaryNextTrack();
        if (temporaryNext) {
            await this.playResolvedTemporaryTrack(temporaryNext, "manual");
            return;
        }
        const nextIndex = this.computeNextIndex(true);
        if (nextIndex == null) {
            return;
        }
        await this.playIndex(nextIndex, "manual");
    }

    async consumeTemporaryNextTrack() {
        const temporaryNext = this.shiftTemporaryNextTrack();
        if (!temporaryNext) {
            return false;
        }
        await this.playResolvedTemporaryTrack(temporaryNext, "end");
        return true;
    }

    async skipToPrevious() {
        const previousIndex = computeMpvPreviousIndex({
            currentIndex: this.desiredIndex,
            queueLength: this.queue.length,
            repeatMode: this.repeatMode,
        });
        if (previousIndex == null) {
            return;
        }
        await this.playIndex(previousIndex, "manual");
    }

    async skipToIndex(index: number) {
        if (index < 0 || index >= this.queue.length) {
            return false;
        }
        await this.playIndex(index, "manual");
        return true;
    }

    async seekTo(position: number) {
        await NativeMpvPlayer.seekTo(position);
        this.currentProgress = {
            ...this.currentProgress,
            position,
            buffered: Math.max(position, this.currentProgress.buffered),
        };
        const payload: PlayerAdapterSeekedEvent = {
            position,
            duration: this.currentProgress.duration,
        };
        this.playbackSeekedListeners.forEach(l => l(payload));
        if (this.currentState === "playing" && this.isAtTrackEnd()) {
            await this.finishCurrentTrackFromEndSeek();
        }
    }

    /**************** 状态查询 ****************/

    async getProgress() {
        try {
            const [position, duration] = await Promise.all([
                NativeMpvPlayer.getPosition(),
                NativeMpvPlayer.getDuration(),
            ]);
            this.currentProgress = {
                position,
                duration: duration || this.currentProgress.duration,
                buffered: Math.max(position, this.currentProgress.buffered),
            };
        } catch {
            // 退回到最近一次进度回调缓存
        }
        return this.currentProgress;
    }

    async getState() {
        return this.currentState;
    }

    async getActiveTrack() {
        return this.activeTrack;
    }

    async getActiveTrackIndex() {
        return isValidMpvQueueIndex(this.activeIndex, this.queue.length)
            ? this.activeIndex
            : null;
    }

    async getPlaybackDiagnostics() {
        return {
            queueRevision: this.queueRevision,
            desiredIndex: this.desiredIndex,
            pendingIndex: this.pendingIndex,
            activeIndex: this.activeIndex,
            activeMediaId: this.activeMediaId,
            activeLoadGeneration: this.activeLoadGeneration,
            pendingMediaId: this.pendingActivation?.mediaId ?? null,
            pendingLoadGeneration:
                this.pendingActivation?.loadGeneration ?? null,
            preparedMediaId: this.preparedNextTrack?.mediaId ?? null,
            prepareToken: this.preparedNextTrack?.prepareToken ?? null,
            preparedQueueRevision:
                this.preparedNextTrack?.queueRevision ?? null,
        };
    }

    async getTrack(index: number) {
        return this.queue[index] ?? null;
    }

    async getRate() {
        return this.rate;
    }

    async setRate(rate: number) {
        this.rate = rate;
        await NativeMpvPlayer.setRate(rate);
    }

    async setVolume(volume: number) {
        // 上层传入 0-1；nitro 适配器会放大到 0-100，这里 mpv 统一用 0-1
        this.volume = volume <= 1 ? volume : volume / 100;
        if (this.duckedVolume == null) {
            await NativeMpvPlayer.setVolume(this.volume);
        } else {
            this.duckedVolume = this.volume;
            await NativeMpvPlayer.setVolume(this.volume * this.duckRatio);
        }
    }

    async setRepeatMode(mode: PlayerAdapterRepeatMode) {
        this.repeatMode = mode;
        if (mode === "track") {
            await this.clearPreparedNextTrack();
        }
    }

    async getRepeatMode() {
        return this.repeatMode;
    }

    async getQueue() {
        return this.queue.slice();
    }

    async getNextTracks(count: number) {
        return collectMpvNextIndices(
            {
                currentIndex: this.desiredIndex,
                queueLength: this.queue.length,
                repeatMode: this.repeatMode,
            },
            count,
        ).map(index => this.queue[index]);
    }

    async getTracksNeedingUrls() {
        return this.queue.filter(track => !isPlayableUrl(track.url));
    }

    async getTracksById(trackIds: string[]) {
        return trackIds.map(
            trackId =>
                this.queue.find(track => this.matchesTrackId(track, trackId)) ??
                null,
        );
    }

    /**************** 队列编辑 ****************/

    private indexOfRef(ref: PlayerAdapterTrackRef<MpvTrack>): number {
        const key = typeof ref === "string" ? ref : keyOf(ref);
        return this.queue.findIndex(t => this.matchesTrackId(t, key));
    }

    private matchesTrackId(track: MpvTrack, candidate: string) {
        const key = keyOf(track);
        return matchesMpvMediaId(key, track.id, candidate);
    }

    async updateTrack(track: MpvTrack, index?: number, syncSnapshot = true) {
        let target = index;
        if (target == null || target < 0 || target >= this.queue.length) {
            target = this.indexOfRef(track);
        }
        if (target < 0) {
            return;
        }
        const merged = { ...this.queue[target], ...track } as MpvTrack;
        this.queue[target] = merged;
        if (keyOf(merged) === this.activeMediaId) {
            this.activeTrack = merged;
        }
        if (syncSnapshot) {
            this.syncNativeQueueSnapshot();
        }

        // 若正在等待该曲目的音源，且现在已就绪 → 立即加载播放
        if (this.pendingLoadIndex === target && isPlayableUrl(merged.url)) {
            await this.playIndex(
                target,
                this.pendingLoadReason,
                this.pendingLoadAutoPlay,
            );
        } else if (
            this.preparedNextTrack?.key === keyOf(merged) &&
            isPlayableUrl(merged.url)
        ) {
            await this.prepareNextTrack(merged).catch(() => undefined);
        } else if (target === this.activeIndex) {
            // 当前曲目元数据变化，刷新锁屏/通知展示
            await NativeMpvPlayer.updateMetadata({
                title: typeof merged.title === "string" ? merged.title : "",
                artist: normalizeArtist(merged.artist),
                album: typeof merged.album === "string" ? merged.album : "",
                artwork:
                    typeof merged.artwork === "string" ? merged.artwork : null,
                duration: Number(merged.duration) || 0,
            }).catch(() => undefined);
        }
    }

    async updateTracks(tracks: MpvTrack[]) {
        for (const track of tracks) {
            await this.updateTrack(track, undefined, false);
        }
        this.emitQueueChanged("update");
    }

    async playTrack(track: PlayerAdapterTrackRef<MpvTrack>) {
        if (typeof track === "string") {
            const index = this.indexOfRef(track);
            if (index >= 0) {
                await this.playIndex(index, "manual");
            }
            return;
        }
        await this.playResolvedTemporaryTrack(track, "manual");
    }

    async addQueueTrack(_queueId: string, track: MpvTrack, index?: number) {
        await this.addQueueTracks([track], index);
    }

    async addQueueTracks(tracks: MpvTrack[], index?: number) {
        if (tracks.length === 0) {
            return;
        }
        const existingKeys = new Set(this.queue.map(track => keyOf(track)));
        const uniqueTracks = tracks.filter(track => {
            const key = keyOf(track);
            if (existingKeys.has(key)) {
                return false;
            }
            existingKeys.add(key);
            return true;
        });
        if (uniqueTracks.length === 0) {
            return;
        }
        const target =
            typeof index === "number" && index >= 0
                ? Math.min(index, this.queue.length)
                : this.queue.length;
        const desiredMediaId = this.queue[this.desiredIndex]
            ? keyOf(this.queue[this.desiredIndex])
            : null;
        this.bumpQueueRevision();
        await this.clearPreparedNextTrack();
        this.queue.splice(target, 0, ...uniqueTracks);
        this.activeIndex = this.activeMediaId
            ? this.queue.findIndex(item => keyOf(item) === this.activeMediaId)
            : -1;
        this.desiredIndex = desiredMediaId
            ? this.queue.findIndex(item => keyOf(item) === desiredMediaId)
            : this.desiredIndex;
        this.emitQueueChanged("add");
    }

    async removeQueueTrack(ref: PlayerAdapterTrackRef<MpvTrack>) {
        const index = this.indexOfRef(ref);
        if (index < 0) {
            return;
        }
        const removedMediaId = keyOf(this.queue[index]);
        const desiredMediaId = this.queue[this.desiredIndex]
            ? keyOf(this.queue[this.desiredIndex])
            : null;
        this.bumpQueueRevision();
        await this.clearPreparedNextTrack();
        this.queue.splice(index, 1);
        if (removedMediaId === this.activeMediaId) {
            this.activeIndex = -1;
            this.activeMediaId = null;
            this.activeLoadGeneration = null;
            this.desiredIndex = Math.min(
                index,
                this.queue.length - 1,
            );
            this.hasLoaded = false;
            if (this.desiredIndex >= 0) {
                await this.playIndex(this.desiredIndex, "manual");
            } else {
                await this.stop();
            }
        } else {
            this.activeIndex = this.activeMediaId
                ? this.queue.findIndex(item => keyOf(item) === this.activeMediaId)
                : -1;
            this.desiredIndex = desiredMediaId
                ? this.queue.findIndex(item => keyOf(item) === desiredMediaId)
                : this.activeIndex;
        }
        this.emitQueueChanged("remove");
    }

    async reorderQueueTrack(
        ref: PlayerAdapterTrackRef<MpvTrack>,
        newIndex: number,
    ) {
        const oldIndex = this.indexOfRef(ref);
        if (oldIndex < 0 || newIndex < 0 || newIndex >= this.queue.length) {
            return;
        }
        const desiredKey =
            isValidMpvQueueIndex(this.desiredIndex, this.queue.length)
                ? keyOf(this.queue[this.desiredIndex])
                : null;
        this.bumpQueueRevision();
        await this.clearPreparedNextTrack();
        const [track] = this.queue.splice(oldIndex, 1);
        this.queue.splice(newIndex, 0, track);
        this.activeIndex = this.activeMediaId
            ? this.queue.findIndex(item => keyOf(item) === this.activeMediaId)
            : -1;
        this.desiredIndex = desiredKey
            ? this.queue.findIndex(item => keyOf(item) === desiredKey)
            : this.activeIndex;
        this.emitQueueChanged("update");
    }

    async getCurrentQueueId() {
        return MPV_QUEUE_ID;
    }

    async getQueueInfo() {
        return this.getQueueInfoSnapshot();
    }

    async getAllQueueInfos() {
        return [this.getQueueInfoSnapshot()];
    }

    async createQueueInfo() {
        return MPV_QUEUE_ID;
    }

    async deleteQueueInfo() {
        await this.reset();
    }

    async loadQueueInfo(_queueId: string, index?: number) {
        if (typeof index === "number") {
            await this.skipToIndex(index);
        }
    }

    async updateQueueInfo() {
        this.emitQueueChanged("update");
    }

    async playNext(track: PlayerAdapterTrackRef<MpvTrack>) {
        const resolved = this.resolveTrackRef(track);
        if (!resolved) {
            return;
        }
        this.playNextQueue = [
            resolved,
            ...this.playNextQueue.filter(
                item => keyOf(item) !== keyOf(resolved),
            ),
        ];
        await this.clearPreparedNextTrack();
        this.emitTemporaryQueueChanged();
    }

    async addToUpNext(track: PlayerAdapterTrackRef<MpvTrack>) {
        const resolved = this.resolveTrackRef(track);
        if (
            !resolved ||
            this.upNextQueue.some(item => keyOf(item) === keyOf(resolved))
        ) {
            return;
        }
        this.upNextQueue.push(resolved);
        await this.clearPreparedNextTrack();
        this.emitTemporaryQueueChanged();
    }

    async removeFromPlayNext(ref: PlayerAdapterTrackRef<MpvTrack>) {
        const before = this.playNextQueue.length;
        this.playNextQueue = this.playNextQueue.filter(
            track => this.indexOfRefForTrack(track, ref) < 0,
        );
        const changed = before !== this.playNextQueue.length;
        if (changed) {
            await this.clearPreparedNextTrack();
            this.emitTemporaryQueueChanged();
        }
        return changed;
    }

    async removeFromUpNext(ref: PlayerAdapterTrackRef<MpvTrack>) {
        const before = this.upNextQueue.length;
        this.upNextQueue = this.upNextQueue.filter(
            track => this.indexOfRefForTrack(track, ref) < 0,
        );
        const changed = before !== this.upNextQueue.length;
        if (changed) {
            await this.clearPreparedNextTrack();
            this.emitTemporaryQueueChanged();
        }
        return changed;
    }

    async clearPlayNext() {
        if (this.playNextQueue.length === 0) {
            return;
        }
        this.playNextQueue = [];
        await this.clearPreparedNextTrack();
        this.emitTemporaryQueueChanged();
    }

    async clearUpNext() {
        if (this.upNextQueue.length === 0) {
            return;
        }
        this.upNextQueue = [];
        await this.clearPreparedNextTrack();
        this.emitTemporaryQueueChanged();
    }

    async reorderTemporaryTrack(
        ref: PlayerAdapterTrackRef<MpvTrack>,
        newIndex: number,
    ) {
        const sourceQueue = this.playNextQueue.some(
            track => this.indexOfRefForTrack(track, ref) >= 0,
        )
            ? this.playNextQueue
            : this.upNextQueue;
        const index = sourceQueue.findIndex(
            track => this.indexOfRefForTrack(track, ref) >= 0,
        );
        if (index < 0 || newIndex < 0 || newIndex >= sourceQueue.length) {
            return false;
        }
        const [track] = sourceQueue.splice(index, 1);
        sourceQueue.splice(newIndex, 0, track);
        await this.clearPreparedNextTrack();
        this.emitTemporaryQueueChanged();
        return true;
    }

    async getPlayNextQueue() {
        return this.playNextQueue.slice();
    }

    async getUpNextQueue() {
        return this.upNextQueue.slice();
    }

    async isAndroidAutoConnected() {
        this.androidAutoConnected =
            await NativeMpvPlayer.isAndroidAutoConnected().catch(
                () => this.androidAutoConnected,
            );
        return this.androidAutoConnected;
    }

    private resolveTrackRef(ref: PlayerAdapterTrackRef<MpvTrack>) {
        if (typeof ref !== "string") {
            return ref;
        }
        return (
            this.queue.find(track => this.matchesTrackId(track, ref)) ?? null
        );
    }

    private indexOfRefForTrack(
        track: MpvTrack,
        ref: PlayerAdapterTrackRef<MpvTrack>,
    ) {
        const key = typeof ref === "string" ? ref : keyOf(ref);
        return this.matchesTrackId(track, key) ? 0 : -1;
    }

    /**
     * 把内部队列整体重排为最新播放列表顺序（上层 setPlayList 每次变化时调用）。
     * 只调整队列与当前下标，不打断正在播放的曲目；据此保证「下一首/上一首」与 UI 列表一致。
     * 增量 add/remove 也有实现，但这里仍是最权威的对齐入口。
     */
    async syncQueueOrder(tracks: MpvTrack[], activeKey?: string | null) {
        const oldKeys = this.queue.map(keyOf);
        const newKeys = tracks.map(keyOf);
        const structureChanged =
            oldKeys.length !== newKeys.length ||
            oldKeys.some((key, index) => key !== newKeys[index]);
        const desiredMediaId = this.queue[this.desiredIndex]
            ? keyOf(this.queue[this.desiredIndex])
            : activeKey ?? null;

        // 保留运行时解析出的播放源、密钥、内存封面和嵌套 musicItem。
        const sourceByKey = new Map<
            string,
            Pick<
                MpvTrack,
                | "url"
                | "headers"
                | "userAgent"
                | "duration"
                | "playbackSource"
                | "ekey"
                | "cek"
                | "artwork"
                | "musicItem"
            >
        >();
        for (const t of this.queue) {
            sourceByKey.set(keyOf(t), {
                url: t.url,
                headers: t.headers,
                userAgent: t.userAgent,
                duration: t.duration,
                playbackSource: t.playbackSource,
                ekey: t.ekey,
                cek: t.cek,
                artwork: t.artwork,
                musicItem: t.musicItem,
            });
        }
        this.queue = tracks.map(t => {
            const cached = sourceByKey.get(keyOf(t));
            if (!cached) {
                return t;
            }
            return {
                ...t,
                ...(isPlayableUrl(cached.url)
                    ? {
                        url: cached.url,
                        headers: cached.headers,
                        userAgent: cached.userAgent,
                        playbackSource: cached.playbackSource,
                        ekey: cached.ekey,
                        cek: cached.cek,
                    }
                    : {}),
                duration: cached.duration ?? t.duration,
                artwork: cached.artwork ?? t.artwork,
                musicItem: cached.musicItem ?? t.musicItem,
            } as MpvTrack;
        });

        this.activeIndex = this.activeMediaId
            ? this.queue.findIndex(t => keyOf(t) === this.activeMediaId)
            : -1;
        if (this.activeIndex >= 0) {
            this.activeTrack = this.queue[this.activeIndex];
        }
        this.desiredIndex = desiredMediaId
            ? this.queue.findIndex(t => keyOf(t) === desiredMediaId)
            : resolveMpvCurrentIndexAfterQueueSync({
                currentIndex: this.desiredIndex,
                queueLength: this.queue.length,
                activeIndex: this.activeIndex >= 0 ? this.activeIndex : undefined,
            });

        if (structureChanged) {
            this.bumpQueueRevision();
            await this.clearPreparedNextTrack();
        }
        if (this.preparedNextTrack) {
            const preparedIndex = this.queue.findIndex(
                t => keyOf(t) === this.preparedNextTrack?.key,
            );
            if (preparedIndex >= 0) {
                this.preparedNextTrack = {
                    ...this.preparedNextTrack,
                    track: this.queue[preparedIndex],
                    index: preparedIndex,
                };
            } else {
                await this.clearPreparedNextTrack();
            }
        }
        this.emitQueueChanged("update");
    }

    /**************** 远程（锁屏/通知）控制 ****************/

    private handleRemoteCommand(
        command: MpvRemoteCommand,
        position?: number,
        volume?: number,
        mediaId?: string,
    ) {
        const runRemoteTask = (
            task: Promise<unknown> | void,
            action: string,
        ) => {
            Promise.resolve(task).catch(error => {
                errorLog(
                    `MpvPlayer 远程${action}失败`,
                    error?.message ?? error,
                );
            });
        };

        if (command === "playFromId") {
            if (typeof mediaId === "string" && mediaId.length > 0) {
                runRemoteTask(this.playTrack(mediaId), "点播");
            }
            return;
        }

        const eventMap: Record<
            Exclude<MpvRemoteCommand, "playFromId">,
            PlayerAdapterEvent
        > = {
            play: "remotePlay",
            pause: "remotePause",
            next: "remoteNext",
            previous: "remotePrevious",
            stop: "remoteStop",
            seek: "remoteSeek",
            duck: "remoteDuck",
            unduck: "remoteDuck",
        };
        const event = eventMap[command];
        const listeners = this.remoteListeners[event];
        if (listeners && listeners.size > 0) {
            // 有上层订阅则交给上层（保留扩展点）
            listeners.forEach(l => {
                try {
                    const result = l({
                        position,
                        volume,
                        ducking: command === "duck",
                    });
                    Promise.resolve(result).catch(error => {
                        errorLog(
                            "MpvPlayer 远程控制监听处理失败",
                            error?.message ?? error,
                        );
                    });
                } catch (error: any) {
                    errorLog(
                        "MpvPlayer 远程控制监听处理失败",
                        error?.message ?? error,
                    );
                }
            });
            return;
        }

        // 默认在适配器内部直接处理远程控制
        switch (command) {
        case "play":
            runRemoteTask(this.play(), "播放");
            break;
        case "pause":
            runRemoteTask(this.pause(), "暂停");
            break;
        case "next":
            runRemoteTask(this.skipToNext(), "下一首");
            break;
        case "previous":
            runRemoteTask(this.skipToPrevious(), "上一首");
            break;
        case "stop":
            runRemoteTask(this.stop(), "停止");
            break;
        case "seek":
            if (typeof position === "number") {
                runRemoteTask(this.seekTo(position), "跳转");
            }
            break;
        case "duck":
            this.duckVolume(volume);
            break;
        case "unduck":
            this.unduckVolume();
            break;
        }
    }

    private duckVolume(volume?: number) {
        if (this.duckedVolume == null) {
            this.duckedVolume = this.volume;
        }
        const ratio =
            typeof volume === "number" && Number.isFinite(volume)
                ? Math.max(0, Math.min(1, volume))
                : 0.5;
        this.duckRatio = ratio;
        NativeMpvPlayer.setVolume(this.volume * this.duckRatio).catch(
            () => undefined,
        );
    }

    private unduckVolume() {
        if (this.duckedVolume == null) {
            return;
        }
        const volume = this.duckedVolume;
        this.duckedVolume = null;
        this.duckRatio = 1;
        NativeMpvPlayer.setVolume(volume).catch(() => undefined);
    }

    /**************** 事件订阅 ****************/

    addEventListener(
        event: PlayerAdapterEvent,
        listener: (...args: any[]) => void,
    ): PlayerAdapterSubscription {
        const setFor: Partial<
            Record<PlayerAdapterEvent, Set<(...a: any[]) => void>>
        > = {
            trackChanged: this.trackChangedListeners,
            playbackStateChanged: this.playbackStateChangedListeners,
            progress: this.progressListeners,
            playbackSeeked: this.playbackSeekedListeners,
            playbackError: this.playbackErrorListeners,
            tracksNeedUpdate: this.tracksNeedUpdateListeners,
            playEnd: this.playEndListeners,
            temporaryQueueChanged: this.temporaryQueueChangedListeners,
            androidAutoConnectionChanged:
                this.androidAutoConnectionChangedListeners,
            queuesChanged: this.queuesChangedListeners,
            queueChanged: this.queueChangedListeners,
        };
        const target = setFor[event];
        if (target) {
            target.add(listener);
            return { remove: () => target.delete(listener) };
        }
        // 远程控制事件
        if (event.startsWith("remote")) {
            const set =
                this.remoteListeners[event] ??
                (this.remoteListeners[event] = new Set());
            set.add(listener);
            return { remove: () => set.delete(listener) };
        }
        return { remove: () => undefined };
    }
}

const mpvPlayerAdapter = new MpvPlayerAdapter();

export default mpvPlayerAdapter;
