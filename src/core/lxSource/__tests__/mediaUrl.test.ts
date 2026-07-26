import {
    validateRemoteMediaUrl,
} from "../mediaUrl";

describe("validateRemoteMediaUrl", () => {
    it.each([
        "",
        "file:///sdcard/song.mp3",
        `${"java"}script:alert(1)`,
        "data:audio/mp3;base64,AA==",
        "https://user:password@example.com/song.mp3",
        "http://127.0.0.1/song.mp3",
        "http://media.example.com/live.m3u8",
        "https://[::1]/song.mp3",
        "not a url",
    ])("rejects an unsupported media URL: %s", url => {
        expect(validateRemoteMediaUrl(url).ok).toBe(false);
    });

    it.each([
        "https://example.com/song.mp3?token=abc",
    ])("accepts a remote HTTPS media URL: %s", url => {
        expect(validateRemoteMediaUrl(` ${url} `)).toEqual({
            ok: true,
            url,
        });
    });

    it("accepts public HTTP only when the compatibility policy allows it", () => {
        const url = "http://media.example.com/live.m3u8";
        expect(validateRemoteMediaUrl(url).ok).toBe(false);
        expect(validateRemoteMediaUrl(url, { allowHttp: true })).toEqual({
            ok: true,
            url,
        });
        expect(validateRemoteMediaUrl(
            "http://127.0.0.1/song.mp3",
            { allowHttp: true },
        ).ok).toBe(false);
    });

    it("rejects an oversized media URL", () => {
        expect(validateRemoteMediaUrl(
            `https://example.com/${"a".repeat(17 * 1024)}`,
        ).ok).toBe(false);
    });

    it("rejects non-string values", () => {
        expect(validateRemoteMediaUrl({ url: "https://example.com" }).ok)
            .toBe(false);
    });
});
