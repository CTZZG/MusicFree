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
jest.mock("@/utils/fileUtils", () => ({ checkAndCreateDir: jest.fn().mockResolvedValue(undefined) }));
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
jest.mock("@/native/lyricUtil", () => ({ __esModule: true, default: {
    setActivePlayerBackend: jest.fn().mockResolvedValue(undefined),
    showStatusBarLyric: jest.fn().mockResolvedValue(undefined),
    setStatusBarLyricText: jest.fn().mockResolvedValue(undefined),
    setStatusBarLyricPayload: jest.fn().mockResolvedValue(undefined),
    clearMediaNotificationLyricText: jest.fn().mockResolvedValue(undefined),
    clearLiveUpdateLyricText: jest.fn().mockResolvedValue(undefined),
} }));
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

test("MV ownership is reported even when the audio timeline was already unavailable", () => {
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready: false }));
    player.setCurrentMusic(song);
    player.initializeMusicVideo();
    const timeline = jest.fn();
    const ownership = jest.fn();
    player.on(TrackPlayerEvents.AudioTimelineChanged, timeline);
    player.on(TrackPlayerEvents.MusicVideoOwnershipChanged, ownership);
    try {
        expect(player.audioTimelineAvailable).toBe(false);
        player.musicVideo.block(true);
        expect(player.videoOwnsPlayback).toBe(true);
        expect(timeline).not.toHaveBeenCalled();
        expect(ownership).toHaveBeenCalledTimes(1);
    } finally {
        player.off(TrackPlayerEvents.AudioTimelineChanged, timeline);
        player.off(TrackPlayerEvents.MusicVideoOwnershipChanged, ownership);
        player.musicVideo.block(false);
    }
});

test("MV ownership does not duplicate an actual audio timeline change", () => {
    player.initializeMusicVideo();
    const timeline = jest.fn();
    const ownership = jest.fn();
    player.on(TrackPlayerEvents.AudioTimelineChanged, timeline);
    player.on(TrackPlayerEvents.MusicVideoOwnershipChanged, ownership);
    try {
        expect(player.audioTimelineAvailable).toBe(true);
        player.musicVideo.block(true);
        expect(timeline).toHaveBeenCalledTimes(1);
        expect(ownership).not.toHaveBeenCalled();
        player.musicVideo.block(false);
        expect(timeline).toHaveBeenCalledTimes(2);
        expect(ownership).not.toHaveBeenCalled();
    } finally {
        player.off(TrackPlayerEvents.AudioTimelineChanged, timeline);
        player.off(TrackPlayerEvents.MusicVideoOwnershipChanged, ownership);
    }
});

test("real TrackPlayer and LyricManager fetch for the new song while the old audio still owns the engine", async () => {
    const manager = require("@/core/lyricManager").default;
    const next = { ...song, id: "B", title: "Song B" };
    let finishNext!: (value: unknown) => void;
    const nextLyrics = new Promise(resolve => {
        finishNext = resolve;
    });
    const getLyric = jest.fn((item: IMusic.IMusicItem) => item.id === "B"
        ? nextLyrics : Promise.resolve({ rawLrc: "[00:00.00]Song A" }));
    const lyricPlugin = { name: "test", methods: { getLyric }, supportedMethods: new Set(["getLyric"]) };
    manager.dispose();
    manager.injectDependencies(trackPlayer, { getConfig: () => undefined },
        { getByMedia: () => lyricPlugin, getSearchablePlugins: () => [] });
    try {
        await manager.setup();
        await tick();
        getLyric.mockClear();
        mockBackend.getProgress.mockClear();
        player.setCurrentMusic(next);
        expect(trackPlayer.audioTimelineAvailable).toBe(false);
        expect(trackPlayer.videoOwnsPlayback).toBe(false);
        expect(getLyric).toHaveBeenCalledTimes(1);
        expect(getLyric).toHaveBeenCalledWith(expect.objectContaining({ id: "B" }));
        expect(mockBackend.getProgress).not.toHaveBeenCalled();
        owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: ++generation };
        player.setCurrentMusic(next);
        expect(trackPlayer.audioTimelineAvailable).toBe(true);
        expect(getLyric).toHaveBeenCalledTimes(1);
        finishNext({ rawLrc: "[00:00.00]Song B" });
        await tick();
        expect(JSON.stringify(manager.lyricState.lyrics)).toContain("Song B");
    } finally {
        manager.dispose();
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

describe("quality selection while audio is not ready (plan A1)", () => {
    it.each(["same-owner-unready", "previous-owner"])("waits for the correct clock in %s", async scenario => {
        const next = { ...song, id: "B", title: "Song B" };
        let ready = scenario !== "same-owner-unready";
        owner = scenario === "same-owner-unready"
            ? { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 }
            : { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
        mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready }));
        mockBackend.getProgress = jest.fn(async () => ({
            position: owner.mediaId === getMediaUniqueKey(next) ? 7 : 91,
            duration: 300, buffered: 100, ready,
        }));
        player.cancelMpvManualSkipTransition("test-start");
        player.setCurrentMusic(next);
        player.setQuality("128k");
        const ongoing = player.qualityChangeCoordinator.begin();
        const setSource = jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
        let result: any;
        const changing = trackPlayer.changeQualityWithResult("320k").then(value => {
            result = value;
            return value;
        });
        await tick();
        expect(result).toBeUndefined();
        expect(mockBackend.getProgress).not.toHaveBeenCalled();
        expect(player.qualityChangeCoordinator.isActive(ongoing)).toBe(true);
        owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
        ready = true;
        player.setCurrentMusic(next);
        await expect(changing).resolves.toMatchObject({ success: true });
        expect(plugin.methods.getMediaSource).toHaveBeenCalled();
        expect(setSource).toHaveBeenCalledWith(expect.anything(), true, 7, true, expect.anything(), true);
    });

    it("cancels a waiting quality selection when the logical song changes", async () => {
        const next = { ...song, id: "B" };
        owner = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
        player.setCurrentMusic(next);
        const changing = trackPlayer.changeQualityWithResult("320k");
        await tick();
        player.setCurrentMusic({ ...song, id: "C" });
        await expect(changing).resolves.toMatchObject({ success: false, superseded: true });
        expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
        expect(mockBackend.getProgress).not.toHaveBeenCalled();
    });
});

