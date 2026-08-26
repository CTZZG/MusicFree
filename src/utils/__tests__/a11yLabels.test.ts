import {
    getMusicItemAccessibilityLabel,
    withAccessibilitySuffixes,
} from "../a11yLabels";

describe("getMusicItemAccessibilityLabel", () => {
    it("joins title and artist", () => {
        expect(
            getMusicItemAccessibilityLabel(
                { title: "Song", artist: "Artist" },
                "unknown",
            ),
        ).toBe("Song, Artist");
    });

    it("omits the separator when artist is missing", () => {
        expect(
            getMusicItemAccessibilityLabel({ title: "Song" }, "unknown"),
        ).toBe("Song");
    });

    it("falls back to the unknown title when title is blank", () => {
        expect(
            getMusicItemAccessibilityLabel(
                { title: "   ", artist: "Artist" },
                "unknown",
            ),
        ).toBe("unknown, Artist");
    });

    it("falls back to the unknown title when item is missing", () => {
        expect(getMusicItemAccessibilityLabel(null, "unknown")).toBe(
            "unknown",
        );
    });
});

describe("withAccessibilitySuffixes", () => {
    it("appends non-empty suffixes in order", () => {
        expect(
            withAccessibilitySuffixes("Song, Artist", [
                "selected",
                false,
                "",
                undefined,
                "missing",
            ]),
        ).toBe("Song, Artist, selected, missing");
    });

    it("returns the base label unchanged when there are no suffixes", () => {
        expect(withAccessibilitySuffixes("Song, Artist", [])).toBe(
            "Song, Artist",
        );
    });
});
