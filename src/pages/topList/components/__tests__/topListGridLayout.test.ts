import { resolveTopListGridLayout } from "../topListGridLayout";

const baseOptions = {
    horizontalPadding: 12,
    columnGap: 8,
    minCardWidth: 140,
};

describe("resolveTopListGridLayout", () => {
    it("keeps two columns on narrow portrait widths", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 360,
            orientation: "vertical",
        });

        expect(layout.availableWidth).toBe(336);
        expect(layout.columnCount).toBe(2);
        expect(layout.itemWidth).toBe(164);
    });

    it("expands portrait grids but caps them at four columns", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 900,
            orientation: "vertical",
        });

        expect(layout.columnCount).toBe(4);
        expect(layout.itemWidth).toBeCloseTo(213);
    });

    it("uses at least three columns in landscape", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 500,
            orientation: "horizontal",
        });

        expect(layout.columnCount).toBe(3);
        expect(layout.itemWidth).toBeCloseTo(153.333, 3);
    });

    it("caps landscape grids at five columns", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 1200,
            orientation: "horizontal",
        });

        expect(layout.columnCount).toBe(5);
        expect(layout.itemWidth).toBeCloseTo(228.8);
    });

    it("does not return negative widths for very small containers", () => {
        const layout = resolveTopListGridLayout({
            ...baseOptions,
            containerWidth: 10,
            orientation: "vertical",
        });

        expect(layout.availableWidth).toBe(0);
        expect(layout.columnCount).toBe(2);
        expect(layout.itemWidth).toBe(0);
    });
});
