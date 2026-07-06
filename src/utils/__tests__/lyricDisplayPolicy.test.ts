import {
    LYRIC_CHIP_MAX_CODE_POINTS,
    LYRIC_INSTRUMENTAL_GAP_TEXT,
    formatLyricSurfaceText,
    normalizeLyricSurfaceText,
    truncateLyricSurfaceText,
} from "@/utils/lyricDisplayPolicy";

describe("lyricDisplayPolicy", () => {
    it("preserves long lyric text for full notification surfaces", () => {
        const longLine = "每在夜静我便想这刻飞返家乡";

        expect(
            formatLyricSurfaceText({
                originalText: longLine,
            }),
        ).toBe(longLine);
    });

    it("truncates chip text with an ellipsis instead of silent clipping", () => {
        const longLine = "每在夜静我便想这刻飞返家乡";

        expect(truncateLyricSurfaceText(longLine)).toBe("每在夜静我便想这刻飞返…");
        expect(
            Array.from(truncateLyricSurfaceText(longLine)).length,
        ).toBe(LYRIC_CHIP_MAX_CODE_POINTS);
    });

    it("uses a stable instrumental-gap marker for timed empty lines", () => {
        expect(
            formatLyricSurfaceText({
                originalText: "",
                translationText: "",
                romanizationText: "",
                isEmptyLine: true,
            }),
        ).toBe(LYRIC_INSTRUMENTAL_GAP_TEXT);
    });

    it("keeps no-lyric and bad-data fallback empty for native lyric owners", () => {
        expect(formatLyricSurfaceText(null)).toBe("");
        expect(formatLyricSurfaceText({ originalText: "   " })).toBe("");
    });

    it("formats translation and romanization by the configured order", () => {
        expect(
            formatLyricSurfaceText(
                {
                    originalText: "hello",
                    translationText: "你好",
                    romanizationText: "ni hao",
                },
                {
                    order: ["romanization", "original", "translation"],
                    showTranslation: true,
                    showRomanization: true,
                    joiner: " / ",
                },
            ),
        ).toBe("ni hao / hello / 你好");
    });

    it("normalizes whitespace and zero-width characters", () => {
        expect(normalizeLyricSurfaceText("  hello\u200B\n\tworld  ")).toBe(
            "hello world",
        );
    });
});
