import shuffle from "@/utils/shuffle";

describe("shuffle", () => {
    it("returns a new array and does not mutate the input", () => {
        const input = [1, 2, 3, 4, 5];
        const snapshot = [...input];
        const result = shuffle(input);

        expect(result).not.toBe(input);
        expect(input).toEqual(snapshot);
    });

    it("preserves all elements (is a permutation)", () => {
        const input = ["a", "b", "c", "d", "e", "f"];
        const result = shuffle(input);

        expect(result).toHaveLength(input.length);
        expect([...result].sort()).toEqual([...input].sort());
    });

    it("handles empty and single-element arrays", () => {
        expect(shuffle([])).toEqual([]);
        expect(shuffle([42])).toEqual([42]);
    });
});
