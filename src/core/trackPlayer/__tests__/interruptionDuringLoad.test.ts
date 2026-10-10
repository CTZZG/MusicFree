/**
 * 复核 62c468b0（P2）：换音质要重新装载同一首歌。装载还没完成（FILE_LOADED 之前）时
 * 来了临时打断，原生撤销了装好后的自动取消暂停；焦点在装好之前还回来，JS 让后端
 * 接着放，适配器却因为这次装载当初要求自动播放，把恢复请求吞掉了，歌装好后一直停着。
 *
 * 用真实的 TrackPlayer 和真实的 mpv 适配器，原生按 MpvPlayerModule 的规则模拟：
 * 自动播放的装载在 FILE_LOADED 时才出声；暂停、外部暂停、系统打断撤销这一点；
 * resume() 重新要求自动播放；PlaybackHold 拦着时什么都不放。
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

/** 模拟的原生 mpv：状态、装载中的文件、这一代要不要自动出声、外部暂停和打断的拦截 */
const mockNative = {
    listeners: {} as Record<string, ((event: any) => void) | undefined>,
    state: "idle",
    loading: null as any,
    active: null as any,
    /** PendingUnpause：装好后、恢复后要替 mpv 取消暂停的那一代 */
    armed: -1,
    hold: { pausedByUser: false, interrupted: false },
    calls: [] as string[],
};

function mockEmitState(state: string) {
    if (mockNative.state === state) {
        return;
    }
    mockNative.state = state;
    mockNative.listeners.state?.({ state });
}

function mockHoldBlocks() {
    return mockNative.hold.pausedByUser || mockNative.hold.interrupted;
}

/** MpvPlayerModule.keepHeldPaused：撤销排着的自动取消暂停，停下 */
function mockKeepHeldPaused() {
    mockNative.armed = -1;
    if (mockNative.state === "playing" || mockNative.state === "buffering") {
        mockEmitState("paused");
    }
}

const mockNativeMpvPlayer = {
    isAvailable: () => true,
    initialize: jest.fn(async () => undefined),
    destroy: jest.fn(async () => undefined),
    loadAndPlay: jest.fn(async (payload: any) => {
        const autoPlay = (payload.autoPlay ?? true) && !mockHoldBlocks();
        mockNative.calls.push(`load(autoPlay=${autoPlay})`);
        mockNative.loading = payload;
        mockNative.armed = autoPlay ? payload.loadGeneration : -1;
        mockEmitState(autoPlay ? "buffering" : "paused");
    }),
    pause: jest.fn(async () => {
        mockNative.calls.push("pause");
        mockNative.armed = -1;
        mockEmitState("paused");
    }),
    resume: jest.fn(async () => {
        mockNative.calls.push("resume");
        if (mockHoldBlocks()) {
            mockKeepHeldPaused();
            return;
        }
        mockNative.armed = (mockNative.loading ?? mockNative.active)?.loadGeneration ?? -1;
        mockEmitState("playing");
    }),
    claimPlayback: jest.fn(async () => {
        mockNative.hold.pausedByUser = false;
        mockNative.hold.interrupted = false;
    }),
    prepareNext: jest.fn(async () => undefined),
    prepareNextBatch: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    seekTo: jest.fn(async () => undefined),
    setVolume: jest.fn(async () => undefined),
    setRate: jest.fn(async () => undefined),
    getIsPlaying: jest.fn(async () => mockNative.state === "playing"),
    getPosition: jest.fn(async () => 30),
    getDuration: jest.fn(async () => 200),
    isAndroidAutoConnected: jest.fn(async () => false),
    updateQueueSnapshot: jest.fn(async () => undefined),
    updateMetadata: jest.fn(async () => undefined),
    addStateChangedListener: (cb: any) => {
        mockNative.listeners.state = cb;
        return { remove: () => undefined };
    },
    addProgressListener: (cb: any) => {
        mockNative.listeners.progress = cb;
        return { remove: () => undefined };
    },
    addActiveTrackChangedListener: (cb: any) => {
        mockNative.listeners.active = cb;
        return { remove: () => undefined };
    },
    addEndedListener: (cb: any) => {
        mockNative.listeners.ended = cb;
        return { remove: () => undefined };
    },
    addErrorListener: (cb: any) => {
        mockNative.listeners.error = cb;
        return { remove: () => undefined };
    },
    addRemoteCommandListener: (cb: any) => {
        mockNative.listeners.remote = cb;
        return { remove: () => undefined };
    },
    addAndroidAutoConnectionChangedListener: (cb: any) => {
        mockNative.listeners.auto = cb;
        return { remove: () => undefined };
    },
};

jest.mock("@/core/playerAdapter/nativeMpvPlayer", () => ({
    __esModule: true,
    default: mockNativeMpvPlayer,
    isMpvAvailable: () => true,
}));

let mockAdapter: any = null;
jest.mock("@/core/playerAdapter", () => ({
    __esModule: true,
    resolvePlayerAdapter: () => {
        if (!mockAdapter) {
            const { MpvPlayerAdapter } = jest.requireActual(
                "@/core/playerAdapter/mpvPlayerAdapter",
            );
            mockAdapter = new MpvPlayerAdapter();
        }
        return mockAdapter;
    },
}));
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

