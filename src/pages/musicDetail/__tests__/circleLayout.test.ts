jest.mock("@/utils/rpx", () => ({
    __esModule: true,
    default: (value: number) => value,
}));

import {
    getMusicDetailCircleLayout,
    getMusicDetailCircleLyricLayout,
} from "../circleLayout";

describe("getMusicDetailCircleLayout", () => {
    it("keeps the circle cover below the compact navigation and below the hero scale cap", () => {
        const layout = getMusicDetailCircleLayout({
            windowWidth: 960,
            windowHeight: 1920,
            safeAreaTop: 48,
            safeAreaBottom: 36,
        });

        expect(layout.navHeight).toBe(112);
        expect(layout.topGap).toBe(24);
        expect(layout.coverSize).toBe(480);
    });

    it("reduces the cover on a short portrait viewport", () => {
        const layout = getMusicDetailCircleLayout({
            windowWidth: 720,
            windowHeight: 1280,
            safeAreaTop: 24,
            safeAreaBottom: 24,
        });

        expect(layout.coverSize).toBeCloseTo(418.88, 5);
    });
});

describe("getMusicDetailCircleLyricLayout", () => {
    it("uses a larger, lower lyric viewport on tall portrait screens", () => {
        const layout = getMusicDetailCircleLyricLayout({
            windowWidth: 960,
            windowHeight: 1920,
        });

        expect(layout).toEqual({
            containerHeight: 156,
            marginTop: 24,
            groupHeight: 52,
            activeFontSize: 32,
            contextFontSize: 27,
            activeLineHeight: 48,
            contextLineHeight: 40,
            fadeHeight: 36,
        });
    });

    it("keeps the lyric viewport compact on short portrait screens", () => {
        const layout = getMusicDetailCircleLyricLayout({
            windowWidth: 720,
            windowHeight: 1280,
        });

        expect(layout).toEqual({
            containerHeight: 112,
            marginTop: 16,
            groupHeight: 44,
            activeFontSize: 28,
            contextFontSize: 24,
            activeLineHeight: 40,
            contextLineHeight: 34,
            fadeHeight: 28,
        });
    });
});
