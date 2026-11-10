export {};

function mockAutoStub(): any {
    const cache: Record<string | symbol, unknown> = {};
    return new Proxy(cache, {
        get(target, key) {
            if (key === "__esModule") {
                return true;
            }
            if (key === "then") {
                return undefined;
            }
            if (!(key in target)) {
                target[key] = key === "default" ? mockAutoStub() : jest.fn();
            }
            return target[key];
        },
    });
}

const mockBackend: any = new Proxy(
    {
        active: null as any,
        getActiveTrack: jest.fn(async () => mockBackend.active?.track ?? null),
        getActiveTrackIndex: jest.fn(async () => mockBackend.active?.index ?? null),
        getState: jest.fn(async () => "playing"),
        getProgress: jest.fn(async () => ({ position: 30, duration: 200, buffered: 30 })),
        getPlayNextQueue: jest.fn(async () => []),
        getUpNextQueue: jest.fn(async () => []),
        getNextTracks: jest.fn(async () => []),
        restoreActiveTrack: jest.fn(async () => true),
    } as Record<string, any>,
    {
        get(target, key) {
            if (!(key in target) && typeof key === "string") {
                target[key] = jest.fn(async () => undefined);
            }
            return target[key as string];
        },
    },
);

jest.mock("@/core/playerAdapter", () => ({
    __esModule: true,
    resolvePlayerAdapter: () => mockBackend,
}));
// 等待都走（假）定时器，测试推进时间才会往下走
jest.mock("@/utils/delay", () => ({
    __esModule: true,
    default: jest.fn(
        (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
    ),
}));
jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    Easing: {
        out: () => () => 0,
        inOut: () => () => 0,
        bezier: () => () => 0,
        exp: () => 0,
        linear: () => 0,
        cubic: () => 0,
        quad: () => 0,
    },
    makeMutable: (value: unknown) => ({ value }),
    cancelAnimation: () => {},
    withTiming: (value: unknown) => value,
}));
jest.mock("immer", () => ({
    __esModule: true,
    produce: (base: unknown, recipe: (draft: any) => unknown) => {
        const draft = structuredClone(base);
        const result = recipe(draft);
        return result === undefined ? draft : result;
    },
}));
jest.mock("@/core/localMusicArtworkManager", () => ({
    __esModule: true,
    getDirectArtworkUri: (artwork: unknown) => artwork || null,
    mergeResolvedArtwork: (item: unknown) => item,
    resolveLocalMusicArtwork: async () => "",
    stripEphemeralLocalArtwork: (item: unknown) => item,
}));
jest.mock("@/utils/log", () => mockAutoStub());
jest.mock("react-native-fs", () => mockAutoStub());
jest.mock("@/utils/getOrCreateMMKV", () => {
    const store = () => ({
        getString: () => undefined,
        set: () => undefined,
        updateString: () => undefined,
        delete: () => undefined,
        contains: () => false,
        getAllKeys: () => [],
        clearAll: () => undefined,
    });
    return {
        __esModule: true,
        default: store,
        prepareKeyValueStore: async () => undefined,
        hydrateKeyValueStore: async () => undefined,
    };
});
jest.mock("@/utils/network", () => ({
    __esModule: true,
    default: { isOffline: false, isCellular: false, getFreshState: jest.fn(async () => ({ type: "wifi", isConnected: true, isInternetReachable: true, details: { isConnectionExpensive: false } })) },
}));
jest.mock("@/utils/persistStatus", () => mockAutoStub());
jest.mock("@/core/localMusicSheet", () => mockAutoStub());
jest.mock("@/core/dislikeMusic", () => mockAutoStub());
jest.mock("@/core/mediaCache", () => mockAutoStub());
jest.mock("@/constants/assetsConst", () => mockAutoStub());
jest.mock("@/native/utils", () => mockAutoStub());
jest.mock("@/service/encryptedMediaProxy", () => mockAutoStub());
jest.mock("@/core/lastfm", () => mockAutoStub());
jest.mock("@/utils/androidMediaPermission", () => mockAutoStub());
jest.mock("@/utils/userAgentHelper", () => mockAutoStub());

jest.mock("@/utils/remoteMediaUrl", () => ({ validateRemoteMediaUrlForPlayback: jest.fn(async (url: string) => ({ ok: true, url })) }));
const trackPlayer = require("@/core/trackPlayer").default;
const player = trackPlayer as any;


