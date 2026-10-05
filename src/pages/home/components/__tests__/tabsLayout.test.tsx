/**
 * 标签栏的模糊要成立有两个前提，这组测试锁住它们：
 * - 标签栏在 BlurTargetView 外面：在里面会把自己也录进模糊；
 * - 页面底色和首页背景图在 BlurTargetView 里面：首页标签是透明的，
 *   背景不在里面，模糊出来就是窗口的深色底。
 */
import React from "react";
import { Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("expo-blur", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    function MockBlurTargetView(props: any) {
        return mockReact.createElement(MockView, props);
    }
    return { BlurTargetView: MockBlurTargetView };
});

jest.mock("../tabBar", () => ({
    __esModule: true,
    default: function MockHomeTabBar() {
        return null;
    },
}));

jest.mock("@/components/base/pageBackground", () => ({
    __esModule: true,
    default: function MockPageBackground() {
        return null;
    },
}));

import HomeTabsLayout from "../tabsLayout";

const { BlurTargetView } = jest.requireMock("expo-blur");
const HomeTabBar = jest.requireMock("../tabBar").default;
const PageBackground = jest.requireMock(
    "@/components/base/pageBackground",
).default;

describe("HomeTabsLayout", () => {
    let renderer: ReactTestRenderer | undefined;

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("keeps the tab bar outside the content it blurs", () => {
        const state = { index: 0, routes: [] } as any;
        const navigation = { emit: jest.fn(), navigate: jest.fn() } as any;

        act(() => {
            renderer = create(
                <HomeTabsLayout state={state} navigation={navigation}>
                    <Text>content</Text>
                </HomeTabsLayout>,
                { createNodeMock: () => ({}) },
            );
        });

        const target = renderer!.root.findByType(BlurTargetView);
        const tabBar = renderer!.root.findByType(HomeTabBar);

        expect(target.findAllByType(HomeTabBar)).toHaveLength(0);
        expect(tabBar.props.blurTarget).toBe(target.props.ref);
        expect(tabBar.props.blurTarget.current).not.toBeNull();
        expect(tabBar.props.state).toBe(state);
        expect(tabBar.props.navigation).toBe(navigation);

        expect(
            target.findAll(node => node.props.children === "content"),
        ).not.toHaveLength(0);
        expect(target.findByType(PageBackground).props.showCustomImage).toBe(
            true,
        );
    });
});
