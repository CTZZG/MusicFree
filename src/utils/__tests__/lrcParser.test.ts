// lrcParser only uses log for diagnostics; mock it so the unit test stays
// isolated from the expo/react-native logging stack (which jest doesn't
// transform by default).
jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    default: jest.fn(),
}));

import LyricParser, {
    formatQrcToAngleBracket,
} from "@/utils/lrcParser";

describe("LyricParser - basic LRC parsing", () => {
    it("parses timestamps and text into ordered items", () => {
        const parser = new LyricParser("[00:01.00]hello\n[00:03.50]world");
        const items = parser.getLyricItems();

        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ time: 1, lrc: "hello", index: 0 });
        expect(items[1]).toMatchObject({ time: 3.5, lrc: "world", index: 1 });
    });

    it("extracts metadata tags", () => {
        const parser = new LyricParser(
            "[ti:My Title]\n[ar:Artist]\n[00:01.00]line",
        );
        const meta = parser.getMeta();

        expect(meta.ti).toBe("My Title");
        expect(meta.ar).toBe("Artist");
    });

    it("returns empty items for empty input", () => {
        expect(new LyricParser("").getLyricItems()).toEqual([]);
    });

    it("ignores comment lines", () => {
        const parser = new LyricParser("[00:00.75]//\n[00:01.00]real");
        const items = parser.getLyricItems();

        expect(items).toHaveLength(1);
        expect(items[0].lrc).toBe("real");
    });
});

describe("LyricParser.getPosition", () => {
    const parser = new LyricParser(
        "[00:01.00]a\n[00:03.00]b\n[00:05.00]c",
    );

    it("returns null before the first line", () => {
        expect(parser.getPosition(0.5)).toBeNull();
    });

    it("returns the active line for a position inside the range", () => {
        expect(parser.getPosition(2)?.lrc).toBe("a");
        expect(parser.getPosition(4)?.lrc).toBe("b");
    });

    it("returns the last line for a position past the end", () => {
        expect(parser.getPosition(99)?.lrc).toBe("c");
    });

    it("handles seeks back to an earlier line after reading a later line", () => {
        const seekParser = new LyricParser(
            "[00:01.00]a\n[00:03.00]b\n[00:05.00]c",
        );

        expect(seekParser.getPosition(6)?.lrc).toBe("c");
        expect(seekParser.getPosition(2)?.lrc).toBe("a");
    });
});

describe("LyricParser - current-line edge cases", () => {
    it("applies metadata offset when resolving the active line", () => {
        const parser = new LyricParser("[offset:500]\n[00:01.00]delayed");

        expect(parser.getPosition(1.49)).toBeNull();
        expect(parser.getPosition(1.5)?.lrc).toBe("delayed");
    });

    it("keeps repeated timestamps in order and resolves to the last active duplicate", () => {
        const parser = new LyricParser(
            "[00:02.00]first\n[00:02.00]second\n[00:04.00]third",
        );
        const items = parser.getLyricItems();

        expect(items.map(item => item.lrc)).toEqual([
            "first",
            "second",
            "third",
        ]);
        expect(parser.getPosition(2)?.lrc).toBe("second");
    });

    it("aligns romanization lines by timestamp", () => {
        const parser = new LyricParser("[00:01.00]你好\n[00:03.00]世界", {
            romanization: "[00:01.00]ni hao\n[00:03.00]shi jie",
        });

        expect(parser.hasRomanization).toBe(true);
        expect(parser.getLyricItems()[0].romanization).toBe("ni hao");
        expect(parser.getLyricItems()[1].romanization).toBe("shi jie");
    });

    it("falls back to plain text lines when no timestamps exist", () => {
        const parser = new LyricParser("plain line one\nplain line two");
        const items = parser.getLyricItems();

        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            time: 0,
            lrc: "plain line one",
            index: 0,
        });
        expect(items[1]).toMatchObject({
            time: 0,
            lrc: "plain line two",
            index: 1,
        });
    });

    it("ignores malformed timestamp-like content without throwing", () => {
        const parser = new LyricParser(
            "[bad timestamp]\n[00:bad]broken\n[00:01.00]valid",
        );
        const items = parser.getLyricItems();

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ time: 1, lrc: "valid" });
    });

    it("preserves long lyric lines for downstream display policies", () => {
        const longLine =
            "每在夜静我便想这刻飞返家乡".repeat(4);
        const parser = new LyricParser(`[00:12.00]${longLine}`);
        const item = parser.getPosition(12);

        expect(item?.lrc).toBe(longLine);
        expect(item?.lrc.length).toBeGreaterThan(40);
    });
});

describe("LyricParser - translation alignment", () => {
    it("aligns translation lines by timestamp", () => {
        const parser = new LyricParser("[00:01.00]hello\n[00:03.00]world", {
            translation: "[00:01.00]你好\n[00:03.00]世界",
        });

        expect(parser.hasTranslation).toBe(true);
        const items = parser.getLyricItems();
        const hello = items.find(i => i.lrc === "hello");
        expect(hello?.translation).toBe("你好");
    });
});

describe("formatQrcToAngleBracket", () => {
    it("converts a QRC word-by-word line to angle-bracket format", () => {
        const result = formatQrcToAngleBracket(
            "[21783,3850]凉(21783,220)风(22003,260)轻(22263,260)",
        );

        expect(result.startsWith("[00:21.783]")).toBe(true);
        expect(result).toContain("<00:21.783>凉");
        expect(result).toContain("<00:22.003>风");
        expect(result).toContain("<00:22.263>轻");
    });

    it("returns an empty string for a non-QRC line", () => {
        expect(formatQrcToAngleBracket("just plain text")).toBe("");
    });
});