it("never reads the outgoing audio clock as the newly selected song", async () => {
    const next = { ...song, id: "B" };
    owner = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
    mockBackend.getProgress = jest.fn(async () => ({ position: 91, duration: 300, buffered: 91, ready: true }));
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(next);
    jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    player.setCurrentMusic(next);
    await changing;
});

it("waits when a pending legacy audio owner differs from the still-active audio", async () => {
    const next = { ...song, id: "B" };
    const previous = { kind: "audio", mediaId: getMediaUniqueKey(song), loadGeneration: 1 };
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    let active = previous;
    mockBackend.getActiveRendition = jest.fn(() => active);
    mockBackend.getProgress = jest.fn(async () => ({ position: active === previous ? 91 : 7, duration: 300, buffered: 91 }));
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(next);
    player.setQuality("128k");
    jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    expect(trackPlayer.audioTimelineAvailable).toBe(true); // legacy audio has no ready field
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    active = owner;
    player.setCurrentMusic(next);
    await expect(changing).resolves.toMatchObject({ success: true });
    expect(mockBackend.getProgress).toHaveBeenCalled();
});

it("keeps the newer pending quality request and cancels the older one", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(next);
    player.setQuality("128k");
    jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    const first = trackPlayer.changeQualityWithResult("192k");
    const second = trackPlayer.changeQualityWithResult("320k");
    await expect(first).resolves.toMatchObject({ success: false, superseded: true });
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    player.setCurrentMusic(next);
    await expect(second).resolves.toMatchObject({ success: true, requestedQuality: "320k" });
    expect(plugin.methods.getMediaSource).toHaveBeenCalledTimes(1);
});

it("does not commit an old source while the newer quality waits for readiness", async () => {
    let release!: (value: any) => void;
    let ready = true;
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(song);
    player.setQuality("128k");
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready }));
    plugin.methods.getMediaSource.mockImplementationOnce(() => new Promise(resolve => {
        release = resolve;
    }));
    const setSource = jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    const first = trackPlayer.changeQualityWithResult("320k");
    await tick();
    ready = false;
    const latest = trackPlayer.changeQualityWithResult("192k");
    // The native state can become ready before its event reaches the waiter.
    ready = true;
    release({ url: "https://example.test/stale.mp3" });
    await expect(first).resolves.toMatchObject({ success: false, superseded: true });
    expect(setSource).not.toHaveBeenCalled();
    player.setCurrentMusic(song);
    await expect(latest).resolves.toMatchObject({ success: true, requestedQuality: "192k" });
    expect(setSource).toHaveBeenCalledTimes(1);
});

