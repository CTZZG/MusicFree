import {
    defaultHomeOrder,
    moveHomeSection,
    normalizeHomeOrder,
} from "../homeSectionOrder";

describe("home section order", () => {
    it("preserves both existing defaults until a user arranges Home", () => {
        expect(normalizeHomeOrder(undefined)).toEqual([
            "continue",
            "discovery",
            "recent",
            "shortcuts",
        ]);
        expect(normalizeHomeOrder(undefined, false)).toEqual([
            "continue",
            "shortcuts",
            "recent",
            "discovery",
        ]);
    });
    it("accepts a partial backup without losing valid order or duplicating sections", () => {
        expect(
            normalizeHomeOrder(["recent", "old-name", "recent", null, "continue"]),
        ).toEqual(["recent", "continue", "discovery", "shortcuts"]);
        expect(normalizeHomeOrder({ malicious: "value" })).toEqual(defaultHomeOrder());
    });
    it("moves a section without mutating settings and handles list edges", () => {
        const original = defaultHomeOrder();
        expect(moveHomeSection(original, "discovery", -1)).toEqual([
            "discovery",
            "continue",
            "recent",
            "shortcuts",
        ]);
        expect(original).toEqual(defaultHomeOrder());
        expect(moveHomeSection(original, "continue", -1)).toBe(original);
        expect(moveHomeSection(original, "shortcuts", 1)).toBe(original);
    });
});
