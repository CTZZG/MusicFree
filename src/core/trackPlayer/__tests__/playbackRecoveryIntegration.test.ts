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


const trackPlayer = require("@/core/trackPlayer").default;
const player = trackPlayer as any;
const { playbackRecovery } = require("../playbackRecovery");
const songs = ["1", "2"].map(id => ({ id, platform: "test", title: `Song ${id}`, artist: "Artist", album: "Album", artwork: "", duration: 180 }));
let getMediaSource: jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    playbackRecovery.begin();
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
});

it("publishes the exact failed song and stops requesting qualities after credential rejection", async () => {
    getMediaSource.mockResolvedValue({ failure: { code: "access-denied" } });
    await trackPlayer.play(songs[1], true);
    expect(getMediaSource).toHaveBeenCalledTimes(1);
    expect(playbackRecovery.state.getValue()).toMatchObject({ musicItem: songs[1], failure: { code: "access-denied" } });
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
