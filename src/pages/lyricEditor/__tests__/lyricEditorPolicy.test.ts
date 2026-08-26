import {
    formatEditableLyricTime,
    insertLyricLine,
    moveLyricLine,
    nudgeLyricLineTime,
    parseEditableLyricTime,
    parseLyricForEditing,
    removeLyricLine,
    serializeLyricForEditing,
    sortLyricLinesByTime,
    updateLyricLineText,
    updateLyricLineTime,
} from "../lyricEditorPolicy";

function makeIdSequence() {
    let n = 0;
    return () => `id-${n++}`;
}

describe("parseLyricForEditing", () => {
    it("parses timestamped lines in time order", () => {
        const { lines } = parseLyricForEditing(
            "[00:03.50]world\n[00:01.00]hello",
            makeIdSequence(),
        );
        // ids are assigned in source order, but rows come out sorted by time
        expect(lines).toEqual([
            { id: "id-1", timeMs: 1000, text: "hello" },
            { id: "id-0", timeMs: 3500, text: "world" },
        ]);
    });

    it("extracts metadata tags separately from lyric lines", () => {
        const { meta, lines } = parseLyricForEditing(
            "[ti:My Title]\n[ar:Artist]\n[00:01.00]line",
            makeIdSequence(),
        );
        expect(meta).toEqual({ ti: "My Title", ar: "Artist" });
        expect(lines).toHaveLength(1);
    });

    it("expands a line with multiple leading timestamps into separate rows", () => {
        const { lines } = parseLyricForEditing(
            "[00:01.00][00:05.00]chorus",
            makeIdSequence(),
        );
        expect(lines).toEqual([
            { id: "id-0", timeMs: 1000, text: "chorus" },
            { id: "id-1", timeMs: 5000, text: "chorus" },
        ]);
    });

    it("returns no lines for empty input", () => {
        expect(parseLyricForEditing("", makeIdSequence()).lines).toEqual([]);
    });

    it("ignores blank lines", () => {
        const { lines } = parseLyricForEditing(
            "[00:01.00]hello\n\n[00:02.00]world",
            makeIdSequence(),
        );
        expect(lines).toHaveLength(2);
    });
});

describe("formatEditableLyricTime / parseEditableLyricTime", () => {
    it("formats milliseconds as mm:ss.xxx", () => {
        expect(formatEditableLyricTime(61234)).toBe("01:01.234");
    });

    it("clamps negative values to zero", () => {
        expect(formatEditableLyricTime(-500)).toBe("00:00.000");
    });

    it("parses a formatted time string back to milliseconds", () => {
        expect(parseEditableLyricTime("01:01.234")).toBe(61234);
    });

    it("parses a time string without milliseconds", () => {
        expect(parseEditableLyricTime("00:05")).toBe(5000);
    });

    it("returns null for an unparsable string", () => {
        expect(parseEditableLyricTime("not a time")).toBeNull();
    });
});

describe("serializeLyricForEditing", () => {
    it("round-trips through parse and serialize", () => {
        const raw = "[ti:Title]\n\n[00:01.000]hello\n[00:03.500]world";
        const parsed = parseLyricForEditing(raw, makeIdSequence());
        expect(serializeLyricForEditing(parsed)).toBe(raw);
    });

    it("sorts lines by time before serializing regardless of array order", () => {
        const serialized = serializeLyricForEditing({
            meta: {},
            lines: [
                { id: "a", timeMs: 3000, text: "second" },
                { id: "b", timeMs: 1000, text: "first" },
            ],
        });
        expect(serialized).toBe("[00:01.000]first\n[00:03.000]second");
    });

    it("omits an empty meta block entirely", () => {
        const serialized = serializeLyricForEditing({
            meta: {},
            lines: [{ id: "a", timeMs: 0, text: "hi" }],
        });
        expect(serialized).toBe("[00:00.000]hi");
    });
});

describe("line list mutations", () => {
    const base = [
        { id: "a", timeMs: 1000, text: "first" },
        { id: "b", timeMs: 2000, text: "second" },
    ];

    it("inserts a line at the given index", () => {
        const next = insertLyricLine(base, 1, {
            id: "c",
            timeMs: 1500,
            text: "inserted",
        });
        expect(next.map(l => l.id)).toEqual(["a", "c", "b"]);
        expect(base).toHaveLength(2); // does not mutate the input
    });

    it("clamps an out-of-range insert index", () => {
        const next = insertLyricLine(base, 99, {
            id: "c",
            timeMs: 5000,
            text: "end",
        });
        expect(next.map(l => l.id)).toEqual(["a", "b", "c"]);
    });

    it("removes a line by id", () => {
        expect(removeLyricLine(base, "a").map(l => l.id)).toEqual(["b"]);
    });

    it("updates a line's text without touching others", () => {
        const next = updateLyricLineText(base, "a", "changed");
        expect(next[0].text).toBe("changed");
        expect(next[1]).toBe(base[1]);
    });

    it("updates a line's time and clamps negative input to zero", () => {
        expect(updateLyricLineTime(base, "a", -100)[0].timeMs).toBe(0);
        expect(updateLyricLineTime(base, "a", 4200)[0].timeMs).toBe(4200);
    });

    it("nudges a line's time and never goes below zero", () => {
        expect(nudgeLyricLineTime(base, "a", 250)[0].timeMs).toBe(1250);
        expect(nudgeLyricLineTime(base, "a", -5000)[0].timeMs).toBe(0);
    });

    it("moves a line from one index to another", () => {
        const three = [
            { id: "a", timeMs: 0, text: "a" },
            { id: "b", timeMs: 0, text: "b" },
            { id: "c", timeMs: 0, text: "c" },
        ];
        expect(moveLyricLine(three, 0, 2).map(l => l.id)).toEqual([
            "b",
            "c",
            "a",
        ]);
    });

    it("returns an unchanged copy for an out-of-range move", () => {
        expect(moveLyricLine(base, 0, 99).map(l => l.id)).toEqual([
            "a",
            "b",
        ]);
    });

    it("sorts lines by time", () => {
        const unsorted = [
            { id: "b", timeMs: 2000, text: "second" },
            { id: "a", timeMs: 1000, text: "first" },
        ];
        expect(sortLyricLinesByTime(unsorted).map(l => l.id)).toEqual([
            "a",
            "b",
        ]);
    });
});
