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
        setLiveUpdateLyricText: jest.fn().mockResolvedValue(undefined),
        setLiveUpdateLyricEnabled: jest.fn().mockResolvedValue(undefined),
        setMediaNotificationLyricText: jest.fn().mockResolvedValue(undefined),
    },
}));

import LyricUtil from "@/native/lyricUtil";
import lyricManager from "../lyricManager";

// 当前这句变空（前奏、间奏、换歌）时 JS 会清掉 Live Update 的歌词；原生层以前把
// 这当成关掉了 Live Update，把播放通知换回媒体样式，下一句再换回来。同一条通知
// 来回换样式，荣耀的实况卡片会留下一大块空白。现在开关单独同步给原生层。
describe("LyricManager Live Update switch", () => {
    it("tells native whether Live Update lyrics are on, separately from the current line", () => {
        const config: Record<string, unknown> = {
            "lyric.showLiveUpdateLyric": true,
        };
        const appConfig = {
            getConfig: jest.fn((key: string) => config[key] ?? false),
        } as any;
        const trackPlayer = {
            currentMusic: null,
            on: jest.fn(),
            off: jest.fn(),
        } as any;
        const pluginManager = {
            getByMedia: jest.fn(),
            getSearchablePlugins: jest.fn(() => []),
        } as any;
        const setEnabled = LyricUtil.setLiveUpdateLyricEnabled as jest.Mock;
        const clearLyric = LyricUtil.clearLiveUpdateLyricText as jest.Mock;

        lyricManager.dispose();
        lyricManager.injectDependencies(trackPlayer, appConfig, pluginManager);

        // 这会儿没有歌词：清掉 Live Update 的这句，但告诉原生层开关是开着的
        lyricManager.refreshNativeNotificationLyric();
        expect(setEnabled).toHaveBeenCalledTimes(1);
        expect(setEnabled).toHaveBeenLastCalledWith(true);
        expect(clearLyric).toHaveBeenCalled();

        // 开关没变就不再重复告诉
        lyricManager.refreshNativeNotificationLyric();
        expect(setEnabled).toHaveBeenCalledTimes(1);

        // 用户关掉才告诉原生层关了，播放通知这时才换回媒体样式
        config["lyric.showLiveUpdateLyric"] = false;
        lyricManager.refreshNativeNotificationLyric();
        expect(setEnabled).toHaveBeenCalledTimes(2);
        expect(setEnabled).toHaveBeenLastCalledWith(false);

        lyricManager.dispose();
    });

    // 冷启动：保存的开关是开着的，第一首完全没有歌词。原生层这时还不知道开关，
    // 要靠换歌时的这一次同步，第一条播放通知才是 Live Update，不会等到有歌词的歌
    // 才从媒体样式换过去。
    it("tells native the switch is on when the first song after a cold start has no lyrics", async () => {
        const appConfig = {
            getConfig: jest.fn((key: string) =>
                key === "lyric.showLiveUpdateLyric" ? true : undefined,
            ),
        } as any;
        let onMusicChanged: (() => void) | undefined;
        const trackPlayer = {
            currentMusic: {
                platform: "test",
                id: "no-lyric",
                title: "没有歌词的歌",
                artist: "歌手",
            },
            on: jest.fn((_event: string, listener: () => void) => {
                onMusicChanged = listener;
            }),
            off: jest.fn(),
            playerAdapter: {
                name: "mpv",
                getState: jest.fn().mockResolvedValue("playing"),
                addEventListener: jest.fn(() => ({ remove: jest.fn() })),
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
            isCurrentMusic: jest.fn(() => true),
        } as any;
        // 没有能提供歌词的插件：这首歌没有歌词
        const pluginManager = {
            getByMedia: jest.fn(() => undefined),
            getSearchablePlugins: jest.fn(() => []),
        } as any;
        const setEnabled = LyricUtil.setLiveUpdateLyricEnabled as jest.Mock;
        const setText = LyricUtil.setLiveUpdateLyricText as jest.Mock;

        lyricManager.dispose();
        setEnabled.mockClear();
        setText.mockClear();
        lyricManager.injectDependencies(trackPlayer, appConfig, pluginManager);
        await lyricManager.setup();

        onMusicChanged?.();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(setEnabled).toHaveBeenCalledWith(true);
        expect(setEnabled).not.toHaveBeenCalledWith(false);
        expect(setText).not.toHaveBeenCalled();

        lyricManager.dispose();
    });
});
