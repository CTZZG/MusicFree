import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import MusicShare, { shareLyricSnapshot } from "../musicShare";
import lyricManager from "@/core/lyricManager";
import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { Share } from "react-native";
import { formatMusicShareMessage } from "@/core/musicShare";
import Toast from "@/utils/toast";
import { errorLog } from "@/utils/log";
import ImageShare from "react-native-share";

const mockExport = jest.fn();
let mockArtwork: string | undefined;
jest.mock("react-native-svg", () => {
    const R = require("react");
    return {
        __esModule: true,
        default: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({
                toDataURL: (...args: any[]) => mockExport(...args),
            }));
            return R.createElement("Svg", props);
        }),
        Defs: "Defs",
        LinearGradient: "LinearGradient",
        Stop: "Stop",
        Rect: "Rect",
        Image: "SvgImage",
        Text: "SvgText",
        G: "G",
    };
});
jest.mock("react-native-fs", () => ({
    CachesDirectoryPath: "/cache",
    mkdir: jest.fn().mockResolvedValue(undefined),
    readDir: jest.fn().mockResolvedValue([]),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("react-native-share", () => ({
    __esModule: true,
    default: { open: jest.fn() },
}));
jest.mock("react-native-reanimated", () => ({
    Easing: { out: (value: unknown) => value, exp: () => 0 },
}));
jest.mock("react-native-image-colors", () => ({
    __esModule: true,
    default: {
        getColors: () =>
            Promise.resolve({ platform: "android", dominant: "#123456" }),
    },
}));
jest.mock("@/hooks/useResolvedMusicArtwork", () => ({
    __esModule: true,
    default: () => mockArtwork,
}));
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: { currentMusic: null },
}));
jest.mock("@/core/lyricManager", () => ({
    __esModule: true,
    default: { lyricState: {}, getLyricDiagnosticSnapshot: jest.fn() },
}));
jest.mock("@/core/musicShare", () => ({ formatMusicShareMessage: jest.fn() }));
jest.mock("@/utils/log", () => ({ errorLog: jest.fn() }));
jest.mock("@/native/utils", () => ({
    __esModule: true,
    default: {
        saveShareImage: jest.fn().mockResolvedValue("content://image/1"),
    },
}));
jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: { success: jest.fn(), warn: jest.fn() },
}));
jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ placeholder: "#eee" }),
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({
        t: (key: string, args?: { text: string }) =>
            key === "shareCard.line" ? args!.text : key,
    }),
}));
jest.mock("../../base/panelBase", () => ({
    __esModule: true,
    default: (p: any) => p.renderBody(),
}));
jest.mock("../../base/panelHeader", () => () => null);
jest.mock("@/components/base/themeText", () => "Text");

