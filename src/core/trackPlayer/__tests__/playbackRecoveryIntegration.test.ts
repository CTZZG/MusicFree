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
        restoreActiveTrack: jest.fn(async () => true),
    } as Record<string, any>,
    {
        // 其余方法（同步队列、预备下一首……）一律当作成功
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
jest.mock("@/utils/delay", () => ({ __esModule: true, default: jest.fn() }));
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
// 原生模块、持久化和插件相关的依赖与这段时序无关
jest.mock("@/utils/mediaExtra", () => ({ getMediaExtraProperty: () => undefined }));
jest.mock("@/utils/log", () => mockAutoStub());
jest.mock("react-native-fs", () => mockAutoStub());
jest.mock("@/utils/getOrCreateMMKV", () => mockAutoStub());
jest.mock("@/utils/network", () => mockAutoStub());
jest.mock("@/utils/persistStatus", () => mockAutoStub());
jest.mock("@/core/localMusicSheet", () => mockAutoStub());
jest.mock("@/core/dislikeMusic", () => mockAutoStub());
jest.mock("@/core/mediaCache", () => mockAutoStub());
jest.mock("@/core/localMusicArtworkManager", () => mockAutoStub());
jest.mock("@/constants/assetsConst", () => mockAutoStub());
jest.mock("@/native/utils", () => mockAutoStub());
jest.mock("@/service/encryptedMediaProxy", () => mockAutoStub());
jest.mock("@/core/lastfm", () => mockAutoStub());
jest.mock("@/utils/androidMediaPermission", () => mockAutoStub());
jest.mock("@/utils/userAgentHelper", () => mockAutoStub());
const mockRecordPlayAttempt = jest.fn();
jest.mock("../playAttemptLog", () => ({
    recordPlayAttempt: (...args: unknown[]) => mockRecordPlayAttempt(...args),
}));


const trackPlayer = require("@/core/trackPlayer").default;
const player = trackPlayer as any;
const { playbackRecovery } = require("../playbackRecovery");
const songs = ["1", "2"].map(id => ({ id, platform: "test", title: `Song ${id}`, artist: "Artist", album: "Album", artwork: "", duration: 180 }));
let getMediaSource: jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    playbackRecovery.begin();
    player.playedAttemptRun = null;
    mockBackend.name = "mpv";
    mockBackend.active = { track: songs[0], index: 0 };
    jest.spyOn(player, "syncPreparedNextTrack").mockImplementation(() => undefined);
    player.lockBackend();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songs[0]);
    player.configService = { getConfig: (key: string) => ({
        "basic.defaultPlayQuality": "flac",
        "basic.useCelluarNetworkPlay": true,
        "basic.playQualityOrder": "desc",
    } as Record<string, unknown>)[key] };
    getMediaSource = jest.fn();
    player.pluginManagerService = { getByName: () => ({ name: "test", methods: { getMediaSource } }) };
    jest.spyOn(player, "createPlayableSource").mockImplementation(async (candidate: any, _: unknown, quality: unknown) => ({ ...candidate, quality }));
    jest.spyOn(player, "setTrackSource").mockImplementation(async (track: any) => {
        mockBackend.active = { track, index: songs.findIndex(song => song.id === track.id) };
    });
    jest.spyOn(player, "updateSupplementalMusicInfo").mockResolvedValue(undefined);
});
afterEach(() => {
    player.cancelMpvManualSkipTransition("test-cleanup");
    jest.restoreAllMocks();
    require("@/utils/delay").default.mockReset();
});

it("publishes the exact failed song and stops requesting qualities after credential rejection", async () => {
    getMediaSource.mockResolvedValue({ failure: { code: "access-denied" } });
    await trackPlayer.play(songs[1], true);
    expect(getMediaSource).toHaveBeenCalledTimes(1);
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "access-denied" } });
    // 用户看到的失败记进播放统计
    expect(mockRecordPlayAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordPlayAttempt).toHaveBeenCalledWith(expect.objectContaining({
        platform: "test",
        outcome: "failed",
        code: "access-denied",
    }));
});

it("falls back when a quality is unavailable and stores the resolved quality", async () => {
    getMediaSource.mockImplementation(async (_: unknown, quality: string) => quality === "flac" ? null : ({ url: "https://example.com/song.mp3" }));
    await trackPlayer.play(songs[1], true);
    expect(getMediaSource).toHaveBeenCalledTimes(2);
    expect(trackPlayer.quality).toBe(getMediaSource.mock.calls[1][1]);
    expect(playbackRecovery.state.getValue()).toBeNull();
});

it("a selected quality retry does not change the default quality or start other quality attempts", async () => {
    getMediaSource.mockResolvedValue(null);
    await trackPlayer.retryPlayback(songs[1], "128k");
    expect(getMediaSource).toHaveBeenCalledTimes(1);
    expect(getMediaSource).toHaveBeenCalledWith(songs[1], "128k");
    expect(player.configService.getConfig("basic.defaultPlayQuality")).toBe("flac");
});

