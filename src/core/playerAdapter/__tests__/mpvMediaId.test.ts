import { encodeMpvMediaId, matchesMpvMediaId } from "../mpvMediaId";

describe("mpv media browser IDs", () => {
    it("encodes queue snapshot IDs for media browser clients", () => {
        expect(encodeMpvMediaId("local@D:/Music/A&B 01.flac")).toBe(
            "local%40D%3A%2FMusic%2FA%26B%2001.flac",
        );
    });

    it("matches raw and encoded media IDs from remote clients", () => {
        const key = "local@D:/Music/A&B 01.flac";
        const id = "D:/Music/A&B 01.flac";

        expect(matchesMpvMediaId(key, id, key)).toBe(true);
        expect(matchesMpvMediaId(key, id, id)).toBe(true);
        expect(matchesMpvMediaId(key, id, encodeMpvMediaId(key))).toBe(true);
        expect(matchesMpvMediaId(key, id, encodeMpvMediaId(id))).toBe(true);
    });

    it("does not throw on malformed encoded IDs", () => {
        expect(matchesMpvMediaId("a@b", "b", "%E0%A4%A")).toBe(false);
    });
});
