jest.mock("@/constants/commonConst", () => ({
    supportLocalMediaType: [".mp3", ".flac", ".ogg", ".m4a", ".mp4"],
}));

jest.mock("@/utils/mediaExtra", () => ({
    getMediaExtraProperty: jest.fn(() => undefined),
}));

jest.mock("@/service/encryptedMediaProxy", () => ({
    canProxyCencSource: jest.fn(() => false),
}));

import { canProxyCencSource } from "@/service/encryptedMediaProxy";
import { getMediaFormatDiagnostics } from "../mediaFormatDiagnostics";

const mockCanProxyCencSource =
    canProxyCencSource as jest.MockedFunction<typeof canProxyCencSource>;

function createMusicItem(
    patch: Partial<IMusic.IMusicItem>,
): IMusic.IMusicItem {
    return {
        id: "test-id",
        title: "Test Song",
        artist: "Test Artist",
        platform: "test",
        ...patch,
    } as IMusic.IMusicItem;
}

describe("media format diagnostics", () => {
    beforeEach(() => {
        mockCanProxyCencSource.mockReturnValue(false);
    });

    it("reports M4A as playable and metadata-writable", () => {
        const diagnostics = getMediaFormatDiagnostics(
            createMusicItem({
                url: "https://example.com/song.m4a",
            }),
        );

        expect(diagnostics).toMatchObject({
            extension: "m4a",
            level: "supported",
            playable: true,
            downloadable: true,
            taggable: true,
            coverWritable: true,
            lyricWritable: true,
        });
    });

    it("infers media extensions through URL fragments and mixed case", () => {
        const diagnostics = getMediaFormatDiagnostics(
            createMusicItem({
                url: "https://example.com/Song.WMA#cache-bust",
            }),
        );

        expect(diagnostics).toMatchObject({
            extension: "wma",
            level: "partial",
            playable: true,
        });
    });

    it("keeps encrypted MMP4 sources blocked without a decrypt proxy", () => {
        const diagnostics = getMediaFormatDiagnostics(
            createMusicItem({
                url: "https://example.com/song.mmp4",
                ekey: "encrypted-key",
                cek: "00112233445566778899aabbccddeeff",
            }),
        );

        expect(diagnostics).toMatchObject({
            extension: "mmp4",
            level: "blocked",
            playable: false,
            downloadable: false,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
        });
        expect(diagnostics.reason).toContain("CENC");
        expect(diagnostics.reason).toContain("CEK");
    });

    it("reports CENC MMP4 sources as partially supported when the decrypt proxy is available", () => {
        mockCanProxyCencSource.mockReturnValue(true);

        const diagnostics = getMediaFormatDiagnostics(
            createMusicItem({
                url: "https://example.com/song.mmp4?token=1",
                cek: "00112233445566778899aabbccddeeff",
            }),
        );

        expect(mockCanProxyCencSource).toHaveBeenCalledWith({
            url: "https://example.com/song.mmp4?token=1",
            cek: "00112233445566778899aabbccddeeff",
        });
        expect(diagnostics).toMatchObject({
            extension: "mmp4",
            level: "partial",
            playable: true,
            downloadable: true,
            taggable: true,
            coverWritable: true,
            lyricWritable: true,
        });
        expect(diagnostics.reason).toContain("Range 代理");
    });
});
