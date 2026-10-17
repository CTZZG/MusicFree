jest.mock("react-native", () => {
    const natives = Object.fromEntries(
        [
            "showStatusBarLyric",
            "hideStatusBarLyric",
            "setStatusBarLyricText",
            "setStatusBarLyricAlign",
            "setStatusBarLyricTop",
            "setStatusBarLyricLeft",
            "setStatusBarLyricWidth",
            "setStatusBarLyricFontSize",
            "setStatusBarColors",
        ].map(name => [name, jest.fn()]),
    );
    // The wrapper replaces methods on NativeModules.LyricUtil; keep the originals reachable.
    return { NativeModules: { LyricUtil: { ...natives } }, mockNatives: natives };
});
jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: { setConfig: jest.fn() },
}));
jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: { warn: jest.fn() },
}));
jest.mock("@/utils/log.ts", () => ({ errorLog: jest.fn() }));

import Config from "@/core/appConfig";
import Toast from "@/utils/toast";
import { errorLog } from "@/utils/log.ts";
import LyricUtil, { OVERLAY_PERMISSION_ERROR } from "../index";

const { mockNatives } = jest.requireMock("react-native") as {
    mockNatives: Record<string, jest.Mock>;
};

function nativeError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

describe("desktop lyric native wrapper", () => {
    const nativeSetters = {
        top: mockNatives.setStatusBarLyricTop,
        colors: mockNatives.setStatusBarColors,
        text: mockNatives.setStatusBarLyricText,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        Object.values(mockNatives).forEach(mock =>
            mock.mockResolvedValue(true),
        );
    });

    it("blames the overlay permission only when native reports it", async () => {
        mockNatives.showStatusBarLyric.mockRejectedValueOnce(
            nativeError(OVERLAY_PERMISSION_ERROR, "Overlay permission is not granted"),
        );
        await LyricUtil.showStatusBarLyric("MusicFree", {});

        expect(Toast.warn).toHaveBeenCalledWith(
            "状态栏歌词开启失败，请到手机系统设置打开悬浮窗权限",
        );
        expect(Config.setConfig).toHaveBeenCalledWith(
            "lyric.showStatusBarLyric",
            false,
        );
    });

    it("reports any other show failure without pointing at the permission", async () => {
        mockNatives.showStatusBarLyric.mockRejectedValueOnce(
            nativeError("Exception", "WindowManager failure"),
        );
        await LyricUtil.showStatusBarLyric("MusicFree", {});

        expect(Toast.warn).toHaveBeenCalledWith(
            "状态栏歌词开启失败，已关闭，详情见错误日志",
        );
        expect(errorLog).toHaveBeenCalledWith(
            "状态栏歌词开启失败",
            expect.objectContaining({ message: "WindowManager failure" }),
        );
        expect(Config.setConfig).toHaveBeenCalledWith(
            "lyric.showStatusBarLyric",
            false,
        );
    });

    it("logs failed settings updates instead of leaving an unhandled rejection", async () => {
        const failure = nativeError("Exception", "View not attached");
        nativeSetters.top.mockRejectedValueOnce(failure);
        nativeSetters.colors.mockRejectedValueOnce(failure);

        await expect(LyricUtil.setStatusBarLyricTop(0.4)).resolves.toBeUndefined();
        await expect(
            LyricUtil.setStatusBarColors("#FFFFFFFF", null),
        ).resolves.toBeUndefined();

        expect(nativeSetters.top).toHaveBeenCalledWith(0.4);
        expect(nativeSetters.colors).toHaveBeenCalledWith("#FFFFFFFF", null);
        expect(errorLog).toHaveBeenCalledWith(
            "状态栏歌词设置失败（setStatusBarLyricTop）",
            failure,
        );
        expect(errorLog).toHaveBeenCalledWith(
            "状态栏歌词设置失败（setStatusBarColors）",
            failure,
        );
        expect(Toast.warn).not.toHaveBeenCalled();
    });

    it("leaves per-line lyric text updates to their callers", async () => {
        const failure = nativeError("Exception", "text failed");
        nativeSetters.text.mockRejectedValueOnce(failure);

        await expect(LyricUtil.setStatusBarLyricText("line")).rejects.toBe(failure);
        expect(errorLog).not.toHaveBeenCalled();
    });
});
