import type QualityChangeCoordinator from "./qualityChangeCoordinator";
import type { IQualityChangeRequestToken } from "./qualityChangeCoordinator";
import type { MusicVideoCandidate, MusicVideoSources } from "../pluginManager/musicVideoSource";
import type {
    PlayerActiveRendition,
    PlayerRenditionIdentity,
    PlayerRenditionReceipt,
    PlayerRenditionRequest,
    PlayerRenditionSource,
    PlayerAdapterProgress,
} from "../playerAdapter/types";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";

export type MusicVideoFailure =
    | "source"
    | "network"
    | "activation"
    | "audio-return"
    | "checkpoint-unavailable";
export type MusicVideoAction = {
    status: "playing" | "audio" | "cancelled" | "restart-confirmation" | "error";
    error?: MusicVideoFailure;
};
export type MusicVideoPreflight = (
    signal: AbortSignal,
) => Promise<{ mobileApproved: boolean; claimPlayback: boolean } | null>;
export type MusicVideoDisplay = Pick<
    MusicVideoCandidate,
    "id" | "title" | "artist" | "providerName" | "qualities"
> & {
    qualityId?: string;
};
export type MusicVideoState =
    | { phase: "audio"; error?: MusicVideoFailure }
    | {
          phase: "resolving" | "loading" | "video" | "returning" | "error";
          songKey: string;
          video: MusicVideoDisplay;
          owner?: PlayerRenditionIdentity;
          error?: MusicVideoFailure;
          canReturn: boolean;
      };

export interface MusicVideoAudioCheckpoint {
    readonly songKey: string;
    readonly sourceGeneration: number;
    readonly positionSeconds: number;
    readonly quality: IMusic.IQualityKey;
    readonly rate: number;
    readonly wasPlaying: boolean;
}

interface AudioSession {
    song: IMusic.IMusicItem;
    key: string;
    generation: number;
    quality: IMusic.IQualityKey;
    rate: number;
    wasPlaying: boolean;
    pausedByUser?: boolean;
    position: number | null;
}

interface Dependencies {
    sources: Pick<MusicVideoSources, "supports" | "find" | "resolve">;
    coordinator: QualityChangeCoordinator;
    currentSong(): IMusic.IMusicItem | null;
    owner(): PlayerRenditionIdentity | null;
    active(): PlayerActiveRendition | null;
    foreground(): boolean;
    audioSettings(): {
        quality: IMusic.IQualityKey;
        rate: number;
        wasPlaying: boolean;
        pausedByUser?: boolean;
    };
    mayAutoPlay(): boolean;
    playbackIntentRevision?(): number;
    repeatCurrentVideo(): boolean;
    claimPlayback(): Promise<void>;
    restorePauseHold?(): Promise<void> | void;
    videoNetwork(approvedMobile: boolean): Promise<"unmetered" | "allow-metered">;
    resumeVideo(policy: "unmetered" | "allow-metered"): Promise<void>;
    resumeAudio(): Promise<void>;
    admitVideo(source: IPlugin.IVideoSourceResult): Promise<PlayerRenditionSource>;
    resolveAudio(
        song: IMusic.IMusicItem,
        quality: IMusic.IQualityKey,
        current: () => boolean,
    ): Promise<PlayerRenditionSource>;
    replace(request: PlayerRenditionRequest): Promise<PlayerRenditionReceipt>;
    cancelNativeWait(): void;
    waitForNativeScheduling?(): Promise<void>;
    videoInfo(): Promise<{
        mediaId: string | null;
        loadGeneration: number;
        kind: string;
        outgoingAudioPosition?: number;
        completed?: boolean;
        suspended?: boolean;
        suspendedPositionAvailable?: boolean;
        failed?: boolean;
        positionPreservable?: boolean;
    }>;
    publish(state: MusicVideoState): void;
    timelineChanged(blocked: boolean): void;
    saveAudioCheckpoint(checkpoint: MusicVideoAudioCheckpoint): void;
    audioReturned(
        checkpoint: MusicVideoAudioCheckpoint,
        readyProgress: PlayerAdapterProgress,
    ): Promise<void>;
    videoActivated(): void;
}

