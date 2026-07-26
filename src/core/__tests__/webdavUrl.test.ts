import {
    isHttpWebdavUrl,
    requiresWebdavHttpConfirmation,
    validateWebdavUrl,
} from "../webdavUrl";

describe("validateWebdavUrl", () => {
    it.each([
        "",
        "not-a-url",
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

    it.each([
        "https://192.168.1.20/dav",
        "https://nas.local/dav",
        "http://192.168.1.20/dav",
        "http://nas.local/dav",
        "http://dav.example.com/dav",
    ])("accepts an explicitly configured HTTP(S) endpoint: %s", url => {
        expect(validateWebdavUrl(url)).toEqual({
            ok: true,
            url,
        });
    });

    it("identifies HTTP without treating HTTPS as insecure", () => {
        expect(isHttpWebdavUrl("http://nas.local/dav")).toBe(true);
        expect(isHttpWebdavUrl("https://nas.local/dav")).toBe(false);
        expect(isHttpWebdavUrl("not-a-url")).toBe(false);
    });

    it("requires confirmation only when saving a new HTTP endpoint", () => {
        expect(requiresWebdavHttpConfirmation(
            undefined,
            "http://nas.local/dav",
        )).toBe(true);
        expect(requiresWebdavHttpConfirmation(
            "https://nas.local/dav",
            "http://nas.local/dav",
        )).toBe(true);
        expect(requiresWebdavHttpConfirmation(
            "http://nas.local/dav",
            "http://nas.local/dav",
        )).toBe(false);
        expect(requiresWebdavHttpConfirmation(
            "http://nas.local/dav",
            "https://nas.local/dav",
        )).toBe(false);
    });

    it("drops fragments before the URL reaches the WebDAV client", () => {
        expect(validateWebdavUrl("https://dav.example.com/root#local")).toEqual({
            ok: true,
            url: "https://dav.example.com/root",
        });
    });
});