it("does not publish a late failure from an earlier play request", async () => {
    let fail: (value: null) => void = () => {};
    let started: () => void = () => {};
    const firstRequested = new Promise<void>(resolve => {
        started = resolve;
    });
    getMediaSource.mockImplementationOnce(() => new Promise(resolve => {
        fail = resolve;
        started();
    }));
    const oldPlay = trackPlayer.retryPlayback(songs[0], "128k");
    await firstRequested;
    getMediaSource.mockResolvedValue({ url: "https://example.com/new.mp3" });
    await trackPlayer.play(songs[1], true);
    fail(null);
    await oldPlay;
    expect(playbackRecovery.state.getValue()).toBeNull();
});

it("does not record the attempted quality when loading the source fails", async () => {
    const previousQuality = trackPlayer.quality;
    getMediaSource.mockResolvedValue({ url: "https://example.com/song.mp3", quality: "hires" });
    player.setTrackSource.mockRejectedValueOnce(new Error("native load failed"));
    await trackPlayer.retryPlayback(songs[1], "hires");
    expect(trackPlayer.quality).toBe(previousQuality);
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "backend-error" } });
});

it("preserves recovery for a failed same-target request when a duplicate joins", async () => {
    let fail: (value: null) => void = () => {};
    let started: () => void = () => {};
    const firstRequested = new Promise<void>(resolve => {
        started = resolve;
    });
    getMediaSource.mockImplementationOnce(() => new Promise(resolve => {
        fail = resolve; started();
    }));
    const original = trackPlayer.retryPlayback(songs[1], "128k");
    await firstRequested;
    const duplicate = trackPlayer.retryPlayback(songs[1], "128k");
    fail(null);
    await Promise.all([original, duplicate]);
    expect(getMediaSource).toHaveBeenCalledTimes(1);
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "unavailable" } });
});


it("reports native loading failure when restarting a stopped current track", async () => {
    mockBackend.active = { track: { ...songs[0], url: "https://example.com/old.mp3" }, index: 0 };
    mockBackend.getState.mockResolvedValueOnce("stopped");
    player.setTrackSource.mockRejectedValueOnce(new Error("native load failed"));
    await trackPlayer.play(songs[0]);
    expect(player.setTrackSource).toHaveBeenCalledTimes(1);
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[0], failure: { code: "backend-error" } });
});

/** 再装一个能搜到同一首歌的来源 "other" */
function addOtherSource(results: unknown[], otherGetMediaSource: jest.Mock) {
    // 其他地方的短等待照常立即返回；找其他来源的 8 秒期限在测试里不到期
    require("@/utils/delay").default.mockImplementation(async (ms: number) => {
        if (ms >= 8000) {
            await new Promise(() => undefined);
        }
    });
    const other = {
        name: "other",
        methods: {
            search: jest.fn(async () => ({ isEnd: true, data: results })),
            getMediaSource: otherGetMediaSource,
        },
    };
    player.pluginManagerService.getSortedSearchablePlugins = () => [
        { name: "test", methods: { search: jest.fn(async () => ({ data: [] })) } },
        other,
    ];
    player.pluginManagerService.getByMedia = (item: { platform: string }) =>
        item.platform === "other" ? other : undefined;
    player.pluginManagerService.isPluginEnabled = () => true;
    return other;
}

it("stops fallback-provider quality attempts after explicit credential rejection", async () => {
    getMediaSource.mockResolvedValue(null);
    const fallbackSource = jest.fn(async () => ({ failure: { code: "access-denied" } }));
    addOtherSource([{ ...songs[1], id: "o2", platform: "other" }], fallbackSource);
    await trackPlayer.play(songs[1], true);
    expect(fallbackSource).toHaveBeenCalledTimes(1);
});

it("plays the same recording from another source and remembers it", async () => {
    const PersistStatus = require("@/utils/persistStatus").default;
    getMediaSource.mockResolvedValue({ failure: { code: "unavailable" } });
    const otherSource = jest.fn(async () => ({ url: "https://other.example.com/2.mp3" }));
    const other = addOtherSource([
        { ...songs[1], id: "live", platform: "other", title: "Song 2 (Live)" },
        { ...songs[1], id: "o2", platform: "other", duration: 181 },
    ], otherSource);

    await trackPlayer.play(songs[1], true);

    expect(other.methods.search).toHaveBeenCalledWith("Song 2 Artist", 1, "music");
    expect(otherSource).toHaveBeenCalledWith(expect.objectContaining({ id: "o2" }), "flac");
    // 队列里还是原来那首歌，只是地址来自另一个来源
    expect(mockBackend.active.track).toMatchObject({ id: "2", platform: "test", url: "https://other.example.com/2.mp3" });
    expect(playbackRecovery.state.getValue()).toBeNull();
    expect(PersistStatus.set).toHaveBeenCalledWith(
        "music.alternateSources",
        { "test@2": expect.objectContaining({ item: expect.objectContaining({ id: "o2", platform: "other" }) }) },
    );

    // 真的放出来 2 秒才记一次，记为换源播放；暂停后继续、再来进度都不重复记
    player.notePlayedAttempt(1, "playing");
    player.notePlayedAttempt(3, "paused");
    expect(mockRecordPlayAttempt).not.toHaveBeenCalled();
    player.notePlayedAttempt(3, "playing");
    player.notePlayedAttempt(9, "playing");
    expect(mockRecordPlayAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordPlayAttempt).toHaveBeenCalledWith(expect.objectContaining({
        platform: "test",
        outcome: "alternate",
        via: "other",
    }));
});

