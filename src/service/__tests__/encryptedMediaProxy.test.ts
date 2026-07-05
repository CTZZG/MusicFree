jest.mock("@/native/cenc", () => ({
    __esModule: true,
    default: {
        isAvailable: jest.fn(),
        registerStream: jest.fn(),
    },
}));

const mockCenc = jest.requireMock("@/native/cenc").default as {
    isAvailable: jest.Mock;
    registerStream: jest.Mock;
};
const {
    canProxyCencSource,
    getPlayableCencKey,
    isUnsupportedEncryptedMediaSource,
    resolveEncryptedMediaStreamIfNeeded,
} = require("../encryptedMediaProxy") as typeof import("../encryptedMediaProxy");

const cek = "00112233445566778899aabbccddeeff";

describe("encrypted media proxy", () => {
    beforeEach(() => {
        mockCenc.isAvailable.mockReturnValue(false);
        mockCenc.registerStream.mockReset();
    });

    it("accepts only HTTP(S) CENC MMP4 sources with a valid CEK", () => {
        expect(
            getPlayableCencKey({
                url: "https://example.com/song.mmp4?token=1",
                cek: ` ${cek} `,
            }),
        ).toBe(cek);
        expect(
            getPlayableCencKey({
                url: "http://example.com/song.MMP4#hash",
                cek,
            }),
        ).toBe(cek);
        expect(
            getPlayableCencKey({
                url: "file:///sdcard/Music/song.mmp4",
                cek,
            }),
        ).toBeUndefined();
        expect(
            getPlayableCencKey({
                url: "https://example.com/song.m4a",
                cek,
            }),
        ).toBeUndefined();
        expect(
            getPlayableCencKey({
                url: "https://example.com/song.mmp4",
                cek: "not-a-32-byte-hex-key",
            }),
        ).toBeUndefined();
    });

    it("requires the native CENC module before proxying", () => {
        const source = {
            url: "https://example.com/song.mmp4",
            cek,
        };

        expect(canProxyCencSource(source)).toBe(false);

        mockCenc.isAvailable.mockReturnValue(true);

        expect(canProxyCencSource(source)).toBe(true);
    });

    it("keeps encrypted CENC blocked when the native module is unavailable", () => {
        expect(
            isUnsupportedEncryptedMediaSource({
                url: "https://example.com/song.mmp4",
                cek,
            }),
        ).toBe(true);

        mockCenc.isAvailable.mockReturnValue(true);

        expect(
            isUnsupportedEncryptedMediaSource({
                url: "https://example.com/song.mmp4",
                cek,
            }),
        ).toBe(false);
    });

    it("registers a local stream and folds userAgent into headers", async () => {
        mockCenc.isAvailable.mockReturnValue(true);
        mockCenc.registerStream.mockResolvedValue("http://127.0.0.1:1234/l/a.m4a");

        const result = await resolveEncryptedMediaStreamIfNeeded({
            url: "https://example.com/song.mmp4",
            headers: {
                referer: "https://example.com/",
            },
            userAgent: "MusicFree/Test",
            ekey: "legacy-key",
            cek,
        });

        expect(mockCenc.registerStream).toHaveBeenCalledWith(
            "https://example.com/song.mmp4",
            cek,
            {
                referer: "https://example.com/",
                "User-Agent": "MusicFree/Test",
            },
        );
        expect(result).toMatchObject({
            url: "http://127.0.0.1:1234/l/a.m4a",
            headers: undefined,
            ekey: undefined,
            cek,
        });
    });

    it("preserves an explicit user-agent header case-insensitively", async () => {
        mockCenc.isAvailable.mockReturnValue(true);
        mockCenc.registerStream.mockResolvedValue("http://127.0.0.1:1234/l/a.m4a");

        await resolveEncryptedMediaStreamIfNeeded({
            url: "https://example.com/song.mmp4",
            headers: {
                "User-Agent": "Plugin/UA",
            },
            userAgent: "MusicFree/Test",
            cek,
        });

        expect(mockCenc.registerStream).toHaveBeenCalledWith(
            "https://example.com/song.mmp4",
            cek,
            {
                "User-Agent": "Plugin/UA",
            },
        );
    });

    it("normalizes proxy headers before registering a local stream", async () => {
        mockCenc.isAvailable.mockReturnValue(true);
        mockCenc.registerStream.mockResolvedValue("http://127.0.0.1:1234/l/a.m4a");

        await resolveEncryptedMediaStreamIfNeeded({
            url: "https://example.com/song.mmp4",
            headers: {
                " Referer ": "https://example.com/",
                Empty: "",
                Numeric: 123,
                Nullish: null,
            },
            cek,
        });

        expect(mockCenc.registerStream).toHaveBeenCalledWith(
            "https://example.com/song.mmp4",
            cek,
            {
                Referer: "https://example.com/",
                Numeric: "123",
            },
        );
    });

    it("rejects invalid native local stream URLs", async () => {
        mockCenc.isAvailable.mockReturnValue(true);
        mockCenc.registerStream.mockResolvedValue("https://example.com/not-local.m4a");

        await expect(
            resolveEncryptedMediaStreamIfNeeded({
                url: "https://example.com/song.mmp4",
                cek,
            }),
        ).rejects.toThrow("invalid local stream URL");

        mockCenc.registerStream.mockResolvedValue("");

        await expect(
            resolveEncryptedMediaStreamIfNeeded({
                url: "https://example.com/song.mmp4",
                cek,
            }),
        ).rejects.toThrow("invalid local stream URL");
    });

    it("accepts localhost native stream URLs", async () => {
        mockCenc.isAvailable.mockReturnValue(true);
        mockCenc.registerStream.mockResolvedValue("http://localhost:1234/l/a.m4a");

        await expect(
            resolveEncryptedMediaStreamIfNeeded({
                url: "https://example.com/song.mmp4",
                cek,
            }),
        ).resolves.toMatchObject({
            url: "http://localhost:1234/l/a.m4a",
        });
    });
});