import { AppState } from "react-native";
import { TrackPlayerEvents } from "@/constants/trackPlayerConst";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import PersistStatus from "@/utils/persistStatus";
import LastfmScrobbler from "@/core/lastfm";
import Network from "@/utils/network";
const song = { id: "A", platform: "test", title: "Song A", artist: "Artist", duration: 300 } as IMusic.IMusicItem;
let owner: any;
let generation: number;
const plugin = { name: "test", hash: "test", instance: {}, supportedMethods: new Set(["getMusicVideos", "getVideoSource"]),
    methods: {
        getMusicVideos: jest.fn(async () => [{ id: "clip", title: "Video", qualities: [{ id: "720p", label: "720p" }] }]),
        getVideoSource: jest.fn(async () => ({ url: "https://example.test/clip.mp4", timelineId: "cut" })),
        getMediaSource: jest.fn(async () => ({ url: "https://example.test/audio.mp3" })),
    } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(LastfmScrobbler.flush).mockResolvedValue(undefined);
    Object.defineProperty(AppState, "currentState", { configurable: true, value: "active" });
    player.musicVideo?.leaveForSongChange();
    generation = 1; owner = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: generation };
    mockBackend.getRenditionOwner = jest.fn(() => owner);
    mockBackend.getActiveRendition = jest.fn(() => owner);
    mockBackend.getProgress = jest.fn(async () => ({ position: owner.kind === "mv" ? 8 : 37.25, duration: owner.kind === "mv" ? 24 : 300, buffered: 40, ready: true }));
    mockBackend.getState = jest.fn(async () => "playing");
    mockBackend.getVideoInfo = jest.fn(async () => ({ ...owner, outgoingAudioPosition: 37.25 }));
    mockBackend.replaceRendition = jest.fn(async (request: any) => {
        owner = { mediaId: getMediaUniqueKey(song), loadGeneration: ++generation, kind: request.kind };
        const result = { rendition: owner, outgoingPosition: 37.25, readyProgress: request.kind === "audio" ? { position: 37.25, duration: 300, buffered: 37.25, ready: true } : undefined };
        request.onScheduled?.(result); return result;
    });
    mockBackend.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    mockBackend.getRate = jest.fn(async () => 1);
    player.backend = mockBackend;
    player.injectDependencies({ getConfig: (key: string) => key === "basic.useCelluarNetworkPlay" ? true : undefined },
        { addMusic: jest.fn() }, { getByMedia: () => plugin, getByName: () => plugin, isPluginEnabled: () => true });
    player.setCurrentMusic(song); player.setPlayList([song]);
    player.playbackIntent.play();
    jest.spyOn(player.sourceResolver, "createPlayableSource").mockImplementation(async (source: unknown) => source);
    player.syncPreparedNextTrack = jest.fn();
});
afterEach(() => jest.restoreAllMocks());
async function enter() {
    const [candidate] = await trackPlayer.findMusicVideos(); return trackPlayer.watchMusicVideo(candidate);
}

test("actual TrackPlayer checkpoints native capture, never MV seek/progress, and returns the same logical song", async () => {
    const changed = jest.fn(); player.on(TrackPlayerEvents.CurrentMusicChanged, changed);
    expect(await enter()).toEqual({ status: "playing" });
    expect(trackPlayer.audioTimelineAvailable).toBe(false);
    expect(PersistStatus.set).toHaveBeenCalledWith("music.progress", 37.25);
    jest.mocked(PersistStatus.set).mockClear();
    player.persistPlaybackProgress(12, true);
    await trackPlayer.seekTo(13);
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", expect.anything());
    expect(mockBackend.seekTo).toHaveBeenCalledWith(13);
    expect(trackPlayer.currentMusic).toMatchObject(song);
    expect(await trackPlayer.returnToSong()).toEqual({ status: "audio" });
    expect(trackPlayer.audioTimelineAvailable).toBe(true);
    expect(mockBackend.replaceRendition.mock.calls[1][0]).toMatchObject({ position: { mode: "restore-audio", positionSeconds: 37.25 } });
    expect(changed).not.toHaveBeenCalled(); player.off(TrackPlayerEvents.CurrentMusicChanged, changed);
});

test("actual source commit waits for the same commitTail used by MV", async () => {
    let release!: () => void;
    const token = player.qualityChangeCoordinator.begin();
    const held = player.qualityChangeCoordinator.runLatest(token, () => new Promise<void>(resolve => {
        release = resolve;
    }));
    await tick();
    const watching = enter(); await tick();
    expect(mockBackend.replaceRendition).not.toHaveBeenCalled();
    release(); await held; await watching;
    expect(mockBackend.replaceRendition).toHaveBeenCalledTimes(1);
});

