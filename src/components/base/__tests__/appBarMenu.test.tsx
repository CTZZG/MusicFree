import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

const mockAnimations: Array<{ target: number; finish?: (finished: boolean) => void }> = [];
jest.mock("color", () => ({
    __esModule: true,
    default: () => ({ alpha: () => ({ toString: () => "#000000" }) }),
}));

jest.mock("@/hooks/useColors", () => ({
    __esModule: true,
    default: () => ({
        background: "#F2F2F7", appBar: "#F2F2F7", text: "#000000",
        primary: "#0066D6", backdrop: "#FFFFFF", divider: "#CCCCCC",
    }),
}));
jest.mock("@react-navigation/native", () => ({
    useNavigation: () => ({ goBack: jest.fn() }),
    useTheme: () => ({ dark: false }),
}));
jest.mock("react-native-reanimated", () => {
    const { useRef } = require("react");
    const { View } = require("react-native");
    return {
        __esModule: true,
        default: { View },
        Easing: { out: () => (value: number) => value, exp: (value: number) => value },
        useSharedValue: (value: number) => useRef({ value }).current,
        useAnimatedStyle: (compute: () => unknown) => compute(),
        withTiming: (target: number, _config: unknown, finish?: (finished: boolean) => void) => {
            mockAnimations.push({ target, finish });
            return target;
        },
        runOnJS: (callback: () => void) => callback,
    };
});
jest.mock("../portal", () => ({ __esModule: true, default: ({ children }: any) => children }));
jest.mock("../statusBar", () => ({ __esModule: true, default: () => null }));
jest.mock("../icon", () => ({
    __esModule: true,
    default: () => null,
}));
jest.mock("../themeText", () => ({
    __esModule: true,
    default: ({ children }: any) => require("react").createElement("menu-text", {}, children),
}));
jest.mock("../listItem", () => {
    const item = (props: any) => require("react").createElement("menu-item", props);
    item.Content = () => null;
    item.ListItemIcon = () => null;
    return { __esModule: true, default: item };
});

import AppBar from "../appBar";

describe("AppBar menu navigation", () => {
    let renderer: ReactTestRenderer;
    const action = jest.fn();

    beforeEach(() => {
        jest.useFakeTimers();
        action.mockClear();
        mockAnimations.length = 0;
        act(() => {
            renderer = create(<AppBar menu={[{ icon: "bookmark-square", title: "订阅设置", onPress: action }]}>
                插件管理
            </AppBar>);
        });
        act(() => {
            openMenu();
        });
    });

    afterEach(() => {
        act(() => renderer.unmount());
        jest.useRealTimers();
    });

    // 导航栏按钮是一层 Pressable，图标在里面
    function openMenu() {
        renderer.root.find(node => node.props.accessibilityLabel === "ellipsis-vertical" && typeof node.props.onPress === "function").props.onPress();
    }

    function selectSubscription() {
        act(() => renderer.root.find(node => (node.type as unknown) === "menu-item").props.onPress());
        return mockAnimations[mockAnimations.length - 1];
    }

    it("waits for the menu's actual closing animation before opening subscriptions", () => {
        const closing = selectSubscription();
        act(() => jest.advanceTimersByTime(1_000));
        expect(action).not.toHaveBeenCalled();
        act(() => closing.finish?.(true));
        expect(action).toHaveBeenCalledTimes(1);
        act(() => closing.finish?.(true));
        expect(action).toHaveBeenCalledTimes(1);
    });

    it("does not navigate after an interrupted close", () => {
        const closing = selectSubscription();
        act(() => closing.finish?.(false));
        expect(action).not.toHaveBeenCalled();
    });

    it("cancels a pending action when the menu is reopened", () => {
        const closing = selectSubscription();
        act(() => {
            openMenu();
        });
        act(() => closing.finish?.(true));
        expect(action).not.toHaveBeenCalled();
    });

    it("does not navigate from an unmounted page's late animation callback", () => {
        const closing = selectSubscription();
        act(() => renderer.unmount());
        act(() => closing.finish?.(true));
        expect(action).not.toHaveBeenCalled();
    });

    it("does not let a late close callback consume a newer menu selection", () => {
        const previousClose = selectSubscription();
        act(() => {
            openMenu();
        });
        const currentClose = selectSubscription();
        act(() => previousClose.finish?.(true));
        expect(action).not.toHaveBeenCalled();
        act(() => currentClose.finish?.(true));
        expect(action).toHaveBeenCalledTimes(1);
    });
});
