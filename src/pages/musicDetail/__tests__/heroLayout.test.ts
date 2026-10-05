jest.mock("@/utils/rpx", () => ({
    __esModule: true,
    default: (value: number) => value,
}));

import {
    getMusicDetailHeroLayout,
    HERO_CONTENT_BOTTOM_PADDING,
    HERO_MINI_LYRIC_BLOCK,
} from "../heroLayout";

describe("getMusicDetailHeroLayout", () => {
    it("places the lyric and song information slightly lower on tall screens", () => {
        const layout = getMusicDetailHeroLayout({
            windowWidth: 750,
            windowHeight: 1600,
            safeAreaTop: 0,
            safeAreaBottom: 0,
        });

        // 1600 - 440（下半部分）- 112（导航）- 350（歌词与歌名）= 698，比宽度上的 720 小
        expect(layout.focusHeight).toBe(698);
        expect(layout.tapHeight).toBe(810);
    });

    it("keeps the minimum artwork focus height on short screens", () => {
        const layout = getMusicDetailHeroLayout({
            windowWidth: 750,
            windowHeight: 1100,
            safeAreaTop: 0,
            safeAreaBottom: 0,
        });

        expect(layout.focusHeight).toBe(300);
        expect(layout.tapHeight).toBe(412);
    });
});

describe("getMusicDetailHeroLayout with measured heights", () => {
    const screen = {
        windowWidth: 750,
        windowHeight: 1600,
        safeAreaTop: 0,
        safeAreaBottom: 0,
    };

    function stackHeight(
        layout: ReturnType<typeof getMusicDetailHeroLayout>,
        songInfoHeight: number,
    ) {
        return (
            layout.tapHeight +
            (layout.showMiniLyric ? HERO_MINI_LYRIC_BLOCK : 0) +
            songInfoHeight +
            HERO_CONTENT_BOTTOM_PADDING
        );
    }

    it("matches the estimate when the measurements agree with it", () => {
        const layout = getMusicDetailHeroLayout({
            ...screen,
            contentHeight: 1160,
            songInfoHeight: 118,
        });

        expect(layout.focusHeight).toBe(698);
        expect(layout.showMiniLyric).toBe(true);
    });

    it("pulls the focus area up when the song info is taller", () => {
        const layout = getMusicDetailHeroLayout({
            ...screen,
            contentHeight: 1120,
            songInfoHeight: 160,
        });

        expect(layout.showMiniLyric).toBe(true);
        expect(stackHeight(layout, 160)).toBeLessThanOrEqual(1120);
    });

    it("drops the mini lyric instead of overflowing on a short screen", () => {
        // 估算模式在这里会把焦点区钳在 300，内容溢出到进度条上
        const layout = getMusicDetailHeroLayout({
            ...screen,
            windowHeight: 1100,
            contentHeight: 660,
            songInfoHeight: 118,
        });

        expect(layout.showMiniLyric).toBe(false);
        expect(layout.focusHeight).toBe(660 - 112 - 64 - 118);
        expect(stackHeight(layout, 118)).toBeLessThanOrEqual(660);
    });
});
