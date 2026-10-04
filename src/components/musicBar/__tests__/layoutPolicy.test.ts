import { resolveMusicBarLayout } from "../layoutPolicy";
import {
    MUSIC_BAR_FLOATING_BOTTOM,
    MUSIC_BAR_HEIGHT,
    MUSIC_BAR_TAB_BAR_GAP,
    TAB_BAR_HEIGHT,
} from "../layout";

const baseInput = {
    routeSupportsMusicBar: true,
    routeHasTabBar: false,
    hasCurrentMusic: true,
    keyboardVisible: false,
    barHeight: MUSIC_BAR_HEIGHT,
    floatingBottom: MUSIC_BAR_FLOATING_BOTTOM,
    tabBarHeight: TAB_BAR_HEIGHT,
    tabBarGap: MUSIC_BAR_TAB_BAR_GAP,
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
            barBottom: 8,
            reservedBottom: 0,
        });
    });

    it("floats the bar above the safe area on pages without a tab bar", () => {
        expect(resolveMusicBarLayout(baseInput)).toEqual({
            visible: true,
            tabBarVisible: false,
            barBottom: 8,
            reservedBottom: 68,
        });
    });

    it("stacks the bar above the tab bar on the home tabs", () => {
        expect(
            resolveMusicBarLayout({ ...baseInput, routeHasTabBar: true }),
        ).toEqual({
            visible: true,
            tabBarVisible: true,
            // 8 底距 + 60 标签栏 + 8 间距
            barBottom: 76,
            reservedBottom: 136,
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
            barBottom: 76,
            reservedBottom: 68,
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
            barBottom: 8,
            reservedBottom: 0,
        });
    });
});
