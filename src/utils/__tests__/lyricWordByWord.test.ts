import {
    canAnimateLyricWords,
    getLyricLineStartTimeMs,
    getLyricWordData,
} from "@/utils/lyricWordByWord";
import type { IParsedLrcItem } from "@/utils/lrcParser";

const realWords: ILyric.IWordData[] = [
    {
        text: "hello",
        startTime: 1000,
        duration: 400,
        space: false,
    },
];

function lyricItem(partial: Partial<IParsedLrcItem>): IParsedLrcItem {
    return {
        time: 1,
        lrc: "hello",
        index: 0,
        ...partial,
    };
}

describe("lyricWordByWord", () => {
    it("allows word animation only for real timed word data", () => {
        expect(
            canAnimateLyricWords({
                hasWordByWord: true,
                words: realWords,
                text: "hello",
                isPseudoWordByWord: false,
            }),
        ).toBe(true);
    });

    it("blocks pseudo word data from animated highlighting", () => {
        expect(
            canAnimateLyricWords({
                hasWordByWord: true,
                words: realWords,
                text: "hello",
                isPseudoWordByWord: true,
            }),
        ).toBe(false);
    });

    it("keeps normal line-level lyrics clean when timing data is missing", () => {
        expect(
            canAnimateLyricWords({
                hasWordByWord: false,
                words: [],
                text: "hello",
            }),
        ).toBe(false);
        expect(
            canAnimateLyricWords({
                hasWordByWord: true,
                text: "hello",
            }),
        ).toBe(false);
        expect(
            canAnimateLyricWords({
                hasWordByWord: true,
                words: realWords,
                text: "   ",
            }),
        ).toBe(false);
    });

    it("marks fallback generated word data as pseudo", () => {
        const item = lyricItem({
            lrc: "plain lyric",
            time: 8,
        });
        const wordData = getLyricWordData(item, "original");

        expect(wordData.hasWordByWord).toBe(true);
        expect(wordData.isPseudoWordByWord).toBe(true);
        expect(canAnimateLyricWords({
            hasWordByWord: wordData.hasWordByWord,
            words: wordData.words,
            text: item.lrc,
            isPseudoWordByWord: wordData.isPseudoWordByWord,
        })).toBe(false);
    });

    it("preserves real word timing as animation-capable", () => {
        const item = lyricItem({
            hasWordByWord: true,
            words: realWords,
        });
        const wordData = getLyricWordData(item, "original");

        expect(wordData.hasWordByWord).toBe(true);
        expect(wordData.isPseudoWordByWord).toBeFalsy();
        expect(wordData.lineStartTimeMs).toBe(getLyricLineStartTimeMs(item));
        expect(canAnimateLyricWords({
            hasWordByWord: wordData.hasWordByWord,
            words: wordData.words,
            text: item.lrc,
            isPseudoWordByWord: wordData.isPseudoWordByWord,
        })).toBe(true);
    });
});
