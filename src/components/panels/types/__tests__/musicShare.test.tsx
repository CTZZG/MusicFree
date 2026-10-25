import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import MusicShare, { shareLyricSnapshot } from "../musicShare";
import lyricManager from "@/core/lyricManager";
import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";

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
jest.mock("react-native-fs", () => ({ CachesDirectoryPath: "/cache" }));
jest.mock("react-native-share", () => ({ __esModule: true, default: {} }));
jest.mock("react-native-reanimated", () => ({
    Easing: { out: (value: unknown) => value, exp: () => 0 },
}));
jest.mock("react-native-image-colors", () => ({
    __esModule: true,
    default: {
        getColors: () => Promise.resolve({ platform: "android", dominant: "#123456" }),
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
jest.mock("@/native/utils", () => ({
    __esModule: true,
    default: { saveShareImage: jest.fn().mockResolvedValue("content://image/1") },
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

it("selects up to four real rows, captures the preview and waits for pixels before saving", async () => {
    mount();
    act(() => {
        ["First line", "Second line", "Third line", "Fourth line", "Fifth line"].forEach(
            line => button(line).props.onPress(),
        );
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
