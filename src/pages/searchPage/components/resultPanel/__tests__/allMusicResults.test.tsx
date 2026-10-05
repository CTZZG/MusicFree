import React from "react";
import renderer, { act } from "react-test-renderer";
import AllMusicResults from "../allMusicResults";
import TrackPlayer from "@/core/trackPlayer";
import Config from "@/core/appConfig";
import { showPanel } from "@/components/panels/usePanel";
import searchSession from "@/core/search";

const mockA = { id: "1", platform: "A", title: "Song", artist: "Artist", album: "Album", duration: 180, artwork: "" };
const mockB = { ...mockA, id: "2", platform: "B" };
const mockOther = { ...mockA, id: "3", title: "Other song" };
const mockSources = [{ hash: "a", name: "A" }, { hash: "b", name: "B" }];
jest.mock("../../../hooks/useSearchSession", () => ({
    useSearchSessionId: () => 1,
    useSearchTypeResults: () => ({
        a: { state: 8, page: 1, query: "song", data: [mockA, mockOther] },
        b: { state: 8, page: 1, query: "song", data: [mockB] },
    }),
}));
jest.mock("@/core/search", () => ({ __esModule: true, default: { ensureLoaded: jest.fn(), retry: jest.fn(), loadMore: jest.fn(), getSnapshot: jest.fn(() => ({ id: 1 })) } }));
jest.mock("@/core/trackPlayer", () => ({ __esModule: true, default: { play: jest.fn(), playWithReplacePlayList: jest.fn() } }));
jest.mock("@/core/appConfig", () => ({ __esModule: true, default: { getConfig: jest.fn() } }));
// 带参数的文案把参数接在后面，方便断言里面的歌名、来源名
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string, args?: Record<string, unknown>) => args ? `${key} ${Object.values(args).join("|")}` : key }),
}));
jest.mock("@/components/base/icon", () => "Icon");
jest.mock("@/hooks/useColors", () => ({ __esModule: true, default: () => ({ primary: "#007AFF" }) }));
jest.mock("@/components/musicBar/useMusicBarFloatingOffset", () => ({ __esModule: true, default: () => 136 }));
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("@/components/base/listEmpty", () => () => null);
jest.mock("@/components/mediaItem/musicItem", () => "MusicRow");
jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));
jest.mock("react-native-reanimated", () => ({ Easing: { exp: jest.fn(), out: jest.fn((value: unknown) => value) } }));
jest.mock("@shopify/flash-list", () => ({
    FlashList: (props: any) => {
        const ReactModule = require("react");
        return ReactModule.createElement("List", null, props.ListHeaderComponent, props.data.map((item: any) => ReactModule.createElement("Row", { key: item.key }, props.renderItem({ item }))), props.ListFooterComponent);
    },
}));
let tree: renderer.ReactTestRenderer;
beforeEach(() => {
    jest.clearAllMocks();
    (Config.getConfig as jest.Mock).mockReturnValue("playMusicAndReplace");
    act(() => {
        tree = renderer.create(<AllMusicResults sources={mockSources} />);
    });
});
afterEach(() => act(() => tree.unmount()));

it("requests all enabled music sources through the shared session", () => {
    expect(searchSession.ensureLoaded).toHaveBeenCalledWith("music", "a");
    expect(searchSession.ensureLoaded).toHaveBeenCalledWith("music", "b");
});
it("plays the chosen original source and substitutes it in the grouped replacement playlist", () => {
    const text = tree.root.findAll(node => node.props.children === "searchPage.otherSources B")[0];
    let button = text.parent;
    while (button && typeof button.props.onPress !== "function") {
        button = button.parent;
    }
    act(() => button!.props.onPress());
    const payload = (showPanel as jest.Mock).mock.calls[0][1];
    expect(payload.candidates[1].value).toBe(mockB);
    act(() => payload.onPress(payload.candidates[1]));
    expect(TrackPlayer.playWithReplacePlayList).toHaveBeenCalledWith(mockB, [mockB, mockOther]);
});
it("keeps the existing single-song click preference", () => {
    (Config.getConfig as jest.Mock).mockReturnValue("playMusic");
    const row = tree.root.findAll(node => (node.type as unknown) === "MusicRow")[0];
    act(() => row.props.onItemPress());
    expect(TrackPlayer.play).toHaveBeenCalledWith(mockA);
    expect(TrackPlayer.playWithReplacePlayList).not.toHaveBeenCalled();
});

it("ignores an old source chooser after a new search starts", () => {
    const text = tree.root.findAll(node => node.props.children === "searchPage.otherSources B")[0];
    let button = text.parent;
    while (button && typeof button.props.onPress !== "function") {
        button = button.parent;
    }
    act(() => button!.props.onPress());
    const payload = (showPanel as jest.Mock).mock.calls[0][1];
    (searchSession.getSnapshot as jest.Mock).mockReturnValueOnce({ id: 2 });
    act(() => payload.onPress(payload.candidates[1]));
    expect(TrackPlayer.playWithReplacePlayList).not.toHaveBeenCalled();
    expect(TrackPlayer.play).not.toHaveBeenCalled();
});

it("names the song's other sources right under it and titles the chooser with the song", () => {
    // 只有一组有两个来源：A 的那首显示在行里，下面写其余的来源 B
    const lines = tree.root.findAll(node => typeof node.props.children === "string" && node.props.children.startsWith("searchPage.otherSources"));
    expect([...new Set(lines.map(node => node.props.children))]).toEqual(["searchPage.otherSources B"]);
    let button = lines[0].parent;
    while (button && typeof button.props.onPress !== "function") {
        button = button.parent;
    }
    expect(button!.props.accessibilityLabel).toBe("Song, searchPage.otherSources B");
    act(() => button!.props.onPress());
    const payload = (showPanel as jest.Mock).mock.calls[0][1];
    expect(payload.header).toBe("searchPage.chooseSourceHeader Song");
    expect(payload.candidates.map((candidate: { title: string }) => candidate.title)).toEqual(["A · Song", "B · Song"]);
});