it("does not remove the next backend listener during a readiness event", async () => {
    const next = { ...song, id: "B" };
    const listeners: Array<() => void> = [];
    mockBackend.addEventListener = jest.fn((event: string, callback: () => void) => {
        if (event === "trackChanged") listeners.push(callback);
        return { remove: () => {
            const index = listeners.indexOf(callback);
            if (index >= 0) listeners.splice(index, 1);
        } };
    });
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(next);
    player.setQuality("128k");
    jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    const changing = trackPlayer.changeQualityWithResult("320k");
    const other = jest.fn();
    listeners.push(other);
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    listeners.forEach(listener => listener());
    expect(other).toHaveBeenCalledTimes(1);
    await expect(changing).resolves.toMatchObject({ success: true });
    expect(listeners).toEqual([other]);
});

it("waits for the active manual transition instead of cancelling its source token", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    const transition = player.beginMpvManualSkipTransition(next, song, "test-next");
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    player.setCurrentMusic(next);
    player.setQuality("128k");
    jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    expect(player.isMpvManualSkipTransitionActive(transition)).toBe(true);
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    player.completeMpvManualSkipTransition(transition, "test-complete");
    await expect(changing).resolves.toMatchObject({ success: true });
});

it("cancels a waiting quality request when MV takes ownership", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(next);
    player.initializeMusicVideo();
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    player.musicVideo.block(true);
    await expect(changing).resolves.toMatchObject({ success: false, superseded: true });
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
    player.musicVideo.block(false);
});

it("rejects audio quality while returning even if the native owner is already audio", async () => {
    player.cancelMpvManualSkipTransition("test-start");
    player.initializeMusicVideo();
    player.musicVideo.block(true);
    player.musicVideo.publish({ phase: "returning", songKey: getMediaUniqueKey(song),
        owner, video: { id: "clip", title: "Video", artist: "Artist", providerName: "test" }, canReturn: true });
    expect(player.musicVideo.snapshot.phase).toBe("returning");
    expect(owner.kind).toBe("audio");
    await expect(trackPlayer.changeQualityWithResult("320k")).resolves.toMatchObject({ success: false, superseded: true });
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
    player.musicVideo.block(false);
});

it("rejects an old progress read after the audio load generation changes", async () => {
    let release!: (value: any) => void;
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(song);
    player.setQuality("128k");
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    owner = { ...owner, loadGeneration: owner.loadGeneration + 1 };
    release({ position: 91, duration: 300, buffered: 91, ready: true });
    await expect(changing).resolves.toMatchObject({ success: false, superseded: true });
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
});

it("reports an unready audio timeout instead of silently treating it as superseded", async () => {
    jest.useFakeTimers();
    try {
        player.cancelMpvManualSkipTransition("test-start");
        player.setCurrentMusic({ ...song, id: "B" });
        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(15_000);
        await expect(changing).resolves.toMatchObject({ success: false, failure: { code: "backend-error" } });
        expect(mockBackend.getProgress).not.toHaveBeenCalled();
        expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
        expect(player.qualityReadinessWait).toBeNull();
    } finally {
        jest.useRealTimers();
    }
});

it("rejects an old progress read if MV entered and returned while it was pending", async () => {
    let release!: (value: any) => void;
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(song);
    player.setQuality("128k");
    player.initializeMusicVideo();
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    player.musicVideo.block(true);
    player.musicVideo.block(false);
    release({ position: 91, duration: 300, buffered: 91, ready: true });
    await expect(changing).resolves.toMatchObject({ success: false, superseded: true });
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
});

it("rejects an old progress read if the song changes away and back", async () => {
    let release!: (value: any) => void;
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic(song);
    player.setQuality("128k");
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    const changing = trackPlayer.changeQualityWithResult("320k");
    await tick();
    player.setCurrentMusic({ ...song, id: "B" });
    player.setCurrentMusic(song);
    release({ position: 91, duration: 300, buffered: 91, ready: true });
    await expect(changing).resolves.toMatchObject({ success: false, superseded: true });
    expect(plugin.methods.getMediaSource).not.toHaveBeenCalled();
});

it("unready ordinary audio is not classified as an outgoing MV (plan A2)", () => {
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready: false }));
    player.setCurrentMusic(song);
    const transition = player.beginMpvManualSkipTransition({ ...song, id: "B" }, song, "test-next");
    expect(transition.previousWasVideo).toBe(false);
});

