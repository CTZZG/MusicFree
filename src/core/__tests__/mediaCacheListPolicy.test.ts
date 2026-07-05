import {
    buildMediaCacheEntries,
    DEFAULT_MEDIA_CACHE_QUALITY,
    filterMediaCacheEntries,
    getMediaCacheEntryQualityKeys,
    getMediaCacheEntryKeys,
    getMediaCachePlatforms,
    getMediaCacheQualities,
    getUniqueMediaCacheKeys,
    normalizeMediaCacheItem,
} from "../mediaCacheListPolicy";

const rawRecord = (key: string, value: Partial<IMusic.IMusicItemCache>) => ({
    key,
    raw: JSON.stringify(value),
});

describe("media cache list policy", () => {
    it("normalizes only complete object cache items", () => {
        expect(
            normalizeMediaCacheItem({
                platform: "qq",
                id: "1",
                title: "Song",
            }),
        ).toMatchObject({
            platform: "qq",
            id: "1",
        });
        expect(normalizeMediaCacheItem(null)).toBeNull();
        expect(normalizeMediaCacheItem("bad")).toBeNull();
        expect(normalizeMediaCacheItem([])).toBeNull();
        expect(normalizeMediaCacheItem({ id: "1" })).toBeNull();
        expect(normalizeMediaCacheItem({ platform: "qq" })).toBeNull();
    });

    it("builds sorted display entries from valid cache records", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@2", {
                platform: "qq",
                id: "2",
                title: "Beta",
                artist: "Artist B",
                album: "Album B",
            }),
            rawRecord("netease@1", {
                platform: "netease",
                id: "1",
                title: "Alpha",
                artist: "Artist A",
                album: "Album A",
            }),
        ]);

        expect(entries.map(entry => entry.key)).toEqual([
            "netease@1",
            "qq@2",
        ]);
        expect(entries[0]).toMatchObject({
            platform: "netease",
            id: "1",
            title: "Alpha",
            artist: "Artist A",
            album: "Album A",
            qualityKeys: [],
        });
        expect(entries[0].approximateSize).toBeGreaterThan(0);
    });

    it("skips invalid, corrupt, or incomplete records", () => {
        const entries = buildMediaCacheEntries([
            { key: "bad-json", raw: "{" },
            rawRecord("missing-platform", {
                id: "1",
                title: "No platform",
            }),
            rawRecord("missing-id", {
                platform: "qq",
                title: "No id",
            }),
        ]);

        expect(entries).toEqual([]);
    });

    it("lists unique platforms in display order", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@2", { platform: "qq", id: "2" }),
            rawRecord("netease@1", { platform: "netease", id: "1" }),
            rawRecord("qq@3", { platform: "qq", id: "3" }),
        ]);

        expect(getMediaCachePlatforms(entries)).toEqual(["netease", "qq"]);
    });

    it("extracts normalized quality keys from source and qualities payloads", () => {
        expect(
            getMediaCacheEntryQualityKeys({
                source: {
                    high: { url: "https://example.com/high.mp3" },
                    flac: { headers: { referer: "test" } },
                },
                qualities: {
                    super: { size: 1024 },
                    empty: {},
                },
            }),
        ).toEqual(["320k", "flac"]);
    });

    it("uses a default quality bucket for direct-url cache entries", () => {
        expect(
            getMediaCacheEntryQualityKeys({
                url: "https://example.com/default.mp3",
            }),
        ).toEqual([DEFAULT_MEDIA_CACHE_QUALITY]);
    });

    it("lists unique quality filters from cache entries", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@1", {
                platform: "qq",
                id: "1",
                source: {
                    high: { url: "u1" },
                    flac: { url: "u2" },
                },
            }),
            rawRecord("netease@2", {
                platform: "netease",
                id: "2",
                url: "u3",
            }),
        ]);

        expect(getMediaCacheQualities(entries)).toEqual([
            "320k",
            DEFAULT_MEDIA_CACHE_QUALITY,
            "flac",
        ]);
    });

    it("filters by platform and query across common song fields", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@1", {
                platform: "qq",
                id: "1",
                title: "First Song",
                artist: "Alice",
                album: "Album One",
            }),
            rawRecord("netease@2", {
                platform: "netease",
                id: "2",
                title: "Second Song",
                artist: "Bob",
                album: "Album Two",
            }),
        ]);

        expect(
            filterMediaCacheEntries(entries, {
                platform: "qq",
                query: "alice",
            }).map(entry => entry.key),
        ).toEqual(["qq@1"]);
        expect(
            filterMediaCacheEntries(entries, { query: "album two" }).map(
                entry => entry.key,
            ),
        ).toEqual(["netease@2"]);
    });

    it("filters by quality key", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@1", {
                platform: "qq",
                id: "1",
                source: { high: { url: "u1" } },
            }),
            rawRecord("netease@2", {
                platform: "netease",
                id: "2",
                source: { flac: { url: "u2" } },
            }),
        ]);

        expect(
            filterMediaCacheEntries(entries, { quality: "320k" }).map(
                entry => entry.key,
            ),
        ).toEqual(["qq@1"]);
    });

    it("normalizes and deduplicates cache keys for batch operations", () => {
        expect(getUniqueMediaCacheKeys([" qq@1 ", "", "netease@2", "qq@1"])).toEqual([
            "qq@1",
            "netease@2",
        ]);
    });

    it("collects unique keys from visible entries", () => {
        const entries = buildMediaCacheEntries([
            rawRecord("qq@1", { platform: "qq", id: "1" }),
            rawRecord("netease@2", { platform: "netease", id: "2" }),
        ]);

        expect(getMediaCacheEntryKeys(entries)).toEqual(["netease@2", "qq@1"]);
    });
});
