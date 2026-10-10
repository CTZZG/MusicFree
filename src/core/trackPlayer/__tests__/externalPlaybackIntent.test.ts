/**
 * 外部播放／暂停统一入口：通知栏、锁屏、耳机、蓝牙的暂停和拔耳机是用户主动暂停，
 * 来电、短视频临时占用音频焦点是系统打断，切歌等新歌地址时先停下当前这首是内部
 * 暂停。以前外部暂停由适配器直接停，TrackPlayer 不知道：切歌取源超时回滚、新歌
 * 装载完成、自动播放补偿都会把它放出来；系统打断按原生当时的状态决定要不要恢复，
 * 切歌等待中的打断结束后不恢复，打断期间装好的新歌还会抢回声音。
 *
 * 用真实的 play()、切歌事务和装载，假的 mpv 后端记下每次调用。原生的拦截见
 * android 的 PlaybackHoldTest。
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
const [songA] = songs;

function nativeIsPlaying(id: string) {
    const index = songs.findIndex(song => song.id === id);
    mockBackend.active = {
        track: { ...songs[index], url: `https://test.example/${id}.mp3` },
        index,
    };
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


/** 后端现在的状态和收到的调用，按顺序 */
let calls: string[];
let state: string;
/** 装载挂住，测试决定什么时候装好 */
let finishLoading: () => void;

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    requests.length = 0;
    answer = () => new Promise(() => undefined);
    changeSourceOnFailure = false;
    calls = [];
    state = "playing";
    finishLoading = () => undefined;
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
    // 地址校验依赖原生和网络，这里原样放行
    jest.spyOn(player, "createPlayableSource").mockImplementation(
        async (source: any) => source,
    );
    mockBackend.getState.mockImplementation(async () => state);
    mockBackend.getActiveTrack.mockImplementation(
        async () => mockBackend.active?.track ?? null,
    );
    mockBackend.pause = jest.fn(async () => {
        calls.push("pause");
        if (state !== "idle") {
            state = "paused";
        }
    });
    mockBackend.play = jest.fn(async () => {
        calls.push("play");
        state = "playing";
    });
    mockBackend.claimPlayback = jest.fn(async () => {
        calls.push("claim");
    });
    mockBackend.restoreActiveTrack = jest.fn(
        async (options: { autoPlay?: boolean }) => {
            calls.push(`restore(autoPlay=${options?.autoPlay})`);
            state = options?.autoPlay ? "playing" : "paused";
            return true;
        },
    );
    mockBackend.skipToIndex = jest.fn(
        async (index: number, options: { autoPlay?: boolean }) => {
            const autoPlay = options?.autoPlay ?? true;
            calls.push(`skipTo(${songs[index].id}, autoPlay=${autoPlay})`);
            nativeIsPlaying(songs[index].id);
            state = autoPlay ? "playing" : "paused";
            return true;
        },
    );
    // 点歌走真实的装载（setTrackSource）：装载挂住，测试调 finishLoading 装好
    mockBackend.loadQueue = jest.fn(
        (tracks: any[], startIndex: number, options: { autoPlay?: boolean }) =>
            new Promise<void>(resolve => {
                calls.push(
                    `load(${tracks[startIndex].id}, autoPlay=${options?.autoPlay})`,
                );
                finishLoading = () => {
                    nativeIsPlaying(tracks[startIndex].id);
                    resolve();
                };
            }),
    );
    player.lockBackend();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songA);
    nativeIsPlaying("A");
    // 每个用例从“用户要听、系统没打断”开始
    player.playbackIntent.play();
});

afterEach(async () => {
    // 切歌队列是共享的：没走完的切歌放完，免得排在下一个用例前面
    player.manualSkipGate.cancelPending();
    player.cancelMpvManualSkipTransition("test-cleanup");
    await jest.advanceTimersByTimeAsync(60_000);
    jest.restoreAllMocks();
    jest.useRealTimers();
});

/** 原生收到焦点变化时已经先停下（见 MpvPlaybackService.interruptPlayback），再告诉 JS */
function systemTakesFocus() {
    if (state === "playing" || state === "buffering") {
        state = "paused";
    }
    trackPlayer.handleSystemInterruptionBegan();
}

function systemGivesFocusBack() {
    return trackPlayer.handleSystemInterruptionEnded();
}

/** 点一首歌，地址马上给，装载挂住 */
async function pickSongAndWaitForLoad(song: (typeof songs)[number]) {
    answer = async item => ({ url: `https://test.example/${item.id}.mp3` });
    const picked = settledAfter(trackPlayer.play(song, true));
    await jest.advanceTimersByTimeAsync(500);
    expect(calls).toContain(`load(${song.id}, autoPlay=true)`);
    return picked;
}

