import { getCardGroupPosition } from "../cardGroupPosition";

describe("getCardGroupPosition", () => {
    it("rounds a lone row on both ends", () => {
        expect(getCardGroupPosition(0, 1)).toBe("single");
    });

    it("joins consecutive rows into one card", () => {
        expect(
            [0, 1, 2, 3].map(index => getCardGroupPosition(index, 4)),
        ).toEqual(["first", "middle", "middle", "last"]);
    });

    it("treats a two-row list as first and last", () => {
        expect(getCardGroupPosition(0, 2)).toBe("first");
        expect(getCardGroupPosition(1, 2)).toBe("last");
    });
});
