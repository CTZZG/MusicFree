jest.mock("react-native-reanimated", () => ({
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn() },
    makeMutable: jest.fn(() => ({ value: 0 })),
    withTiming: jest.fn((value: number) => value),
}));

jest.mock("@/utils/log", () => ({
    errorLog: jest.fn(),
    trace: jest.fn(),
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

        expect(trackPlayer.on).toHaveBeenCalledTimes(1);
        expect(addEventListener).toHaveBeenCalledTimes(3);

        lyricManager.dispose();

        expect(trackPlayer.off).toHaveBeenCalledTimes(1);
        removeListeners.forEach(remove => {
            expect(remove).toHaveBeenCalledTimes(1);
        });
    });
});
