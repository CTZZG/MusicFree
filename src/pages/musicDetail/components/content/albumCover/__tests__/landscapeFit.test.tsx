/**
 * 外部复审：横屏只按高度收紧了封面，歌名区还是竖屏卡片的尺寸（留白 22 + 6，
 * 三行 30 + 26 + 20，共 104 dp）。320 dp 高的窗口里内容区只剩 56～80 dp，专辑行
 * 压进进度条；系统字体调大以后，连 360 dp 高的窗口也放不下。
 *
 * 这里渲染真实的 AlbumCover 横屏分支（连同真实的 SongInfo），把量到的内容区
 * 尺寸交给它，再从渲染出来的样式算封面和歌名区各自多高，断言都在内容区里。
 * 高度按这几条算：单行文字 = 行高 × 字体缩放（设了 maxFontSizeMultiplier 就取
 * 上限）；写死高度的 View 取 height；纵向容器累加子项，横向容器取最高的子项；
 * 再加上下 padding 和 margin。没有跑 Yoga，也不是真机截图。
 */
import React from "react";
import { StyleSheet, Text, TextStyle } from "react-native";
import {
    act,
    create,
    ReactTestInstance,
    ReactTestRenderer,
} from "react-test-renderer";

const mockWindow = { width: 800, height: 320, scale: 2, fontScale: 1 };

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
    __esModule: true,
    default: () => mockWindow,
}));

jest.mock("@/hooks/useOrientation", () => ({
    __esModule: true,
    default: () => "horizontal",
}));

const mockMusicItem = {
    id: "1",
    platform: "测试音源",
    title: "一首名字比较长的歌",
    artist: "歌手甲",
    album: "专辑乙",
    artwork: "",
};

jest.mock("@/core/trackPlayer", () => ({
    useCurrentMusic: () => mockMusicItem,
    useMusicState: () => "paused",
}));

jest.mock("@/core/appConfig", () => ({
    useAppConfig: () => "square",
}));

jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../../artworkContext", () => ({
    useMusicDetailVisuals: () => ({
        displayArtwork: null,
        coverArtwork: null,
        ambientArtwork: null,
    }),
}));

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));

jest.mock("@/components/base/fastImage", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: (props: { style?: object }) =>
            mockReact.createElement(MockView, { style: props.style }),
    };
});

jest.mock("@/components/base/icon.tsx", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: () => mockReact.createElement(MockView),
    };
});

jest.mock("@/constants/assetsConst", () => ({
    ImgAsset: { albumDefault: 1 },
}));

jest.mock("@/components/panels/usePanel", () => ({ showPanel: jest.fn() }));

jest.mock("../miniLyric", () => ({ __esModule: true, default: () => null }));

jest.mock("react-native-reanimated", () => {
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: { View: MockView },
        cancelAnimation: jest.fn(),
        Easing: { linear: jest.fn() },
        useAnimatedStyle: (factory: () => object) => factory(),
        useSharedValue: (value: number) => ({ value }),
        withRepeat: jest.fn(),
        withTiming: jest.fn(),
    };
});

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({
        placeholder: "#eeeeee",
        text: "#000000",
        textSecondary: "#666666",
    }),
}));

jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: {
        defaultSheet: { id: "favorite" },
        addMusic: jest.fn(),
        removeMusic: jest.fn(),
    },
    useFavorite: () => false,
}));

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: { getByMedia: jest.fn() },
}));

jest.mock("@/core/router", () => ({
    ROUTE_PATH: {
        SEARCH_PAGE: "search-page",
        ARTIST_DETAIL: "artist-detail",
        ALBUM_DETAIL: "album-detail",
        MUSIC_DETAIL: "music-detail",
    },
    useNavigate: () => jest.fn(),
}));

import AlbumCover from "../index";

// 横屏封面上下各留的空
const COVER_VERTICAL_PADDING = 12;

function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
    const result: ReactTestInstance[] = [];
    for (const child of node.children) {
        if (typeof child === "string") {
            continue;
        }
        if (typeof child.type === "string") {
            result.push(child);
        } else {
            result.push(...hostChildren(child));
        }
    }
    return result;
}

function flatStyle(node: ReactTestInstance): TextStyle {
    return (StyleSheet.flatten(node.props.style) ?? {}) as TextStyle;
}

function edge(
    style: TextStyle,
    side: "Top" | "Bottom",
    kind: "padding" | "margin",
) {
    const value =
        style[`${kind}${side}`] ?? style[`${kind}Vertical`] ?? style[kind];
    return typeof value === "number" ? value : 0;
}