test("new-song selection cannot use MV seconds as manual rollback progress", async () => {
    await enter();
    const transition = player.beginMpvManualSkipTransition({ ...song, id: "B" }, song, "test-next");
    expect(transition.previousWasVideo).toBe(true);
    expect(transition.previousProgress).toMatchObject({ position: 37.25, duration: 300 });
    expect(trackPlayer.audioTimelineAvailable).toBe(false); // old native MV still owns the engine
});

test("audio quality cannot resolve from the current MV clock", async () => {
    await enter(); plugin.methods.getMediaSource.mockClear();
    expect(await trackPlayer.changeQualityWithResult("standard")).toMatchObject({ success: false, superseded: true });
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
});

test("state and progress while MV is active do not resume original-song listening or crossfade", async () => {
    await player.setupTrackPlayer();
    await enter();
    const callbacks = new Map<string, (...args: any[]) => void>(mockBackend.addEventListener.mock.calls.map(([event, fn]: any[]) => [event, fn]));
    jest.mocked(LastfmScrobbler.onResumed).mockClear(); jest.mocked(LastfmScrobbler.onProgressTick).mockClear();
    callbacks.get("playbackStateChanged")!("playing");
    callbacks.get("progress")!({ position: 12, duration: 24, buffered: 15 });
    expect(LastfmScrobbler.onResumed).not.toHaveBeenCalled();
    expect(LastfmScrobbler.onProgressTick).not.toHaveBeenCalled();
    player.disposeServiceListeners();
});

test("fresh network reading, total mobile switch and session approval are required before video source fetch", async () => {
    jest.mocked(Network.getFreshState).mockResolvedValueOnce({ type: "cellular", isConnected: true, isInternetReachable: true, details: { isConnectionExpensive: true } } as any);
    const [candidate] = await trackPlayer.findMusicVideos();
    expect(await trackPlayer.watchMusicVideo(candidate)).toEqual({ status: "error", error: "network" });
    expect(plugin.methods.getVideoSource).not.toHaveBeenCalled();
    expect(mockBackend.replaceRendition).not.toHaveBeenCalled();
});

test("a new logical song cannot be persisted beside the outgoing MV's original-audio checkpoint", async () => {
    await enter();
    jest.mocked(PersistStatus.set).mockClear();
    const next = { ...song, id: "B" };
    player.beginMpvManualSkipTransition(next, song, "next");
    player.setCurrentMusic(next);
    player.persistPlaybackProgress(99, true);
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.musicItem", expect.anything());
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", 99);
    mockBackend.getRenditionOwner.mockReturnValue({ kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 9 });
    mockBackend.getActiveRendition.mockReturnValue({ kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 9, ready: false });
    player.persistPlaybackProgress(0, true);
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.musicItem", expect.anything());
    mockBackend.getActiveRendition.mockReturnValue({ kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 9, ready: true });
    player.persistPlaybackProgress(0, true);
    expect(PersistStatus.set).toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "B" }));
    expect(PersistStatus.set).toHaveBeenCalledWith("music.progress", 0);
});

test("ordinary load confirmation does not cancel autoplay compensation or republish the timeline", async () => {
    jest.useFakeTimers();
    try {
        mockBackend.active = { track: song, index: 0 };
        mockBackend.getState = jest.fn(async () => "paused");
        mockBackend.play = jest.fn(async () => undefined);
        await player.setupTrackPlayer();
        const callbacks = new Map<string, (...args: any[]) => any>(mockBackend.addEventListener.mock.calls.map(([event, fn]: any[]) => [event, fn]));
        const timeline = jest.fn();
        player.on(TrackPlayerEvents.AudioTimelineChanged, timeline);
        const retry = player.ensureAdapterAutoPlay(getMediaUniqueKey(song));
        await callbacks.get("trackChanged")!({ track: song, index: 0, reason: "manual", activationGeneration: 1 });
        await jest.advanceTimersByTimeAsync(180);
        expect(mockBackend.play).toHaveBeenCalledTimes(1);
        expect(timeline).not.toHaveBeenCalled();
        player.playbackIntent.pause();
        await jest.advanceTimersByTimeAsync(520);
        await retry;
        player.off(TrackPlayerEvents.AudioTimelineChanged, timeline);
    } finally {
        player.disposeServiceListeners();
        jest.useRealTimers();
    }
});

