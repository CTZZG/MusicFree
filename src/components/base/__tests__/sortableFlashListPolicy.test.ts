import {
    getSortableAutoScrollOffset,
    getSortableAccessibilityTarget,
    getSortableDropIndex,
    moveSortableItem,
    updateSortableFrameStats,
} from "../sortableFlashListPolicy";

describe("sortable flash list policy", () => {
    it("moves an item without mutating the caller data", () => {
        const source = ["a", "b", "c"];

        expect(moveSortableItem(source, 0, 2)).toEqual(["b", "c", "a"]);
        expect(source).toEqual(["a", "b", "c"]);
        expect(moveSortableItem(source, 1, 1)).toBeNull();
        expect(moveSortableItem(source, -1, 0)).toBeNull();
        expect(moveSortableItem(source, 0, 3)).toBeNull();
    });

    it("maps screen-reader shortcuts without crossing list bounds", () => {
        expect(getSortableAccessibilityTarget(4, 2, "decrement")).toBe(1);
        expect(getSortableAccessibilityTarget(4, 2, "increment")).toBe(3);
        expect(getSortableAccessibilityTarget(4, 2, "moveToTop")).toBe(0);
        expect(getSortableAccessibilityTarget(4, 2, "moveToBottom")).toBe(3);
        expect(getSortableAccessibilityTarget(4, 0, "decrement")).toBeNull();
        expect(getSortableAccessibilityTarget(4, 3, "moveToBottom")).toBeNull();
        expect(getSortableAccessibilityTarget(0, 0, "increment")).toBeNull();
    });

    it("records only valid frame intervals and flags slow frames", () => {
        const initial = { frameCount: 0, slowFrameCount: 0, maxFrameMs: 0 };
        const first = updateSortableFrameStats(initial, 16);
        const second = updateSortableFrameStats(first, 45);

        expect(second).toEqual({
            frameCount: 2,
            slowFrameCount: 1,
            maxFrameMs: 45,
        });
        expect(updateSortableFrameStats(second, Number.NaN)).toBe(second);
    });

    it("clamps drag destinations to the first and last valid item", () => {
        expect(
            getSortableDropIndex({
                dataLength: 3,
                itemHeight: 100,
                scrollOffset: 0,
                draggingItemOffsetY: -20,
            }),
        ).toBe(0);
        expect(
            getSortableDropIndex({
                dataLength: 3,
                itemHeight: 100,
                scrollOffset: 1000,
                draggingItemOffsetY: 100,
            }),
        ).toBe(2);
        expect(
            getSortableDropIndex({
                dataLength: 3,
                itemHeight: 0,
                scrollOffset: 0,
                draggingItemOffsetY: 0,
            }),
        ).toBeNull();
    });

    it("auto-scrolls proportionally while respecting content bounds", () => {
        expect(
            getSortableAutoScrollOffset({
                draggingItemOffsetY: 0,
                itemHeight: 100,
                viewportHeight: 500,
                contentHeight: 1500,
                currentOffset: 10,
                elapsedMs: 22,
            }),
        ).toBe(0);
        expect(
            getSortableAutoScrollOffset({
                draggingItemOffsetY: 450,
                itemHeight: 100,
                viewportHeight: 500,
                contentHeight: 1500,
                currentOffset: 990,
                elapsedMs: 48,
            }),
        ).toBe(1000);
        expect(
            getSortableAutoScrollOffset({
                draggingItemOffsetY: 250,
                itemHeight: 100,
                viewportHeight: 500,
                contentHeight: 1500,
                currentOffset: 400,
                elapsedMs: 22,
            }),
        ).toBe(400);
        expect(
            getSortableAutoScrollOffset({
                draggingItemOffsetY: 250,
                itemHeight: 100,
                viewportHeight: 500,
                contentHeight: 1500,
                currentOffset: Number.NaN,
                elapsedMs: 16,
            }),
        ).toBe(0);
    });
});
