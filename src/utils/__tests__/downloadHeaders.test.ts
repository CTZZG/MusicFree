import { createDownloadHeaders } from "../downloadHeaders";

describe("createDownloadHeaders", () => {
    it("normalizes string-like header values and drops empty keys", () => {
        expect(
            createDownloadHeaders({
                Referer: "https://example.com",
                " X-Number ": 123,
                Empty: "",
                Blank: "   ",
                Padded: "  value  ",
                Nullish: null,
                Undefined: undefined,
                "": "ignored",
            }),
        ).toEqual({
            Referer: "https://example.com",
            "X-Number": "123",
            Padded: "value",
        });
    });

    it("adds User-Agent only when headers do not already include one", () => {
        expect(createDownloadHeaders(undefined, " MusicFree/1.0 ")).toEqual({
            "User-Agent": "MusicFree/1.0",
        });
        expect(
            createDownloadHeaders(
                {
                    "user-agent": "Plugin-UA",
                },
                "MusicFree/1.0",
            ),
        ).toEqual({
            "user-agent": "Plugin-UA",
        });
    });

    it("returns undefined when no usable header exists", () => {
        expect(createDownloadHeaders({ Empty: "" }, "   ")).toBeUndefined();
    });
});
