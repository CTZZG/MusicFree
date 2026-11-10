import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import MusicVideoContent from "..";
let mockFocused = true;
let mockMusicState = "playing";
let mockOwner: any;
let mockState: any;
let mockAppChange: (value: string) => void;
let mockBack: (() => boolean) | undefined;
let mockMounts = 0;
const mockDeactivate = jest.fn();
const mockActivate = jest.fn(async (_tag: string): Promise<void> => undefined);
const mockFailure = jest.fn();
const mockFullscreen = jest.fn();
jest.mock("@react-navigation/native", () => ({
    useIsFocused: () => mockFocused,
}));
jest.mock("expo-keep-awake", () => ({
    activateKeepAwakeAsync: (tag: string) => mockActivate(tag),
    deactivateKeepAwake: (tag: string) => mockDeactivate(tag),
}));
jest.mock("@/components/mpvVideo", () => {
    const R = require("react");
    return {
        __esModule: true,
        default: function MockNativeVideo(props: any) {
            R.useEffect(() => {
                mockMounts++;
            }, []);
            return R.createElement("MpvVideo", props);
        },
    };
});
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        playerAdapter: { getRenditionOwner: () => mockOwner },
        videoOutputFailed: (owner: any) => mockFailure(owner),
    },
    useMusicState: () => mockMusicState,
    useMusicVideoState: () => mockState,
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));
jest.mock("@/components/base/themeText", () => "Text");
jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));
jest.mock("@/components/musicVideo/actions", () => ({
    returnToSong: jest.fn(),
    resumeMusicVideo: jest.fn(),
}));
jest.mock("../../bottom/seekBar", () => () => null);
jest.mock("../../bottom/playControl", () => () => null);
const RN = require("react-native");
let tree: ReactTestRenderer;
function render(fullscreen = false) {
    return (
        <MusicVideoContent
            fullscreen={fullscreen}
            onFullscreen={mockFullscreen}
            swipeProgress={{ value: 0 } as any}
        />
    );
}
function surface() {
    return tree.root.findByType("MpvVideo" as any);
}
async function frame() {
    await act(async () =>
        surface().props.onVideoFrame({ nativeEvent: { ...mockOwner } }),
    );
}
async function mount(fullscreen = false) {
    await act(async () => {
        tree = create(render(fullscreen));
    });
    await act(async () =>
        tree.root
            .findAll(node => typeof node.props.onLayout === "function")[0]
            .props.onLayout({
                nativeEvent: { layout: { width: 600, height: 340 } },
            }),
    );
}
beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    RN.AppState.currentState = "active";
    mockMounts = 0;
    mockFocused = true;
    mockMusicState = "playing";
    mockOwner = { kind: "mv", mediaId: "a", loadGeneration: 2 };
    mockState = {
        phase: "video",
        owner: mockOwner,
        video: { title: "Video", providerName: "Provider" },
        canReturn: true,
    };
    jest.spyOn(RN.AppState, "addEventListener").mockImplementation(
        (_event: any, listener: any) => {
            mockAppChange = listener;
            return { remove: jest.fn() };
        },
    );
    jest.spyOn(RN.BackHandler, "addEventListener").mockImplementation(
        (_event: any, listener: any) => {
            mockBack = listener;
            return {
                remove: () => {
                    mockBack = undefined;
                },
            };
        },
    );
});
afterEach(() => {
    act(() => tree?.unmount());
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
});

test("fullscreen resizes the same native View without dropping its first-frame evidence", async () => {
    await mount();
    await frame();
    const videoRoot = tree.root.findByProps({ testID: "music-video-content" });
    // Fabric must retain a stacking context even before fullscreen adds zIndex.
    expect(videoRoot.props.collapsable).toBe(false);
    expect(mockMounts).toBe(1);
    await act(async () => tree.update(render(true)));
    expect(tree.root.findByProps({ testID: "music-video-content" })).toBe(videoRoot);
    expect(videoRoot.props.collapsable).toBe(false);
    expect(mockMounts).toBe(1);
    expect(surface().props.loadGeneration).toBe(2);
    await act(async () => {
        jest.advanceTimersByTime(16000);
    });
    expect(mockFailure).not.toHaveBeenCalled();
    expect(mockBack?.()).toBe(true);
    expect(mockFullscreen).toHaveBeenCalledWith(false);
});

test("a transient empty layout preserves the mounted video surface", async () => {
    await mount();
    await frame();
    const previousSurface = surface();
    const stage = tree.root.findAll(
        node => typeof node.props.onLayout === "function",
    )[0];
    expect(RN.StyleSheet.flatten(stage.props.style).overflow).toBe("hidden");
    for (const layout of [
        { width: 600, height: 0 },
        { width: 0, height: 340 },
        { width: 0, height: 0 },
        { width: 800, height: 380 },
    ]) {
        await act(async () =>
            stage.props.onLayout({ nativeEvent: { layout } }),
        );
        expect(surface()).toBe(previousSurface);
    }
    expect(mockMounts).toBe(1);
});

test("background and route blur release only video output, with no fabricated new frame or playback command", async () => {
    await mount();
    await frame();
    await act(async () => mockAppChange("background"));
    expect(surface().props.outputVisible).toBe(false);
    await act(async () => {
        jest.advanceTimersByTime(20000);
    });
    expect(mockFailure).not.toHaveBeenCalled();
    await act(async () => {
        mockAppChange("active");
        mockFocused = false;
        tree.update(render());
    });
    expect(surface().props.outputVisible).toBe(false);
    await act(async () => {
        mockFocused = true;
        tree.update(render());
        jest.advanceTimersByTime(16000);
    });
    expect(surface().props.outputVisible).toBe(true);
    expect(mockFailure).not.toHaveBeenCalled();
});

test("an old generation frame cannot satisfy the current first-frame deadline", async () => {
    await mount();
    const oldFrame = surface().props.onVideoFrame;
    mockOwner = { ...mockOwner, loadGeneration: 3 };
    mockState = { ...mockState, owner: mockOwner };
    await act(async () => tree.update(render()));
    await act(async () =>
        oldFrame({ nativeEvent: { mediaId: "a", loadGeneration: 2 } }),
    );
    await act(async () => {
        jest.advanceTimersByTime(15000);
    });
    expect(mockFailure).toHaveBeenCalledTimes(1);
    expect(mockFailure).toHaveBeenCalledWith(mockOwner);
});

test("a late keep-awake activation releases its own tag, not a newer playback lease", async () => {
    let finish!: () => void;
    mockActivate.mockImplementationOnce(
        () =>
            new Promise<void>(resolve => {
                finish = resolve;
            }),
    );
    await mount();
    await frame();
    const firstTag = mockActivate.mock.calls[0][0];
    await act(async () => {
        mockMusicState = "paused";
        tree.update(render());
    });
    await act(async () => {
        mockMusicState = "playing";
        tree.update(render());
    });
    const secondTag = mockActivate.mock.calls[1][0];
    expect(secondTag).not.toBe(firstTag);
    mockDeactivate.mockClear();
    await act(async () => finish());
    expect(mockDeactivate).toHaveBeenCalledWith(firstTag);
    expect(mockDeactivate).not.toHaveBeenCalledWith(secondTag);
});

test("paused fullscreen controls remain available after the auto-hide duration", async () => {
    mockMusicState = "paused";
    await mount(true);
    await frame();
    await act(async () => {
        jest.advanceTimersByTime(4000);
    });
    expect(
        tree.root.findAll(
            node =>
                node.type === ("Text" as any) &&
                node.props.children === "musicVideo.returnToSong",
        ),
    ).toHaveLength(1);
});
