jest.mock("react-native-reanimated", () => ({
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn() },
    makeMutable: jest.fn(() => ({ value: 0 })),
    withTiming: jest.fn((value: number) => value),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
    trace: jest.fn(),
    devLog: jest.fn(),
}));

jest.mock("@/utils/mediaExtra", () => ({
    getMediaExtraProperty: jest.fn(),
    patchMediaExtra: jest.fn(),
}));

jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: jest.fn(() => "media-key"),
    isSameMediaItem: jest.fn(() => false),
}));

jest.mock("@/utils/persistStatus", () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

jest.mock("@/utils/fileUtils", () => ({
    checkAndCreateDir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("react-native-fs", () => ({
    unlink: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/native/lyricUtil", () => ({
    __esModule: true,
    default: {
        setActivePlayerBackend: jest.fn().mockResolvedValue(undefined),
        showStatusBarLyric: jest.fn().mockResolvedValue(undefined),
        setStatusBarLyricText: jest.fn().mockResolvedValue(undefined),
        setStatusBarLyricPayload: jest.fn().mockResolvedValue(undefined),
        clearMediaNotificationLyricText: jest.fn().mockResolvedValue(undefined),
        clearLiveUpdateLyricText: jest.fn().mockResolvedValue(undefined),
    },
}));

import lyricManager from "../lyricManager";

describe("LyricManager listener lifecycle", () => {
    it("registers once and removes every listener on dispose", async () => {
        const removeListeners = [jest.fn(), jest.fn(), jest.fn()];
        const addEventListener = jest
            .fn()
            .mockImplementation((_event: string, _listener: unknown) => ({
                remove: removeListeners[addEventListener.mock.calls.length - 1],
            }));
        const trackPlayer = {
            currentMusic: null,
            on: jest.fn(),
            off: jest.fn(),
            playerAdapter: {
                name: "mpv",
                getState: jest.fn().mockResolvedValue("idle"),
                addEventListener,
            },
            getProgress: jest.fn().mockResolvedValue({
                position: 0,
                duration: 0,
                buffered: 0,
            }),
            getProgressSnapshot: jest.fn(() => ({
                position: 0,
                duration: 0,
                buffered: 0,
                sequence: 0,
            })),
            isCurrentMusic: jest.fn(() => false),
        } as any;
        const appConfig = {
            getConfig: jest.fn(() => false),
        } as any;
        const pluginManager = {
            getByMedia: jest.fn(),
            getSearchablePlugins: jest.fn(() => []),
        } as any;

        lyricManager.dispose();
        lyricManager.injectDependencies(
            trackPlayer,
            appConfig,
            pluginManager,
        );
        const firstSetup = lyricManager.setup();
        const secondSetup = lyricManager.setup();
        await Promise.all([firstSetup, secondSetup]);

        expect(trackPlayer.on).toHaveBeenCalledTimes(2);
        expect(addEventListener).toHaveBeenCalledTimes(3);

        lyricManager.dispose();

        expect(trackPlayer.off).toHaveBeenCalledTimes(2);
        removeListeners.forEach(remove => {
            expect(remove).toHaveBeenCalledTimes(1);
        });
    });
});

it("same-song MV entry invalidates a late lyric response and audio return can publish fresh lyrics", async () => {
    const { TrackPlayerEvents } = require("@/constants/trackPlayerConst");
    const listeners = new Map<string, () => void>();
    const song = { id: "a", platform: "test", title: "Song", artist: "Artist" };
    let release!: (value: unknown) => void;
    const getLyric = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    const player: any = {
        currentMusic: null, audioTimelineAvailable: true,
        on: (event: string, fn: () => void) => listeners.set(event, fn), off: jest.fn(),
        isCurrentMusic: (item: unknown) => item === song,
        playerAdapter: { name: "mpv", getState: async () => "paused", addEventListener: () => ({ remove: jest.fn() }) },
        getProgress: async () => ({ position: 0, duration: 300, buffered: 0 }),
        getProgressSnapshot: () => ({ position: 0, duration: 300, buffered: 0, sequence: 0 }),
    };
    const plugin = { name: "test", methods: { getLyric }, supportedMethods: new Set(["getLyric"]) };
    lyricManager.dispose();
    lyricManager.injectDependencies(player, { getConfig: () => undefined } as any,
        { getByMedia: () => plugin, getSearchablePlugins: () => [] } as any);
    await lyricManager.setup();
    player.currentMusic = song;
    listeners.get(TrackPlayerEvents.CurrentMusicChanged)!();
    expect(getLyric).toHaveBeenCalledTimes(1);
    player.audioTimelineAvailable = false;
    listeners.get(TrackPlayerEvents.AudioTimelineChanged)!();
    release({ rawLrc: "[00:00]Late original lyric" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lyricManager.lyricState.lyrics).toHaveLength(0);
    expect(lyricManager.getLyricDiagnosticSnapshot().nativeOutput.text).toBe("");
    getLyric.mockImplementationOnce(() => Promise.resolve({ rawLrc: "[00:00]Restored lyric" }));
    player.audioTimelineAvailable = true;
    listeners.get(TrackPlayerEvents.AudioTimelineChanged)!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lyricManager.lyricState.lyrics).toHaveLength(1);
    expect(lyricManager.getLyricDiagnosticSnapshot().nativeOutput.text).toBe("Restored lyric");
    lyricManager.dispose();
});

it("ordinary same-song confirmations neither repeat an in-flight lyric fetch nor reset loaded lyrics", async () => {
    const { TrackPlayerEvents } = require("@/constants/trackPlayerConst");
    const listeners = new Map<string, () => void>();
    const song = { id: "a", platform: "test", title: "Song", artist: "Artist" };
    let release!: (value: unknown) => void;
    const getLyric = jest.fn(() => new Promise(resolve => {
        release = resolve;
    }));
    const player: any = {
        currentMusic: null, audioTimelineAvailable: true,
        on: (event: string, fn: () => void) => listeners.set(event, fn), off: jest.fn(),
        isCurrentMusic: (item: unknown) => item === song,
        playerAdapter: { name: "mpv", getState: async () => "paused", addEventListener: () => ({ remove: jest.fn() }) },
        getProgress: async () => ({ position: 2, duration: 300, buffered: 3 }),
        getProgressSnapshot: () => ({ position: 2, duration: 300, buffered: 3, sequence: 0 }),
    };
    const plugin = { name: "test", methods: { getLyric }, supportedMethods: new Set(["getLyric"]) };
    lyricManager.dispose();
    lyricManager.injectDependencies(player, { getConfig: () => undefined } as any,
        { getByMedia: () => plugin, getSearchablePlugins: () => [] } as any);
    await lyricManager.setup();
    const loading = jest.spyOn(lyricManager as any, "setLyricAsLoadingState");
    const nativeOutput = jest.spyOn(lyricManager as any, "publishNativeLyricOutput");
    try {
        player.currentMusic = song;
        listeners.get(TrackPlayerEvents.CurrentMusicChanged)!();
        listeners.get(TrackPlayerEvents.CurrentMusicChanged)!();
        listeners.get(TrackPlayerEvents.AudioTimelineChanged)!();
        expect(getLyric).toHaveBeenCalledTimes(1);
        release({ rawLrc: "[00:01.00]first line" });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(lyricManager.lyricState.lyrics).toHaveLength(1);
        const priorLoading = loading.mock.calls.length;
        const priorOutput = nativeOutput.mock.calls.length;
        listeners.get(TrackPlayerEvents.CurrentMusicChanged)!();
        listeners.get(TrackPlayerEvents.AudioTimelineChanged)!();
        expect(loading).toHaveBeenCalledTimes(priorLoading);
        expect(nativeOutput).toHaveBeenCalledTimes(priorOutput);
        expect(getLyric).toHaveBeenCalledTimes(1);
    } finally {
        lyricManager.dispose();
        jest.restoreAllMocks();
    }
});
