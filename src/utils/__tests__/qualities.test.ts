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
