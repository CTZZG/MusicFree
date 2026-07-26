import {
    getArtworkUri,
    getNativeArtworkUri,
    isUsableArtworkUri,
} from "../artworkSourcePolicy";

describe("artworkSourcePolicy", () => {
    it("normalizes string and React Native uri values", () => {
        expect(getArtworkUri(" file:///cover.jpg ")).toBe(
            "file:///cover.jpg",
        );
        expect(getArtworkUri({ uri: " content://cover/1 " })).toBe(
            "content://cover/1",
        );
        expect(getArtworkUri({ uri: 42 })).toBe("");
    });

    it.each([
        "https://localhost/cover.jpg",
        "https://127.0.0.1/cover.jpg",
        "https://10.0.0.1/cover.jpg",
        "https://user:secret@example.com/cover.jpg",
        "http://example.com/cover.jpg",
        ["java", "script:alert(1)"].join(""),
    ])("rejects unsafe artwork URLs: %s", uri => {
        expect(isUsableArtworkUri(uri)).toBe(false);
        expect(getNativeArtworkUri(uri)).toBeUndefined();
    });

    it("separates UI-only artwork schemes from native consumers", () => {
        expect(isUsableArtworkUri("data:image/png;base64,AA==")).toBe(true);
        expect(getNativeArtworkUri("data:image/png;base64,AA=="))
            .toBeUndefined();
        expect(getNativeArtworkUri("content://cover/1")).toBe(
            "content://cover/1",
        );
        expect(getNativeArtworkUri("/storage/emulated/0/cover.jpg")).toBe(
            "/storage/emulated/0/cover.jpg",
        );
        expect(getNativeArtworkUri("https://example.com/cover.jpg")).toBe(
            "https://example.com/cover.jpg",
        );
    });
});
