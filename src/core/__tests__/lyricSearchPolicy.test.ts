import { getLyricCandidateDistance } from "../lyricSearchPolicy";

describe("getLyricCandidateDistance", () => {
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
});
