import { resolveMusicBarLayout } from "../layoutPolicy";

const baseInput = {
    routeSupportsMusicBar: true,
    routeHasTabBar: false,
    hasCurrentMusic: true,
    keyboardVisible: false,
    barHeight: 62,
    floatingBottom: 10,
    tabBarHeight: 64,
    tabBarGap: 10,
};

describe("resolveMusicBarLayout", () => {
    it.each([
        ["unsupported route", { routeSupportsMusicBar: false }],
        ["empty player", { hasCurrentMusic: false }],
        ["visible keyboard", { keyboardVisible: true }],
    ])("does not reserve a phantom inset for %s", (_label, patch) => {
        expect(resolveMusicBarLayout({ ...baseInput, ...patch })).toEqual({
            visible: false,
            tabBarVisible: false,
            barBottom: 10,
            reservedBottom: 0,
        });
    });

    it("floats the bar above the safe area on pages without a tab bar", () => {
        expect(resolveMusicBarLayout(baseInput)).toEqual({
            visible: true,
            tabBarVisible: false,
            barBottom: 10,
            reservedBottom: 72,
        });
    });

    it("stacks the bar above the tab bar on the home tabs", () => {
        expect(
            resolveMusicBarLayout({ ...baseInput, routeHasTabBar: true }),
        ).toEqual({
            visible: true,
            tabBarVisible: true,
            // 10 底距 + 64 标签栏 + 10 间距
            barBottom: 84,
            reservedBottom: 146,
        });
    });

    it("still reserves the tab bar when nothing is playing", () => {
        expect(
            resolveMusicBarLayout({
                ...baseInput,
                routeHasTabBar: true,
                hasCurrentMusic: false,
            }),
        ).toEqual({
            visible: false,
            tabBarVisible: true,
            barBottom: 84,
            reservedBottom: 74,
        });
    });

    it("hides both the tab bar and the music bar while typing", () => {
        expect(
            resolveMusicBarLayout({
                ...baseInput,
                routeHasTabBar: true,
                keyboardVisible: true,
            }),
        ).toEqual({
            visible: false,
            tabBarVisible: false,
            barBottom: 10,
            reservedBottom: 0,
        });
    });
});