const song = {
    id: "one",
    platform: "source",
    title: "Correct song",
    artist: "Artist",
} as IMusic.IMusicItem;
let tree: ReactTestRenderer;
function button(label: string) {
    return tree.root.findAll(
        node =>
            node.props.accessibilityLabel === label &&
            typeof node.props.onPress === "function",
    )[0];
}
function mount() {
    act(() => {
        tree = create(<MusicShare musicItem={song} />);
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (NativeUtils.saveShareImage as jest.Mock).mockResolvedValue(
        "content://image/1",
    );
    (formatMusicShareMessage as jest.Mock).mockResolvedValue("Song - Artist");
    mockArtwork = undefined;
    Object.assign(TrackPlayer, { currentMusic: song });
    Object.assign(lyricManager, {
        lyricState: {
            loading: false,
            lyrics: [
                { lrc: "First line", translation: "译文一" },
                { lrc: "Second line" },
                { lrc: "Third line" },
                { lrc: "Fourth line" },
                { lrc: "Fifth line" },
            ],
        },
    });
    (lyricManager.getLyricDiagnosticSnapshot as jest.Mock).mockReturnValue({
        parserMatchesCurrentMusic: true,
    });
});
afterEach(() => {
    act(() => tree?.unmount());
    jest.useRealTimers();
});

it("does not attach a different track's lyrics or a stale/loading parser to a song", () => {
    Object.assign(TrackPlayer, { currentMusic: { ...song, id: "other" } });
    expect(shareLyricSnapshot(song)).toEqual([]);
    Object.assign(TrackPlayer, { currentMusic: song });
    (lyricManager.getLyricDiagnosticSnapshot as jest.Mock).mockReturnValue({
        parserMatchesCurrentMusic: false,
    });
    expect(shareLyricSnapshot(song)).toEqual([]);
    (lyricManager.getLyricDiagnosticSnapshot as jest.Mock).mockReturnValue({
        parserMatchesCurrentMusic: true,
    });
    Object.assign(lyricManager.lyricState, { loading: true });
    expect(shareLyricSnapshot(song)).toEqual([]);
});

it("reloads lyrics after loading without attaching a different song", () => {
    Object.assign(lyricManager.lyricState, { loading: true });
    mount();
    expect(button("shareCard.reloadLyrics")).toBeDefined();
    Object.assign(lyricManager.lyricState, { loading: false });
    Object.assign(TrackPlayer, { currentMusic: { ...song, id: "other" } });
    act(() => button("shareCard.reloadLyrics").props.onPress());
    expect(button("shareCard.reloadLyrics")).toBeDefined();
    Object.assign(TrackPlayer, { currentMusic: song });
    act(() => button("shareCard.reloadLyrics").props.onPress());
    expect(button("First line")).toBeDefined();
});

it("selects up to four real rows, captures the preview and waits for pixels before saving", async () => {
    mount();
    act(() => {
        [
            "First line",
            "Second line",
            "Third line",
            "Fourth line",
            "Fifth line",
        ].forEach(line => button(line).props.onPress());
    });
    expect(
        tree.root.findAll(
            node =>
                (node.type as unknown) === "SvgText" &&
                node.props.children === "Fifth line",
        ),
    ).toHaveLength(0);
    expect(
        tree.root.findAll(
            node =>
                (node.type as unknown) === "SvgText" &&
                node.props.children === "Fourth line",
        ),
    ).toHaveLength(1);
    let done!: (png: string) => void;
    mockExport.mockImplementation(callback => {
        done = callback;
    });
    let action!: Promise<void>;
    act(() => {
        action = button("shareCard.save").props.onPress();
    });
    expect(NativeUtils.saveShareImage).not.toHaveBeenCalled();
    expect(mockExport).toHaveBeenCalledWith(expect.any(Function), {
        width: 1000,
        height: expect.any(Number),
    });
    await act(async () => {
        done("real-native-png");
        await action;
    });
    expect(NativeUtils.saveShareImage).toHaveBeenCalledWith("real-native-png");
});

it("keeps the chosen song and lyric snapshot when playback changes while the panel is open", () => {
    mount();
    Object.assign(TrackPlayer, {
        currentMusic: { ...song, id: "other", title: "New song" },
    });
    Object.assign(lyricManager, {
        lyricState: { loading: false, lyrics: [{ lrc: "Wrong song line" }] },
    });
    act(() => button("First line").props.onPress());
    expect(
        tree.root.findAll(
            node =>
                (node.type as unknown) === "SvgText" &&
                node.props.children === "First line",
        ),
    ).toHaveLength(1);
    expect(
        tree.root.findAll(
            node =>
                (node.type as unknown) === "SvgText" &&
                node.props.children === "Wrong song line",
        ),
    ).toHaveLength(0);
});

it("retains a loaded cover beyond the deadline and falls back for a cover that never loads", async () => {
    mockArtwork = "https://example.test/cover.png";
    mount();
    expect(button("shareCard.save").props.disabled).toBe(true);
    act(() => tree.root.findByType("SvgImage" as any).props.onLoad());
    await act(async () => {
        jest.advanceTimersByTime(4100);
    });
    expect(tree.root.findAllByType("SvgImage" as any)).toHaveLength(1);
    expect(button("shareCard.save").props.disabled).toBe(false);
    act(() => {
        tree.unmount();
    });
    mount();
    await act(async () => {
        jest.advanceTimersByTime(4100);
    });
    expect(tree.root.findAllByType("SvgImage" as any)).toHaveLength(0);
    expect(button("shareCard.save").props.disabled).toBe(false);
});

it("does not save a late export after the user has dismissed the panel", async () => {
    mount();
    let done!: (png: string) => void;
    mockExport.mockImplementation(callback => {
        done = callback;
    });
    let action!: Promise<void>;
    act(() => {
        action = button("shareCard.save").props.onPress();
        tree.unmount();
    });
    await act(async () => {
        done("late-png");
        await action;
    });
    expect(NativeUtils.saveShareImage).not.toHaveBeenCalled();
});

it("cancels preparation and immediately retries without a late export committing or releasing the new request", async () => {
    mount();
    const callbacks: Array<(png: string) => void> = [];
    mockExport.mockImplementation(done => callbacks.push(done));
    let old!: Promise<void>;
    let retry!: Promise<void>;
    act(() => {
        old = button("shareCard.save").props.onPress();
        // Two presses in the same React batch must still start only one capture.
        button("shareCard.save").props.onPress();
    });
    expect(callbacks).toHaveLength(1);
    act(() => button("shareCard.cancel").props.onPress());
    act(() => {
        retry = button("shareCard.save").props.onPress();
    });
    await act(async () => {
        callbacks[0]("obsolete-image");
        await old;
    });
    expect(NativeUtils.saveShareImage).not.toHaveBeenCalled();
    expect(button("shareCard.save").props.disabled).toBe(true);
    await act(async () => {
        callbacks[1]("new-image");
        await retry;
    });
    expect(NativeUtils.saveShareImage).toHaveBeenCalledTimes(1);
    expect(NativeUtils.saveShareImage).toHaveBeenCalledWith("new-image");
    expect(button("shareCard.save").props.disabled).toBe(false);
});

it("ignores a cancelled text preparation and opens only the retry's share sheet", async () => {
    mount();
    let resolve!: (message: string) => void;
    (formatMusicShareMessage as jest.Mock).mockReturnValueOnce(
        new Promise<string>(done => {
            resolve = done;
        }),
    );
    const share = jest
        .spyOn(Share, "share")
        .mockResolvedValue({ action: Share.sharedAction });
    let old!: Promise<void>;
    act(() => {
        old = button("shareCard.link").props.onPress();
    });
    act(() => button("shareCard.cancel").props.onPress());
    await act(async () => {
        await button("shareCard.link").props.onPress();
    });
    await act(async () => {
        resolve("obsolete-message");
        await old;
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ message: "Song - Artist" });
    share.mockRestore();
});

it("keeps a started gallery write in progress and reports a safe, specific save failure", async () => {
    mount();
    mockExport.mockImplementation(done => done("private-image-payload"));
    let reject!: (reason: Error) => void;
    (NativeUtils.saveShareImage as jest.Mock).mockReturnValueOnce(
        new Promise((_, fail) => {
            reject = fail;
        }),
    );
    let result!: Promise<void>;
    await act(async () => {
        result = button("shareCard.save").props.onPress();
    });
    expect(button("shareCard.cancel")).toBeUndefined();
    expect(button("shareCard.save").props.disabled).toBe(true);
    await act(async () => {
        reject(new Error("https://secret.test/?token=private"));
        await result;
    });
    expect(Toast.warn).toHaveBeenCalledWith("shareCard.failed.save");
    expect(errorLog).toHaveBeenCalledWith("share-operation-failed", {
        action: "save",
        reason: "save",
    });
    expect(JSON.stringify((errorLog as jest.Mock).mock.calls)).not.toMatch(
        /private|secret|payload/,
    );
    expect(button("shareCard.save").props.disabled).toBe(false);
});

it("bounds a missing SVG callback, permits retry and reports capture failure", async () => {
    mount();
    mockExport.mockImplementation(() => undefined);
    let result!: Promise<void>;
    act(() => {
        result = button("shareCard.save").props.onPress();
    });
    await act(async () => {
        jest.advanceTimersByTime(5000);
        await result;
    });
    expect(Toast.warn).toHaveBeenCalledWith("shareCard.failed.capture");
    expect(NativeUtils.saveShareImage).not.toHaveBeenCalled();
    expect(button("shareCard.save").props.disabled).toBe(false);
});

it.each(["file", "share"])(
    "distinguishes a %s failure and permits retry without logging the native payload",
    async failure => {
        mount();
        mockExport.mockImplementation(done => done("private-png"));
        const fs = require("react-native-fs");
        const error = new Error(
            "private error https://secret.test/?token=value",
        );
        if (failure === "file") fs.writeFile.mockRejectedValueOnce(error);
        else (ImageShare.open as jest.Mock).mockRejectedValueOnce(error);
        await act(async () => {
            await button("shareCard.image").props.onPress();
        });
        expect(Toast.warn).toHaveBeenCalledWith(`shareCard.failed.${failure}`);
        expect(errorLog).toHaveBeenCalledWith("share-operation-failed", {
            action: "image",
            reason: failure,
        });
        expect(JSON.stringify((errorLog as jest.Mock).mock.calls)).not.toMatch(
            /private|secret|token/,
        );
        expect(button("shareCard.image").props.disabled).toBe(false);
    },
);
