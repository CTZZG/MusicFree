/**
 * 跟进 3730d4c4：MPV 手动切歌先预取目标的地址，取不到再交给 play() 兜底。插件
 * 一直不回应时，预取等满 15 秒，play() 不知道这一点，又向同一个来源要一次、再等
 * 15 秒，一次失败的切歌要等两轮。
 *
 * 这次切歌里已经超时的来源记在切歌事务上，兜底不再重问；歌曲自带的地址、其他
 * 来源照常试，下一次切歌（用户主动重试）重新问。用真实的 play() 和假的 mpv 后端。
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
const [songA, songB] = songs;

function nativeIsPlaying(id: string) {
    const index = songs.findIndex(song => song.id === id);
    mockBackend.active = { track: songs[index], index };
}

/** 原来源：默认对每次取源都不回应，requests 记下每次请求 */
const requests: Array<{ id: string; quality: string }> = [];
let answer: (item: { id: string }) => Promise<unknown> = () =>
    new Promise(() => undefined);
const original = {
    name: "test",
    methods: {
        getMediaSource: jest.fn((item: { id: string }, quality: string) => {
            requests.push({ id: item.id, quality });
            return answer(item);
        }),
    },
};
/** 另一个来源：能搜到同一首歌，也能给出地址 */
const other = {
    name: "other",
    methods: {
        search: jest.fn(async (keyword: string) => ({
            data: songs
                .filter(song => keyword.includes(song.title))
                .map(song => ({ ...song, id: `${song.id}-other`, platform: "other" })),
        })),
        getMediaSource: jest.fn(async (item: { id: string }) => ({
            url: `https://other.example/${item.id}.mp3`,
        })),
    },
};
let changeSourceOnFailure = false;

const settledAfter = (promise: Promise<unknown>) => {
    const state = { settled: false, error: undefined as unknown };
    promise.then(
        () => {
            state.settled = true;
        },
        error => {
            state.error = error;
        },
    );
    return state;
};

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    requests.length = 0;
    answer = () => new Promise(() => undefined);
    changeSourceOnFailure = false;
    player.pluginManagerService = {
        getByName: (name: string) => (name === "other" ? other : original),
        getByMedia: (item: { platform: string }) =>
            item.platform === "other" ? other : original,
        isPluginEnabled: () => true,
        getEnabledPlugins: () => [original, other],
        getSortedSearchablePlugins: () => [original, other],
    };
    player.configService = {
        getConfig: (key: string) =>
            key === "basic.tryChangeSourceWhenPlayFail"
                ? changeSourceOnFailure
                : undefined,
        setConfig: jest.fn(),
    };
    // 地址校验依赖原生和网络，这里原样放行；装载地址就当原生开始放这首
    jest.spyOn(player, "createPlayableSource").mockImplementation(
        async (source: any) => source,
    );
    jest.spyOn(player, "setTrackSource").mockImplementation(
        async (track: any) => nativeIsPlaying(track.id),
    );
    player.lockBackend();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songA);
    nativeIsPlaying("A");
});

afterEach(async () => {
    // 切歌队列是共享的：没走完的切歌放完，免得排在下一个用例前面
    player.manualSkipGate.cancelPending();
    player.cancelMpvManualSkipTransition("test-cleanup");
    await jest.advanceTimersByTimeAsync(60_000);
    jest.restoreAllMocks();
    jest.useRealTimers();
});

