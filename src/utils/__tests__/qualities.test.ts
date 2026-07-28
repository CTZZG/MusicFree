jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
    default: jest.fn(),
}));

import {
    convertLegacyQuality,
    convertToLegacyQuality,
    isLegacyQuality,
    parseQualityText,
    buildQualitiesFromArray,
    convertApiQualityToQualities,
    getAvailableQualities,
    getQualityOptions,
} from "@/utils/qualities";

describe("quality conversions", () => {
    it("maps legacy quality keys to modern keys", () => {
        expect(convertLegacyQuality("low")).toBe("128k");
        expect(convertLegacyQuality("standard")).toBe("192k");
        expect(convertLegacyQuality("high")).toBe("320k");
        expect(convertLegacyQuality("super")).toBe("flac");
    });

    it("passes through modern keys unchanged", () => {
        expect(convertLegacyQuality("320k")).toBe("320k");
        expect(convertLegacyQuality("master")).toBe("master");
    });

    it("identifies legacy keys", () => {
        expect(isLegacyQuality("low")).toBe(true);
        expect(isLegacyQuality("320k")).toBe(false);
    });

    it("maps modern keys back to a legacy bucket", () => {
        expect(convertToLegacyQuality("96k")).toBe("low");
        expect(convertToLegacyQuality("flac")).toBe("super");
        expect(convertToLegacyQuality("unknown-key")).toBeUndefined();
    });
});

describe("parseQualityText", () => {
    it("resolves known quality labels", () => {
        expect(parseQualityText("FLAC")).toBe("flac");
        expect(parseQualityText("320K")).toBe("320k");
        expect(parseQualityText("无损")).toBe("flac");
    });

    it("returns null for unknown labels", () => {
        expect(parseQualityText("definitely-not-a-quality")).toBeNull();
    });
});

describe("buildQualitiesFromArray", () => {
    it("builds a qualities map keyed by normalized quality", () => {
        const result = buildQualitiesFromArray([
            { type: "320K", url: "u1", size: 100 },
            { type: "FLAC", url: "u2", size: 200 },
            { type: "unknown", url: "u3" },
        ]);

        expect(result["320k"]).toEqual({ url: "u1", size: 100 });
        expect(result.flac).toEqual({ url: "u2", size: 200 });
        expect(Object.keys(result)).toHaveLength(2);
    });
});

describe("convertApiQualityToQualities", () => {
    it("returns undefined when there is no result", () => {
        expect(convertApiQualityToQualities(undefined)).toBeUndefined();
        expect(convertApiQualityToQualities({})).toBeUndefined();
    });

    it("maps a known result label to a quality entry", () => {
        expect(convertApiQualityToQualities({ result: "320K", size: 50 })).toEqual({
            "320k": { url: undefined, size: 50 },
        });
    });
});

describe("getQualityOptions", () => {
    const musicItem = {
        id: "track-1",
        platform: "test",
        artist: "Artist",
        title: "Title",
        duration: 180,
        album: "Album",
        artwork: "",
    } as IMusic.IMusicItem;

    it("distinguishes resolved, metadata, and plugin-declared qualities", () => {
        const result = getQualityOptions(
            {
                ...musicItem,
                qualities: {
                    "128k": { size: 1024 },
                },
                source: {
                    flac: { url: "https://example.com/track.flac" },
                },
            },
            {
                supportedQualities: ["128k", "320k", "flac", "hires"],
            },
        );

        expect(result).toEqual([
            { key: "128k", status: "metadata" },
            { key: "320k", status: "declared" },
            { key: "flac", status: "resolved" },
            { key: "hires", status: "declared" },
        ]);
    });

    it("does not advertise metadata outside a plugin's declaration", () => {
        const result = getQualityOptions(
            {
                ...musicItem,
                qualities: {
                    "128k": { size: 1024 },
                    master: { size: 4096 },
                },
            },
            {
                supportedQualities: ["128k", "320k"],
            },
        );

        expect(result).toEqual([
            { key: "128k", status: "metadata" },
            { key: "320k", status: "declared" },
        ]);
    });

    it("does not advertise source metadata outside a plugin's declaration", () => {
        const result = getQualityOptions(
            {
                ...musicItem,
                source: {
                    master: { size: 4096 },
                },
            },
            {
                supportedQualities: ["128k", "320k"],
            },
        );

        expect(result).toEqual([
            { key: "128k", status: "declared" },
            { key: "320k", status: "declared" },
        ]);
    });

    it("keeps a directly resolved source even outside the declaration", () => {
        const result = getQualityOptions(
            {
                ...musicItem,
                source: {
                    master: { url: "https://example.com/master.flac" },
                },
            },
            {
                supportedQualities: ["128k"],
            },
        );

        expect(result).toEqual([
            { key: "128k", status: "declared" },
            { key: "master", status: "resolved" },
        ]);
    });

    it("normalizes legacy quality keys and keeps the compatibility fallback honest", () => {
        expect(
            getQualityOptions(musicItem, {
                supportedQualities: ["low", "high", "super"],
            }),
        ).toEqual([
            { key: "128k", status: "declared" },
            { key: "320k", status: "declared" },
            { key: "flac", status: "declared" },
        ]);

        expect(getQualityOptions(musicItem)).toEqual([
            { key: "128k", status: "unknown" },
            { key: "320k", status: "unknown" },
            { key: "flac", status: "unknown" },
        ]);
        expect(getAvailableQualities(musicItem)).toEqual([]);
    });

    it("returns only resolved qualities for availability badges", () => {
        expect(
            getAvailableQualities(
                {
                    ...musicItem,
                    qualities: {
                        "128k": { size: 1024 },
                    },
                    source: {
                        flac: {
                            url: "https://example.com/track.flac",
                        },
                    },
                },
                {
                    supportedQualities: ["128k", "320k", "flac", "hires"],
                },
            ),
        ).toEqual(["flac"]);
    });
});
