import axios from "axios";
import { downloadRemoteLxSource } from "../remoteSource";

jest.mock("axios", () => ({
    __esModule: true,
    default: Object.assign(jest.fn(), {
        isAxiosError: jest.fn(),
    }),
}));

function axiosResponse(data: string) {
    return {
        data,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
        request: { responseURL: "https://example.com/source.js" },
    } as any;
}

describe("downloadRemoteLxSource", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each([
        "http://example.com/source.js",
        "file:///tmp/source.js",
        "https://localhost/source.js",
        "https://127.0.0.1/source.js",
        "https://192.168.1.1/source.js",
        "https://user:password@example.com/source.js",
    ])("rejects unsafe source URL without making a request: %s", async url => {
        await expect(downloadRemoteLxSource(url)).rejects.toThrow();
        expect(axios).not.toHaveBeenCalled();
    });

    it("normalizes the URL and disables redirects", async () => {
        jest.mocked(axios).mockResolvedValue(
            axiosResponse("module.exports = {};"),
        );

        await expect(
            downloadRemoteLxSource(" https://example.com/source.js "),
        ).resolves.toEqual({
            script: "module.exports = {};",
            sourceUrl: "https://example.com/source.js",
        });
        expect(axios).toHaveBeenCalledWith(
            "https://example.com/source.js",
            expect.objectContaining({
                maxRedirects: 0,
            }),
        );
    });

    it("rejects an empty response", async () => {
        jest.mocked(axios).mockResolvedValue(axiosResponse(" \n "));
        await expect(
            downloadRemoteLxSource("https://example.com/source.js"),
        ).rejects.toThrow("empty");
    });
});
