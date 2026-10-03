/**
 * 用户反馈界面上的卡片太大。用户的手机调大了显示大小，可用宽度约 363 dp
 * （1272 px ÷ 3.5）。原来首页歌单写死 156 dp、资料库网格最窄 150 dp，在这台
 * 手机上首页一屏只放得下两个歌单，资料库只排两列。
 */
import {
    getShelfTileWidth,
    getTileGrid,
    PAGE_MARGIN,
    TILE_GAP,
} from "../tileLayout";

const USER_PHONE = 363;

describe("getTileGrid", () => {
    it("puts three playlists per row on the user's phone", () => {
        const grid = getTileGrid(USER_PHONE, { minTileWidth: 100 });
        expect(grid.columns).toBe(3);
        expect(grid.tileWidth).toBe(102);
        expect(
            PAGE_MARGIN * 2 +
                grid.tileWidth * grid.columns +
                TILE_GAP * (grid.columns - 1),
        ).toBeLessThanOrEqual(USER_PHONE);
    });

    it("keeps three columns on a typical 412 dp phone and adds more on a tablet", () => {
        expect(getTileGrid(412, { minTileWidth: 100 })).toEqual({
            columns: 3,
            tileWidth: 118,
        });
        expect(getTileGrid(800, { minTileWidth: 100 }).columns).toBe(6);
    });

    it("never drops below the minimum column count", () => {
        expect(getTileGrid(200, { minTileWidth: 100 }).columns).toBe(2);
    });
});

describe("getShelfTileWidth", () => {
    const shelf = { visible: 2.6, min: 100, max: 156 };

    it("shows two and a half covers on the user's phone", () => {
        const width = getShelfTileWidth(USER_PHONE, shelf);
        expect(width).toBe(124);
        // 两个完整的加一部分，提示还能往后滑
        const shown = (USER_PHONE - PAGE_MARGIN) / (width + TILE_GAP);
        expect(shown).toBeGreaterThan(2.4);
        expect(shown).toBeLessThan(3);
    });

    it("stays within the limits on very narrow and very wide screens", () => {
        expect(getShelfTileWidth(240, shelf)).toBe(100);
        expect(getShelfTileWidth(1000, shelf)).toBe(156);
    });
});