const songA = {
    id: "A",
    platform: "test",
    title: "Song A",
    artist: "Artist",
    album: "Album",
    artwork: "",
    duration: 200,
};
const songs = [songA, { ...songA, id: "B", title: "Song B" }];

/** 插件：每个音质给不同的地址 */
const plugin = {
    name: "test",
    methods: {
        getMediaSource: jest.fn(async (item: { id: string }, quality: string) => ({
            url: `https://test.example/${item.id}-${quality}.mp3`,
            quality,
        })),
    },
};

/** mpv 装好文件（FILE_LOADED）：报告当前曲目；这一代还要自动播放就出声，否则停着 */
async function fileLoaded() {
    const payload = mockNative.loading;
    expect(payload).toBeTruthy();
    mockNative.loading = null;
    mockNative.active = payload;
    mockNative.listeners.active?.({
        mediaId: payload.mediaId,
        loadGeneration: payload.loadGeneration,
        prepareToken: 0,
        queueRevision: payload.queueRevision,
        source: "loaded",
    });
    if (mockNative.armed === payload.loadGeneration && !mockHoldBlocks()) {
        mockEmitState("playing");
    } else {
        mockNative.armed = -1;
        mockEmitState("paused");
    }
    await jest.advanceTimersByTimeAsync(0);
}

/** 系统临时收回焦点：原生先拦住、停下（MpvPlaybackService.interruptPlayback），再告诉 JS */
function systemTakesFocus() {
    mockNative.hold.interrupted = true;
    mockKeepHeldPaused();
    trackPlayer.handleSystemInterruptionBegan();
}

/** 系统还回焦点：原生只解除打断这一项，再告诉 JS */
async function systemGivesFocusBack() {
    mockNative.hold.interrupted = false;
    await trackPlayer.handleSystemInterruptionEnded();
    await jest.advanceTimersByTimeAsync(0);
}

/** 换成 320K：新地址交给 mpv 装载，还没装好（等 fileLoaded） */
async function startQualityReload() {
    const changing = trackPlayer.changeQualityWithResult("320k");
    await jest.advanceTimersByTimeAsync(150);
    expect(mockNative.loading?.url).toBe("https://test.example/A-320k.mp3");
    expect(mockNative.state).toBe("buffering");
    return changing;
}

beforeAll(async () => {
    jest.useFakeTimers();
    player.pluginManagerService = {
        getByName: () => plugin,
        getByMedia: () => plugin,
        isPluginEnabled: () => true,
        getEnabledPlugins: () => [plugin],
        getSortedSearchablePlugins: () => [plugin],
    };
    player.configService = {
        getConfig: () => undefined,
        setConfig: jest.fn(),
    };
    jest.spyOn(player, "createPlayableSource").mockImplementation(
        async (source: any) => source,
    );
    player.lockBackend();
    await mockAdapter.setup();
    jest.useRealTimers();
});

beforeEach(async () => {
    jest.useFakeTimers();
    mockNative.hold.pausedByUser = false;
    mockNative.hold.interrupted = false;
    player.playbackIntent.play();
    player.setPlayList(songs, false);
    player.setCurrentMusic(songA);
    // 先正常放着 A（标准音质）
    const playing = trackPlayer.play(songA, true);
    await jest.advanceTimersByTimeAsync(150);
    await fileLoaded();
    await jest.advanceTimersByTimeAsync(3_000);
    await playing;
    expect(mockNative.state).toBe("playing");
    expect(mockNative.active?.url).toBe("https://test.example/A-192k.mp3");
    mockNative.calls.length = 0;
});

afterEach(async () => {
    await jest.advanceTimersByTimeAsync(10_000);
    player.qualityChangeCoordinator?.begin?.();
    jest.useRealTimers();
});

describe("changing the quality while a temporary interruption comes and goes", () => {
    it("plays on when the sound comes back before the new file has loaded", async () => {
        const changing = await startQualityReload();
        systemTakesFocus();
        await jest.advanceTimersByTimeAsync(2_000);

        await systemGivesFocusBack();
        // 恢复请求要送到原生，不能因为这次装载当初要求自动播放就吞掉
        expect(mockNative.calls).toContain("resume");
        await fileLoaded();
        await changing;

        expect(mockNative.active?.url).toBe("https://test.example/A-320k.mp3");
        expect(mockNative.state).toBe("playing");
    });

    it("plays on when the new file loads first and the sound comes back after", async () => {
        const changing = await startQualityReload();
        systemTakesFocus();
        await fileLoaded();
        expect(mockNative.state).toBe("paused");
        await jest.advanceTimersByTimeAsync(2_000);

        await systemGivesFocusBack();
        await changing;

        expect(mockNative.state).toBe("playing");
    });

    it("stays paused when the user paused during the interruption", async () => {
        const changing = await startQualityReload();
        systemTakesFocus();
        await trackPlayer.pause();
        await jest.advanceTimersByTimeAsync(2_000);

        await systemGivesFocusBack();
        await fileLoaded();
        await jest.advanceTimersByTimeAsync(3_000);
        await changing;

        expect(mockNative.calls).not.toContain("resume");
        expect(mockNative.state).toBe("paused");
    });
});

it("plays again when the user pauses and plays while the new file is loading", async () => {
    const changing = await startQualityReload();
    await trackPlayer.pause();
    expect(mockNative.state).toBe("paused");

    await trackPlayer.play();
    await fileLoaded();
    await changing;

    expect(mockNative.state).toBe("playing");
});
