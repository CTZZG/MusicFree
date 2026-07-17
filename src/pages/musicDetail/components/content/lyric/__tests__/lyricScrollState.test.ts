import {
    createLyricPayloadIdentity,
    getLyricScrollTargetIndex,
    resolveLyricActiveIndex,
    resolveLyricRestoreIndex,
} from "../lyricScrollState";

describe("lyric scroll state helpers", () => {
    it("returns -1 when there are no lyrics", () => {
        expect(
            resolveLyricRestoreIndex({
                lyricsLength: 0,
                activeIndex: 4,
                restoreIndex: 2,
            }),
        ).toBe(-1);
    });

    it("prefers a cached restore index and clamps it to the lyric range", () => {
        expect(
            resolveLyricRestoreIndex({
                lyricsLength: 4,
                activeIndex: 1,
                restoreIndex: 2,
            }),
        ).toBe(2);
        expect(
            resolveLyricRestoreIndex({
                lyricsLength: 4,
                activeIndex: 1,
                restoreIndex: 8,
            }),
        ).toBe(3);
    });

    it("falls back to the active index and treats inactive playback as the first line", () => {
        expect(
            resolveLyricRestoreIndex({
                lyricsLength: 4,
                activeIndex: 3,
                restoreIndex: -1,
            }),
        ).toBe(3);
        expect(
            resolveLyricRestoreIndex({
                lyricsLength: 4,
                activeIndex: -1,
                restoreIndex: -1,
            }),
        ).toBe(0);
    });

    it("prefers the hydrated progress index over a stale highlighted line", () => {
        expect(
            resolveLyricActiveIndex({
                lyricsLength: 8,
                progressIndex: 5,
                activeIndex: 0,
            }),
        ).toBe(5);
        expect(
            resolveLyricActiveIndex({
                lyricsLength: 8,
                progressIndex: -1,
                activeIndex: 3,
            }),
        ).toBe(3);
    });

    it("builds a stable identity from the music and lyric payload boundaries", () => {
        expect(
            createLyricPayloadIdentity(
                { platform: "local", id: "song-a" },
                [{ time: 1 } as any, { time: 10 } as any],
            ),
        ).toBe("local:song-a:2:1:10");
        expect(
            createLyricPayloadIdentity(
                { platform: "local", id: "song-a" },
                [{ time: 1 } as any, { time: 12 } as any],
            ),
        ).toBe("local:song-a:2:1:12");
    });

    it("finds the detail-page follow target with offset and lead time", () => {
        const lyrics = [
            { time: 1 } as any,
            { time: 3 } as any,
            { time: 5 } as any,
        ];

        expect(getLyricScrollTargetIndex(lyrics, 2900, 0, 120)).toBe(1);
        expect(getLyricScrollTargetIndex(lyrics, 2900, 0.5, 120)).toBe(0);
        expect(getLyricScrollTargetIndex(lyrics, 5200, 0, 120)).toBe(2);
    });
});
