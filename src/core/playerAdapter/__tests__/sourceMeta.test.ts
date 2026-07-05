import {
    parsePlaybackSourceMeta,
    sanitizePlaybackSourceMeta,
    stringifyPlaybackSourceMeta,
} from "../sourceMeta";

describe("player adapter source meta helpers", () => {
    it("round-trips playback source metadata", () => {
        const meta = {
            quality: "lossless" as const,
            origin: "recovery" as const,
            cacheKey: "test@123",
            recovered: true,
            resolvedAt: 123456,
        };

        expect(
            parsePlaybackSourceMeta(stringifyPlaybackSourceMeta(meta)),
        ).toEqual(meta);
    });

    it("ignores invalid metadata payloads", () => {
        expect(parsePlaybackSourceMeta(undefined)).toBeUndefined();
        expect(parsePlaybackSourceMeta({})).toBeUndefined();
        expect(parsePlaybackSourceMeta("{not json")).toBeUndefined();
        expect(parsePlaybackSourceMeta("[]")).toBeUndefined();
        expect(parsePlaybackSourceMeta("{}")).toBeUndefined();
        expect(stringifyPlaybackSourceMeta(undefined)).toBeUndefined();
    });

    it("sanitizes native metadata before exposing recovery hints", () => {
        expect(
            sanitizePlaybackSourceMeta({
                quality: "lossless",
                origin: "plugin",
                cacheKey: "netease@1",
                recovered: false,
                resolvedAt: 100,
                unexpected: true,
            }),
        ).toEqual({
            quality: "lossless",
            origin: "plugin",
            cacheKey: "netease@1",
            recovered: false,
            resolvedAt: 100,
        });

        expect(
            sanitizePlaybackSourceMeta({
                origin: "unknown",
                recovered: "true",
                resolvedAt: Number.POSITIVE_INFINITY,
            }),
        ).toBeUndefined();
    });

    it("keeps valid partial metadata and drops malformed fields", () => {
        expect(
            parsePlaybackSourceMeta(
                JSON.stringify({
                    origin: "recovery",
                    recovered: true,
                    cacheKey: 123,
                    resolvedAt: "now",
                }),
            ),
        ).toEqual({
            origin: "recovery",
            recovered: true,
        });
    });
});
