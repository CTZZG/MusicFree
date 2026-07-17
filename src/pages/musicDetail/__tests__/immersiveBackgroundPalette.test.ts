import {
    createArtworkColorCacheKey,
    DEFAULT_IMMERSIVE_AMBIENT_COLOR,
    normalizeImmersiveAmbientColor,
    resolveImmersiveAmbientColor,
} from "../immersiveBackgroundPalette";

describe("immersiveBackgroundPalette", () => {
    it("uses the Android average color as the ambient base", () => {
        const colors = {
            platform: "android",
            average: "#b8896f",
            dominant: "#050505",
            vibrant: "#ff0000",
            darkVibrant: "#330000",
            lightVibrant: "#ff8888",
            muted: "#886f68",
            darkMuted: "#332b29",
            lightMuted: "#d8c7c0",
        } as const;

        expect(resolveImmersiveAmbientColor(colors)).toBe(
            normalizeImmersiveAmbientColor(colors.average),
        );
    });

    it("uses the iOS background color as the ambient base", () => {
        const colors = {
            platform: "ios",
            background: "#567a9a",
            primary: "#ffffff",
            secondary: "#90aabb",
            detail: "#223344",
            quality: "low",
        } as const;

        expect(resolveImmersiveAmbientColor(colors)).toBe(
            normalizeImmersiveAmbientColor(colors.background),
        );
    });

    it("darkens bright artwork colors enough for a white control layer", () => {
        const normalizedColor = normalizeImmersiveAmbientColor("#ffffff");
        const redChannel = Number.parseInt(normalizedColor.slice(1, 3), 16);

        expect(redChannel).toBeLessThan(190);
    });

    it("falls back safely when a palette entry is malformed", () => {
        expect(normalizeImmersiveAmbientColor("not-a-color")).toBe(
            DEFAULT_IMMERSIVE_AMBIENT_COLOR,
        );
    });

    it("creates short stable cache keys without embedding the artwork URL", () => {
        const artwork =
            "https://example.com/a/very/long/artwork/path/cover.jpg?token=secret";
        const cacheKey = createArtworkColorCacheKey(artwork);

        expect(cacheKey).toBe(createArtworkColorCacheKey(artwork));
        expect(cacheKey).not.toContain("example.com");
        expect(cacheKey.length).toBeLessThan(40);
        expect(createArtworkColorCacheKey(`${artwork}-next`)).not.toBe(cacheKey);
    });
});