/** 按文件开头说的规则，从渲染出来的样式算一个节点自然展开有多高 */
function naturalHeight(node: ReactTestInstance, fontScale: number): number {
    const style = flatStyle(node);
    const padding =
        edge(style, "Top", "padding") + edge(style, "Bottom", "padding");

    // 宿主节点的类型是字符串，但测试渲染器的类型声明不认 "Text"
    if ((node.type as unknown) === "Text") {
        // 模型只认单行、显式行高的文字
        expect(node.props.numberOfLines).toBe(1);
        expect(typeof style.lineHeight).toBe("number");
        const cap = node.props.maxFontSizeMultiplier;
        const scale =
            typeof cap === "number" && cap >= 1
                ? Math.min(fontScale, cap)
                : fontScale;
        return (style.lineHeight as number) * scale + padding;
    }
    if (typeof style.height === "number") {
        return style.height;
    }

    const children = hostChildren(node).map(child => {
        const childStyle = flatStyle(child);
        return (
            naturalHeight(child, fontScale) +
            edge(childStyle, "Top", "margin") +
            edge(childStyle, "Bottom", "margin")
        );
    });
    const inner =
        style.flexDirection === "row"
            ? Math.max(0, ...children)
            : children.reduce((sum, height) => sum + height, 0);
    return inner + padding;
}

function textContents(renderer: ReactTestRenderer) {
    return renderer.root
        .findAll(node => node.type === (Text as unknown))
        .map(node => node.props.children);
}

describe("AlbumCover in landscape", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    function renderMeasured(options: {
        window: { width: number; height: number };
        strip: { width: number; height: number };
        fontScale: number;
    }) {
        Object.assign(mockWindow, options.window, {
            fontScale: options.fontScale,
        });
        act(() => {
            renderer = create(<AlbumCover />);
        });
        const root = renderer!.root.find(
            node =>
                typeof node.type === "string" &&
                typeof node.props.onLayout === "function",
        );
        act(() => {
            root.props.onLayout({ nativeEvent: { layout: options.strip } });
        });
        return root;
    }

    // 复审表格里的三个窗口：内容区 = 窗口高 − 安全区 − 导航栏 64 − 控制区 176
    const windows = [
        {
            window: { width: 800, height: 360 },
            strip: { width: 400, height: 96 },
        },
        {
            window: { width: 568, height: 320 },
            strip: { width: 284, height: 80 },
        },
        {
            window: { width: 800, height: 320 },
            strip: { width: 400, height: 56 },
        },
    ];

    for (const { window, strip } of windows) {
        const size = `${window.width}×${window.height}`;
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            it(`fits cover and song info in ${size} at font ×${fontScale}`, () => {
                const root = renderMeasured({ window, strip, fontScale });
                const items = hostChildren(root);
                expect(items.length).toBeGreaterThan(0);

                for (const item of items) {
                    expect(naturalHeight(item, fontScale)).toBeLessThanOrEqual(
                        strip.height,
                    );
                }

                const cover = items.find(
                    item => typeof item.props.onLongPress === "function",
                );
                if (cover) {
                    expect(
                        naturalHeight(cover, fontScale) +
                            COVER_VERTICAL_PADDING * 2,
                    ).toBeLessThanOrEqual(strip.height);
                }

                // 标题总在，省掉的只是歌手、专辑
                expect(textContents(renderer!)).toContain(mockMusicItem.title);
            });
        }
    }

    it("shows every line when the strip has room for them", () => {
        renderMeasured({
            window: { width: 800, height: 360 },
            strip: { width: 400, height: 96 },
            fontScale: 1,
        });

        expect(textContents(renderer!)).toEqual(
            expect.arrayContaining([
                mockMusicItem.title,
                mockMusicItem.artist,
                mockMusicItem.album,
            ]),
        );
    });

    it("drops the album first, then the artist, as the strip gets tighter", () => {
        renderMeasured({
            window: { width: 800, height: 320 },
            strip: { width: 400, height: 56 },
            fontScale: 1,
        });
        expect(textContents(renderer!)).toContain(mockMusicItem.artist);
        expect(textContents(renderer!)).not.toContain(mockMusicItem.album);

        act(() => {
            renderer?.unmount();
        });
        renderMeasured({
            window: { width: 800, height: 320 },
            strip: { width: 400, height: 56 },
            fontScale: 1.5,
        });
        expect(textContents(renderer!)).not.toContain(mockMusicItem.artist);
        expect(textContents(renderer!)).not.toContain(mockMusicItem.album);
    });
});
