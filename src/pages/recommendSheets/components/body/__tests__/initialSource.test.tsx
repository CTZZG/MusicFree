/**
 * 首页「推荐歌单 · 全部」以前不带音源，推荐歌单页总是停在第一个插件上，
 * 和首页刚看的那个音源对不上（「榜单 · 全部」一直是带着的）。
 */
import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

let mockParams: { initialPluginHash?: string } | undefined;
let mockNavigationIndex: number | undefined;

jest.mock("@/core/router", () => ({
    useParams: () => mockParams,
}));

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        getSortedPluginsWithAbility: () => [
            { hash: "hash-a", name: "A" },
            { hash: "hash-b", name: "B" },
        ],
    },
}));

jest.mock("react-native-tab-view", () => ({
    TabBar: () => null,
    TabView: (props: { navigationState: { index: number } }) => {
        mockNavigationIndex = props.navigationState.index;
        return null;
    },
}));

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({ primary: "#0a84ff", text: "#000", textSecondary: "#666" }),
}));

jest.mock("@/core/i18n", () => ({
    useI18N: () => ({ t: (key: string) => key }),
}));

jest.mock("@/components/base/noPlugin", () => () => null);
jest.mock("../sheetBody", () => () => null);

import Body from "..";

describe("recommend sheets initial source", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
        mockNavigationIndex = undefined;
    });

    function renderBody(params: typeof mockParams) {
        mockParams = params;
        act(() => {
            renderer = create(<Body />);
        });
        return mockNavigationIndex;
    }

    it("opens on the source the home page was showing", () => {
        expect(renderBody({ initialPluginHash: "hash-b" })).toBe(1);
    });

    it("opens on the first source without one, or when it is gone", () => {
        expect(renderBody(undefined)).toBe(0);
        act(() => {
            renderer?.unmount();
        });
        expect(renderBody({ initialPluginHash: "removed" })).toBe(0);
    });
});
