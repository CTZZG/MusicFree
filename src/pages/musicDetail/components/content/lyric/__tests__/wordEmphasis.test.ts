import { getWordEmphasis } from "../wordEmphasis";

describe("duration-aware lyric emphasis", () => {
    it("keeps ordinary words at the old amplitude and gradually accents long words", () => {
        expect(getWordEmphasis(400, true)).toEqual({ lift: 1, scale: 0, glow: 0 });
        const medium = getWordEmphasis(1600, true);
        const long = getWordEmphasis(2400, true);
        expect(medium.glow).toBeGreaterThan(0);
        expect(medium.glow).toBeLessThan(long.glow);
        expect(long).toEqual({ lift: 1.2, scale: 0.025, glow: 6 });
        expect(getWordEmphasis(100000, true)).toEqual(long);
    });
    it("does not add accents for pseudo/secondary/disabled motion or invalid timing", () => {
        for (const duration of [2400, 10000, NaN, Infinity, -1]) {
            expect(getWordEmphasis(duration, false)).toEqual({
                lift: 1,
                scale: 0,
                glow: 0,
            });
        }
        expect(getWordEmphasis(NaN, true).glow).toBe(0);
        expect(getWordEmphasis(-100, true).glow).toBe(0);
    });
});
