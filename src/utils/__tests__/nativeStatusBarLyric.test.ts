import {
    buildNativeStatusBarLyricPayload,
    buildNativeStatusBarLyricWords,
} from "../nativeStatusBarLyric";
import { getLyricWordData } from "../lyricWordByWord";
import type { IParsedLrcItem } from "../lrcParser";

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

    it("maps pseudo word timing when desktop word highlighting is enabled", () => {
        expect(
            buildNativeStatusBarLyricPayload({
                text: "想得美",
                part: {
                    ...part,
                    isPseudoWordByWord: true,
                },
                positionMs: 1200,
                isPlaying: true,
                allowPseudoWordByWord: true,
            }).words,
        ).toHaveLength(3);
    });

    it("publishes generated timing for an ordinary LRC line", () => {
        const item: IParsedLrcItem = {
            time: 8,
            lrc: "普通歌词",
            index: 0,
        };
        const nextItem: IParsedLrcItem = {
            time: 12,
            lrc: "下一句",
            index: 1,
        };
        const wordData = getLyricWordData(
            item,
            "original",
            nextItem,
            true,
        );

        const payload = buildNativeStatusBarLyricPayload({
            text: item.lrc,
            part: {
                text: item.lrc,
                hasWordByWord: wordData.hasWordByWord,
                words: wordData.words,
                isPseudoWordByWord: wordData.isPseudoWordByWord,
            },
            positionMs: 8500,
            isPlaying: true,
            allowPseudoWordByWord: true,
        });

        expect(payload.words).toHaveLength(4);
        expect(payload.words[0]).toMatchObject({
            text: "普",
            startTime: 8000,
            duration: 1000,
            startIndex: 0,
            endIndex: 1,
        });
        expect(payload.words[3]).toMatchObject({
            text: "词",
            startTime: 11000,
            duration: 1000,
            startIndex: 3,
            endIndex: 4,
        });
    });

    it("can disable native word highlighting without discarding lyric text", () => {
        expect(
            buildNativeStatusBarLyricPayload({
                text: "想得美",
                part,
                positionMs: 1200,
                isPlaying: true,
                enableWordByWord: false,
                allowPseudoWordByWord: true,
            }),
        ).toMatchObject({
            text: "想得美",
            words: [],
        });
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
