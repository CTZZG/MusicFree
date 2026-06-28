import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { errorLog, trace } from "@/utils/log";
import NativeMpvPlayer, {
    MpvLoadPayload,
    MpvPlayerState,
    MpvRemoteCommand,
} from "./nativeMpvPlayer";
import type {
    PlayerAdapter,
    PlayerAdapterConfig,
    PlayerAdapterEvent,
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

type MpvTrack = PlayerAdapterTrack & Partial<IMusic.IMusicItem>;
type TrackChangeReason = "playStart" | "manual" | "end" | "repeat";

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
                    ? String((item as { name?: unknown }).name ?? "")
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

function toLoadPayload(track: MpvTrack): MpvLoadPayload {
    return {
        url: track.url ?? "",
        headers: track.headers,
        userAgent: track.userAgent,
        title: typeof track.title === "string" ? track.title : "",
        artist: normalizeArtist(track.artist),
        album: typeof track.album === "string" ? track.album : "",
        artwork:
            typeof track.artwork === "string" ? track.artwork : null,
        duration: Number(track.duration) || 0,
    };
}

export class MpvPlayerAdapter implements PlayerAdapter<MpvTrack> {
    readonly name = "mpv" as const;
    readonly remoteControlMode = "native-session" as const;

    private queue: MpvTrack[] = [];
    private currentIndex = -1;
    private repeatMode: PlayerAdapterRepeatMode = "off";
    private rate = 1;
    private volume = 1;
    private currentState: PlayerBackendState = "idle";
    private currentProgress: PlayerAdapterProgress = {
        position: 0,
        duration: 0,
        buffered: 0,
    };
    /** 是否已向原生加载过音轨（决定 play() 是 resume 还是首次加载） */
    private hasLoaded = false;
    /** 等待 URL 解析后再加载的下标（-1 表示无） */
    private pendingLoadIndex = -1;
    private pendingLoadReason: TrackChangeReason = "playStart";
    private nativeListenersBound = false;
    private setupPromise: Promise<void> | null = null;

    private trackChangedListeners = new Set<(...a: any[]) => void>();
    private playbackStateChangedListeners = new Set<(...a: any[]) => void>();
    private progressListeners = new Set<(...a: any[]) => void>();
    private playbackSeekedListeners = new Set<(...a: any[]) => void>();
    private playbackErrorListeners = new Set<(...a: any[]) => void>();
    private tracksNeedUpdateListeners = new Set<(...a: any[]) => void>();
    private playEndListeners = new Set<(...a: any[]) => void>();
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
                progressIntervalMs: config?.progressUpdateEventInterval,
            });
            trace("MpvPlayer.setup done");
        })();
        return this.setupPromise;
    }

    async configure(config?: PlayerAdapterConfig) {
        // mpv 内核的通知/前台服务由原生模块自管理；此处仅记录关键项，必要时透传。
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
            this.currentState = mapMpvState(state);
            this.playbackStateChangedListeners.forEach(l =>
                l(this.currentState),
            );
        });

        NativeMpvPlayer.addProgressListener(({ position, duration }) => {
            this.currentProgress = {
                position,
                duration: duration || this.currentProgress.duration,
                buffered: position,
            };
            this.progressListeners.forEach(l => l(this.currentProgress));
        });

        NativeMpvPlayer.addEndedListener(() => {
            this.handleNativeEnded().catch(error =>
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

        NativeMpvPlayer.addRemoteCommandListener(({ command, position }) => {
            this.handleRemoteCommand(command, position);
        });
    }

    /**************** 队列加载与切歌 ****************/

    async loadQueue(tracks: MpvTrack[], startIndex = 0) {
        this.queue = tracks.slice();
        const target =
            startIndex >= 0 && startIndex < this.queue.length ? startIndex : 0;
        trace("MpvPlayer.loadQueue", {
            count: this.queue.length,
            startIndex: target,
        });
        await this.playIndex(target, "playStart");
    }

    /** 加载并播放指定下标；URL 未就绪时发 tracksNeedUpdate 并挂起 */
    private async playIndex(index: number, reason: TrackChangeReason) {
        if (index < 0 || index >= this.queue.length) {
            await this.stop();
            return;
        }
        this.currentIndex = index;
        const track = this.queue[index];

        if (!isPlayableUrl(track.url)) {
            // 音源未解析，挂起，等上层通过 updateTrack 回填 URL
            this.pendingLoadIndex = index;
            this.pendingLoadReason = reason;
            trace("MpvPlayer.playIndex 等待音源解析", { index });
            this.tracksNeedUpdateListeners.forEach(l =>
                l({ tracks: [track], lookahead: 0 }),
            );
            // 仍然广播切歌，让上层 UI/状态先切到该曲目
            this.emitTrackChanged(track, index, reason);
            return;
        }

        this.pendingLoadIndex = -1;
        try {
            await NativeMpvPlayer.loadAndPlay(toLoadPayload(track));
            this.hasLoaded = true;
        } catch (error: any) {
            errorLog("MpvPlayer.loadAndPlay 失败", error?.message ?? error);
            this.playbackErrorListeners.forEach(l =>
                l({
                    code: "mpv-load-failed",
                    message: error?.message ?? "mpv load failed",
                    backend: this.name,
                } as PlayerAdapterPlaybackError),
            );
        }
        this.emitTrackChanged(track, index, reason);
    }

    private emitTrackChanged(
        track: MpvTrack,
        index: number,
        reason: TrackChangeReason,
    ) {
        const payload = { track, index, reason };
        trace("MpvPlayer.trackChanged", {
            index,
            reason,
            musicId: track.id,
            platform: track.platform,
        });
        this.trackChangedListeners.forEach(l => l(payload));
    }

    /** 自然播放结束：按 repeat 模式决定下一首，reason="end" 让上层跑 PlayEnd 逻辑 */
    private async handleNativeEnded() {
        if (this.repeatMode === "track") {
            await this.playIndex(this.currentIndex, "repeat");
            return;
        }
        const nextIndex = this.computeNextIndex(false);
        if (nextIndex == null) {
            // 队列结束且不循环：停在末尾，仍广播 end 让上层处理 play-later / 收尾
            this.currentState = "ended";
            const current = this.queue[this.currentIndex];
            if (current) {
                this.emitTrackChanged(current, this.currentIndex, "end");
            }
            return;
        }
        await this.playIndex(nextIndex, "end");
    }

    /** 计算下一首下标；wrapForManual=true 时手动切歌在末尾回绕 */
    private computeNextIndex(wrapForManual: boolean): number | null {
        if (this.queue.length === 0) {
            return null;
        }
        const next = this.currentIndex + 1;
        if (next < this.queue.length) {
            return next;
        }
        if (this.repeatMode === "queue" || wrapForManual) {
            return 0;
        }
        return null;
    }

    /**************** 基础控制 ****************/

    async play() {
        if (this.hasLoaded) {
            await NativeMpvPlayer.resume();
        } else if (this.currentIndex >= 0) {
            await this.playIndex(this.currentIndex, "playStart");
        }
    }

    async pause() {
        await NativeMpvPlayer.pause();
    }

    async stop() {
        await NativeMpvPlayer.stop().catch(() => undefined);
        this.currentState = "stopped";
    }

    async reset() {
        await NativeMpvPlayer.stop().catch(() => undefined);
        this.queue = [];
        this.currentIndex = -1;
        this.pendingLoadIndex = -1;
        this.hasLoaded = false;
        this.currentState = "idle";
        this.currentProgress = { position: 0, duration: 0, buffered: 0 };
    }

    async skipToNext() {
        const nextIndex = this.computeNextIndex(true);
        if (nextIndex == null) {
            return;
        }
        await this.playIndex(nextIndex, "manual");
    }

    async skipToPrevious() {
        if (this.queue.length === 0) {
            return;
        }
        const prev =
            this.currentIndex - 1 < 0
                ? this.queue.length - 1
                : this.currentIndex - 1;
        await this.playIndex(prev, "manual");
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
        const payload: PlayerAdapterSeekedEvent = {
            position,
            duration: this.currentProgress.duration,
        };
        this.playbackSeekedListeners.forEach(l => l(payload));
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
                buffered: position,
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
        return this.queue[this.currentIndex] ?? null;
    }

    async getActiveTrackIndex() {
        return this.currentIndex >= 0 ? this.currentIndex : null;
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
        await NativeMpvPlayer.setVolume(this.volume);
    }

    async setRepeatMode(mode: PlayerAdapterRepeatMode) {
        this.repeatMode = mode;
    }

    async getRepeatMode() {
        return this.repeatMode;
    }

    async getQueue() {
        return this.queue.slice();
    }

    async getNextTracks(count: number) {
        if (this.currentIndex < 0) {
            return [];
        }
        return this.queue.slice(
            this.currentIndex + 1,
            this.currentIndex + 1 + Math.max(0, count),
        );
    }

    /**************** 队列编辑 ****************/

    private indexOfRef(ref: PlayerAdapterTrackRef<MpvTrack>): number {
        const key = typeof ref === "string" ? ref : keyOf(ref);
        return this.queue.findIndex(t => keyOf(t) === key);
    }

    async updateTrack(track: MpvTrack, index?: number) {
        let target = index;
        if (target == null || target < 0 || target >= this.queue.length) {
            target = this.indexOfRef(track);
        }
        if (target < 0) {
            return;
        }
        const merged = { ...this.queue[target], ...track } as MpvTrack;
        this.queue[target] = merged;

        // 若正在等待该曲目的音源，且现在已就绪 → 立即加载播放
        if (
            this.pendingLoadIndex === target &&
            isPlayableUrl(merged.url)
        ) {
            await this.playIndex(target, this.pendingLoadReason);
        } else if (target === this.currentIndex) {
            // 当前曲目元数据变化，刷新锁屏/通知展示
            await NativeMpvPlayer.updateMetadata({
                title: typeof merged.title === "string" ? merged.title : "",
                artist: normalizeArtist(merged.artist),
                album: typeof merged.album === "string" ? merged.album : "",
                artwork:
                    typeof merged.artwork === "string"
                        ? merged.artwork
                        : null,
                duration: Number(merged.duration) || 0,
            }).catch(() => undefined);
        }
    }

    async updateTracks(tracks: MpvTrack[]) {
        for (const track of tracks) {
            await this.updateTrack(track);
        }
    }

    /**
     * 把内部队列整体重排为最新播放列表顺序（上层 setPlayList 每次变化时调用）。
     * 只调整队列与当前下标，不打断正在播放的曲目；据此保证「下一首/上一首」与 UI 列表一致。
     * 取代增量的 addQueueTracks/removeQueueTrack —— 后者会与本全量重排叠加导致队列错乱。
     */
    async syncQueueOrder(tracks: MpvTrack[], activeKey?: string) {
        // 保留已解析的播放 URL，避免重排后重新解析音源
        const urlByKey = new Map<string, string>();
        for (const t of this.queue) {
            if (isPlayableUrl(t.url)) {
                urlByKey.set(keyOf(t), t.url);
            }
        }
        this.queue = tracks.map(t => {
            if (!isPlayableUrl(t.url)) {
                const cached = urlByKey.get(keyOf(t));
                if (cached) {
                    return { ...t, url: cached } as MpvTrack;
                }
            }
            return t;
        });
        // 把当前下标重新定位到正在播放的曲目（重排后其位置会变）
        if (activeKey) {
            const idx = this.queue.findIndex(t => keyOf(t) === activeKey);
            if (idx >= 0) {
                this.currentIndex = idx;
            }
        }
    }

    /**************** 远程（锁屏/通知）控制 ****************/

    private handleRemoteCommand(command: MpvRemoteCommand, position?: number) {
        const eventMap: Record<MpvRemoteCommand, PlayerAdapterEvent> = {
            play: "remotePlay",
            pause: "remotePause",
            next: "remoteNext",
            previous: "remotePrevious",
            stop: "remoteStop",
            seek: "remoteSeek",
        };
        const event = eventMap[command];
        const listeners = this.remoteListeners[event];
        if (listeners && listeners.size > 0) {
            // 有上层订阅则交给上层（保留扩展点）
            listeners.forEach(l => l({ position }));
            return;
        }
        // 默认在适配器内部直接处理远程控制
        switch (command) {
        case "play":
            this.play();
            break;
        case "pause":
            this.pause();
            break;
        case "next":
            this.skipToNext();
            break;
        case "previous":
            this.skipToPrevious();
            break;
        case "stop":
            this.stop();
            break;
        case "seek":
            if (typeof position === "number") {
                this.seekTo(position);
            }
            break;
        }
    }

    /**************** 事件订阅 ****************/

    addEventListener(
        event: PlayerAdapterEvent,
        listener: (...args: any[]) => void,
    ): PlayerAdapterSubscription {
        const setFor: Partial<Record<PlayerAdapterEvent, Set<(...a: any[]) => void>>> = {
            trackChanged: this.trackChangedListeners,
            playbackStateChanged: this.playbackStateChangedListeners,
            progress: this.progressListeners,
            playbackSeeked: this.playbackSeekedListeners,
            playbackError: this.playbackErrorListeners,
            tracksNeedUpdate: this.tracksNeedUpdateListeners,
            playEnd: this.playEndListeners,
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