it("never plays a different version from another source", async () => {
    getMediaSource.mockResolvedValue({ failure: { code: "unavailable" } });
    const otherSource = jest.fn(async () => ({ url: "https://other.example.com/live.mp3" }));
    addOtherSource([{ ...songs[1], id: "live", platform: "other", title: "Song 2 (Live)" }], otherSource);

    await trackPlayer.play(songs[1], true);

    expect(otherSource).not.toHaveBeenCalled();
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "unavailable" } });
});

it("records each listen from the start once: pausing or seeking ahead is the same listen, a replay is a new one", async () => {
    getMediaSource.mockResolvedValue({ url: "https://example.com/2.mp3" });
    await trackPlayer.play(songs[1], true);
    player.notePlayedAttempt(2.5, "playing");
    player.notePlayedAttempt(30, "paused");
    player.notePlayedAttempt(31, "playing");
    player.notePlayedAttempt(120, "playing");
    expect(mockRecordPlayAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordPlayAttempt).toHaveBeenCalledWith(expect.objectContaining({
        platform: "test",
        outcome: "played",
    }));

    // 重播、单曲循环：进度回到开头，放够 2 秒再记一次
    player.notePlayedAttempt(0.4, "playing");
    player.notePlayedAttempt(1.5, "playing");
    expect(mockRecordPlayAttempt).toHaveBeenCalledTimes(1);
    player.notePlayedAttempt(2.4, "playing");
    expect(mockRecordPlayAttempt).toHaveBeenCalledTimes(2);
});

it("does not look for other sources when switching is turned off", async () => {
    player.configService = { getConfig: (key: string) => ({
        "basic.defaultPlayQuality": "flac",
        "basic.useCelluarNetworkPlay": true,
        "basic.playQualityOrder": "desc",
        "basic.tryChangeSourceWhenPlayFail": false,
    } as Record<string, unknown>)[key] };
    getMediaSource.mockResolvedValue({ failure: { code: "unavailable" } });
    const other = addOtherSource([{ ...songs[1], id: "o2", platform: "other" }], jest.fn());

    await trackPlayer.play(songs[1], true);

    expect(other.methods.search).not.toHaveBeenCalled();
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "unavailable" } });
});


it.each(["resolveDirectMediaSource", "resolveFreshMediaSource"])("%s stops requesting provider after credential rejection", async method => {
    getMediaSource.mockResolvedValue({ failure: { code: "access-denied" } });
    await player[method](songs[1]);
    expect(getMediaSource).toHaveBeenCalledTimes(1);
});


it("native recovery does not publish quality before replacement source loads", async () => {
    const renderer = require("react-test-renderer");
    const React = require("react");
    let observedQuality: unknown;
    function QualityProbe() {
        observedQuality = require("@/core/trackPlayer").useMusicQuality(); return null;
    }
    player.sourceRecoveryAttemptedAt.clear();
    player.sourceRecoveryInFlight.clear();
    const originalTrack = { ...songs[0], url: "https://example.com/original.mp3", playbackSource: { quality: "128k", origin: "plugin" } };
    player.setCurrentMusic(originalTrack);
    player.setQuality("128k");
    mockBackend.active = { track: originalTrack, index: 0 };
    jest.spyOn(player, "resolveFreshMediaSource").mockResolvedValue({ url: "https://example.com/replacement.flac", quality: "hires", playbackSource: { quality: "hires", origin: "recovery" } });
    player.setTrackSource.mockRejectedValueOnce(new Error("native load failed"));
    let tree: any;
    renderer.act(() => {
        tree = renderer.create(React.createElement(QualityProbe));
    });
    let recovered = true;
    await renderer.act(async () => {
        recovered = await player.recoverCurrentSourceAfterPlaybackError({ message: "Source error" }, originalTrack);
    });
    renderer.act(() => tree.unmount());
    expect(recovered).toBe(false);
    expect(mockBackend.active.track.playbackSource.quality).toBe("128k");
    expect(observedQuality).toBe("128k");
});