class Superseded extends Error {}
const finitePosition = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Orchestrates the existing player/commitTail; owns no player, queue or progress clock. */
export default class MusicVideoController {
    private state: MusicVideoState = { phase: "audio" };
    private session: AudioSession | null = null;
    private currentVideo: {
        candidate: MusicVideoCandidate;
        quality?: string;
        timeline?: string;
    } | null = null;
    private request: {
        token: IQualityChangeRequestToken;
        abort: AbortController;
        automaticRepeat: boolean;
        allowBackground: boolean;
        committed: boolean;
    } | null = null;
    private blocked = false;
    private failedGeneration: number | null = null;
    private networkBlockedGeneration: number | null = null;
    private mobileApproved = false;
    private playOnReturn = false;
    private audioReturnTask: { key: string; promise: Promise<MusicVideoAction> } | null = null;

    constructor(private readonly deps: Dependencies) {}

    get hasMobileApproval() {
        return this.mobileApproved;
    }

    get snapshot() {
        return this.state;
    }
    get blocksAudioTimeline() {
        return this.blocked || this.deps.active()?.kind === "mv";
    }
    get activeSession(): object | null {
        return this.session;
    }
    get checkpoint(): MusicVideoAudioCheckpoint | null {
        const s = this.session;
        return s && finitePosition(s.position)
            ? {
                songKey: s.key,
                sourceGeneration: s.generation,
                positionSeconds: s.position,
                quality: s.quality,
                rate: s.rate,
                wasPlaying: s.wasPlaying,
            }
            : null;
    }

    supportsCurrentSong() {
        return this.deps.sources.supports(this.deps.currentSong());
    }

    async candidates(signal?: AbortSignal) {
        const song = this.deps.currentSong();
        if (!song) {
            return [];
        }
        const key = getMediaUniqueKey(song);
        return this.deps.sources.find(
            song,
            () => this.currentKey() === key && this.deps.foreground(),
            signal,
        );
    }

    private currentKey() {
        const song = this.deps.currentSong();
        return song ? getMediaUniqueKey(song) : null;
    }
    private begin(automaticRepeat = false, allowBackground = false) {
        this.request?.abort.abort();
        this.deps.cancelNativeWait();
        const request = {
            token: this.deps.coordinator.begin(),
            abort: new AbortController(),
            automaticRepeat,
            allowBackground,
            committed: false,
        };
        this.request = request;
        return request;
    }
    private current(request: NonNullable<MusicVideoController["request"]>, key: string) {
        return (
            this.request === request &&
            !request.abort.signal.aborted &&
            this.deps.coordinator.isActive(request.token) &&
            this.currentKey() === key
        );
    }
    private guard(
        request: NonNullable<MusicVideoController["request"]>,
        key: string,
        foreground = false,
    ) {
        if (
            !this.current(request, key) ||
            (foreground && !request.allowBackground && !this.deps.foreground()) ||
            (request.automaticRepeat && !this.deps.repeatCurrentVideo())
        ) {
            throw new Superseded();
        }
    }
    private block(value: boolean) {
        if (this.blocked !== value) {
            this.blocked = value;
            this.deps.timelineChanged(value);
        }
    }
    private publish(state: MusicVideoState) {
        this.state = Object.freeze(state);
        this.deps.publish(this.state);
    }
    private display(candidate: MusicVideoCandidate, quality?: string): MusicVideoDisplay {
        return {
            id: candidate.id,
            title: candidate.title,
            artist: candidate.artist,
            providerName: candidate.providerName,
            qualities: candidate.qualities,
            qualityId: quality,
        };
    }
    private phase(phase: Exclude<MusicVideoState["phase"], "audio">, error?: MusicVideoFailure) {
        if (!this.session || !this.currentVideo) {
            return;
        }
        if (phase === "video" && this.networkBlockedGeneration === this.deps.owner()?.loadGeneration) error = "network";
        this.publish({
            phase,
            songKey: this.session.key,
            video: this.display(this.currentVideo.candidate, this.currentVideo.quality),
            owner: this.deps.owner() ?? undefined,
            error,
            canReturn: this.checkpoint !== null,
        });
    }
    private saveCapture(session: AudioSession, value: unknown) {
        if (
            this.session !== session ||
            this.currentKey() !== session.key ||
            session.position != null ||
            !finitePosition(value)
        ) {
            return;
        }
        session.position = value;
        const checkpoint = this.checkpoint;
        if (checkpoint) {
            this.deps.saveAudioCheckpoint(checkpoint);
        }
    }
    private async recoverCapture(
        session: AudioSession,
        owner: PlayerRenditionIdentity,
        current: () => boolean,
    ) {
        if (session.position != null || owner.kind !== "mv") {
            return;
        }
        const info = await this.deps.videoInfo();
        if (
            current() &&
            info.mediaId === owner.mediaId &&
            info.loadGeneration === owner.loadGeneration &&
            info.kind === "mv"
        ) {
            this.saveCapture(session, info.outgoingAudioPosition);
        }
    }

