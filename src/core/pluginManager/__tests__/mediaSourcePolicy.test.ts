import { validatePluginMediaSourceUrl } from "../mediaSourcePolicy";

describe("validatePluginMediaSourceUrl", () => {
    it.each([
        [
            " https://media.example.com/song.mp3?token=abc ",
            "https://media.example.com/song.mp3?token=abc",
        ],
        ["file:///data/user/0/app/files/song.mp3", "file:///data/user/0/app/files/song.mp3"],
        [
            "content://media/external/audio/media/42",
            "content://media/external/audio/media/42",
        ],
    ])("accepts an approved media source: %s", (input, expected) => {
        expect(validatePluginMediaSourceUrl(input)).toEqual({
            ok: true,
            url: expected,
        });
    });

    it.each([
        "",
        "http://media.example.com/song.mp3",
        "https://user:password@example.com/song.mp3",
        "https://127.0.0.1/song.mp3",
        "file://server/share/song.mp3",
        "content:///missing-authority",
        "/storage/emulated/0/Music/song.mp3",
        "data:audio/mp3;base64,AA==",
        ["java", "script:alert(1)"].join(""),
        "ftp://example.com/song.mp3",
        "rtmp://example.com/live",
        "custom-player://example.com/song",
    ])("rejects a source that can bypass the player boundary: %s", input => {
        expect(validatePluginMediaSourceUrl(input).ok).toBe(false);
    });

    it("allows only public HTTP when the compatibility policy is explicit", () => {
        expect(validatePluginMediaSourceUrl(
            "http://media.example.com/song.mp3",
            { allowHttp: true },
        )).toEqual({
            ok: true,
            url: "http://media.example.com/song.mp3",
        });
        expect(validatePluginMediaSourceUrl(
            "http://192.168.1.2/song.mp3",
            { allowHttp: true },
        ).ok).toBe(false);
    });
});