test.each(["unready", "pending", "previous-owner"])("audio errors remain eligible for recovery while %s", async scenario => {
    const next = { ...song, id: "B" };
    const previous = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
    const target = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    mockBackend.getRenditionOwner = jest.fn(() => scenario === "previous-owner" ? previous : target);
    mockBackend.getActiveRendition = jest.fn(() => scenario === "unready" ? { ...target, ready: false } : previous);
    mockBackend.active = { track: next, index: 0 };
    player.setCurrentMusic(next);
    await player.setupTrackPlayer();
    const callbacks = new Map<string, (...args: any[]) => any>(mockBackend.addEventListener.mock.calls.map(([event, fn]: any[]) => [event, fn]));
    const record = jest.spyOn(player, "recordPlaybackError").mockImplementation(() => undefined);
    const recover = jest.spyOn(player, "recoverCurrentSourceAfterPlaybackError").mockResolvedValue(true);
    // A preceding test deliberately leaves a manual-skip transaction open;
    // exercise error routing independently of that separate stale-event guard.
    jest.spyOn(player, "shouldIgnoreMpvPlaybackErrorDuringManualSkip").mockReturnValue(false);
    try {
        await callbacks.get("playbackError")!({ code: "mpv-load-failed", message: "load failed" });
        expect(record).toHaveBeenCalledTimes(1);
        expect(recover).toHaveBeenCalledTimes(1);
    } finally {
        player.disposeServiceListeners();
    }
});

test("an autoplay retry cannot resume the original audio after MV has taken ownership", async () => {
    jest.useFakeTimers();
    try {
        mockBackend.active = { track: song, index: 0 };
        mockBackend.getState = jest.fn(async () => "paused");
        mockBackend.play = jest.fn(async () => undefined);
        const retry = player.ensureAdapterAutoPlay(getMediaUniqueKey(song));
        expect(await enter()).toEqual({ status: "playing" });
        await jest.advanceTimersByTimeAsync(180);
        await retry;
        expect(mockBackend.play).not.toHaveBeenCalled();
    } finally {
        jest.useRealTimers();
    }
});

test.each(["unready", "pending", "previous-owner"])("%s audio recovery resolves the selected song without using the previous audio clock", async scenario => {
    const next = { ...song, id: `RECOVERY-${scenario}` };
    const target = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 9 };
    const previous = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
    mockBackend.getRenditionOwner = jest.fn(() => scenario === "previous-owner" ? previous : target);
    mockBackend.getActiveRendition = jest.fn(() => scenario === "unready" ? { ...target, ready: false } : previous);
    mockBackend.getProgress = jest.fn(async () => ({ position: 88, duration: 300, buffered: 88 }));
    player.setCurrentMusic(next);
    const resolve = jest.spyOn(player.sourceResolver, "resolveFreshMediaSource").mockResolvedValue({ url: "https://example.test/recovered.mp3" });
    const setSource = jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    expect(await player.recoverCurrentSourceAfterPlaybackError({ message: "failed" }, scenario === "unready" ? next : song)).toBe(true);
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ id: next.id }));
    expect(setSource).toHaveBeenCalledWith(expect.objectContaining({ id: next.id }), true, 0, false, expect.anything());
});

test("a late failed audio recovery cannot skip or replace a newly selected MV", async () => {
    mockBackend.active = { track: song, index: 0 };
    await player.setupTrackPlayer();
    const callbacks = new Map<string, (...args: any[]) => any>(mockBackend.addEventListener.mock.calls.map(([event, fn]: any[]) => [event, fn]));
    jest.spyOn(player, "shouldIgnoreMpvPlaybackErrorDuringManualSkip").mockReturnValue(false);
    let finishRecovery!: (value: boolean) => void;
    jest.spyOn(player, "recoverCurrentSourceAfterPlaybackError").mockImplementation(() => new Promise(resolve => {
        finishRecovery = resolve;
    }));
    const fail = jest.spyOn(player, "handlePlayFail").mockImplementation(() => undefined);
    const errorTask = callbacks.get("playbackError")!({ code: "mpv-load-failed", message: "failed" });
    await tick();
    expect(await enter()).toEqual({ status: "playing" });
    finishRecovery(false);
    await errorTask;
    expect(fail).not.toHaveBeenCalled();
    expect(trackPlayer.musicVideoState.phase).toBe("video");
    player.disposeServiceListeners();
});