    async enter(
        candidate: MusicVideoCandidate,
        quality?: string,
        options: {
            explicit?: boolean;
            preserve?: boolean;
            restartApproved?: boolean;
            mobileApproved?: boolean;
            automaticRepeat?: boolean;
            existingSession?: boolean;
            preflight?: MusicVideoPreflight;
            intentRevision?: number;
        } = {},
    ): Promise<MusicVideoAction> {
        const song = this.deps.currentSong(),
            initialOwner = this.deps.owner();
        if (
            !song ||
            !initialOwner ||
            candidate.originalSongKey !== getMediaUniqueKey(song) ||
            initialOwner.mediaId !== candidate.originalSongKey
        ) {
            return { status: "cancelled" };
        }
        if (this.session && this.blocked && initialOwner.kind === "audio") {
            return { status: "error", error: "audio-return" };
        }
        if (!this.session) {
            this.mobileApproved = false;
        }
        const oldVideo = this.currentVideo;
        const intentRevision = options.intentRevision ?? this.deps.playbackIntentRevision?.();
        const settings = this.deps.audioSettings();
        const session = this.session ?? {
            song: { ...song },
            key: candidate.originalSongKey,
            generation: initialOwner.loadGeneration,
            ...settings,
            position: null,
        };
        this.session = session;
        this.audioReturnTask = null;
        const request = this.begin(
            options.automaticRepeat === true,
            !!oldVideo &&
                initialOwner.kind === "mv" &&
                (options.automaticRepeat === true || options.existingSession === true),
        );
        let commitStarted = false;
        let stage: MusicVideoFailure = "network";
        this.publish({
            phase: "resolving",
            songKey: session.key,
            owner: initialOwner,
            video: this.display(oldVideo?.candidate ?? candidate, oldVideo?.quality ?? quality),
            canReturn: this.checkpoint !== null,
        });
        try {
            const preparation = options.preflight
                ? await options.preflight(request.abort.signal)
                : undefined;
            this.guard(request, session.key, true);
            if (preparation === null) {
                throw new Superseded();
            }
            const networkPolicy = await this.deps.videoNetwork(
                preparation?.mobileApproved === true ||
                    options.mobileApproved === true ||
                    this.mobileApproved,
            );
            if (networkPolicy === "allow-metered") {
                this.mobileApproved = true;
            }
            this.guard(request, session.key, true);
            stage = "source";
            const resolved = await this.deps.sources.resolve(
                candidate,
                quality,
                () => this.current(request, session.key),
                request.abort.signal,
            );
            this.guard(request, session.key, true);
            if (!resolved.isCurrent()) {
                throw new Superseded();
            }
            const admitted = await this.deps.admitVideo(resolved.source);
            this.guard(request, session.key, true);
            const sameTimeline =
                !!oldVideo?.timeline && oldVideo.timeline === resolved.source.timelineId;
            let suspended = false;
            let preservable = true;
            if (options.preserve && oldVideo) {
                const info = await this.deps.videoInfo();
                this.guard(request, session.key, true);
                const owner = this.deps.owner();
                if (owner?.kind !== "mv" || owner.mediaId !== info.mediaId ||
                    owner.loadGeneration !== initialOwner.loadGeneration || owner.loadGeneration !== info.loadGeneration) {
                    throw new Superseded();
                }
                suspended = info.suspended === true;
                preservable = info.positionPreservable !== false &&
                    (!suspended || info.suspendedPositionAvailable === true);
            }
            if (options.preserve && (!sameTimeline || !preservable) && !options.restartApproved) {
                if (oldVideo) {
                    this.currentVideo = oldVideo;
                    this.phase("video", suspended ? "network" : undefined);
                }
                return { status: "restart-confirmation" };
            }
            stage = "activation";
            const commit = await this.deps.coordinator.runLatest(request.token, async () => {
                this.guard(request, session.key, true);
                if (this.deps.waitForNativeScheduling) await this.deps.waitForNativeScheduling();
                this.guard(request, session.key, true);
                if (!resolved.isCurrent()) {
                    throw new Superseded();
                }
                const owner = this.deps.owner();
                if (!owner || owner.mediaId !== session.key ||
                    (options.preserve && owner.loadGeneration !== initialOwner.loadGeneration)) {
                    throw new Superseded();
                }
                await this.recoverCapture(session, owner, () => this.current(request, session.key));
                this.guard(request, session.key, true);
                if (options.explicit !== false && preparation?.claimPlayback !== false &&
                    (intentRevision === undefined || this.deps.playbackIntentRevision?.() === intentRevision)) {
                    await this.deps.claimPlayback();
                    this.guard(request, session.key, true);
                }
                this.currentVideo = {
                    candidate: resolved.candidate,
                    quality: resolved.quality,
                    timeline: resolved.source.timelineId,
                };
                commitStarted = true;
                request.committed = true;
                this.block(true);
                this.phase("loading");
                const receipt = await this.deps.replace({
                    expected: owner,
                    kind: "mv",
                    source: admitted,
                    videoNetworkPolicy: networkPolicy,
                    requireForeground: !request.allowBackground,
                    autoPlay: this.deps.mayAutoPlay(),
                    position:
                        options.preserve && sameTimeline && preservable
                            ? { mode: suspended ? "resume-suspended-mv" : "preserve-mv", timelineId: resolved.source.timelineId! }
                            : { mode: "start-zero" },
                    video: {
                        videoId: resolved.candidate.id,
                        providerKey: resolved.candidate.providerKey,
                        qualityId: resolved.quality,
                        qualityLabel: resolved.candidate.qualities?.find(
                            (q) => q.id === resolved.quality,
                        )?.label,
                        timelineId: resolved.source.timelineId,
                    },
                    onScheduled: (value) => {
                        if (this.current(request, session.key) && owner.kind === "audio") {
                            this.saveCapture(session, value.outgoingPosition);
                        }
                        if (this.current(request, session.key)) {
                            if (this.networkBlockedGeneration === value.rendition.loadGeneration) this.phase("video", "network");
                            else this.phase("loading");
                        }
                    },
                });
                this.guard(request, session.key);
                if (owner.kind === "audio") {
                    this.saveCapture(session, receipt.outgoingPosition);
                }
                if (this.networkBlockedGeneration === receipt.rendition.loadGeneration) {
                    throw Object.assign(new Error("Video network blocked"), { networkBlocked: true });
                }
                if (this.failedGeneration === receipt.rendition.loadGeneration) throw new Error("Video failed during activation");
                this.phase("video");
                this.networkBlockedGeneration = null;
                this.failedGeneration = null;
                this.deps.videoActivated();
            });
            return { status: commit.executed ? "playing" : "cancelled" };
        } catch (error: any) {
            if (error instanceof Superseded && this.current(request, session.key)) {
                this.currentVideo = oldVideo;
                if (oldVideo) {
                    this.phase("video");
                } else {
                    this.session = null;
                    this.block(false);
                    this.publish({ phase: "audio" });
                }
                return { status: "cancelled" };
            }
            if (
                !this.current(request, session.key) ||
                error instanceof Superseded ||
                error?.cancelled
            ) {
                return { status: "cancelled" };
            }
            if (error?.networkBlocked) {
                this.networkBlockedGeneration = this.deps.owner()?.loadGeneration ?? null;
                this.phase("video", "network");
                return { status: "error", error: "network" };
            }
            if (error?.rolledBack || error?.rejectedBeforeMutation) {
                if (initialOwner.kind === "audio" && error?.rolledBack) {
                    this.saveCapture(session, error.outgoingPosition);
                }
                this.currentVideo = oldVideo;
                if (oldVideo) {
                    this.phase("video", stage);
                    const owner = this.deps.owner();
                    const info = await this.deps.videoInfo().catch(() => null);
                    if (this.current(request, session.key) && info && owner?.kind === "mv" &&
                        info.mediaId === owner.mediaId && info.loadGeneration === owner.loadGeneration) {
                        if (info.suspended || this.networkBlockedGeneration === owner.loadGeneration) {
                            this.phase("video", "network");
                            return { status: "error", error: "network" };
                        }
                        if (info.failed) {
                            const restored = await this.returnToAudio(false, stage);
                            return restored.status === "audio" ? { status: "error", error: stage } : restored;
                        }
                    }
                } else {
                    this.block(false);
                    this.session = null;
                    this.publish({ phase: "audio", error: stage });
                }
                return { status: "error", error: stage };
            }
            if (commitStarted && !error?.rejectedBeforeMutation) {
                const owner = this.deps.owner();
                if (owner?.kind === "mv" && owner.mediaId === session.key) {
                    await this.recoverCapture(session, owner, () =>
                        this.current(request, session.key),
                    ).catch(() => undefined);
                    const restored = await this.returnToAudio(false, stage);
                    return restored.status === "audio"
                        ? { status: "error", error: stage }
                        : restored;
                }
            }
            if (!commitStarted && oldVideo) {
                this.currentVideo = oldVideo;
                this.phase("video", stage);
            } else if (!this.blocksAudioTimeline || this.deps.owner()?.kind === "audio") {
                this.block(false);
                this.session = null;
                this.currentVideo = null;
                this.publish({ phase: "audio", error: stage });
            } else {
                this.phase("error", stage);
            }
            return { status: "error", error: stage };
        }
    }

