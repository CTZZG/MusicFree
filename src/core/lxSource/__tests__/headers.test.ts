import { createReachableMediaSourceHeaders } from "../headers";

describe("lxSource reachable media source headers", () => {
    it("normalizes headers and appends a one-byte range probe", () => {
        expect(
            createReachableMediaSourceHeaders({
                userAgent: " MusicFree/Test ",
                headers: {
                    " Referer ": " https://example.com ",
                    Empty: "",
                    Numeric: 123,
                },
            }),
        ).toEqual({
            Referer: "https://example.com",
            Numeric: "123",
            "User-Agent": "MusicFree/Test",
            Range: "bytes=0-0",
        });
    });

    it("preserves plugin User-Agent and forces the probe range", () => {
        expect(
            createReachableMediaSourceHeaders({
                userAgent: "MusicFree/Test",
                headers: {
                    "user-agent": "Plugin/UA",
                    Range: "bytes=10-20",
                },
            }),
        ).toEqual({
            "user-agent": "Plugin/UA",
            Range: "bytes=0-0",
        });
    });
});