it("waits for a source that does not answer only once per skip", async () => {
    const skip = settledAfter(trackPlayer.skipToNext());

    await jest.advanceTimersByTimeAsync(14_999);
    expect(skip.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    // 一轮期限就结束：回到原来那首，切歌队列放开，没再向同一个来源要第二次
    expect(skip.settled).toBe(true);
    expect(requests.map(request => request.id)).toEqual(["B"]);
    expect(trackPlayer.currentMusic.id).toBe("A");
    expect(player.manualSkipGate.pendingCount).toBe(0);
    expect(player.mpvManualSkipTransition).toBeNull();
    expect(player.setTrackSource).not.toHaveBeenCalled();
});

it("still switches to another source after the original one timed out", async () => {
    changeSourceOnFailure = true;
    const skip = settledAfter(trackPlayer.skipToNext());

    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(skip.settled).toBe(true);
    expect(requests.map(request => request.id)).toEqual(["B"]);
    expect(other.methods.getMediaSource).toHaveBeenCalledTimes(1);
    expect(player.setTrackSource.mock.calls[0][0]).toMatchObject({
        id: "B",
        url: "https://other.example/B-other.mp3",
    });
    expect(trackPlayer.currentMusic.id).toBe("B");
    expect(player.mpvManualSkipTransition).toBeNull();
});

it("asks the source again on the next skip", async () => {
    const first = settledAfter(trackPlayer.skipToNext());
    await jest.advanceTimersByTimeAsync(15_000);
    expect(first.settled).toBe(true);

    // 用户再点一次下一首：新的一次切歌，重新问
    const second = settledAfter(trackPlayer.skipToNext());
    await jest.advanceTimersByTimeAsync(15_000);

    expect(second.settled).toBe(true);
    expect(requests.map(request => request.id)).toEqual(["B", "B"]);
});

it("still asks again when the source failed for another reason", async () => {
    // 没给地址不是超时：照旧在兜底时再问一遍（可能是临时的，换个音质也许有）
    answer = async () => ({ url: "" });
    const skip = settledAfter(trackPlayer.skipToNext());

    await jest.advanceTimersByTimeAsync(5_000);

    expect(skip.settled).toBe(true);
    const perQuality = new Map<string, number>();
    for (const request of requests) {
        expect(request.id).toBe("B");
        perQuality.set(request.quality, (perQuality.get(request.quality) ?? 0) + 1);
    }
    expect(perQuality.size).toBeGreaterThan(0);
    expect([...perQuality.values()].every(count => count === 2)).toBe(true);
});

it("uses the same rule when skipping to the previous song", async () => {
    player.setCurrentMusic(songB);
    nativeIsPlaying("B");
    const skip = settledAfter(trackPlayer.skipToPrevious());

    await jest.advanceTimersByTimeAsync(14_999);
    expect(skip.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(skip.settled).toBe(true);
    expect(requests.map(request => request.id)).toEqual(["A"]);
    expect(trackPlayer.currentMusic.id).toBe("B");
});

it("ends quietly when the queue is cleared while waiting", async () => {
    const skip = settledAfter(trackPlayer.skipToNext());
    await jest.advanceTimersByTimeAsync(5_000);

    await trackPlayer.clearPlayList();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(skip.settled).toBe(true);
    expect(requests.map(request => request.id)).toEqual(["B"]);
    expect(trackPlayer.playList).toEqual([]);
    expect(trackPlayer.currentMusic).toBeNull();
    expect(player.setTrackSource).not.toHaveBeenCalled();
});

it("lets a song picked while waiting win over the late skip", async () => {
    // B 不回应，D 能马上取到
    answer = async item =>
        item.id === "D"
            ? { url: "https://test.example/D.mp3" }
            : new Promise(() => undefined);
    const skip = settledAfter(trackPlayer.skipToNext());
    await jest.advanceTimersByTimeAsync(5_000);

    const picked = settledAfter(trackPlayer.play(songs[3], true));
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(picked.settled).toBe(true);
    expect(skip.settled).toBe(true);
    expect(trackPlayer.currentMusic.id).toBe("D");
    expect(requests.filter(request => request.id === "B")).toHaveLength(1);
    expect(player.setTrackSource).toHaveBeenCalledTimes(1);
    expect(player.setTrackSource.mock.calls[0][0]).toMatchObject({ id: "D" });
});

// 复核 49dfa12e（P2，旧问题）：切歌先暂停正在放的歌、等目标的地址。等待期间用户
// 暂停（应用里的暂停、睡眠定时、musicfree://pause），之后不管是超时回滚还是新歌
// 装好，都要保持暂停；以前回滚照样自动接着放，盖掉了用户的暂停
describe("a pause while the skip is waiting", () => {
    let calls: string[];

    beforeEach(() => {
        calls = [];
        let state = "playing";
        mockBackend.getState.mockImplementation(async () => state);
        mockBackend.pause = jest.fn(async () => {
            calls.push("pause");
            state = "paused";
        });
        mockBackend.play = jest.fn(async () => {
            calls.push("play");
            state = "playing";
        });
        mockBackend.restoreActiveTrack = jest.fn(
            async (options: { autoPlay?: boolean }) => {
                calls.push(`restore(autoPlay=${options?.autoPlay})`);
                state = options?.autoPlay ? "playing" : "paused";
                return true;
            },
        );
        mockBackend.skipToIndex = jest.fn(async (index: number) => {
            calls.push(`skipTo(${songs[index].id})`);
            nativeIsPlaying(songs[index].id);
            state = "playing";
            return true;
        });
    });

    afterEach(() => {
        mockBackend.getState.mockImplementation(async () => "playing");
        delete mockBackend.pause;
        delete mockBackend.play;
        delete mockBackend.skipToIndex;
        mockBackend.restoreActiveTrack = jest.fn(async () => true);
    });

    it("keeps the old song paused when the source never answers", async () => {
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(5_000);
        calls.length = 0;

        await trackPlayer.pause();
        await jest.advanceTimersByTimeAsync(10_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("A");
        expect(calls).not.toContain("play");
        expect(calls).not.toContain("restore(autoPlay=true)");
        expect(await mockBackend.getState()).toBe("paused");
    });

    it("loads another source without playing it when the fallback finds one", async () => {
        changeSourceOnFailure = true;
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(5_000);

        await trackPlayer.pause();
        await jest.advanceTimersByTimeAsync(10_000);
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(player.setTrackSource).toHaveBeenCalledTimes(1);
        const [track, autoPlay] = player.setTrackSource.mock.calls[0];
        expect(track).toMatchObject({ url: "https://other.example/B-other.mp3" });
        expect(autoPlay).toBe(false);
    });

    it("keeps the new song paused when its source arrives after the pause", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);

        await trackPlayer.pause();
        calls.length = 0;
        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        expect(calls).toContain("skipTo(B)");
        expect(calls[calls.length - 1]).toBe("pause");
        expect(await mockBackend.getState()).toBe("paused");
    });
});
