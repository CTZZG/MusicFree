import {
    createEmptyLocalMusicMetadataCache,
    createLocalMusicMetadataFingerprint,
    getLocalMusicCachedMetadata,
    isUsableLocalMusicMetadata,
    localMusicMetadataCacheMaxAgeMs,
    localMusicMetadataCacheMaxEntries,
    normalizeLocalMusicMetadataCache,
    pruneLocalMusicMetadataCache,
    setLocalMusicCachedMetadata,
} from "../localMusicMetadataCache";

const candidate = {
    musicPath: "/music/song.mp3",
    size: 1024,
    modifiedAt: 123456,
};

describe("local music metadata cache", () => {
    it("only fingerprints candidates with a complete change identity", () => {
        expect(createLocalMusicMetadataFingerprint(candidate)).toBe(
            "1024:123456",
        );
        expect(
            createLocalMusicMetadataFingerprint({
                ...candidate,
                modifiedAt: null,
            }),
        ).toBeNull();
        expect(
            createLocalMusicMetadataFingerprint({
                ...candidate,
                size: undefined,
            }),
        ).toBeNull();
        expect(
            createLocalMusicMetadataFingerprint({
                ...candidate,
                size: null,
            }),
        ).toBeNull();
    });

    it("hits only when size and modification time still match", () => {
        const cache = createEmptyLocalMusicMetadataCache();
        expect(
            setLocalMusicCachedMetadata(
                cache,
                candidate,
                { title: "Cached", duration: "120000" },
                200000,
            ),
        ).toBe(true);
        expect(getLocalMusicCachedMetadata(cache, candidate, 200001)).toEqual({
            title: "Cached",
            duration: "120000",
        });
        expect(
            getLocalMusicCachedMetadata(cache, {
                ...candidate,
                size: 1025,
            }, 200001),
        ).toBeNull();
        expect(
            getLocalMusicCachedMetadata(
                cache,
                candidate,
                200000 + localMusicMetadataCacheMaxAgeMs + 1,
            ),
        ).toBeNull();
        expect(isUsableLocalMusicMetadata({})).toBe(false);
        expect(isUsableLocalMusicMetadata({ duration: "1" })).toBe(true);
    });

    it("drops malformed, future and expired persisted entries", () => {
        const now = localMusicMetadataCacheMaxAgeMs + 1000;
        const cache = normalizeLocalMusicMetadataCache({
            version: 1,
            entries: {
                valid: {
                    fingerprint: "1:2",
                    metadata: { title: "Valid" },
                    updatedAt: now - 1,
                },
                expired: {
                    fingerprint: "1:2",
                    metadata: { title: "Expired" },
                    updatedAt: 0,
                },
                future: {
                    fingerprint: "1:2",
                    metadata: { title: "Future" },
                    updatedAt: now + 1,
                },
                empty: {
                    fingerprint: "1:2",
                    metadata: {},
                    updatedAt: now,
                },
            },
        }, now);

        expect(Object.keys(cache.entries)).toEqual(["valid"]);
    });

    it("keeps the newest bounded entries", () => {
        const cache = createEmptyLocalMusicMetadataCache();
        for (let index = 0; index < localMusicMetadataCacheMaxEntries + 2; index += 1) {
            cache.entries[String(index)] = {
                fingerprint: `${index}:${index}`,
                metadata: { title: String(index) },
                updatedAt: index + 1,
            };
        }

        pruneLocalMusicMetadataCache(
            cache,
            localMusicMetadataCacheMaxEntries + 10,
        );
        expect(Object.keys(cache.entries)).toHaveLength(
            localMusicMetadataCacheMaxEntries,
        );
        expect(cache.entries["0"]).toBeUndefined();
        expect(cache.entries["1"]).toBeUndefined();
    });
});
