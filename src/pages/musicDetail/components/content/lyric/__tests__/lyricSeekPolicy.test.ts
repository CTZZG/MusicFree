import {
    getLyricSeekTimeSeconds,
    hasSeekableLyricTimeline,
} from "../lyricSeekPolicy";
import type { IParsedLrcItem } from "@/utils/lrcParser";

function lyricItem(partial: Partial<IParsedLrcItem>): IParsedLrcItem {
    return {
        time: 0,
        lrc: "",
        index: 0,
        ...partial,
    };
}

describe("lyric seek policy", () => {
    it("does not seek plain text fallback lines without a real timeline", () => {
        const lyrics = [
            lyricItem({ lrc: "plain line one", index: 0 }),
            lyricItem({ lrc: "plain line two", index: 1 }),
        ];

        expect(hasSeekableLyricTimeline(lyrics)).toBe(false);
        expect(getLyricSeekTimeSeconds(lyrics[0], lyrics)).toBeUndefined();
    });

    it("allows seeking to a zero-time line when the lyric has a timed timeline", () => {
        const lyrics = [
            lyricItem({ time: 0, lrc: "intro", index: 0 }),
            lyricItem({ time: 12.5, lrc: "verse", index: 1 }),
        ];

        expect(hasSeekableLyricTimeline(lyrics)).toBe(true);
        expect(getLyricSeekTimeSeconds(lyrics[0], lyrics)).toBe(0);
        expect(getLyricSeekTimeSeconds(lyrics[1], lyrics)).toBe(12.5);
    });

    it("uses timed word data as a seekable timeline even at zero seconds", () => {
        const lyrics = [
            lyricItem({
                time: 0,
                lrc: "word",
                hasWordByWord: true,
                words: [{
                    text: "word",
                    startTime: 0,
                    duration: 500,
                    space: false,
                }],
            }),
        ];

        expect(hasSeekableLyricTimeline(lyrics)).toBe(true);
        expect(getLyricSeekTimeSeconds(lyrics[0], lyrics)).toBe(0);
    });

    it("applies offset and clamps negative seek targets to zero", () => {
        const lyrics = [
            lyricItem({ time: 2, lrc: "line", index: 0 }),
        ];

        expect(getLyricSeekTimeSeconds(lyrics[0], lyrics, 1.25)).toBe(3.25);
        expect(getLyricSeekTimeSeconds(lyrics[0], lyrics, -10)).toBe(0);
    });
});
