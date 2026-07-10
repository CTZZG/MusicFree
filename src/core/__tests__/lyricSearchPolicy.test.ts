import {
    getLyricCandidateDistance,
    isLyricCandidateMatchAcceptable,
} from "../lyricSearchPolicy";

describe("lyric search policy", () => {
    const target = {
        title: "Back In My Life",
        artist: "Alice Deejay",
    };

    it("uses candidate title similarity when scoring lyric matches", () => {
        const closeTitleWrongArtist = {
            title: "Back In My Life",
            artist: "Unknown",
        };
        const wrongTitleCloseArtist = {
            title: "Completely Different Song",
            artist: "Alice Deejay",
        };

        expect(
            getLyricCandidateDistance(
                "Back In My Life",
                target,
                closeTitleWrongArtist,
            ),
        ).toBeLessThan(
            getLyricCandidateDistance(
                "Back In My Life",
                target,
                wrongTitleCloseArtist,
            ),
        );
    });

    it("accepts small formatting and spelling differences", () => {
        expect(
            isLyricCandidateMatchAcceptable("Back In My Life", target, {
                title: "back in my life",
                artist: "Alice Deejay",
            }),
        ).toBe(true);
    });

    it("rejects an exact title from the wrong artist", () => {
        expect(
            isLyricCandidateMatchAcceptable("Back In My Life", target, {
                title: "Back In My Life",
                artist: "Completely Different Artist",
            }),
        ).toBe(false);
    });

    it("rejects an unrelated title even when the artist matches", () => {
        expect(
            isLyricCandidateMatchAcceptable("Back In My Life", target, {
                title: "Better Off Alone",
                artist: "Alice Deejay",
            }),
        ).toBe(false);
    });
});
