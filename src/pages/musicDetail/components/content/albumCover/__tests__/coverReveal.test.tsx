/**
 * 方形封面从歌词页切回来时，会有几帧露出空的封面容器：一个大的半透明圆角方框，
 * 里面再套一个小方框（Android 透过半透明底色画出的投影）。
 *
 * 封面每次挂载都要重新解码图片，哪怕命中缓存也要几帧。现在图片画出来之前
 * 封面不显示，画出来后再淡入；迟迟画不出来时到点先淡入不透明的占位卡片。
 */
import React from "react";
import { StyleSheet } from "react-native";
import {
    act,
    create,
    ReactTestInstance,
    ReactTestRenderer,
} from "react-test-renderer";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
    __esModule: true,
    default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

jest.mock("@/hooks/useOrientation", () => ({
    __esModule: true,
    default: () => "vertical",
}));

let mockCoverStyle = "square";

jest.mock("@/core/appConfig", () => ({
    useAppConfig: () => mockCoverStyle,
}));

jest.mock("@/core/trackPlayer", () => ({
    useCurrentMusic: () => ({
        id: "1",
        platform: "测试音源",
        title: "歌名",
        artist: "歌手",
        album: "专辑",
        artwork: "https://example.com/cover.jpg",
    }),
    useMusicState: () => "paused",
}));

jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../../artworkContext", () => ({
    useMusicDetailVisuals: () => ({
        displayArtwork: "https://example.com/cover.jpg",
        coverArtwork: "https://example.com/cover.jpg",
        ambientArtwork: null,
    }),
}));

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));

// 只留下封面图片本身，用 testID 找到它，再从 props 里取 onDisplay、transition
jest.mock("@/components/base/fastImage", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: (props: object) =>
            mockReact.createElement(MockView, {
                ...props,
                testID: "artwork-image",
            }),
    };
});

jest.mock("@/constants/assetsConst", () => ({
    ImgAsset: { albumDefault: 1 },
}));

jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));

jest.mock("../miniLyric", () => ({ __esModule: true, default: () => null }));

jest.mock("../songInfo", () => ({ __esModule: true, default: () => null }));

// 共享值要跨渲染保持，动画直接跳到终点
jest.mock("react-native-reanimated", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: { View: MockView },
        cancelAnimation: jest.fn(),
        Easing: { linear: jest.fn() },
        useAnimatedStyle: (factory: () => object) => factory(),
        useSharedValue: (value: number) =>
            mockReact.useRef({ value }).current,
        withRepeat: (animation: unknown) => animation,
        withTiming: (value: number) => value,
    };
});

import AlbumCover from "../index";

function artworkImage(renderer: ReactTestRenderer) {
    return renderer.root.find(
        node =>
            typeof node.type === "string" &&
            node.props.testID === "artwork-image",
    );
}

/** 封面图片外面那层带形状、阴影和淡入的容器：包着图片、带 opacity 的最内层 */
function artworkFrame(renderer: ReactTestRenderer) {
    const image = artworkImage(renderer);
    const frames = renderer.root.findAll(
        (node: ReactTestInstance) =>
            typeof node.type === "string" &&
            node !== image &&
            "opacity" in (StyleSheet.flatten(node.props.style) ?? {}) &&
            node.findAll(child => child === image).length > 0,
    );
    expect(frames.length).toBeGreaterThan(0);
    return StyleSheet.flatten(frames[frames.length - 1].props.style);
}

function alphaOf(color: string) {
    if (/^#[0-9a-f]{6}$/i.test(color)) {
        return 1;
    }
    const match = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(color);
    return match ? Number(match[1]) : NaN;
}

describe("AlbumCover reveal", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCoverStyle = "square";
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.useRealTimers();
    });

    function render() {
        act(() => {
            renderer = create(<AlbumCover />);
        });
        return renderer!;
    }

    it("keeps the cover hidden until the artwork is on screen", () => {
        render();
        expect(artworkFrame(renderer!).opacity).toBe(0);
        // 第一次直接画上，不在已经透明的容器里再做一次淡入
        expect(artworkImage(renderer!).props.transition).toBe(0);

        act(() => {
            artworkImage(renderer!).props.onDisplay();
        });

        expect(artworkFrame(renderer!).opacity).toBe(1);
        // 之后换歌恢复交叉淡入
        expect(artworkImage(renderer!).props.transition).toBe(260);
    });

    it("shows the placeholder card if the artwork is slow to load", () => {
        render();
        act(() => {
            jest.advanceTimersByTime(499);
        });
        expect(artworkFrame(renderer!).opacity).toBe(0);

        act(() => {
            jest.advanceTimersByTime(1);
        });
        expect(artworkFrame(renderer!).opacity).toBe(1);
    });

    it("gives the square cover an opaque fill so its shadow cannot show through", () => {
        render();
        const frame = artworkFrame(renderer!);
        expect(frame.elevation).toBeGreaterThan(0);
        expect(alphaOf(String(frame.backgroundColor))).toBe(1);
    });

    it("reveals the circle cover the same way", () => {
        mockCoverStyle = "circle";
        render();
        expect(artworkFrame(renderer!).opacity).toBe(0);
        act(() => {
            artworkImage(renderer!).props.onDisplay();
        });
        expect(artworkFrame(renderer!).opacity).toBe(1);
    });
});
