/**
 * 推荐歌单网格：格子里原来是固定 210rpx 宽的图片按钮，外面再套左右各留 16 的
 * 卡片。三列时内容比卡片宽，两边被裁掉：标题第一个字缺一半，卡片的圆角和底色
 * 从图片上方露出来。现在格子里的尺寸全部跟着列宽走。
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import {
    act,
    create,
    ReactTestInstance,
    ReactTestRenderer,
} from "react-test-renderer";

const mockNavigate = jest.fn();

jest.mock("@/core/router", () => ({
    ROUTE_PATH: { PLUGIN_SHEET_DETAIL: "plugin-sheet-detail" },
    useNavigate: () => mockNavigate,
}));

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({
        placeholder: "rgba(118, 118, 128, 0.24)",
        text: "#FFFFFF",
    }),
}));

jest.mock("@/constants/assetsConst", () => ({
    ImgAsset: { albumDefault: 1 },
}));

jest.mock("../../base/fastImage", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: (props: { style?: object }) =>
            mockReact.createElement(MockView, {
                style: props.style,
                testID: "sheet-cover",
            }),
    };
});

import SheetItem, { SHEET_GRID_SIDE_PADDING } from "../sheetItem";

const sheet = {
    id: "1",
    platform: "酷我音乐",
    title: "【怀旧伤感】为你而心碎，再见也是朋友",
    artwork: "https://example.com/sheet.jpg",
} as IMusic.IMusicSheetItemBase;

function hostNodes(renderer: ReactTestRenderer) {
    return renderer.root.findAll(
        (node: ReactTestInstance) => typeof node.type === "string",
    );
}

describe("SheetItem", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        mockNavigate.mockClear();
    });

    function render(sheetInfo = sheet) {
        act(() => {
            renderer = create(
                <SheetItem sheetInfo={sheetInfo} pluginHash="kuwo" />,
            );
        });
        return renderer!;
    }

    it("sizes everything from the column width, so nothing is clipped", () => {
        render();
        for (const node of hostNodes(renderer!)) {
            const style = StyleSheet.flatten(node.props.style) ?? {};
            expect(typeof style.width).not.toBe("number");
            expect(typeof style.minWidth).not.toBe("number");
        }

        const cover = renderer!.root.find(
            node =>
                typeof node.type === "string" &&
                node.props.testID === "sheet-cover",
        );
        const coverStyle = StyleSheet.flatten(cover.props.style);
        expect(coverStyle.width).toBe("100%");
        expect(coverStyle.aspectRatio).toBe(1);
    });

    it("shows the title on up to two lines under the cover", () => {
        render();
        const title = renderer!.root.find(
            node => node.type === (Text as unknown) && node.props.children,
        );
        expect(title.props.children).toBe(sheet.title);
        expect(title.props.numberOfLines).toBe(2);
    });

    it("lines the grid up with the 16 dp page margin used on the home page", () => {
        render();
        const tile = hostNodes(renderer!)[0];
        const style = StyleSheet.flatten(tile.props.style);
        expect(SHEET_GRID_SIDE_PADDING + Number(style.marginHorizontal)).toBe(
            16,
        );
    });

    it("opens the sheet", () => {
        render();
        const pressable = renderer!.root.find(
            node =>
                typeof node.props.onPress === "function" &&
                node.props.accessibilityRole === "button",
        );
        act(() => {
            pressable.props.onPress();
        });
        expect(mockNavigate).toHaveBeenCalledWith("plugin-sheet-detail", {
            pluginHash: "kuwo",
            sheetInfo: sheet,
        });
    });

    it("names an untitled sheet instead of leaving a blank tile", () => {
        render({ ...sheet, title: "" });
        const title = renderer!.root.find(
            node => node.type === (Text as unknown) && node.props.children,
        );
        expect(title.props.children).toBe("common.unknownName");
    });
});
