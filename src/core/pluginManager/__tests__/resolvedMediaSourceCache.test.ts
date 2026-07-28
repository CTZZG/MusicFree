import {
    createResolvedMediaSourceCacheEntry,
    readResolvedMediaSourceCache,
} from "../resolvedMediaSourceCache";

describe("resolved media source cache", () => {
    it("preserves resolved quality across a fresh to cache round trip", () => {
        const entry = createResolvedMediaSourceCacheEntry(
            {
                url: "https://media.example.com/track.mp3",
                headers: { Referer: "https://example.com/" },
                quality: "192k",
            },
            "flac",
        );
        const mediaCache = {
            id: "track-1",
            platform: "test-plugin",
            title: "Track",
            artist: "Artist",
            album: "Album",
            artwork: "",
            duration: 180,
            source: {
                flac: entry,
            },
        } as IMusic.IMusicItem;

        expect(
            readResolvedMediaSourceCache(mediaCache, "flac", "super"),
        ).toMatchObject({
            url: "https://media.example.com/track.mp3",
            quality: "192k",
        });
    });

    it("uses the requested quality for legacy cache entries without quality", () => {
        const mediaCache = {
            id: "track-1",
            platform: "test-plugin",
            title: "Track",
            artist: "Artist",
            album: "Album",
            artwork: "",
            duration: 180,
            source: {
                flac: {
                    url: "https://media.example.com/track.flac",
                },
            },
        } as IMusic.IMusicItem;

        expect(
            readResolvedMediaSourceCache(mediaCache, "flac", "super"),
        ).toMatchObject({
            url: "https://media.example.com/track.flac",
            quality: "flac",
        });
    });
});
