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

        expect(layout.focusHeight).toBe(720);
        expect(layout.tapHeight).toBe(832);
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
