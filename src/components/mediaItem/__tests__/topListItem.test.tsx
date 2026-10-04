import React from "react";
import { Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockNavigate = jest.fn();
jest.mock("@/core/router", () => ({
    ROUTE_PATH: { TOP_LIST_DETAIL: "top-list-detail" },
    useNavigate: () => mockNavigate,
}));
jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));
jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ card: "#FFFFFF", text: "#000000", placeholder: "#CCCCCC" }),
}));
jest.mock("@/constants/assetsConst", () => ({ ImgAsset: { albumDefault: 1 } }));
jest.mock("../../base/fastImage", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: (props: object) => mockReact.createElement(MockView, { ...props, testID: "chart-cover" }),
    };
});

import TopListItem from "../topListItem";

const chart: IMusic.IMusicSheetItemBase = {
    id: "recent",
    platform: "LXD",
    title: "最新入库",
    artwork: "https://example.com/chart.jpg",
};

describe("TopListItem", () => {
    let renderer: ReactTestRenderer | undefined;
    const render = (item: IMusic.IMusicSheetItemBase) => act(() => {
        renderer = create(<TopListItem topListItem={item} pluginHash="source-hash" />);
    });
    const button = () => renderer!.root.find(node =>
        node.props.accessibilityRole === "button" && typeof node.props.onPress === "function",
    );
    const texts = () => renderer!.root.findAll(node => node.type === (Text as unknown))
        .map(node => node.props.children);

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        mockNavigate.mockClear();
    });

    it("opens the original chart and accepts artwork-only covers", () => {
        render(chart);
        act(() => button().props.onPress());
        expect(mockNavigate).toHaveBeenCalledWith("top-list-detail", {
            pluginHash: "source-hash",
            topList: chart,
        });
        expect(renderer!.root.findByProps({ testID: "chart-cover" }).props.source).toBe(chart.artwork);
    });

    it("shows at most three valid preview songs and opens the same chart", () => {
        const withPreview = {
            ...chart,
            musicList: [null, { title: " " }, { title: "One", artist: "Artist" },
                { title: "Two" }, { title: "Three" }, { title: "Four" }],
        };
        render(withPreview);
        expect(texts()).toEqual(["最新入库", "1. One · Artist", "2. Two", "3. Three"]);
        act(() => button().props.onPress());
        expect(mockNavigate).toHaveBeenCalledWith("top-list-detail", {
            pluginHash: "source-hash",
            topList: withPreview,
        });
        expect(withPreview.musicList).toHaveLength(6);
    });

    it("falls back to a tile when preview metadata is not a song array", () => {
        render({ ...chart, musicList: { title: "not a song list" } });
        expect(texts()).toEqual(["最新入库"]);
    });

    it("keeps an untitled chart accessible without a cover", () => {
        render({ id: "empty", platform: "test", title: " " });
        expect(button().props.accessibilityLabel).toBe("common.unknownName");
        expect(texts()).toEqual(["common.unknownName"]);
    });
});