it("rolls back unready ordinary audio without reading an unready clock", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready: false }));
    mockBackend.active = { track: song, index: 0 };
    mockBackend.getProgress = jest.fn(async () => ({ position: 0, duration: 300, buffered: 0, ready: false }));
    mockBackend.restoreActiveTrack = jest.fn(async () => true);
    mockBackend.seekTo = jest.fn(async () => undefined);
    player.setCurrentMusic(song);
    const transition = player.beginMpvManualSkipTransition(next, song, "test-next");
    transition.previousProgress = { position: 37, duration: 300, buffered: 37 };
    player.setCurrentMusic(next);
    const setSource = jest.spyOn(player, "setTrackSource").mockResolvedValue(undefined);
    await expect(player.rollbackMpvManualSkipTransition(transition, "test-failure")).resolves.toBe(true);
    expect(transition.previousWasVideo).toBe(false);
    expect(mockBackend.getProgress).not.toHaveBeenCalled();
    expect(mockBackend.restoreActiveTrack).toHaveBeenCalledTimes(1);
    expect(mockBackend.seekTo).toHaveBeenCalledWith(37);
    expect(setSource).not.toHaveBeenCalled();
});

it("discards a rollback progress sample that becomes unready", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    mockBackend.active = { track: song, index: 0 };
    mockBackend.getProgress = jest.fn(async () => ({ position: 0, duration: 300, buffered: 0, ready: false }));
    mockBackend.restoreActiveTrack = jest.fn(async () => true);
    mockBackend.seekTo = jest.fn(async () => undefined);
    player.setCurrentMusic(song);
    const transition = player.beginMpvManualSkipTransition(next, song, "test-next");
    transition.previousProgress = { position: 37, duration: 300, buffered: 37 };
    player.setCurrentMusic(next);
    await expect(player.rollbackMpvManualSkipTransition(transition, "test-failure")).resolves.toBe(true);
    expect(mockBackend.getProgress).toHaveBeenCalledTimes(1);
    expect(mockBackend.seekTo).toHaveBeenCalledWith(37);
});

it("discards rollback progress if the native audio owner changes during the read", async () => {
    const next = { ...song, id: "B" };
    let release!: (value: any) => void;
    player.cancelMpvManualSkipTransition("test-start");
    mockBackend.active = { track: song, index: 0 };
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    mockBackend.restoreActiveTrack = jest.fn(async () => true);
    mockBackend.seekTo = jest.fn(async () => undefined);
    player.setCurrentMusic(song);
    const transition = player.beginMpvManualSkipTransition(next, song, "test-next");
    transition.previousProgress = { position: 37, duration: 300, buffered: 37 };
    player.setCurrentMusic(next);
    const rollback = player.rollbackMpvManualSkipTransition(transition, "test-failure");
    await tick();
    owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
    release({ position: 91, duration: 300, buffered: 91, ready: true });
    await expect(rollback).resolves.toBe(true);
    expect(mockBackend.seekTo).toHaveBeenCalledWith(37);
});

it("still classifies a returning MV as video when its native owner is audio", () => {
    player.cancelMpvManualSkipTransition("test-start");
    player.initializeMusicVideo();
    player.musicVideo.block(true);
    player.musicVideo.publish({ phase: "returning", songKey: getMediaUniqueKey(song),
        owner, video: { id: "clip", title: "Video", artist: "Artist", providerName: "test" }, canReturn: true });
    expect(player.musicVideo.snapshot.phase).toBe("returning");
    const transition = player.beginMpvManualSkipTransition({ ...song, id: "B" }, song, "test-next");
    expect(transition.previousWasVideo).toBe(true);
});

it("persists owned audio on exit even if the same song is confirmed during the read", async () => {
    let release!: (progress: any) => void;
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    jest.spyOn(player, "disposeServiceListeners").mockImplementation(() => undefined);
    jest.spyOn(player.crossfade, "dispose").mockImplementation(() => undefined);
    player.isForceExiting = false;
    jest.mocked(PersistStatus.set).mockClear();
    try {
        const exiting = player.prepareForAppExit();
        player.publishAudioTimeline();
        release({ position: 37, duration: 300, buffered: 37, ready: true });
        await exiting;
        expect(PersistStatus.set).toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "A" }));
        expect(PersistStatus.set).toHaveBeenCalledWith("music.progress", 37);
    } finally {
        player.isForceExiting = false;
    }
});

it("does not read or persist an unready audio clock during exit", async () => {
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready: false }));
    jest.spyOn(player, "disposeServiceListeners").mockImplementation(() => undefined);
    jest.spyOn(player.crossfade, "dispose").mockImplementation(() => undefined);
    player.isForceExiting = false;
    jest.mocked(PersistStatus.set).mockClear();
    try {
        await player.prepareForAppExit();
        expect(mockBackend.getProgress).not.toHaveBeenCalled();
        expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", expect.anything());
    } finally {
        player.isForceExiting = false;
    }
});