describe("a pause from the notification, lock screen or headset", () => {
    it("keeps the old song paused when the skip gives up waiting", async () => {
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(5_000);

        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;
        await jest.advanceTimersByTimeAsync(10_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("A");
        expect(calls).toContain("restore(autoPlay=false)");
        expect(calls).not.toContain("play");
        expect(state).toBe("paused");
    });

    it("keeps the new song paused when its address arrives after the pause", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);

        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;
        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        expect(calls).toContain("skipTo(B, autoPlay=false)");
        expect(calls).not.toContain("play");
        expect(state).toBe("paused");
    });

    it("counts unplugging the headphones as a pause even while the skip has the old song stopped", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);
        // 切歌等地址时 A 是切歌自己停下的，拔耳机后 B 装好也不能从外放出声
        expect(state).toBe("paused");

        await trackPlayer.pauseByExternalRequest("noisy");
        calls.length = 0;
        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(calls).toContain("skipTo(B, autoPlay=false)");
        expect(calls).not.toContain("play");
        expect(state).toBe("paused");
    });

    it("does not let autoplay compensation resume a song paused right after it loaded", async () => {
        // 装好后 mpv 还没真正出声，补偿会在 180、520、1100 毫秒后检查
        mockBackend.play = jest.fn(async () => {
            calls.push("play");
            state = "buffering";
        });
        const picked = await pickSongAndWaitForLoad(songs[3]);
        finishLoading();
        await jest.advanceTimersByTimeAsync(50);
        expect(calls).toContain("play");

        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;
        await jest.advanceTimersByTimeAsync(5_000);

        expect(picked.settled || picked.error !== undefined).toBe(true);
        expect(calls).not.toContain("play");
        expect(state).toBe("paused");
    });

    it("loads the song paused when the pause lands while it is loading", async () => {
        const picked = await pickSongAndWaitForLoad(songs[3]);

        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;
        finishLoading();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(picked.settled || picked.error !== undefined).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("D");
        expect(calls).not.toContain("play");
        expect(state).toBe("paused");
    });

    it("plays normally again when the user presses play on the lock screen", async () => {
        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;

        await trackPlayer.play();

        // 先解除原生的拦截，再接着放
        expect(calls).toEqual(["claim", "play"]);
        expect(state).toBe("playing");
    });

    it("plays the next song when the user presses next after pausing", async () => {
        answer = async item => ({ url: `https://test.example/${item.id}.mp3` });
        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;

        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(calls[0]).toBe("claim");
        expect(calls).toContain("skipTo(B, autoPlay=true)");
        expect(state).toBe("playing");
    });

    it("only records the pause when nothing is loaded", async () => {
        state = "idle";

        await trackPlayer.pauseByExternalRequest("noisy");

        // 闲置时再发暂停会把已经关掉的播放通知拉回来
        expect(calls).toEqual([]);
        expect(player.playbackIntent.isPausedByUser).toBe(true);
    });
});

describe("a temporary interruption such as a call or a short video", () => {
    it("plays on by itself once the system gives the sound back", async () => {
        systemTakesFocus();
        calls.length = 0;

        await systemGivesFocusBack();

        expect(calls).toEqual(["play"]);
        expect(state).toBe("playing");
    });

    it("stays paused when the user had paused before it", async () => {
        await trackPlayer.pauseByExternalRequest("remote");
        systemTakesFocus();
        calls.length = 0;

        await systemGivesFocusBack();

        expect(calls).toEqual([]);
        expect(state).toBe("paused");
    });

    it("stays paused when the user paused in the app during it", async () => {
        systemTakesFocus();
        await trackPlayer.pause();
        calls.length = 0;

        await systemGivesFocusBack();

        expect(calls).toEqual([]);
        expect(state).toBe("paused");
    });

    it("stays paused when the user paused from the notification during it", async () => {
        systemTakesFocus();
        await trackPlayer.pauseByExternalRequest("remote");
        calls.length = 0;

        await systemGivesFocusBack();

        expect(calls).toEqual([]);
        expect(state).toBe("paused");
    });

    it("does not let autoplay compensation take the sound back while it lasts", async () => {
        mockBackend.play = jest.fn(async () => {
            calls.push("play");
            state = "buffering";
        });
        const picked = await pickSongAndWaitForLoad(songs[3]);
        finishLoading();
        await jest.advanceTimersByTimeAsync(50);
        expect(calls).toContain("play");

        // 新歌刚装好、还没出声，来了视频：补偿不能把声音抢回来
        systemTakesFocus();
        calls.length = 0;
        await jest.advanceTimersByTimeAsync(5_000);
        expect(picked.settled || picked.error !== undefined).toBe(true);
        expect(calls).not.toContain("play");

        // 视频看完，接着放
        mockBackend.play = jest.fn(async () => {
            calls.push("play");
            state = "playing";
        });
        await systemGivesFocusBack();
        expect(calls[calls.length - 1]).toBe("play");
        expect(state).toBe("playing");
    });

    it("loads a song paused while it lasts and plays it afterwards", async () => {
        const picked = await pickSongAndWaitForLoad(songs[3]);
        systemTakesFocus();
        calls.length = 0;
        finishLoading();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(picked.settled || picked.error !== undefined).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("D");
        expect(calls).not.toContain("play");

        await systemGivesFocusBack();
        expect(calls[calls.length - 1]).toBe("play");
        expect(state).toBe("playing");
    });

    it("plays right away when the user presses play during it", async () => {
        systemTakesFocus();
        calls.length = 0;

        await trackPlayer.play();
        expect(calls).toEqual(["claim", "play"]);

        // 用户已经接着放了，系统之后还回焦点不用再做什么
        calls.length = 0;
        await systemGivesFocusBack();
        expect(calls).toEqual([]);
    });
});

