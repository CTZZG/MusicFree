import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import MusicVideo from "../musicVideo";
let mockSong: any;
let mockState: any;
const mockFind = jest.fn();
const mockWatch = jest.fn();
const mockNavigate = jest.fn();
const mockReturn = jest.fn();
const mockQuality = jest.fn();
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        findMusicVideos: (signal: AbortSignal) => mockFind(signal),
        cancelVideoRequest: jest.fn(),
    },
    useCurrentMusic: () => mockSong,
    useMusicVideoState: () => mockState,
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));
jest.mock("@/core/router", () => ({
    ROUTE_PATH: { MUSIC_DETAIL: "music-detail" },
    useNavigate: () => mockNavigate,
}));
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("@/hooks/useColors", () => () => ({ primary: "blue" }));
jest.mock("@/components/musicVideo/actions", () => ({
    watchMusicVideo: (value: any) => mockWatch(value),
    returnToSong: () => mockReturn(),
    changeMusicVideoQuality: (q: string) => mockQuality(q),
    resumeMusicVideo: jest.fn(),
}));
jest.mock("../../base/panelHeader", () => () => null);
jest.mock("../../base/panelBase", () => ({
    __esModule: true,
    default: (props: any) => props.renderBody(),
}));
jest.mock("../../usePanel", () => ({ hidePanel: jest.fn() }));
const candidate = {
    id: "video",
    title: "One MV",
    providerName: "Provider",
    providerKey: "p",
    originalSongKey: "p@a",
    qualities: [{ id: "720p", label: "720p" }],
};
let tree: ReactTestRenderer;
function labels() {
    return tree.root
        .findAll(node => typeof node.props.children === "string")
        .map(node => node.props.children)
        .join("\n");
}
function button(label: string) {
    return tree.root.findAll(
        node =>
            node.props.accessibilityRole === "button" &&
            node.findAll(child => child.props.children === label).length > 0,
    )[0];
}
async function mount() {
    await act(async () => {
        tree = create(<MusicVideo />);
    });
}
beforeEach(() => {
    jest.clearAllMocks();
    mockSong = { id: "a", platform: "p" };
    mockState = { phase: "audio" };
    mockFind.mockResolvedValue([candidate]);
});
afterEach(() => {
    act(() => tree?.unmount());
});

test("browsing does not pick or play a candidate; explicit watch uses the original player route", async () => {
    await mount();
    expect(labels()).toContain("One MV");
    expect(mockWatch).not.toHaveBeenCalled();
    await act(async () => button("One MV").props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("music-detail");
    expect(mockWatch).toHaveBeenCalledWith(candidate);
});

test("a late candidate response for the previous song cannot appear in the new list", async () => {
    let resolve!: (value: any) => void;
    mockFind.mockReturnValueOnce(
        new Promise(done => {
            resolve = done;
        }),
    );
    await mount();
    const signal = mockFind.mock.calls[0][0];
    mockSong = { id: "b", platform: "p" };
    mockFind.mockResolvedValue([]);
    await act(async () => tree.update(<MusicVideo />));
    await act(async () => resolve([candidate]));
    expect(signal.aborted).toBe(true);
    expect(labels()).not.toContain("One MV");
    expect(labels()).toContain("musicVideo.empty");
});

test("provider failures offer a bounded retry without selecting a video", async () => {
    mockFind.mockRejectedValueOnce(new Error("https://private.invalid/hidden"));
    await mount();
    expect(labels()).toContain("musicVideo.retry");
    expect(labels()).not.toContain("private.invalid");
    await act(async () => button("musicVideo.retry").props.onPress());
    expect(labels()).toContain("One MV");
    expect(mockWatch).not.toHaveBeenCalled();
});

test("returning disables competing source selection and duplicate return buttons", async () => {
    mockState = {
        phase: "returning",
        songKey: "p@a",
        owner: { kind: "audio" },
        video: candidate,
        canReturn: true,
    };
    // Use the same media identity encoding as the product.
    const { getMediaUniqueKey } = require("@/utils/mediaIdentity");
    mockState.songKey = getMediaUniqueKey(mockSong);
    await mount();
    expect(button("One MV").props.disabled).toBe(true);
    expect(button("musicVideo.returnToSong").props.disabled).toBe(true);
    expect(mockReturn).not.toHaveBeenCalled();
    expect(mockQuality).not.toHaveBeenCalled();
});
