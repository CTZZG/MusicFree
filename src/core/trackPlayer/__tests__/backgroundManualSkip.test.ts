/**
 * 通知栏、锁屏点「下一首」时 App 在后台。原来确认切歌的轮询用 RN 的普通定时器，
 * 后台停摆：切歌一直「未确认」，期间原生按自己的队列往下放了好几首；回到 App
 * 时轮询醒来，看到的不是目标曲目，就当作超时去重载目标或回滚，把歌拽回好几首
 * 之前。这里用真实的 TrackPlayer 和一个假的 mpv 后端复现这段时序。
 */
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

const delay = require("@/utils/delay").default as jest.Mock;
const trackPlayer = require("@/core/trackPlayer").default;
const player = trackPlayer as any;

const songs = ["A", "B", "C", "D", "E", "F"].map(id => ({
    id,
    platform: "test",
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    artwork: "",
    duration: 200,
}));
const [songA, songB, , , , songF] = songs;

function nativeIsPlaying(song: (typeof songs)[number]) {
    mockBackend.active = { track: song, index: songs.indexOf(song) };
}

let clock = 1_000_000;

beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks 不清实现；每个用例自己给出完整的 delay 行为
    delay.mockReset();
    clock = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    player.lockBackend();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songA);
    nativeIsPlaying(songA);
});

afterEach(() => {
    jest.restoreAllMocks();
    player.cancelMpvManualSkipTransition("test-cleanup");
});

it("keeps the skip confirmation running with a timer that works in the background", async () => {
    delay.mockImplementation(async (ms: number) => {
        clock += ms;
        nativeIsPlaying(songB);
    });
    const transition = player.beginMpvManualSkipTransition(songB, songA, "manual-next");

    expect(await player.confirmMpvManualSkip(songB, "manual-next", transition)).toBe(true);
    expect(trackPlayer.currentMusic.id).toBe("B");
    // 第二个参数为 false 时用的是 RN 的普通定时器，App 在后台就不走了
    expect(delay).toHaveBeenCalled();
    for (const call of delay.mock.calls) {
        expect(call[1]).not.toBe(false);
    }
});

it("adopts the song mpv is playing when the confirmation slept through the background", async () => {
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    // 第一次轮询还没轮到 B；这一觉 JS 被挂起两分钟，原生从 B 一路放到了 F。
    // 之后的等待照常计时
    let suspended = false;
    delay.mockImplementation(async (ms: number) => {
        if (!suspended) {
            suspended = true;
            clock += 120_000;
            nativeIsPlaying(songF);
            return;
        }
        clock += ms;
    });
    const transition = player.beginMpvManualSkipTransition(songB, songA, "manual-next");

    const confirmed = await player.confirmMpvManualSkip(songB, "manual-next", transition);
    // 调用方在未确认时会回滚；事务已经结束，回滚必须什么都不做
    const rolledBack = await player.rollbackMpvManualSkipTransition(
        transition,
        "manual-next-timeout",
    );

    expect(confirmed).toBe(false);
    expect(rolledBack).toBe(false);
    expect(trackPlayer.currentMusic.id).toBe("F");
    expect(play).not.toHaveBeenCalled();
    expect(mockBackend.restoreActiveTrack).not.toHaveBeenCalled();
    expect(player.mpvManualSkipTransition).toBeNull();
});

it("still reloads the target when mpv really did not switch in the foreground", async () => {
    // 前台：定时器正常走，mpv 一直停在 A，1.6 秒后显式重载目标
    delay.mockImplementation(async (ms: number) => {
        clock += ms;
    });
    const play = jest
        .spyOn(trackPlayer, "play")
        .mockImplementation(async () => nativeIsPlaying(songB));
    const transition = player.beginMpvManualSkipTransition(songB, songA, "manual-next");

    expect(await player.confirmMpvManualSkip(songB, "manual-next", transition)).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toMatchObject({ id: "B" });
    expect(trackPlayer.currentMusic.id).toBe("B");
});

it("does not bring back a cleared playlist's song when the confirmation wakes up late", async () => {
    // 确认的等待睡过了后台；这期间用户清空了播放队列：事务被取消、当前歌曲清空，
    // 原生的 stop 还没返回，适配器缓存的当前曲目仍是 F。旧的确认醒来时不能再按
    // 原生同步，把 F 写回来
    let completeNativeReset: () => void = () => {};
    const nativeReset = new Promise<void>(resolve => {
        completeNativeReset = () => {
            mockBackend.active = null;
            resolve();
        };
    });
    mockBackend.reset.mockImplementationOnce(() => nativeReset);
    let clearing: Promise<void> | undefined;
    delay.mockImplementation(async () => {
        clock += 120_000;
        nativeIsPlaying(songF);
        clearing ??= trackPlayer.clearPlayList();
    });
    const transition = player.beginMpvManualSkipTransition(songB, songA, "manual-next");
    try {
        expect(await player.confirmMpvManualSkip(songB, "manual-next", transition)).toBe(false);
    } finally {
        completeNativeReset();
        await clearing;
    }
    expect(trackPlayer.playList).toEqual([]);
    expect(trackPlayer.currentMusic).toBeNull();
});

it("leaves a newer skip alone when the old confirmation wakes up late", async () => {
    // 等待期间又点了一次下一首（新的事务指向 C）；旧的确认醒来时既不能结束新事务，
    // 也不能按原生同步当前歌曲
    const play = jest.spyOn(trackPlayer, "play").mockResolvedValue(undefined);
    let newer: any;
    delay.mockImplementation(async () => {
        clock += 120_000;
        nativeIsPlaying(songF);
        newer ??= player.beginMpvManualSkipTransition(songs[2], songB, "manual-next");
    });
    const transition = player.beginMpvManualSkipTransition(songB, songA, "manual-next");

    expect(await player.confirmMpvManualSkip(songB, "manual-next", transition)).toBe(false);
    expect(player.mpvManualSkipTransition).toBe(newer);
    expect(player.isMpvManualSkipTransitionActive(newer)).toBe(true);
    expect(trackPlayer.currentMusic.id).toBe("A");
    expect(play).not.toHaveBeenCalled();
});

it("does not sync from mpv after a late confirmation that owns no transition", async () => {
    // 没有事务时，原生的切歌事件本来就照常同步；醒来晚了也不该再按原生写当前歌曲
    // （这期间队列可能已经清空）
    player.setPlayList([], false);
    player.setCurrentMusic(null);
    delay.mockImplementation(async () => {
        clock += 120_000;
        nativeIsPlaying(songF);
    });

    expect(await player.confirmMpvManualSkip(songB, "manual-next", null)).toBe(false);
    expect(trackPlayer.currentMusic).toBeNull();
});