    returnToAudio(explicitPlay = false, reason?: MusicVideoFailure): Promise<MusicVideoAction> {
        const existing = this.audioReturnTask;
        if (existing && existing.key === this.currentKey()) {
            if (explicitPlay) {
                this.playOnReturn = true;
                return this.deps.claimPlayback().then(
                    () => existing.promise,
                    () => ({ status: "error", error: "audio-return" }),
                );
            }
            return existing.promise;
        }
        const key = this.currentKey();
        if (!key) {
            return Promise.resolve({ status: "cancelled" });
        }
        const task = { key, promise: this.performAudioReturn(explicitPlay, reason) };
        this.audioReturnTask = task;
        task.promise
            .finally(() => {
                if (this.audioReturnTask === task) {
                    this.audioReturnTask = null;
                }
            })
            .catch(() => undefined);
        return task.promise;
    }

    private async performAudioReturn(
        explicitPlay: boolean,
        reason?: MusicVideoFailure,
    ): Promise<MusicVideoAction> {
        const session = this.session;
        if (!session || this.currentKey() !== session.key) {
            return { status: "cancelled" };
        }
        const request = this.begin(false, true);
        this.playOnReturn = explicitPlay;
        try {
            if (explicitPlay) {
                await this.deps.claimPlayback();
            }
            this.guard(request, session.key);
            if (this.deps.waitForNativeScheduling) await this.deps.waitForNativeScheduling();
            this.guard(request, session.key);
            const owner = this.deps.owner();
            if (!owner || owner.mediaId !== session.key) {
                throw new Superseded();
            }
            await this.recoverCapture(session, owner, () => this.current(request, session.key));
            this.guard(request, session.key);
            const checkpoint = this.checkpoint;
            if (!checkpoint) {
                this.phase("error", "checkpoint-unavailable");
                return { status: "error", error: "checkpoint-unavailable" };
            }
            this.block(true);
            this.phase("returning");
            const source = await this.deps.resolveAudio(session.song, session.quality, () =>
                this.current(request, session.key),
            );
            this.guard(request, session.key);
            const commit = await this.deps.coordinator.runLatest(request.token, async () => {
                this.guard(request, session.key);
                const currentOwner = this.deps.owner();
                if (!currentOwner || currentOwner.mediaId !== session.key) {
                    throw new Superseded();
                }
                const receipt = await this.deps.replace({
                    expected: currentOwner,
                    kind: "audio",
                    source,
                    autoPlay: (explicitPlay || session.wasPlaying) && this.deps.mayAutoPlay(),
                    position: {
                        mode: "restore-audio",
                        positionSeconds: checkpoint.positionSeconds,
                    },
                });
                this.guard(request, session.key);
                if (receipt.readyProgress?.ready !== true) {
                    throw new Error("Audio return has no native ready sample");
                }
                await this.deps.audioReturned(checkpoint, receipt.readyProgress);
                this.guard(request, session.key);
                if (this.playOnReturn && this.deps.mayAutoPlay()) {
                    await this.deps.resumeAudio();
                    this.guard(request, session.key);
                } else if (
                    !explicitPlay &&
                    !this.playOnReturn &&
                    !session.wasPlaying &&
                    session.pausedByUser
                ) {
                    await this.deps.restorePauseHold?.();
                    this.guard(request, session.key);
                }
                this.session = null;
                this.currentVideo = null;
                this.mobileApproved = false;
                this.networkBlockedGeneration = null;
                this.block(false);
                this.publish({ phase: "audio", error: reason });
            });
            return { status: commit.executed ? "audio" : "cancelled" };
        } catch (error: any) {
            if (
                !this.current(request, session.key) ||
                error instanceof Superseded ||
                error?.cancelled
            ) {
                return { status: "cancelled" };
            }
            this.phase("error", "audio-return");
            return { status: "error", error: "audio-return" };
        }
    }

