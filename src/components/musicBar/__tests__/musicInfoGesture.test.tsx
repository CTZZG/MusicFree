import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

type End = (event: { translationX: number; velocityX: number }, success: boolean) => void;
interface MockGesture {
    minPointers(value: number): MockGesture;
    maxPointers(value: number): MockGesture;
    runOnJS(value: boolean): MockGesture;
    onEnd(callback: End): MockGesture;
    onUpdate(callback: unknown): MockGesture;
}
let mockPanEnd: End | undefined;
const mockCompletions: ((finished?: boolean) => void)[] = [];
const mockNext = jest.fn(async () => undefined);
const mockPrevious = jest.fn(async () => undefined);
const mockSong = { id: "b", platform: "fixture", title: "B", artist: "Artist", album: "Album", artwork: "", duration: 180 };

function mockGesture(kind: string): MockGesture {
    const builder: MockGesture = {
        minPointers: () => builder,
        maxPointers: () => builder,
        runOnJS: () => builder,
        onUpdate: () => builder,
        onEnd: callback => {
            if (kind === "pan") mockPanEnd = callback;
            return builder;
        },
    };
    return builder;
}

jest.mock("react-native-gesture-handler", () => ({
    Gesture: { Pan: () => mockGesture("pan"), Tap: () => mockGesture("tap"), Race: (...items: unknown[]) => items },
    GestureDetector: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    default: { View: require("react-native").View },
    useSharedValue: (initial: number) => require("react").useRef({ value: initial }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    runOnJS: (callback: unknown) => callback,
    withTiming: (value: number, _config: unknown, complete?: (finished?: boolean) => void) => {
        if (complete) mockCompletions.push(complete);
        return value;
    },
}));
jest.mock("@/core/trackPlayer", () => ({
    __esModule: true,
    default: {
        previousMusic: { id: "a", platform: "fixture", title: "A" },
        nextMusic: { id: "c", platform: "fixture", title: "C" },
        skipToNext: () => mockNext(),
        skipToPrevious: () => mockPrevious(),
    },
    useCurrentMusic: () => mockSong,
    usePlayList: () => [mockSong],
    useProgress: () => ({ position: 0, duration: 180, buffered: 0 }),
}));
jest.mock("@/hooks/useColors", () => () => ({ musicBarText: "#fff", primary: "#fff", placeholder: "#000" }));
jest.mock("@/hooks/useResolvedMusicArtwork", () => () => undefined);
jest.mock("@/core/router", () => ({ ROUTE_PATH: { MUSIC_DETAIL: "detail" }, useNavigate: () => jest.fn() }));
jest.mock("@/core/i18n", () => ({ useI18N: () => ({ t: (key: string) => key }) }));
jest.mock("@/constants/commonConst", () => ({ timingConfig: { animationFast: { duration: 160 } } }));
jest.mock("@/constants/assetsConst", () => ({ ImgAsset: { albumDefault: 1 } }));
jest.mock("@/components/base/fastImage", () => "Artwork");
jest.mock("@/components/base/themeText", () => "ThemeText");

import MusicInfo from "../musicInfo";

let tree: ReactTestRenderer | undefined;
function render(width = 200) {
    act(() => {
        tree = create(<MusicInfo musicItem={mockSong} />); 
    });
    const container = tree!.root.findAll(node => typeof node.props.onLayout === "function")[0];
    expect(container).toBeDefined();
    act(() => {
        container.props.onLayout({ nativeEvent: { layout: { width, height: 64 } } }); 
    });
    expect(mockPanEnd).toBeDefined();
}

beforeEach(() => {
    mockNext.mockClear(); mockPrevious.mockClear(); mockCompletions.length = 0; mockPanEnd = undefined;
});
afterEach(() => {
    act(() => tree?.unmount()); tree = undefined; 
});

const cases: [string, number, number, "previous" | "next" | "none"][] = [
    ["held right", 80, 0, "previous"],
    ["held right with actual diagnostic tracker residue", 110, -0.019198854, "previous"],
    ["held left", -80, 0, "next"],
    ["right distance with opposite release velocity", 80, -300, "previous"],
    ["left distance with opposite release velocity", -80, 300, "next"],
    ["right distance with matching velocity", 80, 200, "previous"],
    ["left distance with matching velocity", -80, -200, "next"],
    ["short right fling", 10, 1601, "previous"],
    ["short left fling", -10, -1601, "next"],
    ["short held drag", 10, 0, "none"],
    ["exact distance boundary still needs a fling", 60, 0, "none"],
];
it.each(cases)("uses the actual pan callback: %s", async (_name, translationX, velocityX, expected) => {
    render();
    await act(async () => {
        mockPanEnd!({ translationX, velocityX }, true);
        mockCompletions.splice(0).forEach(complete => complete(true));
    });
    expect(mockPrevious).toHaveBeenCalledTimes(expected === "previous" ? 1 : 0);
    expect(mockNext).toHaveBeenCalledTimes(expected === "next" ? 1 : 0);
});

it("does not dispatch a skip when Reanimated reports cancellation", async () => {
    render();
    await act(async () => {
 mockPanEnd!({ translationX: 80, velocityX: 200 }, true); 
    });
    expect(mockNext).not.toHaveBeenCalled(); expect(mockPrevious).not.toHaveBeenCalled();
    expect(mockCompletions).toHaveLength(1);
    await act(async () => {
        mockCompletions[0](false); 
    });
    expect(mockNext).not.toHaveBeenCalled(); expect(mockPrevious).not.toHaveBeenCalled();
});

it.each([true, false])("does not skip with missing layout or a failed gesture (%s)", async missingWidth => {
    render(missingWidth ? 0 : 200);
    await act(async () => {
        mockPanEnd!({ translationX: 80, velocityX: 200 }, missingWidth);
        mockCompletions.splice(0).forEach(complete => complete(true));
    });
    expect(mockNext).not.toHaveBeenCalled(); expect(mockPrevious).not.toHaveBeenCalled();
});