describe("the skip's own pause while it waits for the new song", () => {
    it("is not a user pause: an interruption during the wait still ends with the new song playing", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);
        // 切歌先把 A 停下等 B 的地址，这时来了视频
        expect(state).toBe("paused");
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        systemTakesFocus();
        calls.length = 0;

        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);
        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        // 视频还在放：B 按暂停装好，不抢声音
        expect(calls).toContain("skipTo(B, autoPlay=false)");
        expect(calls).not.toContain("play");

        await systemGivesFocusBack();
        expect(calls[calls.length - 1]).toBe("play");
        expect(state).toBe("playing");
    });

    it("plays the new song when the sound comes back before its address does", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);
        systemTakesFocus();
        await jest.advanceTimersByTimeAsync(1_000);
        calls.length = 0;

        // 切歌还在等：不能去放切歌自己停下的 A
        await systemGivesFocusBack();
        expect(calls).toEqual([]);

        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);
        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        expect(calls).toContain("skipTo(B, autoPlay=true)");
        expect(state).toBe("playing");
    });

    it("plays the new song when the sound comes back while the skip is still confirming it", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        // 原生装好 B 之后要过一会儿才报告 B 成了当前曲目
        let reportB: () => void = () => undefined;
        mockBackend.skipToIndex = jest.fn(
            async (index: number, options: { autoPlay?: boolean }) => {
                const autoPlay = options?.autoPlay ?? true;
                calls.push(`skipTo(${songs[index].id}, autoPlay=${autoPlay})`);
                state = autoPlay ? "playing" : "paused";
                reportB = () => nativeIsPlaying(songs[index].id);
                return true;
            },
        );
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);
        systemTakesFocus();
        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(100);
        // B 按暂停装好了，切歌还在等原生确认
        expect(calls).toContain("skipTo(B, autoPlay=false)");
        expect(skip.settled).toBe(false);
        calls.length = 0;

        await systemGivesFocusBack();
        expect(calls).toEqual([]);
        reportB();
        await jest.advanceTimersByTimeAsync(1_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        expect(calls[calls.length - 1]).toBe("play");
        expect(state).toBe("playing");
    });

    it("goes back to the old song paused during the interruption and plays it afterwards", async () => {
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(5_000);
        systemTakesFocus();
        calls.length = 0;
        await jest.advanceTimersByTimeAsync(10_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("A");
        expect(calls).toContain("restore(autoPlay=false)");
        expect(calls).not.toContain("play");

        await systemGivesFocusBack();
        expect(calls[calls.length - 1]).toBe("play");
        expect(state).toBe("playing");
    });

    it("lets the user resume by pressing play while the skip waits, without asking for the song again", async () => {
        let deliver: (value: unknown) => void = () => undefined;
        answer = () =>
            new Promise(resolve => {
                deliver = resolve;
            });
        const skip = settledAfter(trackPlayer.skipToNext());
        await jest.advanceTimersByTimeAsync(3_000);
        await trackPlayer.pauseByExternalRequest("remote");
        await trackPlayer.play();
        expect(requests.map(request => request.id)).toEqual(["B"]);
        calls.length = 0;

        deliver({ url: "https://test.example/B.mp3" });
        await jest.advanceTimersByTimeAsync(5_000);

        expect(skip.settled).toBe(true);
        expect(trackPlayer.currentMusic.id).toBe("B");
        expect(calls).toContain("skipTo(B, autoPlay=true)");
        expect(calls).not.toContain("pause");
        expect(state).toBe("playing");
    });
});
