/**
 * 插件用户变量、Last.fm 凭据、WebDAV 设置共用这张表单。以前名称最多占一行的 35%、
 * 说明只放在输入框的占位文字里，两者都被截断，开始输入说明就消失了。
 */
import React from "react";
import { Text, TextInput } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("../../base/panelBase", () => ({
    __esModule: true,
    default: (props: { renderBody: () => React.ReactNode }) =>
        props.renderBody(),
}));

jest.mock("../../base/panelHeader", () => {
    const mockReact = require("react");
    const { Text: MockText } = require("react-native");
    return {
        __esModule: true,
        default: (props: { title: string }) =>
            mockReact.createElement(MockText, { testID: "title" }, props.title),
    };
});

jest.mock("../../usePanel", () => ({ hidePanel: jest.fn() }));

// 真正的 Input 引入的 color 包是 ESM，jest 不转；这里只关心面板怎么排版
jest.mock("@/components/base/input", () => {
    const mockReact = require("react");
    const { TextInput: MockTextInput } = require("react-native");
    return {
        __esModule: true,
        default: (props: object) =>
            mockReact.createElement(MockTextInput, props),
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

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));

jest.mock("react-native-gesture-handler", () => {
    const { ScrollView } = require("react-native");
    return { ScrollView };
});

import SetUserVariables from "../setUserVariables";

// react-test-renderer 的类型带着自己那份 @types/react，直接传 RN 组件类型会报错
const ofType = (type: unknown) => (node: { type: unknown }) => node.type === type;

const longHint =
    "可填写浏览器完整 Cookie；优先使用此字段，支持 buvid3、SESSDATA 等全部字段";

describe("SetUserVariables", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    function renderPanel(title?: string) {
        act(() => {
            renderer = create(
                <SetUserVariables
                    title={title}
                    onOk={jest.fn()}
                    variables={[
                        {
                            key: "cookie",
                            name: "Bilibili Cookie（SESSDATA 等）",
                            hint: longHint,
                        },
                        { key: "ck", name: "CK" },
                    ]}
                    initValues={{ cookie: "saved" }}
                />,
            );
        });
        return renderer!;
    }

    it("shows names and hints in full instead of truncating them", () => {
        const root = renderPanel().root;
        const texts = root.findAll(ofType(Text));

        expect(
            texts.filter(node => node.props.numberOfLines !== undefined),
        ).toHaveLength(0);
        expect(
            texts.some(node => node.props.children === longHint),
        ).toBe(true);
        expect(
            texts.some(
                node => node.props.children === "Bilibili Cookie（SESSDATA 等）",
            ),
        ).toBe(true);
    });

    it("keeps the hint out of the input so it stays visible while typing", () => {
        const inputs = renderPanel().root.findAll(ofType(TextInput));

        expect(inputs).toHaveLength(2);
        inputs.forEach(input => {
            expect(input.props.placeholder).toBeUndefined();
        });
        expect(inputs[0].props.defaultValue).toBe("saved");
    });

    it("uses a translated default title", () => {
        const root = renderPanel().root;
        expect(root.findByProps({ testID: "title" }).props.children).toBe(
            "panel.setUserVariables.title",
        );
    });
});
