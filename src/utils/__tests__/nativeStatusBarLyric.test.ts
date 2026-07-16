import {
    buildNativeStatusBarLyricPayload,
    buildNativeStatusBarLyricWords,
} from "../nativeStatusBarLyric";

describe("native status bar lyric payload", () => {
    const part = {
        text: "想得美",
        hasWordByWord: true,
        words: [
            { text: "想", startTime: 1000, duration: 200 },
            { text: "得", startTime: 1200, duration: 200 },
            { text: "美", startTime: 1400, duration: 300 },
        ],
    };

    it("maps word timing to UTF-16 offsets inside a multi-line surface", () => {
        expect(buildNativeStatusBarLyricWords("翻译\n想得美", part)).toEqual([
            {
                text: "想",
                startTime: 1000,
                duration: 200,
                startIndex: 3,
                endIndex: 4,
            },
            {
                text: "得",
                startTime: 1200,
                duration: 200,
                startIndex: 4,
                endIndex: 5,
            },
            {
                text: "美",
                startTime: 1400,
                duration: 300,
                startIndex: 5,
                endIndex: 6,
            },
        ]);
    });

    it("falls back to whole-line output for pseudo word timing", () => {
        expect(
            buildNativeStatusBarLyricWords("想得美", {
                ...part,
                isPseudoWordByWord: true,
            }),
        ).toEqual([]);
    });

    it("uses a structural offset when another displayed line has the same text", () => {
        expect(
            buildNativeStatusBarLyricWords(
                "想得美\n想得美",
                part,
                4,
                "想得美",
            )[0],
        ).toMatchObject({ startIndex: 4, endIndex: 5 });
    });

    it("sanitizes playback clock fields", () => {
        expect(
            buildNativeStatusBarLyricPayload({
                text: "想得美",
                part,
                positionMs: -20,
                isPlaying: true,
                playbackRate: Number.NaN,
            }),
        ).toMatchObject({
            positionMs: 0,
            isPlaying: true,
            playbackRate: 1,
            sequence: 0,
        });
    });
});
