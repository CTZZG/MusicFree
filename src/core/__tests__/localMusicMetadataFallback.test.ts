import { resolveEnrichedLocalMusicMetadata } from "../localMusicMetadataFallback";

const fallback = {
    title: "song",
    artist: "未知歌手",
    duration: 0,
    album: "未知专辑",
};
const resolved = {
    title: "Resolved title",
    artist: "Resolved artist",
    duration: 180,
    album: "Resolved album",
};

describe("local music metadata fallback enrichment", () => {
    it("replaces scanner-owned fallback values", () => {
        expect(resolveEnrichedLocalMusicMetadata(
            fallback,
            fallback,
            resolved,
        )).toEqual(resolved);
    });

    it("preserves fields edited after the fallback import", () => {
        expect(resolveEnrichedLocalMusicMetadata(
            {
                ...fallback,
                title: "My title",
                album: "My album",
            },
            fallback,
            resolved,
        )).toEqual({
            ...resolved,
            title: "My title",
            album: "My album",
        });
    });
});
