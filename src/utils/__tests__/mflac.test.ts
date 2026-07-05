import {
    hasEncryptedMediaSource,
    isCencMediaUrl,
    isEncryptedMediaUrl,
    normalizeCek,
    normalizeEkey,
} from "../mflac";

describe("encrypted media helpers", () => {
    it("detects encrypted media URLs without query strings interfering", () => {
        expect(isEncryptedMediaUrl("https://example.com/song.mflac?token=1")).toBe(
            true,
        );
        expect(isEncryptedMediaUrl("https://example.com/song.MMP4#hash")).toBe(
            true,
        );
        expect(isEncryptedMediaUrl("https://example.com/song.flac")).toBe(
            false,
        );
    });

    it("detects CENC MMP4 URLs separately", () => {
        expect(isCencMediaUrl("https://example.com/song.mmp4?token=1")).toBe(
            true,
        );
        expect(isCencMediaUrl("https://example.com/song.mflac")).toBe(false);
    });

    it("normalizes decrypt keys", () => {
        expect(normalizeCek(" 001122 ")).toBe("001122");
        expect(normalizeEkey(`prefix-${"x".repeat(710)}`)).toHaveLength(704);
    });

    it("treats ekey-only sources as encrypted", () => {
        expect(hasEncryptedMediaSource("https://example.com/song.flac", "key")).toBe(
            true,
        );
    });
});
