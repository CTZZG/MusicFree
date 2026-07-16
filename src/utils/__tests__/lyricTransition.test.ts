import {
    LYRIC_TRANSITION_DURATION_MS,
    getFullLyricOpacity,
    getMiniLyricOpacity,
} from "../lyricTransition";

describe("lyric transition policy", () => {
    it("keeps the mini lyric focus hierarchy stable", () => {
        expect([0, 1, 2, 3].map(getMiniLyricOpacity)).toEqual([
            1, 0.46, 0.2, 0.06,
        ]);
    });

    it("uses the right full lyric opacity for normal, AMLL and drag states", () => {
        expect(getFullLyricOpacity({ highlight: true })).toBe(1);
        expect(getFullLyricOpacity({})).toBe(0.58);
        expect(getFullLyricOpacity({ amllLiteMode: true })).toBe(0.34);
        expect(
            getFullLyricOpacity({
                highlight: true,
                light: true,
                amllLiteMode: true,
            }),
        ).toBe(0.9);
    });

    it("uses a short transition that does not lag behind lyric timing", () => {
        expect(LYRIC_TRANSITION_DURATION_MS).toBeGreaterThanOrEqual(260);
        expect(LYRIC_TRANSITION_DURATION_MS).toBeLessThanOrEqual(320);
    });
});