    changeQuality(
        quality: string,
        restartApproved = false,
        mobileApproved = false,
        preflight?: MusicVideoPreflight,
    ) {
        return this.currentVideo
            ? this.enter(this.currentVideo.candidate, quality, {
                explicit: false,
                preserve: true,
                restartApproved,
                mobileApproved,
                preflight,
            })
            : Promise.resolve<MusicVideoAction>({ status: "cancelled" });
    }
    replay(automatic = true) {
        if (["resolving", "loading", "returning"].includes(this.state.phase)) {
            return Promise.resolve<MusicVideoAction>({ status: "cancelled" });
        }
        return this.currentVideo
            ? this.enter(this.currentVideo.candidate, this.currentVideo.quality, {
                explicit: false,
                automaticRepeat: automatic,
                existingSession: !automatic,
            })
            : Promise.resolve<MusicVideoAction>({ status: "cancelled" });
    }

    async resume(
        mobileApproved = false,
        explicit = true,
        preflight?: MusicVideoPreflight,
        restartApproved = false,
    ): Promise<MusicVideoAction> {
        const schedulingKey = this.currentKey();
        if (!schedulingKey || this.deps.owner()?.kind !== "mv") return { status: "cancelled" };
        const beforeScheduling = this.request;
        const intentRevision = this.deps.playbackIntentRevision?.();
        if (this.deps.waitForNativeScheduling) await this.deps.waitForNativeScheduling();
        if (this.request !== beforeScheduling || this.currentKey() !== schedulingKey) return { status: "cancelled" };
        const key = this.currentKey(),
            owner = this.deps.owner();
        if (!key || owner?.kind !== "mv") {
            return { status: "cancelled" };
        }
        const ownedRequest =
            preflight || !this.request ? this.begin(false, false) : null;
        const request = this.request;
        const current = () =>
            this.request === request &&
            this.currentKey() === key &&
            this.deps.owner()?.loadGeneration === owner.loadGeneration;
        try {
            const preparation = preflight
                ? await preflight(request?.abort.signal ?? new AbortController().signal)
                : undefined;
            if (!current() || preparation === null) {
                return { status: "cancelled" };
            }
            const info = await this.deps.videoInfo();
            if (
                !current() ||
                info.mediaId !== owner.mediaId ||
                info.loadGeneration !== owner.loadGeneration
            ) {
                return { status: "cancelled" };
            }
            // Consent belongs to this session, including a subsequent restart dialog.
            if (preparation?.mobileApproved === true) this.mobileApproved = true;
            const reloadOptions = {
                explicit: explicit && preparation?.claimPlayback !== false,
                existingSession: true,
                intentRevision,
                mobileApproved: preparation?.mobileApproved === true || mobileApproved || this.mobileApproved,
            };
            if (info.suspended && this.currentVideo) {
                this.networkBlockedGeneration = owner.loadGeneration;
                this.phase("video", "network");
                if (!explicit) return { status: "cancelled" };
                if (info.suspendedPositionAvailable !== true && !restartApproved) return { status: "restart-confirmation" };
                return await this.enter(this.currentVideo.candidate, this.currentVideo.quality, {
                    ...reloadOptions, preserve: !restartApproved,
                    restartApproved,
                });
            }
            if (info.failed && this.currentVideo) {
                if (!explicit) return { status: "cancelled" };
                return await this.enter(this.currentVideo.candidate, this.currentVideo.quality, {
                    ...reloadOptions,
                });
            }
            if (info.completed && this.currentVideo) {
                if (!explicit) return { status: "cancelled" };
                return await this.enter(this.currentVideo.candidate, this.currentVideo.quality, {
                    ...reloadOptions,
                });
            }
            const policy = await this.deps.videoNetwork(
                preparation?.mobileApproved === true || mobileApproved || this.mobileApproved,
            );
            if (!current()) {
                return { status: "cancelled" };
            }
            if (policy === "allow-metered") {
                this.mobileApproved = true;
            }
            if (explicit && preparation?.claimPlayback !== false &&
                (intentRevision === undefined || this.deps.playbackIntentRevision?.() === intentRevision)) {
                await this.deps.claimPlayback();
            }
            if (!current()) return { status: "cancelled" };
            if (this.deps.mayAutoPlay()) {
                await this.deps.resumeVideo(policy);
            }
            if (current()) {
                this.networkBlockedGeneration = null;
                this.phase("video");
            }
            return { status: current() ? "playing" : "cancelled" };
        } catch {
            if (!current()) {
                return { status: "cancelled" };
            }
            this.phase("video", "network");
            return { status: "error", error: "network" };
        } finally {
            if (ownedRequest && this.request === ownedRequest) {
                this.request = null;
            }
        }
    }

