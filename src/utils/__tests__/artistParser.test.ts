import { hasMultipleArtists, parseArtists } from "../artistParser";

describe("artistParser", () => {
    it("parses common multi-artist separators", () => {
        expect(parseArtists("Alice / Bob、Carol, Dave & Eve")).toEqual([
            "Alice",
            "Bob",
            "Carol",
            "Dave",
            "Eve",
        ]);
    });

    it("parses featured artists", () => {
        expect(parseArtists("Alice feat. Bob ft. Carol")).toEqual([
            "Alice",
            "Bob",
            "Carol",
        ]);
    });

    it("filters empty and duplicate names", () => {
        expect(parseArtists(" Alice / / Alice / Bob ")).toEqual([
            "Alice",
            "Bob",
        ]);
    });

    it("detects multiple artists", () => {
        expect(hasMultipleArtists("Alice / Bob")).toBe(true);
        expect(hasMultipleArtists("Alice")).toBe(false);
    });
});
