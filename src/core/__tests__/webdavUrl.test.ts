import { validateWebdavUrl } from "../webdavUrl";

describe("validateWebdavUrl", () => {
    it.each([
        "",
        "not-a-url",
        "http://example.com/dav",
        "ftp://example.com/dav",
        "https://user:password@example.com/dav",
    ])("rejects an unsafe WebDAV URL: %s", url => {
        expect(validateWebdavUrl(url).ok).toBe(false);
    });

    it("accepts and normalizes an HTTPS endpoint", () => {
        expect(
            validateWebdavUrl(" https://dav.example.com/remote.php/dav "),
        ).toEqual({
            ok: true,
            url: "https://dav.example.com/remote.php/dav",
        });
    });

    it("drops fragments before the URL reaches the WebDAV client", () => {
        expect(validateWebdavUrl("https://dav.example.com/root#local")).toEqual({
            ok: true,
            url: "https://dav.example.com/root",
        });
    });
});