    onBackground() {
        if (!this.request || this.request.allowBackground || this.request.committed) return;
        if (this.state.phase === "resolving") {
            this.cancelResolving();
        } else {
            this.cancelRequest();
        }
    }

    handleNetworkBlocked(owner: PlayerRenditionIdentity) {
        const current = this.deps.owner();
        if (!this.session || !current || owner.kind !== "mv" || current.mediaId !== owner.mediaId ||
            current.loadGeneration !== owner.loadGeneration || this.currentKey() !== owner.mediaId) return;
        this.networkBlockedGeneration = owner.loadGeneration;
        if (this.state.phase === "returning") return;
        this.block(true);
        this.phase("video", "network");
    }
    playPendingReturn() {
        if (this.state.phase === "returning") {
            this.playOnReturn = true;
        }
    }
    cancelResolving() {
        if (this.state.phase !== "resolving") {
            return;
        }
        this.cancelRequest();
        if (this.currentVideo) {
            this.phase("video");
        } else {
            this.session = null;
            this.block(false);
            this.publish({ phase: "audio" });
        }
    }
    private cancelRequest() {
        const request = this.request;
        if (request && this.deps.coordinator.isActive(request.token)) {
            this.deps.coordinator.begin();
        }
        request?.abort.abort();
        this.deps.cancelNativeWait();
        this.request = null;
    }
    leaveForSongChange() {
        this.networkBlockedGeneration = null;
        this.audioReturnTask = null;
        this.mobileApproved = false;
        this.cancelRequest();
        this.session = null;
        this.currentVideo = null;
        this.block(false);
        this.publish({ phase: "audio" });
    }
    async handlePlaybackError() {
        if (!this.blocksAudioTimeline) {
            return false;
        }
        const owner = this.deps.owner();
        if (owner?.kind !== "mv") {
            return true;
        }
        if (this.networkBlockedGeneration === owner.loadGeneration || this.state.error === "network") return true;
        if (this.state.phase === "returning") return true;
        if (this.failedGeneration === owner.loadGeneration) {
            return true;
        }
        this.failedGeneration = owner.loadGeneration;
        if (this.state.phase === "loading") return true;
        await this.returnToAudio(false, "activation");
        return true;
    }
}
