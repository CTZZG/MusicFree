jest.mock("@/native/cenc", () => ({
    __esModule: true,
    default: {
        isAvailable: jest.fn(),
        registerStream: jest.fn(),
    },
}));

jest.mock("@/native/qmc", () => ({
    __esModule: true,
    default: {
        isAvailable: jest.fn(),
        registerStream: jest.fn(),
        inspectStream: jest.fn(),
    },
}));

const mockCenc = jest.requireMock("@/native/cenc").default as {
    isAvailable: jest.Mock;
    registerStream: jest.Mock;
};
const mockQmc = jest.requireMock("@/native/qmc").default as {
    isAvailable: jest.Mock;
    registerStream: jest.Mock;
    inspectStream: jest.Mock;
};
const {
    canProxyCencSource,
    canProxyQmcSource,
    getPlayableCencKey,
    getPlayableQmcEkey,
    inspectQmcMediaSource,
    isUnsupportedEncryptedMediaSource,
    resolveEncryptedMediaStreamIfNeeded,
} = require("../encryptedMediaProxy") as typeof import("../encryptedMediaProxy");

const cek = "00112233445566778899aabbccddeeff";

describe("encrypted media proxy", () => {
    beforeEach(() => {
        mockCenc.isAvailable.mockReturnValue(false);
        mockCenc.registerStream.mockReset();
        mockQmc.isAvailable.mockReturnValue(false);
        mockQmc.registerStream.mockReset();
        mockQmc.inspectStream.mockReset();
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
            trustedLocalMediaProxy: true,
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
            trustedLocalMediaProxy: true,
        });
    });

    it("recognizes embedded-key QMC URLs and external ekey sources", () => {
        expect(
            canProxyQmcSource({
                url: "https://example.com/song.mflac",
            }),
        ).toBe(false);

        mockQmc.isAvailable.mockReturnValue(true);

        expect(
            canProxyQmcSource({
                url: "https://example.com/song.mflac",
            }),
        ).toBe(true);
        expect(
            canProxyQmcSource({
                url: "https://example.com/opaque-file",
                ekey: " external-key ",
            }),
        ).toBe(true);
        expect(
            getPlayableQmcEkey({
                url: "https://example.com/opaque-file",
                ekey: " external-key ",
            }),
        ).toBe("external-key");
        expect(
            canProxyQmcSource({
                url: "https://example.com/song.mmp4",
                ekey: "legacy-key",
            }),
        ).toBe(false);
    });

    it("registers QMC sources without routing them through CENC", async () => {
        mockQmc.isAvailable.mockReturnValue(true);
        mockQmc.registerStream.mockResolvedValue(
            "http://127.0.0.1:1234/l/a.flac",
        );

        const result = await resolveEncryptedMediaStreamIfNeeded({
            url: "https://example.com/song.mflac",
            headers: { Referer: "https://example.com/" },
            ekey: " qmc-ekey ",
        });

        expect(mockQmc.registerStream).toHaveBeenCalledWith(
            "https://example.com/song.mflac",
            "qmc-ekey",
            { Referer: "https://example.com/" },
        );
        expect(mockCenc.registerStream).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            url: "http://127.0.0.1:1234/l/a.flac",
            headers: undefined,
            ekey: undefined,
            trustedLocalMediaProxy: true,
        });
    });

    it("inspects QMC output metadata for download naming", async () => {
        mockQmc.isAvailable.mockReturnValue(true);
        mockQmc.inspectStream.mockResolvedValue({
            audioSize: 123,
            extension: "ogg",
            contentType: "audio/ogg",
        });

        await expect(
            inspectQmcMediaSource({
                url: "https://example.com/song.mgg",
            }),
        ).resolves.toEqual({
            audioSize: 123,
            extension: "ogg",
            contentType: "audio/ogg",
        });
        expect(mockQmc.inspectStream).toHaveBeenCalledWith(
            "https://example.com/song.mgg",
            undefined,
            undefined,
        );
    });
});
