jest.mock("@/utils/rpx", () => ({
    __esModule: true,
    default: (value: number) => value,
}));

import { getMusicDetailHeroLayout } from "../heroLayout";

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
