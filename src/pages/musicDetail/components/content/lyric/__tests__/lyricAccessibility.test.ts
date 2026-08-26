import { getLyricAccessibilityText } from "../lyricAccessibility";

describe("lyric accessibility text", () => {
    it("joins non-empty visible lyric lines in reading order", () => {
        expect(
            getLyricAccessibilityText([
                { text: "  original lyric  " },
                { text: "translated lyric" },
                { text: "" },
            ]),
        ).toBe("original lyric, translated lyric");
    });

    it("does not repeat an identical visible line", () => {
        expect(
            getLyricAccessibilityText([
                { text: "same lyric" },
                { text: "same lyric" },
            ]),
        ).toBe("same lyric");
    });
});
