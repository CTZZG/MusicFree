import {
    PlayerQueue,
    TrackPlayer as NitroTrackPlayer,
} from "react-native-nitro-player";
import type {
    PlayerState,
    Playlist,
    QueueOperation,
    Reason,
    RepeatMode,
    TrackItem,
    TrackPlayerState,
} from "react-native-nitro-player";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { errorLog, trace } from "@/utils/log";
import { createDownloadHeaders } from "@/utils/downloadHeaders";
import type {
    PlayerAdapter,
    PlayerAdapterConfig,
    PlayerAdapterEvent,
    PlayerAdapterPlaybackError,
    PlayerAdapterProgress,
    PlayerAdapterQueueChangedEvent,
    PlayerAdapterQueueInfo,
    PlayerAdapterQueueMetadata,
    PlayerAdapterQueueOperation,
    PlayerAdapterRepeatMode,
    PlayerAdapterSeekedEvent,
    PlayerAdapterSubscription,
    PlayerAdapterQueuesChangedEvent,
    PlayerAdapterTrackRef,
    PlayerBackendState,
    PlayerAdapterTrack,
} from "./types";
import {
    parsePlaybackSourceMeta,
    stringifyPlaybackSourceMeta,
} from "./sourceMeta";

const MUSICFREE_QUEUE_NAME = "MusicFree Playback Queue";
const isForcedNitroBackend =
    process.env.EXPO_PUBLIC_MUSICFREE_PLAYER_BACKEND === "nitro-player";
const PLAY_END_DEDUPE_MS = 1500;
const EXTRA_HEADERS_JSON = "musicfreeHeadersJson";
const EXTRA_USER_AGENT = "musicfreeUserAgent";
const EXTRA_SOURCE_META_JSON = "musicfreeSourceMetaJson";

function mapState(state?: TrackPlayerState): PlayerBackendState {
    switch (state) {
    case "playing":
        return "playing";
    case "paused":
        return "paused";
    case "buffering":
        return "buffering";
    case "stopped":
        return "stopped";
    default:
        return "idle";
    }
}

function isPlayEndReason(reason?: Reason | string | null) {
    return reason === "end";
}

function normalizeVolume(volume: number) {
    if (volume <= 1) {
        return volume * 100;
    }

    return volume;
}

function toNitroRepeatMode(mode: PlayerAdapterRepeatMode): RepeatMode {
    if (mode === "track") {
        return "track";
    }
    if (mode === "queue") {
        return "Playlist";
    }
    return "off";
}

function fromNitroRepeatMode(mode?: RepeatMode): PlayerAdapterRepeatMode {
    if (mode === "track") {
        return "track";
    }
    if (mode === "Playlist") {
        return "queue";
    }
    return "off";
}

function normalizeText(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(item => {
                if (typeof item === "string") {
                    return item;
                }
                if (item && typeof item === "object" && "name" in item) {
                    return String((item as {name?: unknown}).name ?? "");
                }
                return String(item ?? "");
            })
            .filter(Boolean)
            .join(", ");
    }

    return typeof value === "string" ? value : String(value ?? "");
}

function normalizeArtwork(value: unknown): string | null {
    if (typeof value === "string") {
        return value.trim().length ? value : null;
    }
    if (
        value &&
        typeof value === "object" &&
        "uri" in value &&
        typeof (value as {uri?: unknown}).uri === "string"
    ) {
        const uri = (value as {uri: string}).uri;
        return uri.trim().length ? uri : null;
    }
    return null;
}

