/**
 * 复核 4b4b833b（P1）：MPV 手动切歌先暂停当前曲目，再向插件要下一首的地址。
 * 这一步直接 await 插件，插件的 Promise 一直不完成，这次切歌就一直挂着；
 * 切歌是串行的，后面再点下一首也只能排队，当前歌曲停在暂停。
 *
 * 用真实的 TrackPlayer 和假的 mpv 后端复现：插件永不回应，等满取源期限后，
 * 这次切歌要结束（交给 play() 兜底），后面排着的切歌要能接着走。换音质、
 * 地址过期后重取、备用来源这几个取源入口也一样要有期限。
 */
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
jest.mock("@/utils/delay", () => ({ __esModule: true, default: jest.fn(async () => undefined) }));
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
    default: { isOffline: false, isCellular: false },
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

const BackgroundTimer = require("react-native-background-timer").default;
const trackPlayer = require("@/core/trackPlayer").default;
const player = trackPlayer as any;

const songs = ["A", "B", "C", "D"].map(id => ({
    id,
    platform: "test",
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    artwork: "",
    duration: 200,
}));
const [songA] = songs;

function nativeIsPlaying(song: (typeof songs)[number]) {
    mockBackend.active = { track: song, index: songs.indexOf(song) };
}

/** 插件对每次取源都不回应；记下每次请求，测试可以事后再让它回来 */
const requests: Array<{
    id: string;
    quality: string;
    respond: (result: unknown) => void;
}> = [];
const plugin = {
    name: "test",
    methods: {
        getMediaSource: jest.fn(
            (item: { id: string }, quality: string) =>
                new Promise(resolve => {
                    requests.push({ id: item.id, quality, respond: resolve });
                }),
        ),
    },
};

const play = jest.fn(async (song: (typeof songs)[number]) => {
    nativeIsPlaying(song);
});

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    requests.length = 0;
    player.pluginManagerService = {
        getByName: () => plugin,
        getByMedia: () => plugin,
        isPluginEnabled: () => true,
        getEnabledPlugins: () => [],
    };
    player.configService = {
        // 不换来源：只看原插件不回应时会怎样
        getConfig: (key: string) =>
            key === "basic.tryChangeSourceWhenPlayFail" ? false : undefined,
        setConfig: jest.fn(),
    };
    player.lockBackend();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songA);
    nativeIsPlaying(songA);
    jest.spyOn(trackPlayer, "play").mockImplementation(play as any);
});

afterEach(() => {
    jest.restoreAllMocks();
    player.cancelMpvManualSkipTransition("test-cleanup");
    jest.useRealTimers();
});

it("does not let a plugin that never answers hold up the skips behind it", async () => {
    let settled = 0;
    const first = trackPlayer.skipToNext().then(() => (settled += 1));
    const second = trackPlayer.skipToNext().then(() => (settled += 1));

    await jest.advanceTimersByTimeAsync(0);
    // 当前曲目已经暂停，插件被问到 B 的地址
    expect(mockBackend.pause).toHaveBeenCalled();
    expect(requests.map(request => request.id)).toEqual(["B"]);

    await jest.advanceTimersByTimeAsync(15_000);
    // 等满期限：这次切歌结束，交给 play() 兜底；排在后面的那次接着去要 C
    expect(settled).toBe(1);
    expect(play.mock.calls.map(([song]) => song.id)).toEqual(["B"]);
    expect(requests.map(request => request.id)).toEqual(["B", "C"]);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(settled).toBe(2);
    await Promise.all([first, second]);
    expect(play.mock.calls.map(([song]) => song.id)).toEqual(["B", "C"]);
    expect(trackPlayer.currentMusic.id).toBe("C");
    expect(player.manualSkipGate.pendingCount).toBe(0);
    expect(player.mpvManualSkipTransition).toBeNull();
});

it("asks a plugin that did not answer only once per skip, not once per quality", async () => {
    const skip = trackPlayer.skipToNext();
    await jest.advanceTimersByTimeAsync(15_000);
    await skip;

    // 一个音质等了 15 秒没回应，其他音质多半也一样；一个个等下去就是一分钟
    expect(requests).toHaveLength(1);
});

it("ignores a source that arrives after the skip has moved on", async () => {
    const skip = trackPlayer.skipToNext();
    await jest.advanceTimersByTimeAsync(15_000);
    await skip;
    expect(trackPlayer.currentMusic.id).toBe("B");
    mockBackend.updateTrack.mockClear();

    // B 的地址终于回来了：切歌已经结束，不能再拿它改队列或当前歌曲
    requests[0].respond({ url: "https://late.example/b.mp3" });
    await jest.advanceTimersByTimeAsync(0);

    expect(mockBackend.updateTrack).not.toHaveBeenCalled();
    expect(trackPlayer.currentMusic.id).toBe("B");
});

it("times the wait with a timer that keeps running in the background", async () => {
    const setTimer = jest.spyOn(BackgroundTimer, "setTimeout");
    const skip = trackPlayer.skipToNext();
    await jest.advanceTimersByTimeAsync(0);

    // 通知栏、锁屏切歌时 App 在后台，RN 的普通定时器会停到回前台才触发
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 15_000);

    await jest.advanceTimersByTimeAsync(15_000);
    await skip;
});

// 上面几个用例把 play() 换成了成功的假实现，只覆盖预取超时和队列衔接；走真实
// play() 兜底的切歌（含不再重复等待同一个来源）见 manualSkipRepeatedWait.test.ts。

describe("other ways of asking a plugin for a source are bounded too", () => {
    it("changing the quality gives up instead of waiting forever", async () => {
        let result: any;
        trackPlayer.changeQualityWithResult("high").then((value: any) => {
            result = value;
        });

        await jest.advanceTimersByTimeAsync(15_000);

        expect(result).toMatchObject({
            success: false,
            failure: { code: "network-error" },
        });
    });

    it("refreshing an expired address falls back to the song's own address", async () => {
        // 地址校验依赖原生和网络，这里原样放行
        jest.spyOn(player, "createPlayableSource").mockImplementation(
            async (source: any) => source,
        );
        let result: any = "pending";
        player
            .resolveFreshMediaSource({ ...songs[1], url: "https://own.example/b.mp3" })
            .then((value: any) => {
                result = value;
            });

        await jest.advanceTimersByTimeAsync(15_000);

        expect(result).toMatchObject({ url: "https://own.example/b.mp3" });
        expect(requests).toHaveLength(1);
    });

    it("an alternate source that does not answer is skipped", async () => {
        let result: any = "pending";
        player
            .resolveSourceFromAlternate(songs[2], ["standard", "high", "low"], () => true)
            .then((value: any) => {
                result = value;
            });

        await jest.advanceTimersByTimeAsync(15_000);

        expect(result).toBeNull();
        expect(requests).toHaveLength(1);
    });
});
