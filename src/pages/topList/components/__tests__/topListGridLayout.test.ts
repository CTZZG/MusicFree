import { resolveTopListGridLayout } from "../topListGridLayout";

const baseOptions = {
    horizontalPadding: 16,
    columnGap: 12,
    minCardWidth: 92,
};

describe("resolveTopListGridLayout", () => {
    it("fits three compact cards on narrow portrait widths", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 360,
            orientation: "vertical",
        });

        expect(layout.availableWidth).toBe(328);
        expect(layout.columnCount).toBe(3);
        expect(layout.itemWidth).toBe(101);
    });

    it("expands portrait grids but caps them at four columns", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 900,
            orientation: "vertical",
        });

        expect(layout.columnCount).toBe(4);
        expect(layout.itemWidth).toBeCloseTo(208);
    });

    it("uses the available panel width for landscape columns", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 500,
            orientation: "horizontal",
        });

        expect(layout.columnCount).toBe(4);
        expect(layout.itemWidth).toBeCloseTo(108);
    });

    it("caps landscape grids at five columns", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 1200,
            orientation: "horizontal",
        });

        expect(layout.columnCount).toBe(5);
        expect(layout.itemWidth).toBeCloseTo(224);
    });

    it("does not return negative widths for very small containers", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 10,
            orientation: "vertical",
        });

        expect(layout.availableWidth).toBe(0);
        expect(layout.columnCount).toBe(3);
        expect(layout.itemWidth).toBe(0);
    });
});