function normalizeDuration(value: unknown): number {
    const duration = Number(value ?? 0);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function stringifyRequestHeaders(headers?: Record<string, unknown>) {
    const normalized = createDownloadHeaders(headers);
    if (!normalized) {
        return undefined;
    }

    try {
        return JSON.stringify(normalized);
    } catch (error: any) {
        errorLog("Nitro headers 序列化失败", error?.message ?? error);
        return undefined;
    }
}

function normalizeTrackId(value: string): string {
    return encodeURIComponent(value);
}

function isNativeTrackItem(
    track: TrackItem | PlayerAdapterTrack,
): track is TrackItem {
    return (
        "extraPayload" in track &&
        !("musicItem" in track) &&
        !("platform" in track) &&
        !("userAgent" in track) &&
        !("headers" in track)
    );
}

function toTrackItem(track: PlayerAdapterTrack | TrackItem): TrackItem {
    if (isNativeTrackItem(track)) {
        return track as TrackItem;
    }

    const adapterTrack = track as PlayerAdapterTrack &
        Partial<IMusic.IMusicItem>;
    const musicItem =
        adapterTrack.musicItem ??
        (adapterTrack.platform && adapterTrack.id
            ? (adapterTrack as IMusic.IMusicItem)
            : undefined);
    const stableId = musicItem ? getMediaUniqueKey(musicItem) : adapterTrack.id;
    const headersJson = stringifyRequestHeaders(adapterTrack.headers);
    const sourceMetaJson = stringifyPlaybackSourceMeta(
        adapterTrack.playbackSource,
    );
    const userAgent =
        typeof adapterTrack.userAgent === "string"
            ? adapterTrack.userAgent.trim() || undefined
            : undefined;

    return {
        id: normalizeTrackId(stableId),
        title: normalizeText(adapterTrack.title),
        artist: normalizeText(adapterTrack.artist),
        album: normalizeText(adapterTrack.album),
        duration: normalizeDuration(adapterTrack.duration),
        url: adapterTrack.url ?? "",
        artwork: normalizeArtwork(adapterTrack.artwork),
        extraPayload: {
            platform: musicItem?.platform ?? "",
            mediaId: musicItem?.id ?? adapterTrack.id,
            stableId,
            ...(headersJson ? { [EXTRA_HEADERS_JSON]: headersJson } : {}),
            ...(userAgent ? { [EXTRA_USER_AGENT]: userAgent } : {}),
            ...(sourceMetaJson
                ? { [EXTRA_SOURCE_META_JSON]: sourceMetaJson }
                : {}),
        },
    };
}

function toPlayerAdapterTrack(
    track?: TrackItem | null,
): (TrackItem & Partial<IMusic.IMusicItem>) | null {
    if (!track) {
        return null;
    }

    const payload = track.extraPayload as
        | {
              platform?: unknown;
              mediaId?: unknown;
              stableId?: unknown;
              [EXTRA_HEADERS_JSON]?: unknown;
              [EXTRA_USER_AGENT]?: unknown;
              [EXTRA_SOURCE_META_JSON]?: unknown;
          }
        | undefined;
    const platform =
        typeof payload?.platform === "string" ? payload.platform : undefined;
    const mediaId =
        typeof payload?.mediaId === "string" ? payload.mediaId : undefined;

    if (!platform || !mediaId) {
        return track as TrackItem & Partial<IMusic.IMusicItem>;
    }

    const headersJson =
        typeof payload?.[EXTRA_HEADERS_JSON] === "string"
            ? payload[EXTRA_HEADERS_JSON]
            : undefined;
    const userAgent =
        typeof payload?.[EXTRA_USER_AGENT] === "string"
            ? payload[EXTRA_USER_AGENT]
            : undefined;
    const playbackSource = parsePlaybackSourceMeta(
        payload?.[EXTRA_SOURCE_META_JSON],
    );
    const headers = headersJson
        ? (() => {
            try {
                return JSON.parse(headersJson) as Record<string, string>;
            } catch {
                return undefined;
            }
        })()
        : undefined;

    return {
        ...track,
        id: mediaId,
        platform,
        $: payload?.stableId,
        ...(headers ? { headers } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(playbackSource ? { playbackSource } : {}),
    } as TrackItem & Partial<IMusic.IMusicItem>;
}

function toPlayerAdapterTracks(tracks: TrackItem[]) {
    return tracks.map(track => toPlayerAdapterTrack(track) ?? track);
}

function toPlayerAdapterQueue(
    queue?: Playlist | null,
): PlayerAdapterQueueInfo<TrackItem> | null {
    if (!queue) {
        return null;
    }

    return {
        id: queue.id,
        name: queue.name,
        description: queue.description,
        artwork: queue.artwork,
        tracks: toPlayerAdapterTracks(queue.tracks),
    };
}

function toPlayerAdapterQueues(playlists: Playlist[]) {
    return playlists
        .map(queue => toPlayerAdapterQueue(queue))
        .filter(Boolean) as Array<PlayerAdapterQueueInfo<TrackItem>>;
}

function toPlayerAdapterQueueOperation(
    operation?: QueueOperation,
): PlayerAdapterQueueOperation | undefined {
    return operation;
}

function toNativeTrackId(
    track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
) {
    if (typeof track === "string") {
        return track;
    }
    return toTrackItem(track).id;
}

export function toPlayerAdapterProgress(
    state: PlayerState,
): PlayerAdapterProgress {
    return {
        position: state.currentPosition,
        duration: state.totalDuration,
        buffered: state.currentPosition,
    };
}

export class NitroPlayerAdapter
implements PlayerAdapter<TrackItem | PlayerAdapterTrack> {
    readonly name = "nitro-player" as const;

    private playlistId: string | null = null;
    private lastPlayEndKey: string | null = null;
    private lastPlayEndAt = 0;
    private trackChangedListeners = new Set<(...args: any[]) => void>();
    private playbackStateChangedListeners = new Set<(...args: any[]) => void>();
    private playbackErrorListeners = new Set<(...args: any[]) => void>();
    private playEndListeners = new Set<(...args: any[]) => void>();
    private tracksNeedUpdateListeners = new Set<(...args: any[]) => void>();
    private temporaryQueueChangedListeners = new Set<
        (...args: any[]) => void
    >();
    private androidAutoConnectionChangedListeners = new Set<
        (...args: any[]) => void
    >();
    private progressListeners = new Set<(...args: any[]) => void>();
    private playbackSeekedListeners = new Set<(...args: any[]) => void>();
    private queuesChangedListeners = new Set<(...args: any[]) => void>();
    private queueChangedListeners = new Set<(...args: any[]) => void>();
    private nativeTrackChangeRegistered = false;
    private nativePlaybackStateRegistered = false;
    private nativeTracksNeedUpdateRegistered = false;
    private nativeTemporaryQueueRegistered = false;
    private nativeAndroidAutoConnectionRegistered = false;
    private nativeProgressRegistered = false;
    private nativeSeekRegistered = false;
    private nativeQueuesChangedRegistered = false;
    private nativeQueueChangedRegistered = false;
    readonly remoteControlMode = "native-session" as const;

    private emitPlayEndOnce(payload: Record<string, unknown>) {
        const now = Date.now();
        const key = String(payload.trackId ?? payload.index ?? "unknown");
        if (
            this.lastPlayEndKey === key &&
            now - this.lastPlayEndAt < PLAY_END_DEDUPE_MS
        ) {
            return;
        }
        this.lastPlayEndKey = key;
        this.lastPlayEndAt = now;
        trace("NitroPlayer.playEnd", payload);
        this.playEndListeners.forEach(listener => listener(payload));
    }

    private ensureNativeTrackChangeListener() {
        if (this.nativeTrackChangeRegistered) {
            return;
        }
        this.nativeTrackChangeRegistered = true;
        NitroTrackPlayer.onChangeTrack(async (track, reason) => {
            const state = await NitroTrackPlayer.getState().catch(() => null);
            const adapterTrack = toPlayerAdapterTrack(track);
            const payload = {
                track: adapterTrack ?? track,
                index: state?.currentIndex ?? undefined,
                reason,
            };
            this.trackChangedListeners.forEach(listener => listener(payload));
            if (isPlayEndReason(reason)) {
                this.emitPlayEndOnce({
                    reason,
                    index: state?.currentIndex,
                    trackId: track?.id,
                });
            }
        });
    }

    private ensureNativePlaybackStateListener() {
        if (this.nativePlaybackStateRegistered) {
            return;
        }
        this.nativePlaybackStateRegistered = true;
        NitroTrackPlayer.onPlaybackStateChange((state, reason) => {
            const mappedState = reason === "error" ? "error" : mapState(state);
            this.playbackStateChangedListeners.forEach(listener =>
                listener(mappedState, reason),
            );
            if (reason === "error") {
                const error: PlayerAdapterPlaybackError = {
                    code: "nitro-playback-error",
                    message: "Nitro playback error",
                    backend: this.name,
                    reason,
                    state,
                };
                errorLog(error.message, error.code);
                this.playbackErrorListeners.forEach(listener =>
                    listener(error),
                );
            }
        });
    }

    private ensureNativeTracksNeedUpdateListener() {
        if (this.nativeTracksNeedUpdateRegistered) {
            return;
        }
        this.nativeTracksNeedUpdateRegistered = true;
        NitroTrackPlayer.onTracksNeedUpdate((tracks, lookahead) => {
            this.tracksNeedUpdateListeners.forEach(listener =>
                listener({
                    tracks: tracks.map(
                        track => toPlayerAdapterTrack(track) ?? track,
                    ),
                    lookahead,
                }),
            );
        });
    }

    private ensureNativeTemporaryQueueListener() {
        if (this.nativeTemporaryQueueRegistered) {
            return;
        }
        this.nativeTemporaryQueueRegistered = true;
        NitroTrackPlayer.onTemporaryQueueChange(
            (playNextQueue, upNextQueue) => {
                this.temporaryQueueChangedListeners.forEach(listener =>
                    listener({
                        playNextQueue: toPlayerAdapterTracks(playNextQueue),
                        upNextQueue: toPlayerAdapterTracks(upNextQueue),
                    }),
                );
            },
        );
    }

    private ensureNativeAndroidAutoConnectionListener() {
        if (this.nativeAndroidAutoConnectionRegistered) {
            return;
        }
        this.nativeAndroidAutoConnectionRegistered = true;
        NitroTrackPlayer.onAndroidAutoConnectionChange(connected => {
            this.androidAutoConnectionChangedListeners.forEach(listener =>
                listener({ connected }),
            );
        });
    }

    private ensureNativeProgressListener() {
        if (this.nativeProgressRegistered) {
            return;
        }
        this.nativeProgressRegistered = true;
        NitroTrackPlayer.onPlaybackProgressChange(
            (position, totalDuration, isManuallySeeked) =>
                this.progressListeners.forEach(listener =>
                    listener({
                        position,
                        duration: totalDuration,
                        buffered: position,
                        isManuallySeeked,
                    }),
                ),
        );
    }

    private ensureNativeSeekListener() {
        if (this.nativeSeekRegistered) {
            return;
        }
        this.nativeSeekRegistered = true;
        NitroTrackPlayer.onSeek((position, totalDuration) => {
            const payload: PlayerAdapterSeekedEvent = {
                position,
                duration: totalDuration,
            };
            this.playbackSeekedListeners.forEach(listener => listener(payload));
        });
    }

    private ensureNativeQueuesChangedListener() {
        if (this.nativeQueuesChangedRegistered) {
            return;
        }
        this.nativeQueuesChangedRegistered = true;
        PlayerQueue.onPlaylistsChanged((playlists, operation) => {
            const payload: PlayerAdapterQueuesChangedEvent<TrackItem> = {
                queues: toPlayerAdapterQueues(playlists),
                operation: toPlayerAdapterQueueOperation(operation),
            };
            this.queuesChangedListeners.forEach(listener => listener(payload));
        });
    }

    private ensureNativeQueueChangedListener() {
        if (this.nativeQueueChangedRegistered) {
            return;
        }
        this.nativeQueueChangedRegistered = true;
        PlayerQueue.onPlaylistChanged((queueId, queue, operation) => {
            const adapterQueue = toPlayerAdapterQueue(queue);
            if (!adapterQueue) {
                return;
            }
            const payload: PlayerAdapterQueueChangedEvent<TrackItem> = {
                queueId,
                queue: adapterQueue,
                operation: toPlayerAdapterQueueOperation(operation),
            };
            this.queueChangedListeners.forEach(listener => listener(payload));
        });
    }

    async setup(config?: PlayerAdapterConfig) {
        await this.configure(config);
    }

    async configure(config?: PlayerAdapterConfig) {
        trace("NitroPlayer.configure", {
            forced: isForcedNitroBackend,
            showInNotification: config?.showInNotification,
        });
        await NitroTrackPlayer.configure({
            androidAutoEnabled: false,
            carPlayEnabled: false,
            showInNotification: config?.showInNotification ?? true,
            lookaheadCount: 2,
        });
    }

    async loadQueue(
        tracks: Array<TrackItem | PlayerAdapterTrack>,
        startIndex = 0,
    ) {
        const nitroTracks = tracks.map(toTrackItem);
        const targetTrack = nitroTracks[startIndex] ?? nitroTracks[0];
        trace("NitroPlayer.loadQueue", {
            count: nitroTracks.length,
            startIndex,
            targetTrackId: targetTrack?.id,
            targetUrl: targetTrack?.url,
        });

        if (this.playlistId) {
            await PlayerQueue.deletePlaylist(this.playlistId).catch(
                () => undefined,
            );
        }

        this.playlistId = await PlayerQueue.createPlaylist(
            MUSICFREE_QUEUE_NAME,
        );
        await PlayerQueue.addTracksToPlaylist(this.playlistId, nitroTracks);

        if (targetTrack) {
            await NitroTrackPlayer.playSong(targetTrack.id, this.playlistId);
        } else {
            await PlayerQueue.loadPlaylist(this.playlistId, startIndex);
        }
    }

    async play() {
        trace("NitroPlayer.play");
        try {
            await NitroTrackPlayer.play();
        } catch (error: any) {
            errorLog("NitroPlayer.play failed", error?.message ?? error);
            throw error;
        }
    }

    async pause() {
        await NitroTrackPlayer.pause();
    }

    async stop() {
        await NitroTrackPlayer.pause();
        await NitroTrackPlayer.seek(0);
    }

    async reset() {
        await NitroTrackPlayer.pause().catch(() => undefined);

        if (this.playlistId) {
            await PlayerQueue.deletePlaylist(this.playlistId).catch(
                () => undefined,
            );
            this.playlistId = null;
        }
    }

    async skipToNext() {
        await NitroTrackPlayer.skipToNext();
    }

    async skipToPrevious() {
        await NitroTrackPlayer.skipToPrevious();
    }

    async skipToIndex(index: number) {
        return NitroTrackPlayer.skipToIndex(index);
    }

    async seekTo(position: number) {
        await NitroTrackPlayer.seek(position);
    }

    async getProgress() {
        const state = await NitroTrackPlayer.getState();
        return toPlayerAdapterProgress(state);
    }

    async getState() {
        const state = await NitroTrackPlayer.getState();
        return mapState(state.currentState);
    }

    async getTrack(index: number) {
        const state = await NitroTrackPlayer.getState();

        if (state.currentIndex === index) {
            return toPlayerAdapterTrack(state.currentTrack);
        }

        const queue = await NitroTrackPlayer.getActualQueue();
        return toPlayerAdapterTrack(queue[index]);
    }

    async getActiveTrack() {
        const state = await NitroTrackPlayer.getState();
        return toPlayerAdapterTrack(state.currentTrack);
    }

    async getActiveTrackIndex() {
        return NitroTrackPlayer.getCurrentTrackIndex();
    }

    async getRate() {
        return NitroTrackPlayer.getPlaybackSpeed();
    }

    async setRate(rate: number) {
        await NitroTrackPlayer.setPlaybackSpeed(rate);
    }

    async setVolume(volume: number) {
        await NitroTrackPlayer.setVolume(normalizeVolume(volume));
    }

    async updateTrack(track: TrackItem | PlayerAdapterTrack) {
        await NitroTrackPlayer.updateTracks([toTrackItem(track)]);
    }

    async setRepeatMode(mode: PlayerAdapterRepeatMode) {
        await NitroTrackPlayer.setRepeatMode(toNitroRepeatMode(mode));
    }

    async getRepeatMode() {
        const mode = await NitroTrackPlayer.getRepeatMode();
        return fromNitroRepeatMode(mode);
    }

    async getQueue() {
        const queue = await NitroTrackPlayer.getActualQueue();
        return toPlayerAdapterTracks(queue);
    }

    async getNextTracks(count: number) {
        const tracks = await NitroTrackPlayer.getNextTracks(count);
        return toPlayerAdapterTracks(tracks);
    }

    async getTracksNeedingUrls() {
        const tracks = await NitroTrackPlayer.getTracksNeedingUrls();
        return toPlayerAdapterTracks(tracks);
    }

    async getTracksById(trackIds: string[]) {
        const tracks = await NitroTrackPlayer.getTracksById(trackIds);
        return toPlayerAdapterTracks(tracks);
    }

    async updateTracks(tracks: Array<TrackItem | PlayerAdapterTrack>) {
        await NitroTrackPlayer.updateTracks(tracks.map(toTrackItem));
    }

    async getCurrentQueueId() {
        return PlayerQueue.getCurrentPlaylistId();
    }

    async getQueueInfo(queueId?: string | null) {
        const targetQueueId = queueId ?? PlayerQueue.getCurrentPlaylistId();
        if (!targetQueueId) {
            return null;
        }

        return toPlayerAdapterQueue(PlayerQueue.getPlaylist(targetQueueId));
    }

    async getAllQueueInfos() {
        return toPlayerAdapterQueues(PlayerQueue.getAllPlaylists());
    }

    async createQueueInfo(metadata?: PlayerAdapterQueueMetadata) {
        return PlayerQueue.createPlaylist(
            metadata?.name ?? MUSICFREE_QUEUE_NAME,
            metadata?.description ?? undefined,
            metadata?.artwork ?? undefined,
        );
    }

    async deleteQueueInfo(queueId: string) {
        await PlayerQueue.deletePlaylist(queueId);
        if (this.playlistId === queueId) {
            this.playlistId = null;
        }
    }

    async loadQueueInfo(queueId: string, index?: number) {
        this.playlistId = queueId;
        await PlayerQueue.loadPlaylist(queueId, index);
    }

    async updateQueueInfo(
        queueId: string,
        metadata: PlayerAdapterQueueMetadata,
    ) {
        await PlayerQueue.updatePlaylist(
            queueId,
            metadata.name,
            metadata.description ?? undefined,
            metadata.artwork ?? undefined,
        );
    }

    async playTrack(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
        queueId?: string | null,
    ) {
        await NitroTrackPlayer.playSong(
            toNativeTrackId(track),
            queueId ?? this.playlistId ?? undefined,
        );
    }

    async addQueueTrack(
        queueId: string,
        track: TrackItem | PlayerAdapterTrack,
        index?: number,
    ) {
        await PlayerQueue.addTrackToPlaylist(
            queueId,
            toTrackItem(track),
            index,
        );
    }

    async addQueueTracks(
        tracks: Array<TrackItem | PlayerAdapterTrack>,
        index?: number,
    ) {
        if (!this.playlistId || tracks.length === 0) {
            return;
        }
        await PlayerQueue.addTracksToPlaylist(
            this.playlistId,
            tracks.map(toTrackItem),
            index,
        );
    }

    async removeQueueTrack(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
    ) {
        if (!this.playlistId) {
            return;
        }
        await PlayerQueue.removeTrackFromPlaylist(
            this.playlistId,
            toNativeTrackId(track),
        );
    }

    async reorderQueueTrack(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
        newIndex: number,
    ) {
        if (!this.playlistId) {
            return;
        }
        await PlayerQueue.reorderTrackInPlaylist(
            this.playlistId,
            toNativeTrackId(track),
            newIndex,
        );
    }

    async playNext(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
    ) {
        await NitroTrackPlayer.playNext(toNativeTrackId(track));
    }

    async addToUpNext(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
    ) {
        await NitroTrackPlayer.addToUpNext(toNativeTrackId(track));
    }

    async removeFromPlayNext(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
    ) {
        return NitroTrackPlayer.removeFromPlayNext(toNativeTrackId(track));
    }

    async removeFromUpNext(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
    ) {
        return NitroTrackPlayer.removeFromUpNext(toNativeTrackId(track));
    }

    async clearPlayNext() {
        await NitroTrackPlayer.clearPlayNext();
    }

    async clearUpNext() {
        await NitroTrackPlayer.clearUpNext();
    }

    async reorderTemporaryTrack(
        track: PlayerAdapterTrackRef<TrackItem | PlayerAdapterTrack>,
        newIndex: number,
    ) {
        return NitroTrackPlayer.reorderTemporaryTrack(
            toNativeTrackId(track),
            newIndex,
        );
    }

    async getPlayNextQueue() {
        const tracks = await NitroTrackPlayer.getPlayNextQueue();
        return toPlayerAdapterTracks(tracks);
    }

    async getUpNextQueue() {
        const tracks = await NitroTrackPlayer.getUpNextQueue();
        return toPlayerAdapterTracks(tracks);
    }

    async isAndroidAutoConnected() {
        return NitroTrackPlayer.isAndroidAutoConnected();
    }

    addEventListener(
        event: PlayerAdapterEvent,
        listener: (...args: any[]) => void,
    ): PlayerAdapterSubscription {
        if (event === "trackChanged") {
            this.trackChangedListeners.add(listener);
            this.ensureNativeTrackChangeListener();
            return {
                remove: () => this.trackChangedListeners.delete(listener),
            };
        } else if (event === "playbackStateChanged") {
            this.playbackStateChangedListeners.add(listener);
            this.ensureNativePlaybackStateListener();
            return {
                remove: () =>
                    this.playbackStateChangedListeners.delete(listener),
            };
        } else if (event === "playEnd") {
            this.playEndListeners.add(listener);
            this.ensureNativeTrackChangeListener();
            return {
                remove: () => this.playEndListeners.delete(listener),
            };
        } else if (event === "playbackError") {
            this.playbackErrorListeners.add(listener);
            this.ensureNativePlaybackStateListener();
            return {
                remove: () => this.playbackErrorListeners.delete(listener),
            };
        } else if (event === "tracksNeedUpdate") {
            this.tracksNeedUpdateListeners.add(listener);
            this.ensureNativeTracksNeedUpdateListener();
            return {
                remove: () => this.tracksNeedUpdateListeners.delete(listener),
            };
        } else if (event === "temporaryQueueChanged") {
            this.temporaryQueueChangedListeners.add(listener);
            this.ensureNativeTemporaryQueueListener();
            return {
                remove: () =>
                    this.temporaryQueueChangedListeners.delete(listener),
            };
        } else if (event === "androidAutoConnectionChanged") {
            this.androidAutoConnectionChangedListeners.add(listener);
            this.ensureNativeAndroidAutoConnectionListener();
            return {
                remove: () =>
                    this.androidAutoConnectionChangedListeners.delete(listener),
            };
        } else if (event === "progress") {
            this.progressListeners.add(listener);
            this.ensureNativeProgressListener();
            return {
                remove: () => this.progressListeners.delete(listener),
            };
        } else if (event === "playbackSeeked") {
            this.playbackSeekedListeners.add(listener);
            this.ensureNativeSeekListener();
            return {
                remove: () => this.playbackSeekedListeners.delete(listener),
            };
        } else if (event === "queuesChanged") {
            this.queuesChangedListeners.add(listener);
            this.ensureNativeQueuesChangedListener();
            return {
                remove: () => this.queuesChangedListeners.delete(listener),
            };
        } else if (event === "queueChanged") {
            this.queueChangedListeners.add(listener);
            this.ensureNativeQueueChangedListener();
            return {
                remove: () => this.queueChangedListeners.delete(listener),
            };
        }

        return { remove: () => undefined };
    }
}

export { toTrackItem as toNitroTrackItem };

const nitroPlayerAdapter = new NitroPlayerAdapter();

export default nitroPlayerAdapter;