it("cleans up without applying a native exit sample reported as unready", async () => {
    mockBackend.getProgress = jest.fn(async () => ({ position: 91, duration: 300, buffered: 91, ready: false }));
    const dispose = jest.spyOn(player, "disposeServiceListeners").mockImplementation(() => undefined);
    jest.spyOn(player.crossfade, "dispose").mockImplementation(() => undefined);
    player.isForceExiting = false;
    const before = player.getProgressSnapshot();
    jest.mocked(PersistStatus.set).mockClear();
    try {
        await player.prepareForAppExit();
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", 91);
        expect(player.getProgressSnapshot()).toEqual(before);
    } finally {
        player.isForceExiting = false;
    }
});

it("does not pair the old song with another song's progress when exit races a song change", async () => {
    let release!: (progress: any) => void;
    mockBackend.getProgress = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    jest.spyOn(player, "disposeServiceListeners").mockImplementation(() => undefined);
    jest.spyOn(player.crossfade, "dispose").mockImplementation(() => undefined);
    player.isForceExiting = false;
    try {
        const exiting = player.prepareForAppExit();
        const next = { ...song, id: "B" };
        player.setCurrentMusic(next);
        owner = { kind: "audio", mediaId: getMediaUniqueKey(next), loadGeneration: 2 };
        const snapshotBeforeLateRead = player.getProgressSnapshot();
        jest.mocked(PersistStatus.set).mockClear();
        release({ position: 91, duration: 300, buffered: 91, ready: true });
        await exiting;
        expect(PersistStatus.set).not.toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "A" }));
        expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", 91);
        expect(player.getProgressSnapshot()).toEqual(snapshotBeforeLateRead);
    } finally {
        player.isForceExiting = false;
    }
});

it("records a newly selected ordinary song with a zero checkpoint before its source loads", () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    jest.mocked(PersistStatus.set).mockClear();
    player.setCurrentMusic(next);
    const calls = jest.mocked(PersistStatus.set).mock.calls;
    const zeroIndex = calls.findIndex(([key, value]) => key === "music.progress" && value === 0);
    const songIndex = calls.findIndex(([key, value]) => key === "music.musicItem" && (value as any)?.id === "B");
    expect(zeroIndex).toBeGreaterThanOrEqual(0);
    expect(songIndex).toBeGreaterThan(zeroIndex);
});

it("restores the original checkpoint if an unready ordinary song change fails", async () => {
    const next = { ...song, id: "B" };
    player.cancelMpvManualSkipTransition("test-start");
    mockBackend.active = { track: song, index: 0 };
    mockBackend.getActiveRendition = jest.fn(() => ({ ...owner, ready: false }));
    mockBackend.restoreActiveTrack = jest.fn(async () => true);
    mockBackend.seekTo = jest.fn(async () => undefined);
    player.setCurrentMusic(song);
    const transition = player.beginMpvManualSkipTransition(next, song, "test-next");
    transition.previousProgress = { position: 37, duration: 300, buffered: 37 };
    player.setCurrentMusic(next);
    jest.mocked(PersistStatus.set).mockClear();
    await player.rollbackMpvManualSkipTransition(transition, "test-failure");
    expect(PersistStatus.set).toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "A" }));
    expect(PersistStatus.set).toHaveBeenCalledWith("music.progress", 37);
});

it("keeps the saved checkpoint when restoring the same song at startup", () => {
    player.cancelMpvManualSkipTransition("test-start");
    player.setCurrentMusic({ ...song, id: "B" });
    jest.mocked(PersistStatus.get).mockReturnValueOnce(song);
    jest.mocked(PersistStatus.set).mockClear();
    player.setCurrentMusic(song);
    expect(PersistStatus.set).toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "A" }));
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", 0);
});

it("preserves the audio checkpoint when leaving a returning MV for another song", () => {
    player.cancelMpvManualSkipTransition("test-start");
    player.initializeMusicVideo();
    player.musicVideo.block(true);
    player.musicVideo.publish({ phase: "returning", songKey: getMediaUniqueKey(song),
        owner, video: { id: "clip", title: "Video", artist: "Artist", providerName: "test" }, canReturn: true });
    const next = { ...song, id: "B" };
    player.beginMpvManualSkipTransition(next, song, "test-next");
    jest.mocked(PersistStatus.set).mockClear();
    player.setCurrentMusic(next);
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.musicItem", expect.objectContaining({ id: "B" }));
    expect(PersistStatus.set).not.toHaveBeenCalledWith("music.progress", 0);
});
