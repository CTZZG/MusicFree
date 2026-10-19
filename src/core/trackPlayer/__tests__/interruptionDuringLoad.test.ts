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
        let restoredPosition: number | undefined;
        if (payload.preservePositionFallback !== undefined) {
            restoredPosition = payload.preservePositionFallback;
            try {
                const stopped = await mockNativeMpvPlayer.getPosition();
                if (typeof stopped === "number" && Number.isFinite(stopped) && stopped >= 0) {
                    restoredPosition = stopped;
                }
            } catch {}
        }
        const autoPlay = (payload.autoPlay ?? true) && !mockHoldBlocks();
        mockNative.calls.push(`load(autoPlay=${autoPlay})`);
        mockNative.loading = { ...payload, restoredPosition };
        mockNative.armed = autoPlay ? payload.loadGeneration : -1;
        mockEmitState(autoPlay ? "buffering" : "paused");
        return restoredPosition;
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
    useSharedValue: (value: unknown) =>
        require("react").useRef({ value }).current,
    useAnimatedStyle: () => ({}),
    cancelAnimation: () => {},
    withTiming: (value: unknown) => value,
}));
// Render the real page controls; animations, icons and orientation are incidental.
jest.mock("@/components/base/icon", () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock("@/hooks/useOrientation", () => ({
    __esModule: true,
    default: () => "horizontal",
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));
jest.mock("react-native-gesture-handler", () => ({
    Gesture: {
        Pan: () => {
            const gesture: any = new Proxy({}, { get: () => () => gesture });
            return gesture;
        },
    },
    GestureDetector: "GestureDetector",
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
const React = require("react");
const { act, create } = require("react-test-renderer");
const { ActivityIndicator } = require("react-native");
const PlayControl = require("@/pages/musicDetail/components/bottom/playControl").default;
let controlTree: import("react-test-renderer").ReactTestRenderer | undefined;
let exposedState: string;

function ControlProbe() {
    exposedState = require("@/core/trackPlayer").useMusicState();
    return React.createElement(PlayControl, { swipeProgress: { value: 0 } });
}

async function renderControls() {
    await act(async () => {
        controlTree = create(React.createElement(ControlProbe));
        await jest.advanceTimersByTimeAsync(0);
    });
}

function mainButtons(label: string) {
    return controlTree!.root.findAll(node =>
        node.props.accessibilityRole === "button" &&
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );
}

async function pressMainButton(label: string) {
    // Pressable and its host can share props; invoke the displayed action once.
    expect(mainButtons(label).length).toBeGreaterThan(0);
    await act(async () => {
        mainButtons(label)[0].props.onPress();
        await jest.advanceTimersByTimeAsync(0);
    });
}

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
const qualitySpies: jest.SpyInstance[] = [];

async function mockSource(item: { id: string }, quality: string) {
    return { url: `https://test.example/${item.id}-${quality}.mp3`, quality };
}

/** 插件：每个音质给不同的地址 */
const plugin = {
    name: "test",
    methods: {
        getMediaSource: jest.fn(mockSource),
    },
};

/** mpv 装好文件（FILE_LOADED）：报告当前曲目；这一代还要自动播放就出声，否则停着 */
async function fileLoaded() {
    const payload = mockNative.loading;
    expect(payload).toBeTruthy();
    mockNative.loading = null;
    mockNative.active = payload;
    if (payload.restoredPosition !== undefined) {
        await mockNativeMpvPlayer.seekTo(payload.restoredPosition);
    }
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
    jest.spyOn(player.sourceResolver, "createPlayableSource").mockImplementation(
        async (source: any) => source,
    );
    player.lockBackend();
    await mockAdapter.setup();
    jest.useRealTimers();
});

beforeEach(async () => {
    jest.useFakeTimers();
    mockNativeMpvPlayer.getPosition.mockReset().mockResolvedValue(30);
    plugin.methods.getMediaSource.mockReset().mockImplementation(mockSource);
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
    mockNativeMpvPlayer.seekTo.mockClear();
    mockNativeMpvPlayer.loadAndPlay.mockClear();
});

afterEach(async () => {
    if (controlTree) {
        act(() => controlTree!.unmount());
        controlTree = undefined;
    }
    qualitySpies.splice(0).forEach(spy => spy.mockRestore());
    await jest.advanceTimersByTimeAsync(10_000);
    player.qualityChangeCoordinator?.begin?.();
    jest.useRealTimers();
});

describe("real page controls during a quality file load", () => {
    beforeAll(async () => {
        require("@/core/lastfm").default.flush.mockResolvedValue(undefined);
        require("@/core/dislikeMusic").default.onUpdated.mockReturnValue(() => {});
        player.musicHistoryService = { addMusic: jest.fn() };
        await trackPlayer.setupTrackPlayer();
    });
    afterAll(() => player.disposeServiceListeners());

    it("exposes native paused as a play action without inventing a user pause", async () => {
        await startQualityReload();
        await renderControls();
        // Replay the erroneous native callback observed on Android16 #50.
        await act(async () => {
            mockEmitState("paused");
            await jest.advanceTimersByTimeAsync(0);
        });
        expect(exposedState).toBe("paused");
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        expect(mainButtons("musicDetail.playControl.pause.a11y")).toHaveLength(0);
        mockNative.calls.length = 0;
        await pressMainButton("common.play");
        expect(mockNative.calls).toContain("resume");
        expect(mockNative.calls).not.toContain("pause");
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        await act(async () => {
            await fileLoaded();
        });
    });

    it("offers pause on the buffering spinner and keeps the loading file paused", async () => {
        await startQualityReload();
        await renderControls();
        expect(exposedState).toBe("buffering");
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        // 加载中：还在转圈，同时是一个能按的暂停。读屏标签和平常的暂停分开（“正在加载，暂停”），
        // 端到端测试按“暂停”判断在播时也不会把加载中当成在播
        expect(controlTree!.root.findAll(node => node.type === (ActivityIndicator as unknown))).not.toHaveLength(0);
        expect(mainButtons("common.play")).toHaveLength(0);
        expect(mainButtons("musicDetail.playControl.pause.a11y")).toHaveLength(0);
        const loadingPause = mainButtons("musicDetail.playControl.pauseWhileLoading.a11y");
        expect(loadingPause.length).toBeGreaterThan(0);
        expect(loadingPause[0].props.accessibilityState).toEqual({ busy: true });

        mockNative.calls.length = 0;
        await pressMainButton("musicDetail.playControl.pauseWhileLoading.a11y");
        expect(mockNative.calls).toContain("pause");
        expect(player.playbackIntent.isPausedByUser).toBe(true);
        expect(exposedState).toBe("paused");
        expect(controlTree!.root.findAll(node => node.type === (ActivityIndicator as unknown))).toHaveLength(0);

        // 文件装好也不自己出声
        await act(async () => {
            await fileLoaded();
            await jest.advanceTimersByTimeAsync(3_000);
        });
        expect(exposedState).toBe("paused");
        expect(mockNative.state).toBe("paused");
        expect(player.playbackIntent.isPausedByUser).toBe(true);

        // 再按播放就接着放
        await pressMainButton("common.play");
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        expect(exposedState).toBe("playing");
    });

    it("pauses from the spinner while a playing song stalls on the network", async () => {
        await startQualityReload();
        await act(async () => {
            await fileLoaded();
        });
        await renderControls();
        expect(exposedState).toBe("playing");
        // 网络卡住（mpv paused-for-cache）：原生报 buffering
        await act(async () => {
            mockEmitState("buffering");
            await jest.advanceTimersByTimeAsync(0);
        });
        await pressMainButton("musicDetail.playControl.pauseWhileLoading.a11y");
        expect(player.playbackIntent.isPausedByUser).toBe(true);
        expect(exposedState).toBe("paused");
        expect(mockNative.state).toBe("paused");
    });

    it("honors the actual pause action during loading through FILE_LOADED", async () => {
        await startQualityReload();
        await renderControls();
        // A resume callback can expose the pause control before FILE_LOADED.
        await act(async () => {
            mockEmitState("playing");
            await jest.advanceTimersByTimeAsync(0);
        });
        expect(mockNative.loading).not.toBeNull();
        expect(player.playbackIntent.isPausedByUser).toBe(false);
        await pressMainButton("musicDetail.playControl.pause.a11y");
        expect(player.playbackIntent.isPausedByUser).toBe(true);
        await act(async () => {
            await fileLoaded();
            await jest.advanceTimersByTimeAsync(3_000);
        });
        expect(exposedState).toBe("paused");
        expect(mockNative.state).toBe("paused");
        expect(player.playbackIntent.isPausedByUser).toBe(true);
    });
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

describe("quality reload uses the current position when committing", () => {
    it("keeps playing when another quality replaces a source still loading", async () => {
        const first = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(150);
        expect(mockNative.state).toBe("buffering");
        const latest = trackPlayer.changeQualityWithResult("128k");
        await jest.advanceTimersByTimeAsync(150);
        await fileLoaded();
        await latest;
        await first;
        expect(mockNative.active.url).toBe("https://test.example/A-128k.mp3");
        expect(mockNative.state).toBe("playing");
    });

    it("preserves progress while replacement waits at the native boundary", async () => {
        let oldPosition = 30;
        let positionAtReplacement: number | undefined;
        mockNativeMpvPlayer.getPosition.mockImplementation(async () => oldPosition);
        const originalLoad = mockNativeMpvPlayer.loadAndPlay.getMockImplementation()!;
        mockNativeMpvPlayer.loadAndPlay.mockImplementationOnce(async payload => {
            // Model a queued native replacement: the old engine still plays until
            // the load command executes, as in the Android 16 transition trace.
            expect(mockNative.state).toBe("playing");
            expect(mockNative.active?.url).toBe("https://test.example/A-192k.mp3");
            await new Promise(resolve => setTimeout(resolve, 400));
            expect(mockNative.state).toBe("playing");
            oldPosition += 0.4;
            positionAtReplacement = oldPosition;
            return originalLoad(payload);
        });

        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(600);
        expect(mockNativeMpvPlayer.seekTo).not.toHaveBeenCalled();
        await fileLoaded();
        await expect(changing).resolves.toMatchObject({ success: true });
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenCalledTimes(1);
        expect(positionAtReplacement).toBe(30.4);
        expect(mockNative.active?.url).toBe("https://test.example/A-320k.mp3");
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(positionAtReplacement);
    });

    async function finishChange(changing: Promise<unknown>) {
        await jest.advanceTimersByTimeAsync(200);
        await fileLoaded();
        await expect(changing).resolves.toMatchObject({ success: true });
    }

    function slowSource() {
        plugin.methods.getMediaSource.mockImplementation(async (item, quality) => {
            if (item.id === "A" && quality === "320k") {
                await new Promise(resolve => setTimeout(resolve, 5_000));
            }
            return mockSource(item, quality);
        });
    }

    it("keeps the five seconds played while the plugin fetches the new address", async () => {
        slowSource();
        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(4_999);
        expect(mockNativeMpvPlayer.loadAndPlay).not.toHaveBeenCalled();
        mockNativeMpvPlayer.getPosition.mockResolvedValue(35);
        await jest.advanceTimersByTimeAsync(1);
        await finishChange(changing);
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(35);
        expect(mockNative.active.url).toBe("https://test.example/A-320k.mp3");
    });

    it("keeps the position reached before a pause during the fetch", async () => {
        slowSource();
        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(2_000);
        mockNativeMpvPlayer.getPosition.mockResolvedValue(32);
        await trackPlayer.pause();
        await jest.advanceTimersByTimeAsync(3_000);
        await finishChange(changing);
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(32);
        expect(mockNative.state).toBe("paused");
    });

    it.each([0, 10])("honors a user seek back to %p while fetching", async position => {
        slowSource();
        const source = jest.spyOn(player, "setTrackSource");
        qualitySpies.push(source);
        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(4_999);
        mockNativeMpvPlayer.getPosition.mockResolvedValue(position);
        await jest.advanceTimersByTimeAsync(1);
        await finishChange(changing);
        expect(source).toHaveBeenLastCalledWith(expect.anything(), true, position, true);
    });

    it.each([NaN, Infinity, -1, undefined])("uses the request-time position if the latest read is %p", async position => {
        const progress = jest.spyOn(mockAdapter, "getProgress")
            .mockResolvedValueOnce({ position: 30, duration: 200, buffered: 30 })
            .mockResolvedValueOnce({ position, duration: 200, buffered: 30 });
        qualitySpies.push(progress);
        await finishChange(trackPlayer.changeQualityWithResult("320k"));
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(30);
    });

    it("uses the request-time position if the latest query rejects", async () => {
        const progress = jest.spyOn(mockAdapter, "getProgress")
            .mockResolvedValueOnce({ position: 30, duration: 200, buffered: 30 })
            .mockRejectedValueOnce(new Error("position unavailable"));
        qualitySpies.push(progress);
        await finishChange(trackPlayer.changeQualityWithResult("320k"));
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(30);
    });

    it("does not load the old song if it changes during the latest progress query", async () => {
        let release!: (value: unknown) => void;
        const progress = jest.spyOn(mockAdapter, "getProgress")
            .mockResolvedValueOnce({ position: 30, duration: 200, buffered: 30 })
            .mockImplementationOnce(() => new Promise(resolve => {
                release = resolve;
            }));
        qualitySpies.push(progress);
        const changing = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(0);
        player.setCurrentMusic(songs[1]);
        if (release) release({ position: 35, duration: 200, buffered: 35 });
        await jest.advanceTimersByTimeAsync(200);
        await expect(changing).resolves.toMatchObject({ superseded: true });
        expect(mockNativeMpvPlayer.loadAndPlay).not.toHaveBeenCalled();
    });

    it("reads again after an earlier source commit leaves the serial queue", async () => {
        let release!: () => void;
        const source = jest.spyOn(player, "setTrackSource")
            .mockImplementationOnce(async () => {
                await new Promise<void>(resolve => {
                    release = resolve;
                });
                mockNativeMpvPlayer.getPosition.mockResolvedValue(40);
            });
        qualitySpies.push(source);
        const first = trackPlayer.changeQualityWithResult("320k");
        await jest.advanceTimersByTimeAsync(0);
        expect(source).toHaveBeenCalledTimes(1);
        mockNativeMpvPlayer.getPosition.mockResolvedValue(35);
        const latest = trackPlayer.changeQualityWithResult("128k");
        await jest.advanceTimersByTimeAsync(0);
        release();
        await finishChange(latest);
        await expect(first).resolves.toMatchObject({ superseded: true });
        expect(mockNativeMpvPlayer.seekTo).toHaveBeenLastCalledWith(40);
        expect(mockNative.active.url).toBe("https://test.example/A-128k.mp3");
    });
});
